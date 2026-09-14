// lib/import-chunks.ts
//
// ARBEIDSENHETEN og MANIFESTET for stedsimporten — den delen som ikke vet noe
// om hverken OSM, Overpass eller filsystemet.
//
// BAKGRUNNEN (docs/nasjonal-dekning.md og skalavurderingen sep. 2026):
// importen kjørte per by, og hentet + beriket + skrev i én operasjon som først
// skrev når hele byen var ferdig. En kjøring som feilet halvveis måtte kjøres
// om. Nasjonalt er det ~39 500 objekter over sju kategorier (osmium mot
// Geofabrik-fila, sep. 2026), og geokodingen alene er timer — da er «kjør om
// alt» ikke et alternativ.
//
// Sømmen deler kjøringen i hent → berik → skriv per CHUNK. Denne fila
// definerer hva en chunk er og hvordan vi vet at et steg er FERDIG.
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR SÅ LITE I [ImportChunk]
//
// Enheten er en by i dag og skal kunne bli en flis, et fylke eller hele
// landet. Fristelsen er å modellere geografi — bbox, admin_level, senterpunkt.
// Det ville foregrepet fase 3, der kilden byttes og «område» kanskje ikke
// finnes i det hele tatt (et PBF-uttrekk har ingen områdespørring).
//
// Det ALLE variantene faktisk trenger er tre ting:
//
//   id          — for manifest og mellomledd. Må være stabil og filnavnsikker.
//   label       — for logg og rapport.
//   cityAnchor  — det som blir activities.municipality.
//
// Pluss ÉN kildespesifikk ting, og den er bevisst navngitt etter kilden sin:
// [overpassArea]. Den dagen fase 3 bytter kilde, byttes HENTEREN og dette
// feltet — ikke chunk-begrepet, ikke manifestet, ikke mellomleddet.
//
// ─────────────────────────────────────────────────────────────────────────
// cityAnchor OG FASE 2
//
// I dag er en chunk en kommune, så `cityAnchor` er kommunenavnet, og
// [rowsMissingCityAnchor] er trivielt oppfylt. Blir enheten en flis, finnes
// det ingen ett svar for hele chunken, og feltet er `null`. Da MÅ municipality
// utledes per rad — det er fase 2, og guarden kaster hardt til den finnes.
//
// Dette er med vilje: en flis-chunk i dag feiler høylytt før upsert i stedet
// for å skrive 39 500 rader uten by-anker, som ville vært usynlige i by-modus.
//
// Fase 2 setter `cityAnchor: null` på flis-chunkene og fyller municipality i
// BERIKELSEN, per rad. Kartverket punktsøk returnerer kommunenavn og
// kommunenummer direkte (målt sep. 2026), og berikelsen kaller det allerede
// for hver rad uten brukbart OSM-navn — så det er gratis for dem. Radene MED
// navn geokodes aldri og trenger en annen vei (grensepolygoner). Merk at
// Kartverket svarer «OSLO», ikke «Oslo».

/**
 * Én enhet arbeid: hentes, berikes og skrives for seg, og kan gjenopptas for
 * seg. En by i dag; en flis, et fylke eller et land senere.
 */
export interface ImportChunk {
    /**
     * Stabil, filnavnsikker id. Brukes som nøkkel i manifestet OG som
     * filnavn for mellomleddet, så den kan ikke endres uten at tidligere
     * kjøringer blir uleselige — [chunkId] håndhever formen.
     */
    readonly id: string;
    /** Menneskelig navn i logg og rapport. */
    readonly label: string;
    /**
     * Verdien som havner i activities.municipality for hver rad i chunken.
     * `null` betyr «chunken dekker mer enn én kommune» — da må municipality
     * utledes per rad (fase 2), og [rowsMissingCityAnchor] kaster til den er
     * på plass.
     */
    readonly cityAnchor: string | null;
    /**
     * KILDESPESIFIKK. Overpass-klausulen som avgrenser området, uten
     * avsluttende semikolon. Navngitt etter kilden med vilje: den dagen
     * fase 3 leser fra et uttrekk i stedet, byttes henteren og dette feltet —
     * resten av begrepet står.
     */
    readonly overpassArea: string;
}

/** Filnavnsikker id: små bokstaver, tall, bindestrek. Kaster på alt annet, så
 *  en chunk aldri kan lage en sti utenfor arbeidskatalogen. */
export function chunkId(raw: string): string {
    const id = raw
        .toLowerCase()
        .replace(/[æ]/g, 'ae')
        .replace(/[ø]/g, 'oe')
        .replace(/[å]/g, 'aa')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!id) throw new Error(`Kan ikke lage chunk-id av «${raw}».`);
    return id;
}

/**
 * Dagens enhet: én kommune, slått opp på navn i OSM.
 *
 * `admin_level=7` er kalibrert for norsk kommune. Merk at målingen mot
 * Geofabrik-fila (sep. 2026) ga 1892 objekter på nivå 7 og 353 på nivå 4 —
 * altså er hverken tallet 356 (kommuner) eller 15 (fylker) truffet direkte.
 * Tallene er OBJEKTER, ikke distinkte områder, så de kan ikke uten videre
 * leses som «antall kommuner». Det er fase 2/3 sitt spørsmål; her er
 * `admin_level=7` uendret fra før sømmen.
 */
