// lib/places.ts
// Tittelgenerering for faste steder (kind='place') fra OSM-import.
//
// Undersøkelsen (jul. 2026) viste at adresse-tagger i praksis ikke finnes
// i norsk OSM (0 % i alle utvalg) og at name-taggen er ujevn (0–57 %) og
// ofte kopiert fra gate- eller institusjonsnavn. Strategi:
//   1. Bruk name-taggen når den finnes OG ser ut som et ekte stedsnavn.
//   2. Ellers: revers-geokod punktet (Kartverket punktsøk) og generer
//      "Lekeplass ved Storgata" / "Badeplass i Vollen".
// Koordinatene fra OSM brukes alltid direkte (100 % dekning i utvalgene);
// revers-geokodingen er kun for lesbare titler.
import { supabaseAdmin, isDatahubConfigured } from './supabase';

const USER_AGENT = 'Togedoo datahub (hello@togedoo.com)';

// Ord som viser at navnet beskriver stedet selv — da stoler vi på det,
// selv om det også inneholder gate-/institusjonsord.
const TRUSTED_WORDS =
    /(lekeplass|leikeplass|park(en)?$|ballbinge|balløkke|bane|anlegg|hall(en)?$|strand(a|en)?$|badeplass|friområde|tufte|aktivitets)/i;

// Første sil for "navnet er trolig kopiert fra en annen tagg" — justeres
// etter hvert som importen viser reelle feiltreff.
const SUSPICIOUS_PATTERNS: RegExp[] = [
    // Institusjon/eier, ikke stedets eget navn ("Auglend barnehage")
    /\b(barnehage|barnehagen|skole|skolen|sfo|borettslag|sameie|velforening|kirke|menighet)\b/i,
    // Rent gatenavn ("A. B. C. gata", "Håkavikveien")
    /(gata|gaten|gate|veien|vegen|vei|svingen|allé|alleen)$/i,
    // Ender med husnummer ("Storgata 5", "Storgata 5B")
    /\d+\s*[A-ZÆØÅ]?$/,
];

/** Ser name-taggen ut som et ekte stedsnavn, eller trolig kopiert fra
 *  gate/institusjon? Tillitsord vinner over mistankemønstre. */
export function isUsablePlaceName(name: string | null | undefined): boolean {
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length < 3) return false;
    if (TRUSTED_WORDS.test(trimmed)) return true;
    return !SUSPICIOUS_PATTERNS.some((re) => re.test(trimmed));
}

export interface ReverseGeocodeResult {
    street: string | null; // "Storgata" (uten husnummer)
    addressText: string | null; // "Storgata 5"
    postalPlace: string | null; // "Vollen"
}

function stripHouseNumber(addressText: string): string {
    return addressText.replace(/\s+\d+\s*[A-ZÆØÅ]?$/, '').trim();
}

async function fromCache(key: string): Promise<ReverseGeocodeResult | null | undefined> {
    if (!isDatahubConfigured()) return undefined;
    const { data } = await supabaseAdmin()
        .from('geocode_cache')
        .select('formatted_address, provider')
        .eq('query', key)
        .maybeSingle();
    if (!data) return undefined;
    if (!data.formatted_address) return null; // cachet negativt treff
    const [addressText, postalPlace] = data.formatted_address.split('|');
    return {
        addressText: addressText || null,
        street: addressText ? stripHouseNumber(addressText) : null,
        postalPlace: postalPlace || null,
    };
}

async function saveCache(key: string, result: ReverseGeocodeResult | null): Promise<void> {
    if (!isDatahubConfigured()) return;
    await supabaseAdmin()
        .from('geocode_cache')
        .upsert(
            {
                query: key,
                lat: null,
                lng: null,
                formatted_address: result ? `${result.addressText ?? ''}|${result.postalPlace ?? ''}` : null,
                provider: 'kartverket-punktsok',
            },
            { onConflict: 'query' }
        );
}

export type ReverseOutcome =
    | { ok: true; result: ReverseGeocodeResult }
    | { ok: false; reason: string };

