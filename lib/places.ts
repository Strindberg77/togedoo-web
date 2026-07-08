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

/**
 * Nærmeste adresse for et punkt (Kartverket punktsøk), med cache i
 * geocode_cache (nøkkel `rev:<lat>,<lng>` avrundet til 5 desimaler ≈ 1 m).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
    const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = await fromCache(key);
    if (cached !== undefined) return cached;

    let result: ReverseGeocodeResult | null = null;
    try {
        const params = new URLSearchParams({
            lat: String(lat),
            lon: String(lng),
            radius: '200',
            treffPerSide: '1',
            koordsys: '4258',
        });
        const res = await fetch(`https://ws.geonorge.no/adresser/v1/punktsok?${params}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        if (res.ok) {
            const data = await res.json();
            const hit = data?.adresser?.[0];
            if (hit?.adressetekst) {
                result = {
                    addressText: hit.adressetekst,
                    street: stripHouseNumber(hit.adressetekst),
                    postalPlace: hit.poststed ?? null,
                };
            }
        }
    } catch {
        // Nettverksfeil: ikke cache, prøv igjen neste import.
        return null;
    }
    await saveCache(key, result);
    return result;
}

/**
 * Tittel for et importert sted: ekte OSM-navn hvis brukbart, ellers
 * "<Kategori> ved <gate>" / "<Kategori> i <poststed>" / "<Kategori>".
 */
export async function makePlaceTitle(
    categoryLabel: string,
    osmName: string | null | undefined,
    lat: number,
    lng: number
): Promise<string> {
    if (isUsablePlaceName(osmName)) return osmName!.trim();
    const rev = await reverseGeocode(lat, lng);
    if (rev?.street) return `${categoryLabel} ved ${rev.street}`;
    if (rev?.postalPlace) return `${categoryLabel} i ${rev.postalPlace}`;
    return categoryLabel;
}