export function chunkForCity(city: string): ImportChunk {
    return {
        id: `by-${chunkId(city)}`,
        label: city,
        cityAnchor: city,
        overpassArea: `area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a`,
    };
}

export function planForCities(cities: readonly string[]): ImportChunk[] {
    return cities.map(chunkForCity);
}

// ---------------------------------------------------------------------------
// MANIFESTET
// ---------------------------------------------------------------------------

/**
 * Stegene som lagres. `write` er IKKE med, og det er en beslutning:
 *
 * Upserten er idempotent på `(source_id, external_id)`, så å skrive samme
 * chunk to ganger koster noen sekunder og endrer ingenting. Hadde write vært
 * i manifestet, ville en gjenopptagelse HOPPET OVER den — og en kjøring som
 * døde midt i chunkens upsert-løkke (som skriver i bolker på 500) ville
 * etterlatt en halvskrevet chunk merket som ferdig. Å alltid skrive om igjen
 * er den trygge asymmetrien.
 */
export type StageName = 'fetch' | 'enrich';

export const STAGES: readonly StageName[] = ['fetch', 'enrich'];

export interface ManifestEntry {
    readonly chunkId: string;
    readonly stage: StageName;
    /**
     * Hash over det som bestemmer stegets utdata. Endres en selektor, en
     * kategoriliste eller --limit, endres denne, og et lagret steg blir IKKE
     * gjenbrukt. Uten den ville «rett en selektor og kjør på nytt med
     * --resume» gitt gårsdagens data uten en eneste advarsel.
     */
    readonly fingerprint: string;
    /** Antall elementer/rader steget produserte. Kun rapport. */
    readonly count: number;
    readonly at: string;
    /**
     * Kun `enrich`: OSM-id-ene som ble undertrykt av en claim i denne chunken.
     *
     * HVORFOR HER OG IKKE I MINNET: dødt-claim-rapporten må kunne si «denne
     * claimen traff ingenting i HELE planen». Ved gjenopptagelse hoppes
     * ferdige chunks over, så et minnebasert sett ville manglet nettopp de
     * chunkene som gikk bra — og rapporten ville meldt døde claims som lever.
     */
    readonly seenClaims?: readonly string[];
}

/** Manifestet som ÉN oppføring per (chunk, steg) — siste vinner.
 *  Logga er append-only, så en ny kjøring legger til en linje framfor å
 *  skrive om fila. Da kan en krasj midt i skrivingen aldri ødelegge historikk
 *  som allerede sto der. */
export function latestEntries(
    entries: readonly ManifestEntry[]
): Map<string, ManifestEntry> {
    const m = new Map<string, ManifestEntry>();
    for (const e of entries) m.set(`${e.chunkId}/${e.stage}`, e);
    return m;
}

/** Er steget ferdig OG laget med de samme forutsetningene? */
export function stageIsDone(
    entries: ReadonlyMap<string, ManifestEntry>,
    chunk: ImportChunk,
    stage: StageName,
    fingerprint: string
): boolean {
    const e = entries.get(`${chunk.id}/${stage}`);
    return e !== undefined && e.fingerprint === fingerprint;
}

/**
 * Deterministisk hash over stegets forutsetninger.
 *
 * FNV-1a, 32 bit, som hex. Ikke kryptografisk, og trenger ikke være det:
 * oppgaven er å oppdage at noe er ENDRET, ikke å motstå en angriper. Valgt
 * framfor node:crypto fordi funksjonen skal kunne leses og etterregnes uten
 * å lure på hvilken digest som var i bruk.
 */
export function fingerprint(parts: unknown): string {
    const s = stableJson(parts);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** JSON med sorterte nøkler, så feltrekkefølge ikke kan endre hashen. */
function stableJson(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys
        .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
        .join(',')}}`;
}

/**
 * Dekker kjøringen ALT — alle chunkene i standardplanen og alle kategoriene?
 *
 * ERSTATTER `cities.length === DEFAULT_CITIES.length && !catArg`, som sluttet
 * å bety noe i det øyeblikket enheten ikke lenger var en by. Vilkåret er nå
 * uttrykt i planen, ikke i bynavn, så det overlever at standardplanen blir
 * 353 fliser.
 *
 * Brukes av dødt-claim-rapporten: «traff ingenting» er først et varsel når
 * ingenting var utenfor rekkevidde.
 */
export function runCoversEverything(
    plan: readonly ImportChunk[],
    defaultPlan: readonly ImportChunk[],
    catCount: number,
    allCatCount: number
): boolean {
    if (catCount !== allCatCount) return false;
    const dekket = new Set(plan.map((c) => c.id));
    return defaultPlan.every((c) => dekket.has(c.id));
}
