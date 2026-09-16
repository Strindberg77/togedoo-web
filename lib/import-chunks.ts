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
     * KILDESPESIFIKK. Setningen som DEFINERER området, uten avsluttende
     * semikolon — typisk `area[...]->.a`. Tom streng når avgrensningen ikke
     * trenger en egen setning, som for en bbox.
     *
     * Navngitt etter kilden med vilje: den dagen fase 3 leser fra et uttrekk i
     * stedet, byttes henteren og de tre `overpass*`-feltene — resten av
     * begrepet står.
     */
    readonly overpassArea: string;
    /**
     * KILDESPESIFIKK. Filtrene som settes på HVER selektorlinje: `(area.a)`
     * for en kommune, `(57.5,4.0,71.5,31.5)` for en bbox.
     *
     * Selektorene i [PLACE_CATEGORIES] er skrevet med `(area.a)` som
     * kanonisk form, og [scopedSelector] bytter den ut. Grunnen til at
     * avgrensningen er et EGET felt og ikke bakt inn i selektorene: elleve
     * selektorer måtte ellers kjenne til hvordan chunken er avgrenset, og da
     * ville et kildebytte rørt dem alle.
     *
     * HVORFOR EN LISTE. Den ble en liste for å kunne dele Norge i flere
     * breddebånd: ÉN boks rundt landet rommer også Stockholm, Helsingfors,
     * Riga og St. Petersburg. Båndene tapte mot `area[ISO3166-1=NO]` i
     * målingen (okt. 2026) og er ute — se [NATIONAL_AREA]. INGEN CHUNK I
     * PRODUKSJON LAGER MER ENN ÉN AVGRENSNING I DAG.
     *
     * Mekanismen står likevel igjen, testet i scripts/bbox-og-noder.test.ts:
     * den er veien videre om en reservekjøring på bboks noen gang må deles
     * opp. Skal den bort, er det en egen, rent subtraktiv endring — ikke en
     * som hører hjemme i commiten som bytter avgrensning.
     *
     * Rekkefølgen betyr ingenting for svaret, men den er en del av
     * hentestegets fingeravtrykk: endres avgrensningen, blir et lagret
     * hentesteg IKKE gjenbrukt ved --resume.
     */
    readonly overpassScopes: readonly string[];
    /**
     * KILDESPESIFIKK. Sekundene Overpass får bruke.
     *
     * 180 for en kommune. 300 for den nasjonale chunken, fordi det var det
     * Frederik målte med: bevisspørringen brukte 35 s ved midnatt, men
     * belastningen på speilet varierer mye mer enn volumet gjør — Oslo alene
     * feilet med 504 på dagtid.
     */
    readonly overpassTimeout: number;
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
        overpassScopes: ['(area.a)'],
        overpassTimeout: 180,
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
     * Kun `fetch`: settene som kom tilbake med NULL objekter, som
     * «<kategori>/<sett>».
     *
     * HVORFOR DET MÅ LAGRES. Et tomt hentesteg og et ferdig hentesteg så
     * nøyaktig like ut i manifestet fram til sep. 2026. En kjøring mot Oslo
     * fikk 504 på første forsøk og et ekte, tomt 200-svar på det andre; begge
     * steg ble markert ferdig med null linjer, og neste kjøring med --resume
     * gjenopptok null rader uten å røre nettet. ADVARSEL-linja kom ikke, fordi
     * berikelsen ble hoppet over. Samme spørring ga 34 objekter både før og
     * etter.
     *
     * Med feltet her overlever opplysningen gjenopptagelsen, og
     * oppsummeringen til slutt kan liste hver tomme (chunk, kategori) enten
     * chunken kjørte denne gangen eller ikke — som er det eneste som virker
     * når 353 chunks kjører over en natt og ingen leser midtpartiet.
     */
    readonly emptySets?: readonly string[];
    /**
     * Kun `fetch`: antall objekter per sett, som `{ omrade: 423, bevis: 4536 }`
     * per kategorinøkkel.
     *
     * HVORFOR DET MÅ LAGRES, og ikke bare telles opp fra fila: utbyttevakten
     * kjøres til slutt, etter at alle chunkene er beriket, og med --resume har
     * hentesteget for de fleste av dem ikke kjørt i denne prosessen i det hele
     * tatt. Uten tallet her måtte vakten lest hvert hentesteg inn på nytt —
     * titusenvis av rå OSM-elementer — bare for å telle dem.
     *
     * PER SETT, ikke per kategori. Skianlegg henter `omrade` (blir rader) og
     * `bevis` (blir aldri rader). Summen av de to er ikke en størrelse som
     * betyr noe, og forventningstallet gjelder bare det ene settet. Se
     * [NasjonalForventning].
     *
     * Feltet mangler i .import-work skrevet før okt. 2026. Vakten hopper da
     * over kategorien og SIER det — se [hoppetOverIUtbytte].
     */
    readonly settAntall?: Readonly<Record<string, Readonly<Record<string, number>>>>;
    /**
     * Kun `enrich`: OSM-id-ene som ble undertrykt av en claim i denne chunken.
     *
     * HVORFOR HER OG IKKE I MINNET: dødt-claim-rapporten må kunne si «denne
     * claimen traff ingenting i HELE planen». Ved gjenopptagelse hoppes
     * ferdige chunks over, så et minnebasert sett ville manglet nettopp de
     * chunkene som gikk bra — og rapporten ville meldt døde claims som lever.
     */
    readonly seenClaims?: readonly string[];
    /**
     * Kun `enrich`: external_id-ene til objekter som ble tatt ut fordi de var
     * dubletter av et annet objekt i samme kategori (lib/dedup.ts).
     *
     * HVORFOR HER, OG IKKE BARE I MINNET — nøyaktig samme grunn som
     * [seenClaims]: en gjenopptatt kjøring leser berikelsen fra mellomleddet
     * og kjører aldri dedupen på nytt. Uten feltet ville nedtakings-SQL-en
     * til slutt manglet nettopp de chunkene som gikk gjennom første gang, og
     * de dupliserte radene ville blitt stående publisert i stillhet.
     *
     * Radene tas IKKE ned av importen. Dette er inndata til et menneske.
     */
    readonly deduped?: readonly string[];
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

