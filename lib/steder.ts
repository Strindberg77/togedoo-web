// lib/steder.ts
//
// STEDSFORSLAG TIL SØKET: «Geilo · tettsted i Hol – se hva som finnes i
// nærheten».
//
// Aktivitetssøket (/api/activities) finner SkiGeilo når noen skriver «Geilo».
// Det finner ikke GEILO — stedet — for det finnes ingen rad for et tettsted.
// Verken Geilo eller Ski er kommuner, så kommunelista i data/ holder ikke.
// Kartverkets stedsnavn-API har dem, og denne modulen gjør svaret derfra om
// til en kort liste appen kan tilby. Appen kaller aldri Kartverket selv:
// togedoo-web er datahubben.
//
// Kontrakten står i docs/api-steder.md.
//
// ─────────────────────────────────────────────────────────────────────────
// KILDEN: api.kartverket.no/stedsnavn/v1/sted
//
// Valgt ut fra openapi.json (lest 18. sep. 2026), ikke antatt:
//
//   * /sted, ikke /navn: /sted gir ett treff per STED med alle navnene, og
//     er det eneste av de to som tar `navneobjekttype` som filter. Filteret
//     må ligge hos Kartverket — «Nes» gir 217 treff ufiltrert, og 101 av dem
//     er gårder.
//   * api.kartverket.no, ikke ws.geonorge.no: spesifikasjonen sier at
//     ws.geonorge.no bare er en proxy «inntil videre», og anbefaler å bytte.
//   * utkoordsys=4258 (ETRS89). Forskjellen fra WGS84 er under en meter i
//     Norge, og mindre enn noe appen viser.
//
// ─────────────────────────────────────────────────────────────────────────
// TO KALL, ETT SVAR
//
// Kartverket sorterer på STEDSKATEGORI først og treffkvalitet etterpå. Med
// bare et prefikssøk («Sand*») kommer Sandefjord og Sandnes (by) før
// tettstedet Sand — og med 115 treff kan det eksakte navnet havne på side 3.
// Derfor to kall i parallell: eksakt («Sand») og prefiks («Sand*»). Det
// eksakte er lite (7 treff for Sand) og alltid komplett; prefikset fyller på.
//
// Prefikset trengs også for kommunene. De heter «Trysil kommune» og «Voss
// herad» i registeret, så et eksakt søk på «Trysil» finner ikke kommunen.

import { BILINGUAL_MUNICIPALITIES } from './municipality';

export const KARTVERKET_STED_URL = 'https://api.kartverket.no/stedsnavn/v1/sted';

/** Krediteringen appen skal vise der stedsforslagene står. */
export const KARTVERKET_ATTRIBUTION = 'Stedsnavn © Kartverket (CC BY 4.0)';

/**
 * NAVNEOBJEKTTYPENE SOM SLIPPES GJENNOM, med etiketten appen viser.
 *
 * Utvalget er «et sted en familie ville dra til»: noe med folk, butikker og
 * en skole — ikke en gård, en bekk eller en haug. Tallene fra ekte søk
 * (ufiltrert, 18. sep. 2026) viser hva som ellers ville fylt lista:
 *
 *   «Nes»:  217 treff — 101 gård, 61 bruk, 14 navnegard, 10 bru.
 *           Bare 6 er tettsted/bygd/tettbebyggelse.
 *   «Sand»: 104 treff — 51 bruk, 17 gård, 6 gammel bosettingsplass.
 *           Bare 7 er tettsted/grend/tettbebyggelse.
 *   «Ski»:  12 treff — 4 gård, 2 bruk, stasjon, bru, kirke. Byen Ski er én.
 *
 * Rekkefølgen er RANGERINGEN innenfor et like godt navnetreff: en by før et
 * tettsted før en grend. Kommunen står etter tettstedet med vilje. «Hemsedal»
 * er både kommune og bygd; «Voss» er både kommune (Voss herad) og tettsted
 * (Vossavangen). Tettstedet er der folk faktisk kjører til.
 *
 * UTELATT, OG HVORFOR:
 *   * fylke — for stort. «Se hva som finnes i nærheten» av Innlandet betyr
 *     ingenting.
 *   * poststed — dublerer tettstedene, og er en postgrense, ikke et sted.
 *   * annenAdministrativInndeling — mest TIDLIGERE kommuner («Ski kommune»,
 *     «Søgne kommune»). Å tilby et sted som ikke finnes lenger, er verre enn
 *     å ikke tilby det.
 *   * statistiskTettsted — to treff på «S*» i hele landet; SSB-definisjon,
 *     ikke et navn folk bruker.
 *   * landskapsområde, dalføre — «Trysil» og «Hemsedal» finnes også som
 *     dette, men kommunen og bygda med samme navn dekker dem, med et punkt
 *     der folk bor i stedet for midt i et fjellområde.
 */