/**
 * Nærmeste adresse for et punkt (Kartverket punktsøk), med cache i
 * geocode_cache (nøkkel `rev:<lat>,<lng>` avrundet til 5 desimaler ≈ 1 m).
 * Feiler ALDRI stille: alle feilmoduser returneres som { ok: false, reason }.
 */
export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<ReverseOutcome> {
    const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = await fromCache(key);
    if (cached === null) return { ok: false, reason: 'cachet negativt treff' };
    if (cached !== undefined) return { ok: true, result: cached };

    try {
        // Ingen koordsys-parameter: API-ets standard (EPSG:4258 ≈ WGS84)
        // er riktig for OSM-koordinater.
        const params = new URLSearchParams({
            lat: String(lat),
            lon: String(lng),
            radius: '200',
            treffPerSide: '1',
        });
        const url = `https://ws.geonorge.no/adresser/v1/punktsok?${params}`;

        // Forbigående feil (429/5xx, timeout, nettverksfeil) retryes med
        // backoff — men hvert forsøk har egen timeout (et hengende TCP-kall
        // uten AbortSignal låste hele importen, jul. 2026), og hele stedet
        // har et totalbudsjett så ett problematisk punkt aldri blokkerer
        // resten av kjøringen.
        const TIMEOUT_MS = Number(process.env.PUNKTSOK_TIMEOUT_MS ?? 8000);
        const BUDGET_MS = Number(process.env.PUNKTSOK_BUDGET_MS ?? 20000);
        const BACKOFFS_MS = [2000, 4000];
        const started = Date.now();
        let res: Response | null = null;
        let transient = '';
        for (let attempt = 0; ; attempt++) {
            try {
                res = await fetch(url, {
                    headers: { 'User-Agent': USER_AGENT },
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                });
            } catch (err) {
                res = null;
                transient =
                    err instanceof Error && err.name === 'TimeoutError'
                        ? `timeout etter ${TIMEOUT_MS / 1000} s`
                        : `nettverksfeil: ${err instanceof Error ? err.message : String(err)}`;
            }
            if (res) {
                if (res.ok) break;
                if (![429, 500, 502, 503].includes(res.status)) {
                    const body = (await res.text()).slice(0, 120);
                    return { ok: false, reason: `HTTP ${res.status}: ${body}` };
                }
                transient = `HTTP ${res.status}`;
            }
            const backoff = BACKOFFS_MS[attempt];
            const wouldExceedBudget =
                backoff === undefined || Date.now() - started + backoff + TIMEOUT_MS > BUDGET_MS;
            if (wouldExceedBudget) {
                return {
                    ok: false,
                    reason: `${transient} (ga opp etter ${attempt + 1} forsøk, ${Math.round((Date.now() - started) / 1000)} s)`,
                };
            }
            await new Promise((r) => setTimeout(r, backoff));
        }
        const data = await res!.json();
        const hit = data?.adresser?.[0];
        if (!hit?.adressetekst) {
            await saveCache(key, null);
            return { ok: false, reason: 'ingen adresse innen 200 m' };
        }
        const street = stripHouseNumber(hit.adressetekst);
        const result: ReverseGeocodeResult = {
            addressText: hit.adressetekst,
            // En adressetekst som bare er husnummer gir ikke brukbart gatenavn.
            street: street && !/^\d+\s*[A-ZÆØÅ]?$/.test(street) ? street : null,
            postalPlace: hit.poststed ?? null,
        };
        await saveCache(key, result);
        return { ok: true, result };
    } catch (err) {
        // Nettverksfeil: ikke cache, prøv igjen neste import.
        return { ok: false, reason: `nettverksfeil: ${err instanceof Error ? err.message : String(err)}` };
    }
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
    const outcome = await reverseGeocodeDetailed(lat, lng);
    return outcome.ok ? outcome.result : null;
}

export type TitleSource = 'osm-navn' | 'ved-gate' | 'i-poststed' | 'kun-kategori';