/**
 * Hvor stor del av NORGE planen dekker — eller null når det ikke er mulig å
 * si.
 *
 * DETTE ER EN RETTING AV EN EKTE FEIL, funnet ved en tørrkjøring sep. 2026.
 * Utbyttesjekken brukte «andel av standardplanen» som forholdstall, og for en
 * kjøring med alle fire byene er den 1. Da ble forventningen hele det
 * nasjonale tallet — 3 070 parker for fire kommuner — og vakten slo ut på en
 * helt normal kjøring.
 *
 * Feilen var en kategoriforveksling: [NATIONAL_EXPECTATION] er en NASJONAL
 * størrelse, og fire byer er ikke en brøkdel av Norge man kan regne ut fra
 * antall chunks. Oslo alene har en tredel av landets lekeplasser.
 *
 * Derfor svarer denne funksjonen bare når svaret er kjent:
 *
 *   alle chunks uten cityAnchor  → 1   (den nasjonale planen, én eller flere
 *                                       chunks som til sammen er landet)
 *   ellers                       → null (per-kommune-plan: andelen av Norge
 *                                       er ukjent, og utbyttesjekken hopper
 *                                       over)
 *
 * Den dagen planen blir 356 kommune-chunks med kjent dekning, er det HER det
 * skal stå — ikke i vakten.
 */
export function nationalCoverage(plan: readonly ImportChunk[]): number | null {
    if (plan.length && plan.every((c) => c.cityAnchor === null)) return 1;
    return null;
}

/**
 * BBOKSEN OVER NORGE — IKKE LENGER STANDARD, men beholdt som RESERVE.
 *
 * Fram til okt. 2026 var dette den nasjonale avgrensningen. [NATIONAL_AREA]
 * overtok etter målingen som er gjengitt der. Boksen blir stående av én grunn:
 * den er den eneste ALTERNATIVE avgrensningen som er MÅLT ende-til-ende — 445
 * winter_sports-polygoner på 5,5 s og 7 555 bevisobjekter på 35 s, begge uten
 * remark og på første forsøk. Svarer ikke speilets områdeindeks en kveld, er
 * `PLACES_NATIONAL_SCOPE=bbox` veien tilbake til noe som er kjørt før.
 *
 * Tallene skal ikke justeres uten en ny måling — da er de ikke lenger sanne
 * om koden som kjører.
 *
 * DEN DEKKER OGSÅ SVERIGE, DANMARK OG FINLAND, og det er nettopp derfor den
 * tapte: se [NATIONAL_AREA]. I bboks-modus er Norge-filteret i buildRows et
 * EKTE FILTER og ikke bare en vakt.
 */