export const STEDSTYPER: readonly { kode: string; typeNavn: string; etikett: string }[] = [
    { kode: 'by', typeNavn: 'By', etikett: 'by' },
    { kode: 'tettsted', typeNavn: 'Tettsted', etikett: 'tettsted' },
    { kode: 'kommune', typeNavn: 'Kommune', etikett: 'kommune' },
    { kode: 'bydel', typeNavn: 'Bydel', etikett: 'bydel' },
    { kode: 'administrativBydel', typeNavn: 'Administrativ bydel', etikett: 'bydel' },
    { kode: 'bygdelagBygd', typeNavn: 'Bygdelag (bygd)', etikett: 'bygd' },
    { kode: 'tettsteddel', typeNavn: 'Tettsteddel', etikett: 'del av tettsted' },
    // «Tettbebyggelse» er fagspråk. Kartverket beskriver det som et mindre
    // tettsted eller boligområde, og det er det siste folk kjenner igjen.
    { kode: 'tettbebyggelse', typeNavn: 'Tettbebyggelse', etikett: 'boligområde' },
    { kode: 'grend', typeNavn: 'Grend', etikett: 'grend' },
];

const TYPE_RANG = new Map(STEDSTYPER.map((t, i) => [t.typeNavn, i]));
const TYPE_ETIKETT = new Map(STEDSTYPER.map((t) => [t.typeNavn, t.etikett]));

/** Et stedsforslag slik API-et svarer. */
export interface Sted {
    /** Kartverkets stedsnummer. Stabil id for stedet. */
    id: string;
    /** Navnet appen viser («Geilo», «Voss», «Trysil»). */
    navn: string;
    /** Kort norsk typeetikett («tettsted», «by», «kommune»). */
    type: string;
    kommune: string | null;
    kommunenummer: string | null;
    fylke: string | null;
    lat: number;
    lng: number;
    /** Luftlinje i hele meter fra oppgitt posisjon, eller null uten posisjon. */
    distanceM: number | null;
    /** Traff søket navnet eksakt («Geilo»), eller bare starten («Geilomoen»)? */
    eksakt: boolean;
}

// ── Kartverkets svarform (bare feltene vi leser) ───────────────────────────

interface KvSkrivemate {
    skrivemåte?: string;
    navnestatus?: string;
    skrivemåtestatus?: string;
}
interface KvSted {
    stedsnummer?: number;
    stedstatus?: string;
    navneobjekttype?: string;
    stedsnavn?: KvSkrivemate[];
    kommuner?: { kommunenavn?: string; kommunenummer?: string }[];
    fylker?: { fylkesnavn?: string; fylkesnummer?: string }[];
    representasjonspunkt?: { nord?: number; øst?: number };
}

// ── Søketekst ──────────────────────────────────────────────────────────────

/** Under dette blir det ingen kall. «Sk» ville gitt hundrevis av steder. */
export const MIN_Q_LENGTH = 3;

/**
 * Søketeksten slik Kartverket skal få den, eller null når den er for kort.
 *
 * `*` fjernes: det er Kartverkets jokertegn, og vi legger det på selv der vi
 * vil ha det. Resten av tegnsettet er bokstaver (inkl. æøå og samiske tegn),
 * tall, mellomrom, bindestrek, apostrof og punktum («St. Hanshaugen»).
 */
export function sanitizeStedQuery(raw: string | null | undefined): string | null {
    const q = (raw ?? '')
        .replace(/[^\p{L}\p{N}\s'.-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50);
    return q.length >= MIN_Q_LENGTH ? q : null;
}

/** Små bokstaver, ett mellomrom, og UTEN «kommune»/«herad» på slutten. */
export function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ (kommune|herad)$/u, '');
}

// ── Omforming ──────────────────────────────────────────────────────────────

/** Er skrivemåten i bruk? Historiske navn skal verken vises eller matches. */
function iBruk(s: KvSkrivemate): boolean {
    return (
        !!s.skrivemåte &&
        s.navnestatus !== 'historisk' &&
        !(s.skrivemåtestatus ?? '').startsWith('historisk')
    );
}

/**
 * Navnet som vises: hovednavnet, helst den prioriterte skrivemåten, uten
 * «kommune»/«herad». «Voss herad» vises som «Voss» — typeetiketten sier
 * allerede at det er en kommune.
 */