export interface PlaceTitle {
    title: string;
    source: TitleSource;
    /** Satt når fallback til kategoritekst skyldes geokodingsfeil, ikke ekte mangel. */
    geocodeError?: string;
}

/**
 * Tittel for et importert sted, med sporbar kilde: ekte OSM-navn hvis
 * brukbart, ellers "<Kategori> ved <gate>" / "<Kategori> i <poststed>" /
 * ren kategoritekst (siste utvei — geocodeError skiller feil fra mangel).
 */
export async function makePlaceTitleDetailed(
    categoryLabel: string,
    osmName: string | null | undefined,
    lat: number,
    lng: number
): Promise<PlaceTitle> {
    if (isUsablePlaceName(osmName)) return { title: osmName!.trim(), source: 'osm-navn' };
    const outcome = await reverseGeocodeDetailed(lat, lng);
    if (outcome.ok && outcome.result.street) {
        return { title: `${categoryLabel} ved ${outcome.result.street}`, source: 'ved-gate' };
    }
    if (outcome.ok && outcome.result.postalPlace) {
        return { title: `${categoryLabel} i ${outcome.result.postalPlace}`, source: 'i-poststed' };
    }
    return {
        title: categoryLabel,
        source: 'kun-kategori',
        geocodeError: outcome.ok ? undefined : outcome.reason,
    };
}

export async function makePlaceTitle(
    categoryLabel: string,
    osmName: string | null | undefined,
    lat: number,
    lng: number
): Promise<string> {
    return (await makePlaceTitleDetailed(categoryLabel, osmName, lat, lng)).title;
}

// ---------------------------------------------------------------------------
// Brukertips om nye steder (/tips): validering. Selve innsendingen
// gjenbruker activities-tabellen med kind='place' og status='pending'.
// ---------------------------------------------------------------------------

export const PLACE_TIP_CATEGORIES = [
    'Lekeplass',
    'Ballbane',
    'Park',
    'Idrettshall',
    'Badeplass',
    'Museum',
    'Annet',
] as const;

export interface PlaceTip {
    title: string;
    category: string;
    description: string;
    address: string | null;
    municipality: string;
    imageUrl: string | null;
    contactEmail: string;
}

const TIP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tipStr(value: unknown, maxLen: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= maxLen ? trimmed : null;
}

export function validatePlaceTip(body: unknown): { tip: PlaceTip | null; errors: string[] } {
    const errors: string[] = [];
    const b = (body ?? {}) as Record<string, unknown>;

    const title = tipStr(b.title, 200);
    if (!title) errors.push('Navn på stedet er påkrevd (maks 200 tegn).');

    const category = tipStr(b.category, 50) ?? 'Annet';
    if (!PLACE_TIP_CATEGORIES.includes(category as (typeof PLACE_TIP_CATEGORIES)[number])) {
        errors.push(`Ugyldig kategori. Gyldige: ${PLACE_TIP_CATEGORIES.join(', ')}.`);
    }

    const municipality = tipStr(b.municipality, 100);
    if (!municipality) errors.push('Kommune er påkrevd.');

    const contactEmail = tipStr(b.contactEmail, 200);
    if (!contactEmail || !TIP_EMAIL_RE.test(contactEmail)) {
        errors.push('Gyldig kontakt-e-post er påkrevd.');
    }

    let imageUrl: string | null = null;
    const imageRaw = tipStr(b.imageUrl, 2000);
    if (imageRaw) {
        try {
            const u = new URL(imageRaw);
            if (u.protocol === 'http:' || u.protocol === 'https:') imageUrl = u.href;
            else errors.push('Bilde-URL må være http/https.');
        } catch {
            errors.push('Bilde-URL er ugyldig.');
        }
    }

    if (errors.length > 0) return { tip: null, errors };
    return {
        tip: {
            title: title!,
            category,
            description: tipStr(b.description, 2000) ?? '',
            address: tipStr(b.address, 300),
            municipality: municipality!,
            imageUrl,
            contactEmail: contactEmail!,
        },
        errors: [],
    };
}