export const NATIONAL_BBOX = '(57.5,4.0,71.5,31.5)';

/**
 * NORGE SOM OMRÅDE — standardavgrensningen fra okt. 2026.
 *
 * MÅLT (overpass-api.de, kveld, alle på første forsøk, uten remark):
 *
 *   selektor            A  bboks                D  area[ISO3166-1=NO]
 *   skianlegg:bevis     7 555 objekter          4 536 objekter   −40 %
 *   aking                 313 objekter             91 objekter   −71 %
 *
 * De 91 stemmer eksakt med det Norge-filteret slapp gjennom i tørrkjøringen
 * dagen før («aking 91 i Norge, 222 utenfor»). Området henter altså nøyaktig
 * det filteret ellers måtte kaste — og [NATIONAL_EXPECTATION] sier 89 for
 * `piste:type=sled` i Geofabrik-fila, så 91 er det samme tallet pluss drift.
 * Tre uavhengige kilder på samme størrelse.
 *
 * DETTE BLE FRARÅDET DA DET BLE FORESLÅTT, med den begrunnelsen at områdebygging
 * koster tid og kan feile. Målingen sier noe annet, og målingen vinner.
 *
 * `admin_level=2` er med for å låse treffet til STATEN Norge. Uten den kan
 * `ISO3166-1=NO` også sitte på underordnede grenser i OSM, og da avgjør
 * området hvilken rad Overpass tilfeldigvis fant først.
 *
 * DET OMRÅDET IKKE GIR, og bboksen ga: MARGIN UTENFOR RIKSGRENSA. Boksen hadde
 * [BOX_MARGIN_M] = 2 km, fordi bevisspørringen skal finne heiser og nedfarter
 * som ligger inntil [SKI_EVIDENCE_TOLERANCE_M] utenfor et polygon. Området
 * klipper på grensa. Et bevisobjekt som ligger HELT i Sverige, men betjener et
 * norsk anlegg, hentes ikke lenger. Se runbooken for hvordan det måles etter
 * kjøringen — det er ikke målt på forhånd.
 */
export const NATIONAL_AREA = 'area["ISO3166-1"="NO"]["admin_level"="2"]->.a';

/**
 * HVILKEN AVGRENSNING DEN NASJONALE CHUNKEN BRUKER.
 *
 * Standarden er området ([NATIONAL_AREA]) fordi det er MÅLT og vant: −40 % på
 * bevisspørringen, −71 % på aking, uten remark.
 *
 * `PLACES_NATIONAL_SCOPE=bbox` går tilbake til [NATIONAL_BBOX]. Reserven
 * finnes fordi områdene på et Overpass-speil bygges av en egen prosess som
 * ligger etter OSM og kan mangle: svarer `area[...]->.a` med et tomt sett, gir
 * hele spørringen 0 objekter uten å feile. Da er dette veien til en
 * avgrensning som er kjørt før, uten en kodeendring imellom.
 *
 * HVA SOM IKKE FINNES LENGER: `PLACES_NATIONAL_BANDS` og bånd-konstantene
 * (kandidat B og C, fire og fem breddebånd). De var REGNET UT, ikke målt, og
 * kommentaren deres krevde en `out count;`-måling før bruk. Målingen ble gjort
 * i okt. 2026, og båndene tapte mot området på akkurat den aksen de skulle
 * forbedre. De er fortsatt regnbare på kommando —
 * `npx tsx scripts/bbox-candidates.ts` skriver dem ut — men de står ikke
 * lenger i produksjonskoden, og grensefila kan dermed oppdateres uten at et
 * tallsett ingen kjører må limes inn på nytt.
 */
export type NationalScope = 'area' | 'bbox';

export function nationalScope(
    env: string | undefined = process.env.PLACES_NATIONAL_SCOPE
): NationalScope {
    if (env === undefined || env === '' || env === 'area') return 'area';
    if (env === 'bbox') return 'bbox';
    throw new Error(
        `PLACES_NATIONAL_SCOPE må være «area» eller «bbox», fikk «${env}». ` +
            `Utelat variabelen for området (standard).`
    );
}