function visningsnavn(sted: KvSted): string | null {
    const iBrukNavn = (sted.stedsnavn ?? []).filter(iBruk);
    const hoved = iBrukNavn.filter((s) => s.navnestatus === 'hovednavn');
    const kandidater = hoved.length > 0 ? hoved : iBrukNavn;
    const valgt =
        kandidater.find((s) => (s.skrivemåtestatus ?? '').includes('prioritert')) ??
        kandidater[0];
    const navn = valgt?.skrivemåte?.trim();
    if (!navn) return null;
    return sted.navneobjekttype === 'Kommune'
        ? navn.replace(/ (kommune|herad)$/u, '')
        : navn;
}

/**
 * Hvor godt traff søket? 0 = eksakt på hovednavnet, 1 = eksakt på et annet
 * navn stedet har (Tingnes heter også «Nes»), 2 = bare starten av navnet.
 */
function navnetreff(sted: KvSted, q: string): 0 | 1 | 2 {
    const nq = normalizeName(q);
    let best: 0 | 1 | 2 = 2;
    for (const s of (sted.stedsnavn ?? []).filter(iBruk)) {
        if (normalizeName(s.skrivemåte!) !== nq) continue;
        if (s.navnestatus === 'hovednavn') return 0;
        best = 1;
    }
    return best;
}

/**
 * Kommunenavnet appen bruker. Kartverket skriver tospråklige kommuner som én
 * streng i varierende rekkefølge («Storfjord - Omasvuotna - Omasvuono»);
 * appen bruker samme navn som resten av datahubben (lib/municipality.ts).
 */
function kommunenavn(k: { kommunenavn?: string; kommunenummer?: string } | undefined): string | null {
    if (!k) return null;
    const nr = k.kommunenummer ?? '';
    return BILINGUAL_MUNICIPALITIES[nr] ?? k.kommunenavn?.trim() ?? null;
}

/**
 * Fylkesnavnet uten de samiske og kvenske leddene. For fylkene står det
 * norske navnet alltid først («Troms - Romsa - Tromssa», «Trøndelag -
 * Trööndelage»), så første ledd er riktig — i motsetning til for kommunene.
 */
function fylkesnavn(f: { fylkesnavn?: string } | undefined): string | null {
    const navn = f?.fylkesnavn?.trim();
    if (!navn) return null;
    return navn.split(' - ')[0].trim();
}

const EARTH_RADIUS_M = 6371000;
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MAX_STEDER = 5;

/**
 * Kartverkets svar → de inntil fem forslagene appen skal vise.
 *
 * RANGERING: eksakt navnetreff foran delvis, så stedstype, så avstand fra
 * brukeren (når posisjon er oppgitt), så navn og id for en stabil rekkefølge.
 */
export function rankSteder(
    kvSteder: readonly KvSted[],
    q: string,
    posisjon: { lat: number; lng: number } | null
): Sted[] {
    const sett = new Set<number>();
    const kandidater: { sted: Sted; treff: number; typeRang: number }[] = [];

    for (const kv of kvSteder) {
        if (kv.stedsnummer === undefined || sett.has(kv.stedsnummer)) continue;
        if (kv.stedstatus && kv.stedstatus !== 'aktiv') continue;
        const typeRang = TYPE_RANG.get(kv.navneobjekttype ?? '');
        if (typeRang === undefined) continue; // en type vi ikke slipper gjennom
        const navn = visningsnavn(kv);
        const lat = kv.representasjonspunkt?.nord;
        const lng = kv.representasjonspunkt?.øst;
        if (!navn || typeof lat !== 'number' || typeof lng !== 'number') continue;
        sett.add(kv.stedsnummer);

        const treff = navnetreff(kv, q);
        kandidater.push({
            treff,
            typeRang,
            sted: {
                id: String(kv.stedsnummer),
                navn,
                type: TYPE_ETIKETT.get(kv.navneobjekttype!)!,
                kommune: kommunenavn(kv.kommuner?.[0]),
                kommunenummer: kv.kommuner?.[0]?.kommunenummer ?? null,
                fylke: fylkesnavn(kv.fylker?.[0]),
                lat,
                lng,
                distanceM: posisjon
                    ? Math.round(distanceMeters(posisjon.lat, posisjon.lng, lat, lng))
                    : null,
                eksakt: treff < 2,
            },
        });
    }

    kandidater.sort(
        (a, b) =>
            a.treff - b.treff ||
            a.typeRang - b.typeRang ||
            (a.sted.distanceM ?? 0) - (b.sted.distanceM ?? 0) ||
            a.sted.navn.localeCompare(b.sted.navn, 'nb') ||
            a.sted.id.localeCompare(b.sted.id)
    );

    // SAMME NAVN I SAMME KOMMUNE ER ETT FORSLAG. Registeret fører «Ski» både
    // som by og som bygd, og «Hemsedal» både som kommune og bygd — med
    // punkter noen hundre meter til få kilometer fra hverandre. For en
    // forelder er det ett sted, og to like linjer i en liste på fem ser ut
    // som en feil. Den best rangerte (sortert over) står igjen.
    const valgt: Sted[] = [];
    const sammeSted = new Set<string>();
    for (const { sted } of kandidater) {
        const nokkel = `${normalizeName(sted.navn)}|${sted.kommunenummer ?? ''}`;
        if (sammeSted.has(nokkel)) continue;
        sammeSted.add(nokkel);
        valgt.push(sted);
        if (valgt.length === MAX_STEDER) break;
    }
    return valgt;
}