/**
 * HELE NORGE SOM ÉN CHUNK.
 *
 * MÅLINGEN SOM GJØR DEN MULIG (overpass-api.de, ved midnatt, bboks):
 *
 *   område  nwr[landuse=winter_sports]                      445 obj   5,5 s   3,2 MB
 *   bevis   nwr[piste:type~downhill|sled|playground]       7555 obj    35 s  11,3 MB
 *
 * Ingen remark, begge på første forsøk.
 *
 * MÅLINGEN SOM SNEVRET DEN INN (okt. 2026, kveld): de samme spørringene med
 * `area["ISO3166-1"="NO"]` ga 4 536 og 91 objekter, også uten remark og på
 * første forsøk. Se [NATIONAL_AREA]. Avgrensningen ligger nå i SPØRRINGEN;
 * Norge-filteret i buildRows er dermed en VAKT, ikke lenger et filter.
 *
 * TIDSPUNKTET BETYR MER ENN STØRRELSEN. Oslo ALENE feilet med 504 i hver
 * eneste kjøring på dagtid, mens hele Norge gikk gjennom ved midnatt. Den
 * ufiltrerte bevisspørringen feilet med «server is probably too busy» — altså
 * belastning, ikke volum. Sammenligningen filtrert/ufiltrert er derfor IKKE
 * målt, og verdifilteret kan ikke krediteres for at nasjonal henting ble
 * mulig. Det sparer data uansett, siden `nordic` ikke leses av noen.
 *
 * ÉN CHUNK, IKKE 356. Konsekvensene er verdt å ha i hodet:
 *
 *  + Områdeaksen (admin_level) trengs ikke i det hele tatt.
 *  + Klyngedelte anlegg over en kommunegrense kan ikke oppstå — det finnes
 *    ingen grense å dele på.
 *  + Tre spørringer i stedet for ~700.
 *  − Ingen delvis gjenopptagelse: feiler chunken, kjøres hele på nytt.
 *    Hentesteget er 40 sekunder, så det er en billig pris.
 */
export function nationalChunk(scope: NationalScope = nationalScope()): ImportChunk {
    return {
        id: 'norge',
        label: 'Norge',
        // null: chunken dekker 357 kommuner, så municipality utledes per rad
        // fra grensefila. Se lib/municipality.ts.
        cityAnchor: null,
        // OMRÅDE: samme form som en kommune-chunk, bare på admin_level 2.
        // BBOKS: ingen area-setning — boksen sitter på hver selektorlinje.
        overpassArea: scope === 'area' ? NATIONAL_AREA : '',
        overpassScopes: scope === 'area' ? ['(area.a)'] : [NATIONAL_BBOX],
        // UENDRET PÅ 300. Området henter 40 % færre objekter, men det er ikke
        // volumet som feiler mot dette speilet — Oslo ALENE ga 504 på dagtid.
        // Å stramme timeouten på et lavere volum ville vært å endre to ting
        // samtidig i den ene kjøringen som skal bekrefte den første.
        overpassTimeout: 300,
    };
}

/**
 * Selektoren med chunkens egen avgrensning.
 *
 * Selektorene er skrevet med `(area.a)`, som er sant for en kommune-chunk.
 * For en bbox-chunk byttes den ut. ÉN funksjon gjør byttet, og den er testet
 * mot hver enkelt selektor i [PLACE_CATEGORIES] — ellers ville en selektor
 * som glemte konvensjonen blitt hentet for hele planeten uten at noe feilet.
 */
export function scopedSelector(selector: string, chunk: ImportChunk): string {
    const scopes = chunk.overpassScopes;
    if (scopes.length === 1) return selector.split('(area.a)').join(scopes[0]);
    // FLERE BOKSER: hver selektorLINJE gjentas én gang per boks. Å sette flere
    // filtre på samme setning ville gitt SNITTET av boksene (Overpass
    // OG-er filtre på samme statement), altså tomt — og tomt ser ut som et
    // land uten alpinanlegg. Derfor gjentas linja i stedet, slik at unionen
    // rundt dem gir summen.
    //
    // Linjedelingen er trygg fordi hver selektorlinje er én komplett setning
    // som ender på «;» — det er låst av vakten i scripts/nasjonal-chunk.test.ts.
    return selector
        .split('\n')
        .map((linje) => {
            const t = linje.trim();
            if (!t.includes('(area.a)')) return linje;
            return scopes.map((s) => linje.split('(area.a)').join(s)).join('\n  ');
        })
        .join('\n');
}