// ── Henting ────────────────────────────────────────────────────────────────

/**
 * Kort. Stedsforslagene er et tillegg til aktivitetssøket, og et forslag som
 * kommer etter at brukeren har sett trefflista og bestemt seg, er verdiløst.
 * Kartverket svarte på 106–254 ms i målingene; 1,5 s er god margin mot et
 * tregt øyeblikk uten å la en treg kilde bli brukerens problem.
 */
export const KARTVERKET_TIMEOUT_MS = 1500;

/** Et døgn. Stedsnavn endres ved kommunereform og navnevedtak, ikke daglig. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

type Fetcher = (url: string, init: RequestInit & { next?: { revalidate: number } }) => Promise<Response>;

interface CacheEntry {
    at: number;
    steder: KvSted[];
}

/**
 * Minnebuffer per serverinstans, på SØKETEKSTEN — ikke på posisjonen.
 * Posisjonen påvirker bare rangeringen, som er billig å gjøre på nytt; den
 * dyre delen er rundturen til Kartverket. Med posisjon i nøkkelen ville
 * nesten hvert kall vært unikt.
 *
 * På Vercel kan instansene være mange og kortlevde, så fetch-kallet ber i
 * tillegg Next om å cache svaret (`next.revalidate`). Bufferen her tar
 * gjentakelsene innenfor én varm instans uten å gå via nettet.
 */
const cache = new Map<string, CacheEntry>();

/** Kun for tester. */
export function clearStedCache(): void {
    cache.clear();
}

async function hentSide(
    fetcher: Fetcher,
    sok: string,
    treffPerSide: number,
    timeoutMs: number
): Promise<KvSted[]> {
    const params = new URLSearchParams({
        sok,
        treffPerSide: String(treffPerSide),
        utkoordsys: '4258',
    });
    for (const t of STEDSTYPER) params.append('navneobjekttype', t.kode);
    const res = await fetcher(`${KARTVERKET_STED_URL}?${params}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
        next: { revalidate: CACHE_TTL_MS / 1000 },
    });
    if (!res.ok) throw new Error(`Kartverket svarte HTTP ${res.status}`);
    const body = (await res.json()) as { navn?: KvSted[] };
    return Array.isArray(body.navn) ? body.navn : [];
}

/**
 * Stedene som matcher [q], rå fra Kartverket (eksakt + prefiks, uten
 * dubletter). ALDRI et kast: er Kartverket tregt eller nede, er svaret en
 * tom liste og `ok: false`. Stedsforslag er et tillegg, ikke en forutsetning.
 *
 * Bare et helt vellykket svar caches. Et halvt svar (ett av to kall feilet)
 * vises, men lagres ikke — ellers ville en kort forstyrrelse hos Kartverket
 * gitt dårligere forslag i et helt døgn.
 */
export async function hentSteder(
    q: string,
    opts: { fetcher?: Fetcher; now?: number; timeoutMs?: number } = {}
): Promise<{ steder: KvSted[]; ok: boolean; fraCache: boolean }> {
    const fetcher = opts.fetcher ?? (fetch as Fetcher);
    const now = opts.now ?? Date.now();
    const timeoutMs = opts.timeoutMs ?? KARTVERKET_TIMEOUT_MS;
    const key = normalizeName(q);

    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) {
        return { steder: hit.steder, ok: true, fraCache: true };
    }

    const [eksakt, prefiks] = await Promise.allSettled([
        hentSide(fetcher, q, 50, timeoutMs),
        hentSide(fetcher, `${q}*`, 50, timeoutMs),
    ]);
    const steder = [
        ...(eksakt.status === 'fulfilled' ? eksakt.value : []),
        ...(prefiks.status === 'fulfilled' ? prefiks.value : []),
    ];
    const ok = eksakt.status === 'fulfilled' && prefiks.status === 'fulfilled';
    if (ok) {
        if (cache.size >= CACHE_MAX) {
            const eldste = cache.keys().next().value;
            if (eldste !== undefined) cache.delete(eldste);
        }
        cache.set(key, { at: now, steder });
    }
    return { steder, ok, fraCache: false };
}
