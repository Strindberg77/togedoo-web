// scripts/import-places.ts
//
// Månedlig batch-import av faste steder (kind='place') fra OpenStreetMap
// via Overpass API, for de fem kategoriene bekreftet i dekningsundersøkelsen
// (jul. 2026): lekeplasser, ballbinger/baner, parker, idrettshaller,
// strender/badeplasser. Kjøres manuelt/periodisk — IKKE del av daglig cron.
//
//   npx tsx scripts/import-places.ts --dry-run          (rapport, ingen skriving)
//   npx tsx scripts/import-places.ts                    (full import, alle byer)
//   npx tsx scripts/import-places.ts --city=Oslo --limit=25
//
// Krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY i miljøet (unntatt
// --dry-run uten cache, som fungerer uten). Titler: OSM-navn når brukbart,
// ellers revers-geokodet "Lekeplass ved <gate>", så "Badeplass i <bydel>"
// (Nominatim) for steder uten adresse innen 200 m (lib/places.ts).
// Rader med locked=true røres aldri (brukerrapport/manuell korrigering).
//
// ODbL-KRAV: der disse dataene vises, skal "© OpenStreetMap contributors"
// være synlig med lenke til openstreetmap.org/copyright.
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';
import { SKATEBOARD_IMPLIES, type FacetToken } from '../lib/facets';
import {
    anyInsideOrNearAny,
    assembleRings,
    boundsGapMeters,
    boundsOf,
    boundsOverlap,
    rejectBoundsFor,
    centerOfBounds,
    distanceMeters,
    pointInBounds,
    type GeoBounds,
    type GeoPoint,
} from '../lib/geo-polygon';
import {
    fingerprint,
    nationalChunk,
    nationalCoverage,
    planForCities,
    runCoversEverything,
    scopedSelector,
    type ImportChunk,
} from '../lib/import-chunks';
import {
    batchFingerprint,
    duplicateCandidates,
    formatApproval,
    generatedTitleCollisions,
    type ForhandsDiff,
    type KategoriLinje,
} from '../lib/import-approval';
import {
    claimMismatchStop,
    geocodeFailureStop,
    ImportStop,
    NATIONAL_EXPECTATION,
    yieldCollapseStop,
} from '../lib/import-guards';
import { municipalityIndex } from './municipality-index';
import {
    claimNameMatches,
    claimsByOsmId,
    OSM_CLAIMS,
    staleClaims,
    type OsmClaim,
} from '../lib/osm-claims';
import { FileStore, NullStore, type WorkStore } from './work-store';
import { makePlaceTitleDetailed, isUsablePlaceName, TitleSource } from '../lib/places';
import { sanitizeWebsite } from '../lib/website';

// Speilene kan overstyres via env (komma-separert) — nyttig for selvhostet
// Overpass og for å verifisere feilhåndteringen mot et test-endepunkt.
const OVERPASS_ENDPOINTS = (
    process.env.PLACES_OVERPASS_ENDPOINTS ??
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const UA = 'Togedoo datahub (hello@togedoo.com)';
const CITY_PAUSE_MS = 5000;
// 2b: ekte eksponentiell backoff mellom Overpass-forsøk (5s→15s→45s), brukt
// over TO runder på speilene (opptil ENDPOINTS.length × 2 forsøk per spørring).
// Overstyrbar via env (komma-separert ms) for testing/tuning.
const OVERPASS_BACKOFF_MS = (() => {
    const parsed = (process.env.PLACES_OVERPASS_BACKOFF_MS ?? '5000,15000,45000')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0);
    return parsed.length ? parsed : [5000, 15000, 45000];
})();
// 2a: kort høflighetspause mellom de per-kategori-spørringene innen én by.
// Overstyrbar av samme grunn som de andre pausene: bekreftelsen av et tomt
// svar legger på én pause til per tom kategori, og tester skal ikke sove.
const OVERPASS_QUERY_PAUSE_MS = Number(process.env.PLACES_OVERPASS_QUERY_PAUSE_MS ?? 1000);
// Kartverket punktsøk svarte 502 under 100 ms-kadens og var treg (timeouts)
// ved 400 ms (jul. 2026). Pausen dekker nå OGSÅ Nominatim-bydeloppslaget
// (i-omraade), som krever ≥1 req/s — derfor 1100 ms default. Pausen kjøres
// etter hvert steds tittelgenerering, og bydeloppslaget er det siste eksterne
// kallet i kaskaden, så ≥1100 ms mellom to Nominatim-kall er garantert.
// Overstyr med PLACES_PAUSE_MS. Egen pause, uavhengig av Overpass.
const TITLE_PAUSE_MS = Number(process.env.PLACES_PAUSE_MS ?? 1100);
const SOURCE_SLUG = 'osm-steder';
export const DEFAULT_CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

interface OsmTags {
    [key: string]: string | undefined;
}
interface OsmElement {
    type: 'node' | 'way' | 'relation';
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: OsmTags;
    // Fra `out geom` (Skianlegg og Aking). Nodene i en way/relation.
    // `out geom` legger geometri på WAYS her …
    geometry?: GeoPoint[];
    // Boksen Overpass selv regner ut. Kommer med `out geom` for BÅDE ways og
    // relasjoner, også når medlemslista mangler — derfor er den siste
    // skanse i [akingGeometry] og i skianleggElements sin ringsammensying.
    bounds?: GeoBounds;
    // … men på RELASJONER ligger den per medlem, ikke på toppnivå. Å lese
    // el.geometry på en relation gir undefined.
    //
    // RETTET BESKRIVELSE (sep. 2026). Dette feltet sto lenge som eneste
    // forklaring på at relasjonene i Oslo falt ut, og den forklaringen var
    // ufullstendig: spørringene sa `out geom tags`, og ordet `tags` slår av
    // medlemslista i det hele tatt. `members` var ikke bare uten geometri —
    // nøkkelen fantes ikke i svaret. Se [OUT_GEOM_TAGS].
    members?: {
        type: 'node' | 'way' | 'relation';
        ref: number;
        role?: string;
        geometry?: GeoPoint[];
        lat?: number;
        lon?: number;
    }[];
    // Settes KUN av skianleggElements(), aldri av Overpass:
    /** Taggene til objektene som ligger i eller inntil polygonet. Driver
     *  fasettene — piste:type og mtb:type står på barneobjektene, ikke på
     *  polygonet. */
    memberTags?: OsmTags[];
    /** Polygonet har bestått heis-/utforløype-testen. Uten denne ville
     *  `matches` gjort et hvilket som helst ski-tagget polygon til Skianlegg,
     *  også et langrennsstadion som kom inn via en annen kategoris spørring. */
    skiVerified?: boolean;
    /** Settes KUN av akingClusters(): objektet er ett anker for én akebakke,
     *  ikke ett av flere segmenter, og det er ikke en alpinbakke. Se
     *  [akingVerdict] for hvorfor taggene alene ikke er nok. */
    akingVerified?: boolean;
}

/**
 * HENTESTEGETS utdata for én kategori: navngitte sett med rå OSM-elementer.
 *
 * Et KART og ikke en liste, fordi Skianlegg henter to sett med ulik rolle —
 * `omrade` blir rader, `bevis` gjør det aldri. Etter sømmen går settene
 * gjennom mellomleddet, og da må rollen overleve turen. Alle andre
 * kategorier bruker ett sett, `main`.
 */
export type FetchSets = Record<string, OsmElement[]>;

/** BERIKELSESSTEGETS utdata for én kategori. */
export interface EnrichOutput {
    /** Elementene som kan bli rader. */
    elements: OsmElement[];
    /** Linjer til rapporten, med innrykk. */
    rapport: string[];
    /** Én oppsummeringslinje, uten innrykk og uten kategoriprefiks. */
    summary?: string;
}

/**
 * Sport-tokens som gjør en pitch til en GENERISK ballbane. Vinner over de
 * sport-spesifikke etikettene under: en bane tagget «tennis;soccer» er i
 * praksis en flerbruksflate, og «Ballbane» er da den ærlige tittelen.
 *
 * Brukes også som KATEGORI-vakt av rullesport (sep. 2026): en pitch tagget
 * «skateboard;multi» er en flerbruksflate med skatemulighet, ikke en
 * skatepark, og skal falle igjennom til Ballbane rett bak i lista.
 */
const GENERIC_BALL_SPORTS = new Set(['soccer', 'basketball', 'multi']);

/**
 * Sport-spesifikke tittel-etiketter. Alle mønstre er ANKRET, så de er
 * gjensidig utelukkende — `table_tennis` treffer aldri /^tennis$/. Beach-
 * variantene faller inn under sine respektive hovedsporter.
 *
 * Rekkefølgen er derfor ikke en felle-forsvarsmekanisme, men en ekte
 * PRIORITET for flersports-tagger: er en flate tagget «tennis;table_tennis»,
 * navngir det STØRSTE anlegget stedet. Bordtennisbord står sist fordi et bord
 * er det minst definerende av dem.
 */
const SPORT_TITLE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^tennis$/, 'Tennisbane'],
    [/^(beach[_-]?)?volleyball$/, 'Volleyballbane'],
    [/^(beach[_-]?)?handball$/, 'Håndballbane'],
    [/^table[_-]?tennis$/, 'Bordtennisbord'],
];

/**
 * Tittel-etiketten for én pitch, utledet av OSM-ens `sport`-tag. Brukes KUN
 * til å konstruere titler for steder uten brukbart OSM-navn («Tennisbane ved
 * Sofienberggata») — kategoriverdien i databasen er «Ballbane» for alle seks
 * sportene, uavhengig av hva denne returnerer.
 *
 * Merk samspillet med appen: DatahubPlace.displayTitle stripper prefikset kun
 * når det er lik kategoriverdien, så «Tennisbane ved X» blir stående ustrippet
 * på kortet. Det er tilsiktet — tittelen er det eneste stedet sporten navngis,
 * ved siden av kategorilinja.
 */
export function ballTitleLabel(sportRaw: string | undefined): string {
    const tokens = sportTokens(sportRaw);
    if (tokens.some((t) => GENERIC_BALL_SPORTS.has(t))) return 'Ballbane';
    for (const [pattern, label] of SPORT_TITLE_LABELS) {
        if (tokens.some((t) => pattern.test(t))) return label;
    }
    return 'Ballbane'; // ukjent/manglende sport — generisk er tryggest
}

/**
 * OSM-ens `sport`-tag som normaliserte tokens. Sammensatte verdier finnes
 * gjennom hele datasettet, med varierende skilletegn OG rekkefølge
 * («basketball;soccer» og «soccer;basketball» er samme type anlegg), så alle
 * lesere må splitte — aldri sammenligne hele strengen.
 */
export function sportTokens(sportRaw: string | undefined): string[] {
    return (sportRaw ?? '')
        .toLowerCase()
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter(Boolean);
}

/**
 * FASETT-TOKENS utledet fra OSM-tagger (migrasjon 0016).
 *
 * Regelen dekker de dimensjonene `sport`-taggen IKKE bærer, og bare dem:
 *
 *   piste:type=downhill   -> alpint
 *   piste:type=sled       -> aking
 *   piste:type=playground -> skileik
 *   mtb:type=downhill     -> downhill
 *   route=mtb             -> terrengsykling
 *
 *   sport~skateboard      -> skateboard, sparkesykkel, rulleskoyter
 *   sport~bmx             -> bmx
 *   sport~kick_scooter    -> sparkesykkel
 *   sport~roller_skating  -> rulleskoyter
 *
 * OVERLAPPER `sports` FOR SPORT-TOKENENE — endret sep. 2026. Da denne
 * funksjonen ble skrevet, emitterte den bevisst ALDRI sport-tokens, for at
 * samme token ikke skulle komme fra to kanaler. Det er ikke lenger riktig:
 * skal `facets` en dag være den eneste kanalen, må kolonnen beskrive raden
 * ALENE, uten at noen må utlede resten fra osm_tags. Derfor skrives
 * `skateboard` og `bmx` nå inn her også.
 *
 * Overlappet er ufarlig i drift: klienten slår opp i unionen av de to
 * (DatahubPlace.facetTokens) og bruker den kun til `any(...)`, så et duplikat
 * endrer ingenting. `sports` er fortsatt urørt og kan avvikles i ro.
 *
 * MERK asymmetrien: `pumptrack` og `roller_skiing` har fasetter i appen, men
 * utledes IKKE hit — de kommer fortsatt bare via `sports`. Det er en bevisst
 * avgrensning av denne endringen, ikke en glipp, men det betyr at `facets`
 * ennå ikke er komplett nok til å stå alene.
 *
 * DETERMINISTISK og utledet PÅ NYTT hver kjøring: ingen tilstand, ingen
 * oppslag mot basen, kun taggene på elementet. En rad som mister
 * piste:type i OSM mister fasetten ved neste import — som den skal.
 *
 * `piste:type` er semikolon-/kommaseparert på samme måte som `sport`
 * («downhill;nordic»), så [sportTokens] gjenbrukes til delingen. Navnet er
 * historisk; funksjonen er en ren tokenizer.
 *
 * ice_skate er BEVISST utelatt. Skøyter er en kategori, ikke en fasett, og
 * Sørmarka Arena skal ikke bære et token som ingen fasett leser. Legges inn
 * den dagen en skøytefasett faktisk finnes.
 *
 * SPARKESYKKEL OG RULLESKØYTER ER UTLEDET, IKKE LEST. Antakelsen — og
 * målingene bak den — står i sin helhet på [SKATEBOARD_IMPLIES] i
 * lib/facets.ts. Skal regelen endres, endres den der.
 */
export function osmFacetTokens(t: OsmTags): FacetToken[] {
    const facets = new Set<FacetToken>();
    const piste = sportTokens(t['piste:type']);
    if (piste.includes('downhill')) facets.add('alpint');
    if (piste.includes('sled')) facets.add('aking');
    if (piste.includes('playground')) facets.add('skileik');
    if (sportTokens(t['mtb:type']).includes('downhill')) facets.add('downhill');
    if (t.route === 'mtb') facets.add('terrengsykling');

    // Sport-taggen. sportTokens splitter på «;» og «,», så treffet er på HELE
    // tokenet — «roller_skiing» (rulleski) blir aldri forvekslet med
    // «roller_skating» (rulleskøyter), selv om strengene ligner.
    const sport = sportTokens(t.sport);
    // Enveis: skateboard gir de tre, bmx gir bare seg selv. Se
    // [SKATEBOARD_IMPLIES] for hvorfor retningen ikke kan snus.
    if (sport.includes('skateboard')) for (const f of SKATEBOARD_IMPLIES) facets.add(f);
    if (sport.includes('bmx')) facets.add('bmx');
    // De to taggene som faktisk finnes i OSM, når de finnes: lest, ikke utledet.
    if (sport.includes('kick_scooter')) facets.add('sparkesykkel');
    if (sport.includes('roller_skating')) facets.add('rulleskoyter');

    // Set fordi reglene er additive og kan overlappe: et anlegg tagget
    // «skateboard;kick_scooter» skal ha sparkesykkel én gang, ikke to.
    return [...facets];
}

/**
 * [osmFacetTokens] over FLERE tagg-sett, unionert.
 *
 * HVORFOR DEN TRENGS: osmFacetTokens leser ett element. For en POLYGON-
 * forankret rad — et alpinanlegg — står `piste:type` og `mtb:type` på
 * barneobjektene (nedfartene, akebakken, sykkelløypene), ikke på polygonet.
 * Kalt med polygonets egne tagger ville funksjonen gitt tom liste, og hver
 * importert alpinrad ville fått `facets = '{}'` — nøyaktig feilen kolonnen
 * ble bygget for å unngå.
 *
 * Valget falt på en variant her framfor å slå sammen medlemstaggene til ett
 * syntetisk tagg-objekt på kallstedet. To grunner:
 *
 *  1. Sammenslåing TAPER data. To nedfarter med `piste:type=downhill` og
 *     `piste:type=sled` ville kollidert på samme nøkkel, og den ene ville
 *     overskrevet den andre. Semikolon-liming («downhill;sled») ville
 *     virket her, men bare fordi disse taggene tilfeldigvis er
 *     semikolon-separerbare — det er ikke en egenskap ved OSM-tagger
 *     generelt, og regelen ville vært et felt unna å ryke.
 *  2. Et syntetisk tagg-objekt kunne lett endt i `osm_tags`-kolonnen, som
 *     skal inneholde RÅ tagger fra ett objekt. Å aldri lage et slikt objekt
 *     er billigere enn å passe på at det ikke lekker.
 */
export function osmFacetTokensFrom(tagSets: readonly OsmTags[]): FacetToken[] {
    const facets = new Set<FacetToken>();
    for (const t of tagSets) for (const f of osmFacetTokens(t)) facets.add(f);
    return [...facets];
}

/**
 * Sport-tokens som gjør et sports_centre til et GENERISK flerbruksanlegg.
 * Samme presedens som [GENERIC_BALL_SPORTS]: en hall tagget «climbing;multi»
 * er en flerbrukshall som også har klatrevegg, ikke et klatresenter — den
 * skal forbli «Idrettshall».
 */
const GENERIC_CENTRE_SPORTS = new Set(['multi']);

/**
 * Klatre-etiketter. Ankret og gjensidig utelukkende, som [SPORT_TITLE_LABELS]
 * — `climbing_adventure` treffer aldri /^climbing$/, så understreng-fella er
 * lukket i begge retninger.
 *
 * Rekkefølgen er en PRIORITET for anlegg tagget med begge: da vinner
 * «Klatrepark». Klatrepark i trær er den mer SPESIFIKKE opplevelsen, mens
 * klatresenter er standardforventningen til et sted i Klatring-kategorien —
 * tittelen skal bære det som ikke allerede følger av kategorien. Merk at
 * dette er motsatt regel av [SPORT_TITLE_LABELS], der det største anlegget
 * navngir stedet; der er alle seks sportene like forventede.
 */
const CLIMB_TITLE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^climbing[_-]?adventure$/, 'Klatrepark'],
    [/^climbing$/, 'Klatresenter'],
];

/** Har taggen minst ett klatre-token? Brukes av både selektor-matchingen og
 *  tittel-etiketten, så de to aldri kan komme i utakt. */
export function hasClimbingSport(sportRaw: string | undefined): boolean {
    return sportTokens(sportRaw).some((t) =>
        CLIMB_TITLE_LABELS.some(([pattern]) => pattern.test(t))
    );
}

/**
 * Tittel-etiketten for ett klatreanlegg. «Klatrepark» (løype i trær, tagget
 * `climbing_adventure`) og «Klatresenter» (innendørs vegg, `climbing`) er to
 * ulike opplevelser og fortjener ulik tittel når stedet mangler OSM-navn.
 * Kategoriverdien er «Klatring» for begge — det er databasenøkkelen.
 */
export function climbTitleLabel(sportRaw: string | undefined): string {
    const tokens = sportTokens(sportRaw);
    for (const [pattern, label] of CLIMB_TITLE_LABELS) {
        if (tokens.some((t) => pattern.test(t))) return label;
    }
    return 'Klatring'; // ukjent/manglende sport — kategorinavnet er tryggest
}

/**
 * Sport-verdier som gjør en flate til et rullesportanlegg, som Overpass-regex.
 * Ett sted, brukt av selektoren for BEGGE leisure-verdiene, så de to aldri kan
 * komme i utakt.
 *
 * `pump_track` er IKKE målt i norsk OSM (osmium sep. 2026 fant kun `pumptrack`,
 * 6 alene + 9 som `cycling;pumptrack`), men understreng-matchingen dekker den
 * ikke, og et ekstra ledd koster ingenting mot at en skrivemåte forsvinner.
 * Her er det altså IKKE støy, i motsetning til ball-/racketselektoren, der
 * `tennis` allerede fanger `table_tennis` som understreng.
 */
const ROLLER_SPORT_SELECTOR_RE = 'skateboard|bmx|pumptrack|pump_track|roller_skiing';

/**
 * Rullesport-etiketter. Ankret og gjensidig utelukkende, som
 * [SPORT_TITLE_LABELS] og [CLIMB_TITLE_LABELS].
 *
 * Rekkefølgen er PRIORITET ved sammensatt tagging, og følger klatre-regelen,
 * ikke ballbane-regelen: tittelen skal bære det som IKKE allerede følger av
 * kategorien. «Skatepark» er standardforventningen til et sted i Rullesport
 * — 376 av de 597 nasjonale treffene er skateboard, og illustrasjonen i appen
 * er skate — så den står SIST og taper mot enhver mer spesifikk byggform.
 *
 * Innbyrdes rekkefølge på de tre øverste er derimot IKKE observerbar: i de
 * målte dataene opptrer rulleski, pumptrack og BMX aldri sammen. De
 * sammensatte verdiene er utelukkende med `cycling`, som ikke er en etikett
 * her. Rekkefølgen dem imellom er altså en antakelse om spesifisitet, ikke
 * et funn — det er «Skatepark sist» som er den reelle beslutningen.
 *
 * `roller_skating` (inlines/rulleskøyter) er BEVISST utelatt: den er ikke
 * blant de fire målte tokenene. Ankringen gjør at /^roller[_-]?skiing$/ aldri
 * treffer den ved uhell. Se «Åpent» i rapporten — docs/seed-backlog.md
 * beskriver inlines som en del av det appen viser, så dette kan være en
 * bevisst utvidelse senere, men den skal i så fall måles først.
 */
const ROLLER_TITLE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^roller[_-]?skiing$/, 'Rulleskiløype'],
    [/^pump[_-]?track$/, 'Pumptrack'],
    [/^bmx$/, 'BMX-bane'],
    [/^skateboard$/, 'Skatepark'],
];

/** Har taggen minst ett rullesport-token? Delt av kategori-matchingen og
 *  tittel-etiketten, samme grep som [hasClimbingSport]. */
export function hasRollerSport(sportRaw: string | undefined): boolean {
    return sportTokens(sportRaw).some((t) =>
        ROLLER_TITLE_LABELS.some(([pattern]) => pattern.test(t))
    );
}

/**
 * Tittel-etiketten for ett rullesportanlegg. Skatepark, BMX-bane, pumptrack og
 * rulleskiløype er fire ulike byggformer og fortjener ulik tittel når stedet
 * mangler OSM-navn. Kategoriverdien er «Rullesport» for alle fire — det er
 * databasenøkkelen.
 */
export function rollerTitleLabel(sportRaw: string | undefined): string {
    const tokens = sportTokens(sportRaw);
    for (const [pattern, label] of ROLLER_TITLE_LABELS) {
        if (tokens.some((t) => pattern.test(t))) return label;
    }
    return 'Rullesport'; // ukjent/manglende sport — kategorinavnet er tryggest
}

/**
 * Prisstatusen for ETT sted: stedets egen `fee`-tagg vinner alltid over
 * kategoriens antakelse, i begge retninger. Taggen er en observasjon om
 * nettopp dette stedet; kategorien er en generalisering.
 *
 * Merk asymmetrien i returtypen mot [PlaceCategoryDef.isFree]: `false` kan
 * KUN oppstå her, fra en eksplisitt `fee=yes`. Ingen kategori har lov til å
 * påstå at noe koster. Ukjente fee-verdier («donation», «unknown», tom
 * streng) er ingen påstand — da gjelder kategorien.
 *
 * Eksportert for å kunne testes direkte. Var tidligere en inline-uttrykk i
 * [buildRows], og testen speilet det — to kopier som kunne drive fra
 * hverandre, nettopp mens regelen fikk en typegaranti å bære.
 */
export function resolveIsFree(tags: OsmTags, categoryDefault: true | null): boolean | null {
    if (tags.fee === 'yes') return false;
    if (tags.fee === 'no') return true;
    return categoryDefault;
}

/**
 * ÉN spørring, bygget av chunken.
 *
 * Alt som er kildespesifikt samles her: områdesetningen, avgrensningen på
 * hver selektorlinje og timeouten. Det er dette stedet fase 3 bytter ut, og
 * grunnen til at selektorene i [PLACE_CATEGORIES] slipper å vite om de kjøres
 * mot en kommune eller mot hele landet.
 *
 * Områdesetningen utelates når den er tom — en bbox-chunk har ingen
 * `area[...]->.a` å definere, og en tom linje med semikolon ville vært en
 * syntaksfeil.
 */
export function overpassQuery(
    chunk: ImportChunk,
    selector: string,
    outStatement: string
): string {
    const area = chunk.overpassArea ? `${chunk.overpassArea};\n` : '';
    return `[out:json][timeout:${chunk.overpassTimeout}];
${area}(
  ${scopedSelector(selector, chunk)}
);
${outStatement};`;
}

/**
 * HEISVERDIENE som teller som bevis på et alpinanlegg.
 *
 * Eksportert for test — samme presedens som [resolveIsFree] og [sportTokens]:
 * en testkopi av lista ville kunnet drive fra den ekte.
 *
 * `cable_car` er BEVISST utelatt: Krossobanen og Fløibanen er turistbaner,
 * ikke skiheiser. En generisk `["aerialway"]` ville gjort Fløyen til et
 * alpinanlegg.
 *
 * Livssyklus-prefikser trenger ingen egen vakt her: `disused:aerialway=...`
 * har ingen `aerialway`-nøkkel i det hele tatt, så regex-en treffer den ikke.
 * Vakten mot `disused=yes` PÅ en aktiv nøkkel ligger i selektorene under.
 */
export const SKI_LIFT_VALUES =
    'drag_lift|t-bar|j-bar|platter|rope_tow|magic_carpet|chair_lift|gondola|mixed_lift';

/** Hvor langt utenfor polygonets bounding box et bevis fortsatt teller.
 *
 *  Heiser og løyper er ofte tegnet fra parkeringsplassen utenfor polygonet og
 *  opp i bakken, så en ren containment-test ville mistet dem. 50 m er valgt
 *  lavt med vilje: tolleransen er den eneste tingen som kan la et NABOanlegg
 *  smitte over på et langrennsstadion, og Varingskollen har begge deler i
 *  samme dal.
 *
 *  Overstyrbar med PLACES_SKI_TOLERANCE_M. Den finnes fordi et polygon som
 *  rapporteres med «0 bevis inne» kan ha to helt ulike årsaker — ingen
 *  nedfart i det hele tatt, eller en nedfart som ligger like utenfor. To
 *  tørrkjøringer med ulik tolleranse skiller dem, uten en kodeendring
 *  imellom. */
const SKI_EVIDENCE_TOLERANCE_M = Number(
    process.env.PLACES_SKI_TOLERANCE_M ?? 50
) || 50;

/** Vakt mot nedlagte anlegg på en ellers aktiv nøkkel. */
const NOT_DISUSED = '["disused"!~"."]["abandoned"!~"."]';

/** Polygonene som KAN være et alpinanlegg. Fire tagge-mønstre, fordi norsk
 *  OSM ikke bruker ett: winter_sports, recreation_ground med en piste:*-tagg,
 *  recreation_ground med sport~ski, og sports_centre med sport~ski.
 *  Varingskollen har bare `piste:lit`, Skimore Kongsberg bare
 *  `piste:difficulty` — derfor tre separate piste:*-linjer. */
export const SKI_AREA_SELECTOR = [
    `nwr["landuse"="winter_sports"]${NOT_DISUSED}(area.a);`,
    `nwr["landuse"="recreation_ground"]["piste:type"]${NOT_DISUSED}(area.a);`,
    `nwr["landuse"="recreation_ground"]["piste:lit"]${NOT_DISUSED}(area.a);`,
    `nwr["landuse"="recreation_ground"]["piste:difficulty"]${NOT_DISUSED}(area.a);`,
    `nwr["landuse"="recreation_ground"]["sport"~"ski",i]${NOT_DISUSED}(area.a);`,
    `nwr["leisure"="sports_centre"]["sport"~"ski",i]${NOT_DISUSED}(area.a);`,
].join('\n  ');

/**
 * `piste:type`-VERDIENE KODEN FAKTISK LESER. Én kilde, brukt både av
 * bevisselektoren under og av vakten i scripts/piste-filter.test.ts.
 *
 * Leserne, uttømmende:
 *   downhill    → [skiVerdict] (eneste som gjør et polygon til alpinanlegg)
 *                 og fasetten `alpint` i [osmFacetTokens]
 *   sled        → fasetten `aking`
 *   playground  → fasetten `skileik`
 *
 * `nordic` leses INGEN steder, og det er 47 988 segmenter nasjonalt (osmium
 * mot Geofabrik-fila, sep. 2026) mot 3 108 utforløyper og 89 akebakker. Uten
 * filteret hentet bevisspørringen alle sammen, med `out geom`, og den var
 * den enkeltspørringen som først ville drept en nasjonal kjøring.
 *
 * Legges en ny verdi til her, utvides spørringen automatisk. Leses en ny
 * verdi UTEN å legge den til her, feiler vakten — ellers ville en fasett
 * forsvunnet i stillhet fordi objektene aldri ble hentet.
 */
export const READ_PISTE_TYPES = ['downhill', 'sled', 'playground'] as const;

/**
 * BEVISENE. Hentes én gang per chunk og brukes til to ting:
 *   - kategoritesten: heis ELLER piste:type=downhill i/inntil polygonet
 *   - fasettene: sled, playground og mtb
 *
 * VERDIFILTERET ER BEVISST USTRENGT (understreng, ikke ankret). Overpass sin
 * `~` matcher understreng, så `~"downhill|sled|playground"` slipper gjennom
 * «downhill», «nordic;downhill» og «downhill;sled» uten at regexen må kunne
 * semikolonlister. Den kan derfor bare over-matche, aldri under-matche.
 *
 * Over-matching er ufarlig HER, og det er hele begrunnelsen: bevissettet er
 * inndata til predikater som uansett sjekker verdien eksakt med
 * [sportTokens] ([hasDownhillPiste], [osmFacetTokens]). Filteret er en
 * HENTE-optimalisering, ikke en korrekthetsregel — korrektheten ligger
 * nedstrøms. Under-matching ville derimot mistet data i stillhet, så feilen
 * tas bevisst i den retningen som ikke koster noe.
 */
export const SKI_EVIDENCE_SELECTOR = [
    `nwr["aerialway"~"^(${SKI_LIFT_VALUES})$"]${NOT_DISUSED}(area.a);`,
    `nwr["piste:type"~"${READ_PISTE_TYPES.join('|')}"]${NOT_DISUSED}(area.a);`,
    `nwr["mtb:type"]${NOT_DISUSED}(area.a);`,
    `nwr["route"="mtb"]${NOT_DISUSED}(area.a);`,
].join('\n  ');

/**
 * Punktene et element dekker.
 *
 * Rekkefølgen er ikke tilfeldig: RELASJONER må hentes fra medlemmene, fordi
 * `out geom` ikke legger geometri på relasjonen selv. Uten medlems-grenen fikk
 * en route=mtb-relasjon eller en løype mappet som relation null punkter, og
 * talte dermed aldri som bevis.
 */
export function elementPoints(el: OsmElement): GeoPoint[] {
    if (el.geometry?.length) return el.geometry;
    if (el.members?.length) {
        const pts: GeoPoint[] = [];
        for (const m of el.members) {
            if (m.geometry?.length) pts.push(...m.geometry);
            else if (typeof m.lat === 'number' && typeof m.lon === 'number') {
                pts.push({ lat: m.lat, lon: m.lon });
            }
        }
        if (pts.length) return pts;
    }
    if (typeof el.lat === 'number' && typeof el.lon === 'number') {
        return [{ lat: el.lat, lon: el.lon }];
    }
    if (el.center) return [{ lat: el.center.lat, lon: el.center.lon }];
    return [];
}

/**
 * RINGENE et polygon-element består av.
 *
 * Ways har én ring i `geometry`. Relasjoner (multipolygoner) har den ytre
 * kanten delt på flere member-ways, hver med sin egen retning — de må sys
 * sammen før de kan brukes til punkt-i-polygon.
 *
 * `inner`-medlemmer (hull) utelates bevisst. Et hull i et alpinanlegg er
 * typisk en bygning eller et vann; å behandle det som «utenfor» ville bare
 * gjort testen strengere enn nødvendig, og heisene ligger ikke i hullene.
 *
 * Tom liste betyr «kunne ikke bygge et polygon» — kallstedet må da falle
 * tilbake på `bounds`, ikke forkaste elementet.
 */
export function polygonRings(el: OsmElement): GeoPoint[][] {
    if (el.geometry && el.geometry.length >= 3) return [el.geometry];
    if (!el.members?.length) return [];
    const outer = el.members
        .filter((m) => m.type === 'way' && (m.role ?? 'outer') !== 'inner')
        .map((m) => m.geometry ?? [])
        .filter((g) => g.length >= 2);
    return assembleRings(outer);
}

/** En ring bygget av elementets bounds — siste utvei når sammensyingen
 *  ikke lykkes (ødelagt multipolygon, eller medlemmer utenfor området).
 *  Grovere enn den ekte kanten, men langt bedre enn å miste anlegget. */
export function boundsRing(b: GeoBounds): GeoPoint[] {
    return [
        { lat: b.minlat, lon: b.minlon },
        { lat: b.minlat, lon: b.maxlon },
        { lat: b.maxlat, lon: b.maxlon },
        { lat: b.maxlat, lon: b.minlon },
        { lat: b.minlat, lon: b.minlon },
    ];
}

/** Har noen av tagg-settene en utforløype? Det er det ENESTE som kvalifiserer
 *  et polygon som alpinanlegg etter rettingen — se [skiVerdict]. */
export function hasDownhillPiste(tagSets: readonly OsmTags[]): boolean {
    return tagSets.some((t) => sportTokens(t['piste:type']).includes('downhill'));
}

/** Har noen av tagg-settene en skiheis? Kvalifiserer IKKE alene lenger, men
 *  brukes til å rapportere polygoner som er verdt et manuelt blikk. */
export function hasSkiLift(tagSets: readonly OsmTags[]): boolean {
    return tagSets.some((t) => Boolean(t.aerialway));
}

/** Hoppanlegg-signal. Diskvalifiserer ikke — se [skiVerdict] — men forklarer
 *  hvorfor et heis-treff uten utforløype trolig ikke er alpint. */
export function hasSkiJump(tagSets: readonly OsmTags[]): boolean {
    return tagSets.some(
        (t) =>
            sportTokens(t['piste:type']).includes('ski_jump') ||
            sportTokens(t.sport).includes('ski_jumping')
    );
}

export type SkiVerdict = 'alpint' | 'usikker-heis' | 'ikke-alpint';

/**
 * Er polygonet et ALPINANLEGG?
 *
 * KRAVET BLE STRAMMET ETTER TØRRKJØRINGEN MOT OSLO. Den gamle regelen var
 * «heis ELLER utforløype», og den slapp inn tre av fem verifiserte anlegg som
 * ikke er alpine: Holmenkollen nasjonalanlegg, Linderudkollen hoppbakke og
 * Lia skisenter. Grunnen er enkel når man ser den: et hoppanlegg har heis opp
 * til tilløpet. Heis er bevis på at noen fraktes oppover, ikke på at de kjører
 * utfor.
 *
 * Ny regel: `piste:type=downhill` i eller inntil polygonet. Ingenting annet
 * kvalifiserer.
 *
 * HVORFOR IKKE EN DISKVALIFISERING PÅ ski_jump/ski_jumping I STEDET: den ville
 * vært en liste som kan være ufullstendig, og den ville tatt feil på et anlegg
 * som har BÅDE hoppbakke og alpinbakke — som er vanlig. Med utforløype som
 * krav trengs ingen slik liste: et hoppanlegg uten alpinbakke har ingen
 * downhill-løype og faller ut av seg selv, mens et kombinert anlegg består på
 * riktig grunnlag.
 *
 * PRISEN er recall: en liten kommunal bakke med heis der ingen har tagget
 * nedfarten faller ut. Den taper vi bevisst framfor å hente inn hoppanlegg —
 * men den forsvinner ikke i stillhet. Slike polygoner får «usikker-heis» og
 * skrives ut i rapporten, så de kan seedes eller tagges i OSM.
 */
export function skiVerdict(
    polygonTags: OsmTags,
    memberTags: readonly OsmTags[]
): SkiVerdict {
    const alle = [polygonTags, ...memberTags];
    if (hasDownhillPiste(alle)) return 'alpint';
    if (hasSkiLift(alle)) return 'usikker-heis';
    return 'ikke-alpint';
}

/**
 * Henter Skianlegg for én by, ferdig romlig verifisert.
 *
 * Skiller seg fra alle andre kategorier på tre måter, og det er derfor den
 * har sin egen henter i stedet for å gå gjennom standardveien:
 *
 *  1. `out geom` i stedet for `out center` — punkt-i-polygon trenger ringen.
 *     Senteret regnes ut selv fra `bounds`, så resten av rørledningen ser
 *     nøyaktig det samme som fra `out center`.
 *  2. En ANDRE spørring etter bevis (heiser og løyper), som ikke blir rader.
 *  3. Et romlig filter: et alpinanlegg og et langrennsstadion er tagget likt.
 *
 * Varingskollen skistadion (piste:type=nordic, ingen heis) faller ut her.
 * Kirkerudbakken (recreation_ground med heis) består.
 */
async function skianleggFetch(chunk: ImportChunk): Promise<FetchSets> {
    // `out geom`, IKKE `out geom tags`. Se [OUT_GEOM_TAGS] — ordet `tags`
    // slår av medlemslista, og uten den har ingen relasjon her noen gang hatt
    // medlemmer. [polygonRings] falt derfor alltid til `bounds (grov)`, og
    // [assembleRings] — skrevet nettopp for disse relasjonene — har aldri
    // kjørt mot ekte data. Rettingen kan bare gjøre ringen mer nøyaktig:
    // lykkes ikke sammensyingen, faller koden tilbake til nøyaktig samme
    // bounds som før. MERK at den likevel er en oppførselsendring på en
    // kategori med grønn tørrkjøring — `grunnlag`-kolonnen i rapporten viser
    // forskjellen, så kjør en ny tørrkjøring for Skianlegg før neste import.
    const q = (selector: string) => overpassQuery(chunk, selector, 'out geom');

    const omrade = await fetchOverpass(q(SKI_AREA_SELECTOR), `${chunk.label}/skianlegg:omrade`);
    await sleep(OVERPASS_QUERY_PAUSE_MS);
    const bevis = await fetchOverpass(q(SKI_EVIDENCE_SELECTOR), `${chunk.label}/skianlegg:bevis`);
    // TO navngitte sett. Grunnen til at [FetchSets] er et kart og ikke en
    // liste: bevisene blir aldri rader, de er inndata til den romlige testen
    // i berikelsen, og de to må derfor kunne skilles etter at de har vært
    // innom mellomleddet.
    return { omrade, bevis };
}

/**
 * BERIKELSEN for Skianlegg: den romlige verifiseringen, uten nettverk.
 *
 * Skilt fra hentingen i sømmen (sep. 2026). Den avgjør hvilke polygoner som
 * ER alpinanlegg, og det er en TOLKNING av hentede data — ikke en henting.
 * Skillet er det som gjør at fase 3 kan bytte kilde uten å røre denne
 * funksjonen, og at den kan testes uten Overpass.
 */
export function skianleggVerify(sets: FetchSets): EnrichOutput {
    const polygons = sets.omrade ?? [];
    const evidence = sets.bevis ?? [];
    // Bevisobjektets egen boks regnes ut ÉN gang, ikke per polygon. Se
    // [rejectBoundsFor]: sammen utgjør de forkastningsfilteret som gjør den
    // romlige testen brukbar nasjonalt.
    const withPoints = evidence.map((el) => {
        const points = elementPoints(el);
        return { el, points, bounds: boundsOf(points) };
    });
    const verified: OsmElement[] = [];
    const rapport: string[] = [];

    for (const poly of polygons) {
        const id = `${poly.type}/${poly.id}`;
        const navn = poly.tags?.name ?? '(uten navn)';
        // Ways har ringen i `geometry`, relasjoner må sys sammen fra
        // medlemmene. Lykkes ingen av delene, faller vi tilbake på Overpass
        // sin egen bounds framfor å miste anlegget — det var nøyaktig den
        // stille feilen som tok Skimore Oslo.
        let rings = polygonRings(poly);
        let grunnlag = poly.geometry?.length ? 'way-ring' : 'sydd ring';
        if (rings.length === 0 && poly.bounds) {
            rings = [boundsRing(poly.bounds)];
            grunnlag = 'bounds (grov)';
        }
        if (rings.length === 0) {
            rapport.push(`    ${id.padEnd(18)} ${navn.padEnd(32)} HOPPET OVER — ingen geometri`);
            continue;
        }

        // FORKASTNINGSFILTER FØRST. Uten det er testen O(polygoner × bevis ×
        // punkter × ringlengde): 445 polygoner mot 7 555 bevisobjekter er
        // 3,4 millioner par, og hvert par gikk gjennom hvert punkt i beviset
        // mot hele ringen — [insideOrNear] regnet til og med ut ringens boks
        // på nytt for hvert eneste punkt.
        //
        // Boks-mot-boks er O(1) og forkaster de aller fleste parene, fordi to
        // tilfeldige anlegg i Norge ikke ligger oppå hverandre. Filteret er et
        // OVERSETT av det den ekte testen godtar (se [rejectBoundsFor]), så
        // dommene er uendret — det er låst av en egenskapstest mot den
        // ufiltrerte varianten.
        const reject = rejectBoundsFor(rings, SKI_EVIDENCE_TOLERANCE_M);
        const kandidater = reject
            ? withPoints.filter((w) => w.bounds && boundsOverlap(w.bounds, reject))
            : [];
        const inside = kandidater.filter(({ points }) =>
            anyInsideOrNearAny(points, rings, SKI_EVIDENCE_TOLERANCE_M)
        );
        const memberTags = inside.map(({ el }) => el.tags ?? {});
        const verdict = skiVerdict(poly.tags ?? {}, memberTags);

        const b = poly.bounds ?? boundsOf(rings.flat());
        if (!b) {
            rapport.push(`    ${id.padEnd(18)} ${navn.padEnd(32)} HOPPET OVER — ingen bounds`);
            continue;
        }

        // Hvert polygon får én linje med DOM og GRUNN. Begge feilene i den
        // første tørrkjøringen var stille: den ene mistet det største
        // anlegget, den andre la til noe som så riktig ut i en telling.
        const hvorfor =
            `${inside.length} bevis inne` +
            (hasSkiJump([poly.tags ?? {}, ...memberTags]) ? ', hoppanlegg' : '') +
            (verdict === 'usikker-heis' ? ', heis uten utforløype' : '');
        rapport.push(
            `    ${id.padEnd(18)} ${navn.padEnd(32)} ${verdict.padEnd(13)} ` +
                `[${grunnlag}, ${hvorfor}]`
        );

        if (verdict !== 'alpint') continue;
        const c = centerOfBounds(b);
        verified.push({
            ...poly,
            // Se centerOfBounds: dette er bbox-senteret, altså midt i bakken
            // og ikke ved bunnstasjonen. Kjent og akseptert i v1.
            center: { lat: c.lat, lon: c.lon },
            memberTags,
            skiVerified: true,
        });
    }

    const usikre = rapport.filter((r) => r.includes('usikker-heis')).length;
    return {
        elements: verified,
        rapport,
        summary:
            `${String(polygons.length).padStart(4)} polygoner, ` +
            `${evidence.length} bevisobjekter → ${verified.length} alpinanlegg` +
            (usikre ? `, ${usikre} med heis uten utforløype (se under)` : ''),
    };
}

// ─────────────────────────────────── AKING ───────────────────────────────────
//
// EGEN KATEGORI fra sep. 2026. Akebakker lå tidligere under Skianlegg, med
// «(akebakke)» skrevet inn i tittelen på den ene seedede raden. Det var ikke
// bare upresist: å ake i en alpinbakke i åpningstiden er farlig, og en
// kategori som blander de to inviterer til nettopp det. Derfor er skillet
// håndhevet i [akingVerdict] og ikke bare i navnet — et objekt tagget
// «piste:type=downhill;sled» blir ALDRI en Aking-rad.
//
// MÅLT NASJONALT (Overpass, sep. 2026): 89 objekter med piste:type=sled,
// 43 med piste:type=playground (skileik), og to objekter med
// «downhill;sled».

/**
 * [OUT_GEOM_TAGS] HVORFOR SPØRRINGENE SIER `out geom;` OG ALDRI `out geom tags;`
 *
 * Tørrkjøringen mot Oslo (sep. 2026) rapporterte «relation/1459739
 * Korketrekkeren HOPPET OVER — ingen geometri», og forankringen falt tilbake
 * på en vilkårlig av de 14 veiene. Årsaken er ikke i denne kodebasen, men i
 * hvordan Overpass tolker `out`:
 *
 *   map_ql_parser.cc  — `out` starter på mode="body"; ordet `tags` OVERSKRIVER
 *                       mode til "tags". `geom` setter bare geometry="full".
 *   print.cc:80       — mode "tags" gir ID | TAGS. Ingen MEMBERS, ingen NDS.
 *   print.cc:118      — geometry "full" legger til GEOMETRY | BOUNDS.
 *   output_json.cc    — hele `members`-blokka er portet på MEMBERS (l. 235),
 *                       mens `geometry` på en WAY bare krever GEOMETRY (l. 187)
 *                       og lat/lon på en NODE holder med GEOMETRY (l. 126).
 *
 * `out geom tags;` gir altså ID | TAGS | GEOMETRY | BOUNDS: ways får full
 * geometri, noder får koordinater — og relasjoner får INGEN medlemmer, bare
 * en bounding box. Det forklarer nøyaktig hva tørrkjøringen viste: de ti
 * veiene ble gruppert, noden Griser'n kom med, og relasjonen var tom.
 *
 * `out geom;` (mode = body) gir alt det samme PLUSS medlemmene, med geometri
 * per medlem. Prisen er at ways også får sin `nodes`-liste, som ingen leser —
 * noen prosent større svar, mot at relasjonsforankringen faktisk virker.
 */

/** Akebakke-selektoren. ÉN tagg, og det er med vilje.
 *
 *  `sport=toboggan` er BEVISST utelatt. Det eneste målte forekomsten i Oslo
 *  står på en LEKEPLASS (sammen med `playground=sledding`), og den skal
 *  forbli en lekeplass — se [akingVerdict]. Om det finnes frittstående
 *  `sport=toboggan`-objekter uten `piste:type` i Norge er IKKE målt, og en
 *  selektorlinje for dem ville vært en gjetning. Legges inn den dagen noen
 *  har telt dem.
 *
 *  `piste:type=playground` (skileik) er også utelatt, av en annen grunn: en
 *  skileik er ikke en akebakke. Den forblir en FASETT (`skileik`), slik den
 *  har vært siden migrasjon 0016.
 *
 *  Regex-en er understreng-matching, som alle Overpass sine `~`. Ingen annen
 *  piste:type-verdi inneholder «sled», så den er presis nok — og den skal
 *  fange «downhill;sled», nettopp for at [akingVerdict] kan AVVISE den
 *  synlig i rapporten framfor at den forsvinner i selektoren. */
export const AKING_SELECTOR = `nwr["piste:type"~"sled"]${NOT_DISUSED}(area.a);`;

/** Hvor nær to likt navngitte objekter må ligge for å telle som samme bakke.
 *
 *  Grupperingen er ENKELTLENKE: segment A og C havner sammen om B ligger
 *  mellom dem, så en lang bakke kan strekke seg mye lenger enn taket. Taket
 *  er derfor ikke bakkens lengde, men den største tillatte LUKEN mellom to
 *  nabosegmenter.
 *
 *  1000 m er valgt romslig nok til at et hull i taggingen ikke splitter en
 *  bakke i to rader, og stramt nok til at to ubeslektede «Akebakken» i hver
 *  sin bydel forblir to. Overstyrbar med PLACES_AKING_GROUP_M, av samme grunn
 *  som ski-tolleransen: to tørrkjøringer med ulik verdi skiller «for mange
 *  rader» fra «feil sammenslått», uten en kodeendring imellom. */
export const AKING_NAME_GROUP_M =
    Number(process.env.PLACES_AKING_GROUP_M ?? 1000) || 1000;

/** Har noen av tagg-settene en akeløype? */
export function hasSledPiste(tagSets: readonly OsmTags[]): boolean {
    return tagSets.some((t) => sportTokens(t['piste:type']).includes('sled'));
}

export type AkingVerdict =
    | 'aking'
    /** Også utforløype. Hører hjemme i alpinanlegget, ikke her. */
    | 'alpint-blandet'
    /** leisure=playground vinner. Se under. */
    | 'lekeplass'
    /** Uten brukbart navn — utelatt i v1. Se under. */
    | 'uten-navn'
    | 'ikke-aking';

/**
 * Er dette ÉN akebakke vi kan navngi?
 *
 * De tre avvisningene, i den rekkefølgen de tas:
 *
 *  1. `downhill;sled` → **alpint-blandet**. To objekter nasjonalt. Dette er
 *     kategoriens eksistensgrunn: en nedfart som også brukes til aking er en
 *     alpinbakke, og en akebakke-nål der ville sendt barn ned en bakke med
 *     slalåmkjørere i. Regelen står her, ikke i selektoren, så avvisningen
 *     blir synlig i rapporten.
 *
 *  2. `leisure=playground` → **lekeplass**. Oslo har minst én lekeplass
 *     tagget `sport=toboggan` + `playground=sledding`. Lekeplass står FØR
 *     Aking i [PLACE_CATEGORIES], så dedupliseringen i [overpassCity] ville
 *     uansett gitt lekeplassen forrang — men bare når begge spørringene
 *     kjører. Med `--categories=aking` gjør den det ikke, og uten denne
 *     linja ville akebakke-kategorien stjålet lekeplassen i nettopp den
 *     kjøringen. Den taper ingenting på å bli stående der den er: fasetten
 *     `aking` utledes fra `piste:type=sled` av standardregelen
 *     [osmFacetTokens], så lekeplassen med akebakke er søkbar på aking
 *     likevel.
 *
 *  3. Uten brukbart navn → **uten-navn**. Dette er v1-avgrensningen, og den
 *     er en ekte kostnad: et navnløst segment blir ingen rad. Grunnen er at
 *     grupperingen under bygger på navnet. To navnløse segmenter i samme
 *     bakke kan ikke skilles fra to navnløse bakker ved siden av hverandre,
 *     og valget står da mellom å lage én rad per segment (14 nåler på
 *     Korketrekkeren) eller ingen. Ingen er den ærligere feilen — og de
 *     navnløse telles i rapporten, så tallet ikke forsvinner.
 */
export function akingVerdict(t: OsmTags): AkingVerdict {
    if (!hasSledPiste([t])) return 'ikke-aking';
    if (hasDownhillPiste([t])) return 'alpint-blandet';
    if (t.leisure === 'playground') return 'lekeplass';
    // Leser HELE kjeden, ikke bare `name` — se [AKING_NAME_TAGS]. Sollibakken
    // (way/558688673) falt ut her før sep. 2026.
    if (!resolvePlaceName(t, AKING_NAME_TAGS)) return 'uten-navn';
    return 'aking';
}

/** Navnet som GRUPPERINGSNØKKEL. Bare trimming, småbokstaver og kollapset
 *  mellomrom — ingen fjerning av ord. «Øvre Akebakken» og «Akebakken» er to
 *  navn, og importen har ingen kilde som sier at de er samme bakke. */
export function akingNameKey(name: string | undefined): string {
    return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Tagg-nøklene Aking leser navnet fra, i prioritert rekkefølge.
 *
 * `piste:name` KOM INN sep. 2026, etter at way/558688673 Sollibakken falt ut
 * som «uten navn»: den bærer `piste:name=Sollibakken` og ingen `name`. Taggen
 * er dokumentert i OSM-ens piste-skjema og brukes når en way har en rolle
 * utover løypa (en skogsvei som også er akebakke, der `name` er veiens navn).
 *
 * AKING ER FØRSTE KATEGORI SOM LESER NOE ANNET ENN `name`. Ingen annen
 * kategori har et slikt mønster i dag — det er sjekket, ikke antatt:
 * [buildRows] leste `tags.name` fire steder og ingenting annet. Derfor er
 * mekanismen OPT-IN per kategori ([PlaceCategoryDef.nameTags]) i stedet for
 * en global fallback-kjede. En global kjede ville stille endret titlene på
 * alle ~7800 eksisterende radene ved neste import.
 *
 * SAMME LISTE brukes av [akingVerdict], [akingClusters] og kategorien selv.
 * Det er ikke pynt: grupperingen matcher på navn, og leste den et annet
 * navn enn tittelen, ville to segmenter av samme bakke kunne havnet i hver
 * sin gruppe med hvert sitt navn. Vakten står i scripts/aking.test.ts.
 */
export const AKING_NAME_TAGS = ['name', 'piste:name'] as const;

/** Standarden for alle andre kategorier: bare `name`. */
export const DEFAULT_NAME_TAGS = ['name'] as const;

export interface ResolvedName {
    /** Trimmet verdi, allerede godkjent av [isUsablePlaceName]. */
    value: string;
    /** Hvilken tagg den kom fra — kun til rapporten. */
    tag: string;
}

/**
 * Stedets navn, lest fra den FØRSTE taggen i [nameTags] som gir et BRUKBART
 * navn.
 *
 * «Første brukbare», ikke «første som finnes», og det er den viktige
 * detaljen: en akebakke lagt oppå en skogsvei har gjerne
 * `name=Frognerseterveien` + `piste:name=Sollibakken`. Med «første som
 * finnes» ville veinavnet vunnet, blitt forkastet av [isUsablePlaceName] som
 * rent gatenavn, og bakken hadde falt ut som navnløs — med piste:name-taggen
 * liggende rett ved siden av.
 *
 * Med default-lista (`['name']`) er oppførselen BIT FOR BIT som før: verdien
 * er enten et brukbart `name` eller null, og [makePlaceTitleDetailed] kjører
 * samme [isUsablePlaceName]-test selv.
 */
export function resolvePlaceName(
    t: OsmTags,
    nameTags: readonly string[] = DEFAULT_NAME_TAGS
): ResolvedName | null {
    for (const tag of nameTags) {
        const raw = t[tag];
        if (isUsablePlaceName(raw)) return { value: raw!.trim(), tag };
    }
    return null;
}

/**
 * Kartpunktet for en akebakke: bbox-senteret SNAPPET til nærmeste punkt i
 * geometrien.
 *
 * HVORFOR IKKE BARE BBOX-SENTERET, som Skianlegg bruker: et alpinanlegg er
 * et FLATE-objekt, og senteret i boksen ligger inne i anlegget. En akebakke
 * er en LINJE, ofte krum, og boksens senter kan da ligge helt utenfor traseen
 * — i skogen ved siden av, eller på en vei. Snappingen koster én sortering og
 * garanterer at nåla står på bakken.
 *
 * HVA DEN IKKE KAN: finne TOPPEN. Det er der man begynner å ake, og det er
 * punktet en forelder vil kjøre til. `out geom` gir ingen høyde på
 * way-punkter — `ele` finnes bare som tagg på enkelte noder (Griser'n har
 * ele=163) — og uten høyde kan ikke enden av en linje avgjøres som topp
 * eller bunn. Retningen på en way er heller ingen regel. Toppen krever en
 * høydekilde (Kartverkets høyde-API) og er en egen oppgave; v1 setter et
 * punkt PÅ bakken og sier tydelig i rapporten hvor lang den er, så en
 * akebakke med stor utstrekning kan kvalitetssikres manuelt.
 */
/** Over denne bbox-diagonalen er kartpunktet UPÅLITELIG og merkes i
 *  rapporten.
 *
 *  500 m er valgt ut fra hva punktet skal brukes til: en forelder kjører dit
 *  nåla står. En diagonal på 500 m betyr at nåla kan ligge 250 m fra begge
 *  endene, og 250 m i skogsterreng uten sti er der «jeg står ved nåla, men
 *  ser ingen bakke» begynner. En typisk akebakke er 100-300 m og havner godt
 *  under. Av de fem målte i Oslo er det Akebakken (950 m) og Korketrekkeren
 *  (1240 m) som slår ut — og begge er nettopp de to der punktet ligger midt
 *  i løypa.
 *
 *  Terskelen fjerner ikke raden. Den er et flagg til den som leser
 *  tørrkjøringen, til en høydekilde finnes (egen oppgave). Overstyrbar med
 *  PLACES_AKING_WARN_M. */
export const AKING_DIAGONAL_WARN_M =
    Number(process.env.PLACES_AKING_WARN_M ?? 500) || 500;

/**
 * GEOMETRIEN for én klynge, med fallback — og uten ringsammensying.
 *
 * EN RUTE-RELASJON ER EN LINJE, IKKE ET POLYGON. [assembleRings] (og dermed
 * [polygonRings]) er skrevet for multipolygoner: den syr medlemsveier sammen
 * til LUKKEDE ringer og forkaster alt som forblir åpent. Korketrekkeren er en
 * åpen trasé fra Frognerseteren til Midtstuen — sammensyingen ville forkastet
 * hele bakken. Her trengs bare punktSKYEN, og [elementPoints] gir den
 * allerede: den leser `members[].geometry` på relasjoner og `geometry` på
 * ways, uten å bry seg om hvorvidt noe lukker seg.
 *
 * STIGEN, i rekkefølge:
 *   1. medlemsgeometri — alle punkter i klyngen, snappet til nærmeste punkt.
 *   2. bounds (grov)   — Overpass sin egen bounding box, som `out geom` gir
 *                        også når medlemslista mangler. Da finnes det ingen
 *                        geometri å snappe TIL, så senteret er det beste
 *                        estimatet og punktet er ikke garantert å ligge på
 *                        bakken. Rapporten sier hvilken av de to som ble
 *                        brukt.
 *   3. null            — hoppes over, med linje i rapporten.
 *
 * Trinn 2 er ikke teoretisk: den er nøyaktig det tørrkjøringen i sep. 2026
 * manglet. Med `out geom tags` hadde relasjonen bounds og ingenting annet, og
 * uten stigen ble den kastet framfor å bli forankret grovt.
 */
export function akingGeometry(
    medlemmer: readonly OsmElement[]
): { punkt: GeoPoint; bounds: GeoBounds; grunnlag: string } | null {
    const punkter = medlemmer.flatMap((el) => elementPoints(el));
    const b = boundsOf(punkter);
    if (b) {
        const punkt = akingAnchorPoint(punkter);
        if (punkt) return { punkt, bounds: b, grunnlag: 'medlemsgeometri' };
    }
    // Hjørnene i hver medlemsboks gir unionen av boksene.
    const hjorner = medlemmer.flatMap((el) => (el.bounds ? boundsRing(el.bounds) : []));
    const bb = boundsOf(hjorner);
    if (bb) return { punkt: centerOfBounds(bb), bounds: bb, grunnlag: 'bounds (grov)' };
    return null;
}

export function akingAnchorPoint(points: readonly GeoPoint[]): GeoPoint | null {
    const b = boundsOf(points);
    if (!b) return null;
    const c = centerOfBounds(b);
    let best = points[0];
    let bestD = Infinity;
    for (const p of points) {
        const d = distanceMeters(p, c);
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return best;
}

/** Sorteringsnøkkel som gjør valget av anker DETERMINISTISK, uavhengig av
 *  rekkefølgen Overpass tilfeldigvis svarer i. Relasjon slår way slår node —
 *  et samleobjekt er et bedre anker enn ett av delene — og innenfor samme
 *  type vinner laveste id. */
const AKING_TYPE_RANK: Record<OsmElement['type'], number> = {
    relation: 0,
    way: 1,
    node: 2,
};
function akingAnchorOrder(a: OsmElement, b: OsmElement): number {
    return AKING_TYPE_RANK[a.type] - AKING_TYPE_RANK[b.type] || a.id - b.id;
}

/** Enkeltlenke-gruppering på avstand. O(n²), og det er greit: den største
 *  navnegruppa i Oslo er et titalls segmenter. */
export function clusterByProximity(
    elements: readonly OsmElement[],
    meters: number
): OsmElement[][] {
    const boxes = elements.map((el) => boundsOf(elementPoints(el)));
    const rest = elements.map((_, i) => i);
    const out: OsmElement[][] = [];
    while (rest.length) {
        const seed = rest.shift()!;
        const gruppe = [seed];
        // Bredde-først: hvert nytt medlem kan trekke inn flere, og det er
        // nettopp det enkeltlenke betyr.
        for (let i = 0; i < gruppe.length; i += 1) {
            const a = boxes[gruppe[i]];
            if (!a) continue;
            for (let j = rest.length - 1; j >= 0; j -= 1) {
                const b = boxes[rest[j]];
                if (!b) continue;
                if (boundsGapMeters(a, b) <= meters) {
                    gruppe.push(rest[j]);
                    rest.splice(j, 1);
                }
            }
        }
        out.push(gruppe.map((i) => elements[i]));
    }
    return out;
}

export interface AkingResult {
    /** Ferdige ankere, ett per akebakke, med `center`, `memberTags` og
     *  `akingVerified` satt. Går rett inn i standard-rørledningen. */
    anchors: OsmElement[];
    /** Én linje per objekt/gruppe, for tørrkjøringsrapporten. */
    rapport: string[];
    /** Antall objekter per dom — inkludert 'aking', som er de GODKJENTE
     *  objektene (og ikke antall rader: flere objekter blir én rad). */
    domTelling: Record<AkingVerdict, number>;
}

/**
 * FRA RÅ OVERPASS-SVAR TIL ÉN RAD PER AKEBAKKE.
 *
 * FELLA SOM GJØR DETTE NØDVENDIG: Korketrekkeren er 14 separate veisegmenter
 * i OSM, hver med `piste:type=sled` og samme navn. Uten gruppering ville
 * kategorien fått 14 nåler oppå hverandre i Nordmarka ved første import.
 * `relation/1459739` samler de samme segmentene.
 *
 * FORANKRINGEN, i prioritert rekkefølge — og hva hvert alternativ gjør med de
 * fem målte Oslo-objektene:
 *
 *  1. RELASJONEN, der den finnes. Medlemmene ekskluderes EKSAKT på
 *     `type/ref`, ikke på avstand eller navnelikhet. Korketrekkeren → 1 rad.
 *  2. NAVNEGRUPPE innenfor [AKING_NAME_GROUP_M] for resten. «Akebakken» er
 *     flere ways uten relasjon → 1 rad. Griser'n (node), Sollibakken og
 *     Bjartbakken er enkeltobjekter og blir 1 rad hver — en navnegruppe på
 *     ett medlem er samme kodevei, ikke et unntak.
 *  3. Navnløse UTELATES. Se [akingVerdict].
 *
 * Alternativene som ble forkastet: «bare relasjoner» ville mistet alle fire
 * de andre Oslo-objektene, siden bare Korketrekkeren har en relasjon. «Bare
 * avstandsgruppering, uten navn» ville slått Sollibakken og Bjartbakken
 * sammen om de ligger i samme li — avstand alene kan ikke skille to bakker
 * som deler skråning.
 *
 * MEDLEMMER AV EN RELASJON EKSKLUDERES OGSÅ NÅR RELASJONEN SELV AVVISES SOM
 * `alpint-blandet`. Ellers ville segmentene i en kombinert bakke sluppet inn
 * gjennom navnegruppa og gjenopprettet nøyaktig den sammenblandingen
 * kategorien finnes for å fjerne. En relasjon som avvises som `uten-navn`
 * ekskluderer derimot IKKE medlemmene sine: der kan segmentene være navngitt
 * selv, og da er de den beste kilden vi har.
 *
 * EXTERNAL_ID er ankerets egen `type/id`, som for alle andre kategorier.
 * Kjent kostnad: deles eller slås ways sammen i OSM, kan ankeret bytte id, og
 * den gamle raden blir stående (importen sletter aldri). Et syntetisk
 * `aking/<by>/<navn>` ville vært stabilt, men brutt konvensjonen om at
 * external_id peker på et ekte OSM-objekt — og dermed lenka i [buildRows].
 * Valget er tatt bevisst; en foreldreløs rad kan avpubliseres manuelt, og
 * `locked` verner rettingen.
 */
export function akingClusters(elements: readonly OsmElement[]): AkingResult {
    const domTelling: Record<AkingVerdict, number> = {
        aking: 0,
        'alpint-blandet': 0,
        lekeplass: 0,
        'uten-navn': 0,
        'ikke-aking': 0,
    };
    const rapport: string[] = [];

    // Pass 1: dommen per objekt.
    const dom = new Map<OsmElement, AkingVerdict>();
    for (const el of elements) dom.set(el, akingVerdict(el.tags ?? {}));

    // Pass 2: hvilke objekter er allerede dekket av en relasjon?
    //
    // HOVEDVEIEN er eksakt: medlemslista, matchet på `type/ref`. Den krever at
    // Overpass faktisk sendte medlemmene — se [OUT_GEOM_TAGS] for gangen da
    // den ikke gjorde det.
    //
    // RESERVEVEIEN, for en relasjon UTEN medlemsliste: samme navn OG et punkt
    // inne i relasjonens bounding box. Den finnes fordi et bounds-forankret
    // anker uten noen form for dekning ville vært verre enn ingen forankring:
    // relasjonen hadde blitt én rad og segmentene en ANNEN rad, altså to
    // nåler på samme bakke der vi før hadde én. Boksen er regnet ut av
    // Overpass fra nettopp de segmentene, så testen trenger ingen toleranse —
    // et medlem kan per definisjon ikke ligge utenfor.
    const dekket = new Set<string>();
    const boksDekning: { key: string; bounds: GeoBounds }[] = [];
    for (const el of elements) {
        if (el.type !== 'relation') continue;
        const d = dom.get(el);
        if (d !== 'aking' && d !== 'alpint-blandet') continue;
        if (el.members?.length) {
            for (const m of el.members) dekket.add(`${m.type}/${m.ref}`);
        } else if (el.bounds) {
            boksDekning.push({
                key: akingNameKey(resolvePlaceName(el.tags ?? {}, AKING_NAME_TAGS)?.value),
                bounds: el.bounds,
            });
        }
    }

    /** Er objektet dekket av en relasjon — eksakt eller via reserveveien? */
    const erDekket = (el: OsmElement): boolean => {
        if (dekket.has(`${el.type}/${el.id}`)) return true;
        if (!boksDekning.length) return false;
        const key = akingNameKey(resolvePlaceName(el.tags ?? {}, AKING_NAME_TAGS)?.value);
        if (!key) return false;
        const punkter = elementPoints(el);
        return boksDekning.some(
            (b) => b.key === key && punkter.some((p) => pointInBounds(p, b.bounds))
        );
    };

    // TELLINGEN kommer ETTER pass 2, ikke i pass 1, og det er en retting.
    // Korketrekkerens 14 segmenter er dekket av relasjonen; teller vi dem,
    // sier rapporten «15 aking» om én bakke, og de segmentene som mangler
    // navn blåser opp «uten navn» med tall som ikke representerer data vi
    // faktisk går glipp av. Rapporten skal telle det som står igjen å
    // bestemme, ikke det Overpass sendte.
    for (const el of elements) {
        if (el.type !== 'relation' && erDekket(el)) continue;
        domTelling[dom.get(el)!] += 1;
    }

    const godkjent = elements.filter((el) => dom.get(el) === 'aking');
    const relasjoner = godkjent.filter((el) => el.type === 'relation');
    const frie = godkjent.filter((el) => el.type !== 'relation' && !erDekket(el));

    // Pass 3: grupper de frie på navn, så på avstand innenfor navnet.
    const perNavn = new Map<string, OsmElement[]>();
    for (const el of frie) {
        // SAMME kjede som dommen og tittelen. Leste denne bare `name`, ville
        // Sollibakken-segmentet fått tom nøkkel og gruppert seg med et
        // hvilket som helst annet navnløst — se [AKING_NAME_TAGS].
        const key = akingNameKey(resolvePlaceName(el.tags ?? {}, AKING_NAME_TAGS)?.value);
        const liste = perNavn.get(key);
        if (liste) liste.push(el);
        else perNavn.set(key, [el]);
    }
    const grupper: { medlemmer: OsmElement[]; grunnlag: string }[] = [];
    for (const rel of relasjoner) grupper.push({ medlemmer: [rel], grunnlag: 'relasjon' });
    // Sortert på navnenøkkel, så rapporten er stabil mellom kjøringer.
    for (const key of [...perNavn.keys()].sort()) {
        for (const klynge of clusterByProximity(perNavn.get(key)!, AKING_NAME_GROUP_M)) {
            grupper.push({
                medlemmer: klynge,
                grunnlag: klynge.length > 1 ? `navnegruppe×${klynge.length}` : 'enkeltobjekt',
            });
        }
    }

    const anchors: OsmElement[] = [];
    let upalitelige = 0;
    for (const { medlemmer, grunnlag } of grupper) {
        const anker = [...medlemmer].sort(akingAnchorOrder)[0];
        const geo = akingGeometry(medlemmer);
        const id = `${anker.type}/${anker.id}`;
        const navnet = resolvePlaceName(anker.tags ?? {}, AKING_NAME_TAGS);
        const navn = navnet?.value ?? '(uten navn)';
        if (!geo) {
            rapport.push(`    ${id.padEnd(18)} ${navn.padEnd(32)} HOPPET OVER — ingen geometri`);
            continue;
        }
        const { punkt, bounds: b } = geo;
        // Utstrekningen skrives ut fordi kartpunktet er et kompromiss: en
        // bakke på 2 km har en nål som ikke står ved starten, og da skal
        // tallet stå i rapporten framfor å oppdages på kartet.
        const lengde = Math.round(
            distanceMeters(
                { lat: b.minlat, lon: b.minlon },
                { lat: b.maxlat, lon: b.maxlon }
            )
        );
        const upalitelig = lengde > AKING_DIAGONAL_WARN_M;
        if (upalitelig) upalitelige += 1;
        rapport.push(
            `    ${id.padEnd(18)} ${navn.padEnd(32)} ${grunnlag.padEnd(16)} ` +
                `[${medlemmer.length} objekt, ${geo.grunnlag}, bbox-diagonal ${lengde} m` +
                (navnet && navnet.tag !== 'name' ? `, navn fra ${navnet.tag}` : '') +
                ']' +
                (upalitelig ? `  ⚠ UPÅLITELIG KARTPUNKT (>${AKING_DIAGONAL_WARN_M} m)` : '')
        );
        anchors.push({
            ...anker,
            lat: undefined,
            lon: undefined,
            center: { lat: punkt.lat, lon: punkt.lon },
            memberTags: medlemmer.map((el) => el.tags ?? {}),
            akingVerified: true,
        });
    }

    if (upalitelige) {
        rapport.push(
            `    ⚠ ${upalitelige} av ${anchors.length} har bbox-diagonal over ` +
                `${AKING_DIAGONAL_WARN_M} m — nåla står midt i løypa, ikke der man starter. ` +
                `Toppen krever en høydekilde (egen oppgave).`
        );
    }

    return { anchors, rapport, domTelling };
}

/** Henter Aking for én by. `out geom` fordi grupperingen og kartpunktet
 *  trenger geometrien, og fordi relasjonsforankringen trenger MEDLEMMENE —
 *  se [OUT_GEOM_TAGS] for hvorfor ordet `tags` ikke får stå der. */
async function akingFetch(chunk: ImportChunk): Promise<FetchSets> {
    const main = await fetchOverpass(
        overpassQuery(chunk, AKING_SELECTOR, 'out geom'),
        `${chunk.label}/aking:objekter`
    );
    return { main };
}

/**
 * BERIKELSEN for Aking: klyngingen, uten nettverk.
 *
 * KLYNGING ER IKKE HENTING. Det er den avgjørelsen som gjør de 14
 * Korketrekker-segmentene til ÉN rad, og den er ren tolkning av data vi
 * allerede har. Lå den i hentesteget, ville et bytte av kilde i fase 3 tatt
 * den med seg — og den er det mest særegne i hele kategorien.
 */
export function akingEnrich(sets: FetchSets): EnrichOutput {
    const raw = sets.main ?? [];
    const { anchors, rapport, domTelling } = akingClusters(raw);
    return {
        elements: anchors,
        rapport,
        summary:
            `${String(raw.length).padStart(4)} objekter → ` +
            `${anchors.length} akebakker (avvist: ${domTelling['alpint-blandet']} alpint-blandet, ` +
            `${domTelling.lekeplass} lekeplass, ${domTelling['uten-navn']} uten navn)`,
    };
}

interface PlaceCategoryDef {
    key: string;
    /** Kategoriens navn OG standard tittel-prefiks. */
    label: string;
    /** Verdien som lagres i activities.category. */
    category: string;
    audience: string;
    selector: string;
    /**
     * Andre argument er ELEMENTET, ikke bare taggene. Alle kategorier unntatt
     * Skianlegg ignorerer det og avgjør på tagger alene. Skianlegg trenger
     * det fordi taggene ikke er nok: et langrennsstadion og et alpinanlegg
     * ser identiske ut, og skillet er den romlige verifiseringen som
     * [skianleggElements] har gjort. Uten den ville et ski-tagget polygon som
     * kom inn via idrettshall-spørringen blitt hevdet av Skianlegg her.
     */
    matches: (t: OsmTags, el?: OsmElement) => boolean;
    /**
     * Kategoriens prisantakelse når OSM ikke sier noe. Typen er `true | null`,
     * IKKE boolean: en kategori kan påstå at noe er gratis, aldri at det
     * koster. `false` kan bare komme fra en eksplisitt `fee=yes` på det
     * enkelte stedet.
     *
     * Asymmetrien er tilsiktet og er svaret på «bør feltet skille mellom at
     * kategorien VET og at den GJETTER». Et eget felt for det ville vært
     * overflødig: en `true` her er alltid kunnskap (offentlige uteanlegg er
     * gratis; folkebibliotek er gratis ved lov), og alt som ville vært en
     * gjetning hører hjemme som `null`. Typen håndhever det, så en ny
     * kategori ikke kan gjenta museums-feilen ved et uhell.
     *
     * `null` betyr «ukjent», ikke «betalt». Appen viser det som et nøytralt
     * merke etter togedoo-modern 3c70f07 — ingen påstand i noen retning.
     */
    isFree: true | null;
    /**
     * Overstyrer [label] som tittel-prefiks, per element. Satt kun for
     * ballbane, der én kategori dekker seks sporter.
     */
    titleLabelFor?: (t: OsmTags) => string;
    /**
     * Overstyrer [osmFacetTokens] for denne kategorien. Ingen kategori
     * trenger det i dag — standardregelen dekker piste:type, mtb:type og
     * route=mtb, og de er kategoriuavhengige. Kroken finnes for den dagen en
     * kategori har en fasett som bare gir mening der (f.eks. et anlegg der
     * en tagg betyr noe annet enn ellers).
     */
    facetsFor?: (el: OsmElement) => FacetToken[];
    /**
     * Erstatter standardhentingen (selector + `out center tags`) for denne
     * kategorien. Satt for Skianlegg (to spørringer, `out geom`) og Aking
     * (én spørring, `out geom`).
     *
     * HENTER BARE. Alt som TOLKER de hentede dataene hører hjemme i
     * [enrichSets] — se der for hvorfor skillet er verdt en ekstra funksjon.
     */
    fetchSets?: (chunk: ImportChunk) => Promise<FetchSets>;
    /**
     * Gjør hentede sett om til elementene som kan bli rader.
     *
     * Satt for Skianlegg (romlig verifisering) og Aking (klynging). Begge er
     * RENE funksjoner uten nettverk, og det er poenget med sømmen: de
     * overlever at kilden byttes i fase 3, og de kan testes uten Overpass.
     *
     * Standarden er identitet på settet `main`.
     */
    enrichSets?: (sets: FetchSets) => EnrichOutput;
    /**
     * Tagg-nøklene stedets navn leses fra, i prioritert rekkefølge.
     * Default [DEFAULT_NAME_TAGS] = kun `name`, som er det alle kategorier
     * unntatt Aking bruker. Se [resolvePlaceName] og [AKING_NAME_TAGS].
     */
    nameTags?: readonly string[];
}

// Rekkefølgen er match-prioritet (et element kategoriseres av første treff).
export const PLACE_CATEGORIES: PlaceCategoryDef[] = [
    {
        // Først i match-prioritet: institusjonen vinner over evt. park-/
        // leisure-tagger på samme objekt. Tag-proben (jul. 2026, Oslo/
        // Bergen/Stavanger): 132 steder, 97 % navn, fee 62,1 %,
        // opening_hours 51,5 %, charge med kronebeløp 12,9 %.
        //
        // isFree var `false` fram til sep. 2026. Det gjorde at de ~38 % uten
        // fee-tagg havnet på «Betalt inngang» i appen — en påstand importen
        // ikke har grunnlag for, og for målgruppen ofte direkte feil: ved
        // norske museer kommer barn stort sett gratis inn (Nasjonalmuseet og
        // MUNCH under 18, Rockheim 0–15, Oslo Museum til og med 25).
        //
        // `null` er ikke en dårligere gjetning enn `false` — det er fravær av
        // gjetning. Merk at det først BLE trygt med togedoo-modern 3c70f07:
        // før den viste appen ingenting for null, mens den nå viser et
        // nøytralt merke. Prisen som faktisk gjelder for et museum er en
        // betinget størrelse (barn/voksen, gratisdager) som hverken en
        // boolean eller OSM kan bære — se vurderingen av price_text.
        key: 'museum',
        label: 'Museum',
        category: 'Museum',
        audience: 'For alle',
        selector: 'nwr["tourism"="museum"](area.a);',
        matches: (t: OsmTags) => t.tourism === 'museum',
        isFree: null,
    },
    {
        // Rik OSM-dekning i de fire byene (Deichman, Bergen off. bibliotek,
        // Trondheim folkebibliotek, Sølvberget m/filialer). Nesten alle har
        // name-tag → få trenger geokodet tittel. access!=private siler bort
        // institusjons-/skolebibliotek. Gratis inngang.
        key: 'bibliotek',
        label: 'Bibliotek',
        category: 'Bibliotek',
        audience: 'For alle',
        selector: 'nwr["amenity"="library"]["access"!="private"](area.a);',
        matches: (t: OsmTags) => t.amenity === 'library',
        isFree: true,
    },
    {
        key: 'lekeplass',
        label: 'Lekeplass',
        category: 'Lekeplass',
        audience: 'Barn',
        selector: 'nwr["leisure"="playground"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'playground',
        isFree: true,
    },
    {
        // MÅ STÅ ETTER lekeplass. Rekkefølgen er match-prioritet, og Oslo har
        // minst én lekeplass tagget både `sport=toboggan`/`playground=sledding`
        // og `piste:type=sled`. Sto Aking først, ville akebakke-kategorien
        // stjålet en lekeplass — og en lekeplass er det en forelder leter
        // etter hele året, ikke bare når det er snø.
        //
        // Motsatt vei er også håndhevet, og det er den viktigere retningen:
        // [akingVerdict] avviser `leisure=playground` eksplisitt, så
        // lekeplassen blir ikke stjålet selv når bare Aking-spørringen kjører
        // (`--categories=aking`). Den mister ingenting på å bli i Lekeplass:
        // standardregelen [osmFacetTokens] gir den fasetten `aking` fra
        // `piste:type=sled` uansett.
        key: 'aking',
        label: 'Aking',
        category: 'Aking',
        // «For alle», ikke «Barn». Akebakken er et av de få stedene der
        // voksne faktisk er med ned, og Lekeplass sin «Barn» ville vært en
        // snevrere påstand enn kategorien bærer.
        audience: 'For alle',
        selector: AKING_SELECTOR,
        fetchSets: akingFetch,
        enrichSets: akingEnrich,
        // Første og eneste kategori som leser noe annet enn `name`.
        // way/558688673 Sollibakken bærer piste:name og falt ut som «uten
        // navn» i tørrkjøringen sep. 2026. Grupperingen leser SAMME liste.
        nameTags: AKING_NAME_TAGS,
        // Taggene alene kan ikke avgjøre dette. Grupperingen i
        // [akingClusters] har allerede bestemt hvilket objekt som er ANKERET
        // for bakken; uten flagget ville hvert av Korketrekkerens 14 segmenter
        // matchet like godt, og 13 av dem ville blitt egne rader dersom de
        // kom inn via en annen spørring.
        matches: (_t: OsmTags, el?: OsmElement) => el?.akingVerified === true,
        // FAST `aking`, ikke utledet fra medlemmene. Standardregelen ville
        // gitt det samme i det normale tilfellet — ankeret bærer
        // `piste:type=sled`, ellers var det ikke her — men [osmFacetTokensFrom]
        // over medlemstaggene kunne plukket opp `alpint` fra ett segment som
        // også er tagget downhill, og skrevet «alpint» på en akebakke-rad.
        // Det er nøyaktig sammenblandingen kategorien finnes for å fjerne, så
        // løftet holdes eksakt: en Aking-rad lover aking.
        facetsFor: () => ['aking'],
        // GRATIS, som Lekeplass og Badeplass. Ikke en gjetning: en akebakke
        // er en offentlig bakke med snø i, og det unntaket man kan tenke seg
        // — en akebakke inne på et alpinanlegg med billett — faller uansett
        // ut som `alpint-blandet` eller ligger i et Skianlegg-polygon.
        //
        // Merk at `true | null` her ikke stenger døra: [resolveIsFree] leser
        // `fee=yes` på det enkelte stedet og setter false, så en bakke som
        // FAKTISK koster penger kan si det selv i OSM. Kategorien påstår
        // gratis, den påtvinger det ikke.
        isFree: true,
    },
    {
        // RULLESPORT (sep. 2026, fase C andre halvdel). Skatepark, BMX-bane,
        // pumptrack og rulleskiløype i én kategori — de deler brukergruppe, og
        // flere av anleggene deler faktisk flate i tid mellom skateboard,
        // sparkesykkel, BMX og inlines (se docs/seed-backlog.md).
        //
        // MÅ STÅ FØR BALLBANE. Dette er den avgjørende plasseringen, og den er
        // en sterkere utgave av klatring/idrettshall-forholdet under:
        // ballbanes matches() er `t.leisure === 'pitch'` UTEN sport-sjekk, så
        // den svelger enhver pitch som når fram til den. 356 av de 376
        // nasjonale skateboard-treffene ER pitcher. Verifisert mot dagens kode
        // før endringen: {leisure:'pitch', sport:'skateboard'} ga «ballbane».
        // Bak ballbane ville kategorien altså vært tom fra dag én.
        //
        // FORANKRET I leisure=pitch OG leisure=track — ikke i én leisure-verdi
        // slik de andre kategoriene er. leisure=skatepark og leisure=pump_track
        // finnes IKKE i norsk OSM (0 treff nasjonalt), så det finnes ingen
        // enkelt-tagg å feste seg i. Fordelingen: skateboard 356 pitch / 5
        // sports_centre / 1 track / 1 playground; bmx+pumptrack+roller_skiing
        // 63 track / 7 pitch / 2 sports_centre / 1 range. To leisure-verdier
        // dekker 95 % og 86 % av hver gruppe.
        //
        // leisure=track er ubrukt av alle andre kategorier (verifisert: ingen
        // matches() treffer {leisure:'track'}), så den delen kolliderer ikke.
        // Motstykket er at et track som IKKE matcher her ikke har noen kategori
        // å falle til — det forklarer multi-vakten under.
        //
        // sports_centre er BEVISST utelatt, selv om 7 anlegg ligger der.
        // matches() må speile selektoren: aksepterte den sports_centre, ville
        // idrettshall-spørringen matet rullesport med elementer denne
        // kategorien aldri ba om — nøyaktig den selektor/matches-asymmetrien
        // som gjorde ballbane farlig over. De 7 blir liggende som Idrettshall.
        // De seks store innendørshallene (Oslo Skatehall, Skur 13, tre Fysak,
        // Trikkestallen, Paradis) er uansett ikke i OSM som skateanlegg og
        // kommer via seed, ikke import — se docs/seed-backlog.md.
        //
        // Regex, ikke likhet: to tredjedeler av BMX ligger i sammensatte
        // verdier med varierende rekkefølge (bmx 54, bmx;cycling 50,
        // cycling;bmx 63). sportTokens() splitter, så rekkefølgen er likegyldig.
        key: 'rullesport',
        label: 'Rullesport',
        category: 'Rullesport',
        audience: 'For alle',
        selector:
            `nwr["leisure"="pitch"]["sport"~"${ROLLER_SPORT_SELECTOR_RE}",i]["access"!="private"](area.a);\n  ` +
            `nwr["leisure"="track"]["sport"~"${ROLLER_SPORT_SELECTOR_RE}",i]["access"!="private"](area.a);`,
        // Multi-vakten gjelder KUN pitch, og det er ikke en forglemmelse: der
        // finnes Ballbane rett bak som ærlig fallback for en flerbruksflate
        // tagget «skateboard;multi». For track finnes ingen kategori bak, så
        // samme vakt ville slettet elementet i stillhet i stedet for å flytte
        // det. Presedensen er GENERIC_BALL_SPORTS' egen: den beskriver når en
        // flate er en generisk ballflate, og det er nettopp da Ballbane vinner.
        matches: (t: OsmTags) =>
            hasRollerSport(t.sport) &&
            (t.leisure === 'track' ||
                (t.leisure === 'pitch' &&
                    !sportTokens(t.sport).some((s) => GENERIC_BALL_SPORTS.has(s)))),
        // Gratis, som ballbane. Selektoren er begrenset til pitch og track —
        // utendørs betong og asfalt — og det er nettopp sports_centre-anleggene
        // og de seed-ede hallene som tar betaling. tags.fee overstyrer uansett
        // per sted.
        isFree: true,
        titleLabelFor: (t: OsmTags) => rollerTitleLabel(t.sport),
    },
    {
        // Ball- OG RACKETSPORT (des. 2026, fase B). Selektoren hentet tidligere
        // bare soccer|basketball|multi, så tennis (187), bordtennis (174),
        // volleyball (173 inkl. beach/sand) og håndball (17) ble filtrert bort
        // ved import og fantes ikke i databasen.
        //
        // Overpass' `~` er USNITT-forankret, så seks alternativer dekker alle
        // variantene: `tennis` fanger også `table_tennis`, `volleyball` fanger
        // `beachvolleyball`/`beach_volleyball`, `handball` fanger
        // `beachhandball`. Flere ledd ville bare vært støy.
        //
        // Kategoriverdien er fortsatt «Ballbane» for alle seks — det er
        // databasenøkkelen. Appen VISER «Ball- og racketsport» via
        // CategoryTheme.label; nøkkelen renames bevisst ikke, fordi de
        // konstruerte titlene («Ballbane ved X») er koblet til den gjennom
        // DatahubPlace.displayTitle-strippingen.
        key: 'ballbane',
        label: 'Ballbane',
        category: 'Ballbane',
        audience: 'For alle',
        selector:
            'nwr["leisure"="pitch"]["sport"~"soccer|basketball|multi|tennis|volleyball|handball",i]["access"!="private"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'pitch',
        isFree: true,
        titleLabelFor: (t: OsmTags) => ballTitleLabel(t.sport),
    },
    {
        // KLATRING (fase C). Må stå FØR idrettshall: kategorisering skjer på
        // første treff, og idrettshall-selektoren under er ufiltrert
        // sports_centre — den ville ellers svelget alle klatreanleggene.
        //
        // Forankret i leisure=sports_centre, IKKE i sport=climbing. Nasjonalt
        // har sport=climbing 1253 treff, men bare 63 har leisure-taggen. De
        // øvrige ~1177 er utendørs klatrefelt og enkeltruter på klippevegger
        // — utstyrskrevende og ikke familiesteder. De skal ikke inn, og en
        // sport-forankret selektor ville tatt dem alle.
        //
        // Overpass' `~` er usnitt-forankret, så ett ledd dekker begge
        // variantene: `climbing` fanger også `climbing_adventure` (12
        // nasjonalt, alle sports_centre). Samme resonnement som for
        // ball-/racketselektoren over.
        key: 'klatring',
        label: 'Klatring',
        category: 'Klatring',
        audience: 'For alle',
        selector: 'nwr["leisure"="sports_centre"]["sport"~"climbing",i](area.a);',
        // Sjekker BÅDE leisure og sport: samme objekt kommer tilbake fra
        // idrettshall-spørringen også, og uten sport-sjekken ville hvilket
        // som helst sports_centre blitt «Klatring».
        matches: (t: OsmTags) =>
            t.leisure === 'sports_centre' &&
            hasClimbingSport(t.sport) &&
            !sportTokens(t.sport).some((s) => GENERIC_CENTRE_SPORTS.has(s)),
        // Klatresentre tar som regel betaling, men ikke alle — ukjent er
        // ærligere enn en gjetning.
        isFree: null,
        titleLabelFor: (t: OsmTags) => climbTitleLabel(t.sport),
    },
    {
        // MÅ STÅ FØR idrettshall. Rekkefølgen er match-prioritet, og
        // idrettshall er en ukvalifisert oppsamler for leisure=sports_centre.
        // Står Skianlegg etter, havner de 13 sports_centre-alpinanleggene i
        // Idrettshall — trolig nøyaktig slik Saupstad skisenter har havnet der.
        key: 'skianlegg',
        label: 'Skianlegg',
        category: 'Skianlegg',
        audience: 'For alle',
        selector: SKI_AREA_SELECTOR,
        fetchSets: skianleggFetch,
        enrichSets: skianleggVerify,
        // Taggene alene kan ikke avgjøre dette — se [PlaceCategoryDef.matches].
        // skiVerified settes kun av skianleggElements, etter at heis eller
        // utforløype er funnet i eller inntil polygonet.
        matches: (_t: OsmTags, el?: OsmElement) => el?.skiVerified === true,
        // Fasettene kommer fra MEDLEMMENE: piste:type og mtb:type står på
        // nedfartene og løypene, ikke på polygonet. Polygonets egne tagger tas
        // med fordi et lite anlegg av og til bærer piste:type selv.
        facetsFor: (el: OsmElement) =>
            osmFacetTokensFrom([el.tags ?? {}, ...(el.memberTags ?? [])]),
        // UKJENT, ikke «betalt». Alpinanlegg med heis koster nesten alltid
        // penger, men kategorien rommer også kommunale barnebakker med gratis
        // rope_tow, akebakker og skileikområder. En default på `false` ville
        // vært den samme feilen som museene hadde: et «Betalt inngang»-merke
        // uten grunnlag, som er verre enn ingen påstand. resolveIsFree leser
        // fee=yes/no der OSM faktisk har den.
        isFree: null,
    },
    {
        key: 'idrettshall',
        label: 'Idrettshall',
        category: 'Idrettshall',
        audience: 'For alle',
        selector: 'nwr["leisure"="sports_centre"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'sports_centre',
        isFree: null,
    },
    {
        key: 'badeplass',
        label: 'Badeplass',
        category: 'Badeplass',
        audience: 'For alle',
        selector: 'nwr["natural"="beach"](area.a);',
        matches: (t: OsmTags) => t.natural === 'beach',
        isFree: true,
    },
    {
        key: 'park',
        label: 'Park',
        category: 'Park',
        audience: 'For alle',
        selector: 'nwr["leisure"="park"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'park',
        isFree: true,
    },
];

type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

// Forbigående server-/gateway-statuser verdt å prøve på nytt: 429 (rate limit),
// 500, 502 (bad gateway), 503 (overbelastet) og 504 (gateway timeout).
//
// 500 kom inn des. 2026, etter at en ustabil Overpass-periode feilet HELE byer
// på første forsøk: 500 lå ikke i settet, så det ble kastet umiddelbart — uten
// retry OG uten å prøve speilet. Overpass svarer 500 både på ekte
// spørringsfeil («Query run error») og når serveren er presset. Vi retryer
// begge: spørringene her er statiske og verifiserte, så et 500 er i praksis
// alltid last. Prisen for en ekte spørringsfeil er noen bortkastede forsøk,
// mot at en travel time ikke lenger feller en hel by.
export const OVERPASS_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

// Antall runder over speil-lista. To runder ga 4 forsøk med to speil; tre gir
// 6, som dekker en lengre ustabil periode uten å bli plagsomt tregt (backoffen
// flater ut på 45 s). Legg til flere speil med PLACES_OVERPASS_ENDPOINTS.
const OVERPASS_ROUNDS = Math.max(
    1,
    Number(process.env.PLACES_OVERPASS_ROUNDS ?? 3) || 3
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// Kjør ÉN Overpass-spørring med retry: [OVERPASS_ROUNDS] runder over speilene
/// med ekte eksponentiell backoff (5s→15s→45s) mellom forsøkene.
/// [OVERPASS_RETRY_STATUS], et HTTP 200 med `remark` (stille kjøretidsfeil)
/// og nettverks-/parse-feil er retrybare; annen HTTP-status (typisk 4xx)
/// kastes umiddelbart — det er en spørringsfeil retry ikke løser.
/**
 * Teller spørringer og omkamper, for godkjenningsoppsummeringen.
 *
 * En høy omkampandel betyr at dataene KAN være degradert selv når kjøringen
 * lykkes: et 504 etterfulgt av et tomt 200 er allerede observert (se
 * docs/import-sommen.md). Tallet står i oppsummeringen så det kan veies inn i
 * et ja eller nei, framfor å ligge spredt i loggen.
 */
export const overpassTelling = { sporringer: 0, medOmkamp: 0 };

export async function fetchOverpass(query: string, label: string): Promise<OsmElement[]> {
    overpassTelling.sporringer += 1;
    let omkamp = false;
    const attempts = Array.from(
        { length: OVERPASS_ENDPOINTS.length * OVERPASS_ROUNDS },
        (_, i) => OVERPASS_ENDPOINTS[i % OVERPASS_ENDPOINTS.length]
    );
    for (let i = 0; i < attempts.length; i++) {
        const endpoint = attempts[i];
        const isLast = i === attempts.length - 1;
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
                body: 'data=' + encodeURIComponent(query),
            });
            if (res.ok) {
                const json = await res.json();
                // Overpass svarer på KJØRETIDSFEIL — timeout, minnetak, slot- og
                // rategrense — med HTTP 200, tom `elements` OG en `remark`. Uten
                // denne sjekken er et slikt svar ikke til å skille fra et genuint
                // tomt område: hele kategorien forsvant i stillhet, og
                // «0 treff»-advarselen i importCity pekte på en OSM-tag-endring
                // som ikke fantes. Verifisert 9. sep. 2026 over tre dry-run av
                // Oslo UTEN kodeendring mellom dem: advarselen flyttet seg fra
                // Idrettshall til Ballbane mens totalen svingte 2956 → 2188 rader.
                //
                // ALLE remarks behandles som feil, ikke bare de som begynner med
                // «runtime error»: Overpass sender også rene advarsler, men prisen
                // for å ta feil er noen bortkastede forsøk — mot at et helt
                // datasett går tapt ubemerket. Retryes på lik linje med 504/429;
                // er siste forsøk brukt, kaster løkka under som ved enhver annen
                // feil, og importCity isolerer den til én by.
                const remark = typeof json.remark === 'string' ? json.remark.trim() : '';
                // `elements` MÅ være en liste. Var det før `json.elements ?? []`,
                // og da var et 200-svar UTEN elements-nøkkel — en proxy-feilside,
                // et gateway-svar i JSON — ikke til å skille fra et tomt område.
                // Samme feilklasse som remark-sjekken over, funnet sep. 2026 da
                // det tomme hentesteget ble undersøkt. Retryes på lik linje.
                if (!remark && !Array.isArray(json.elements)) {
                    console.log(
                        `    ${label}: ${endpoint} svarte 200 uten elements-liste ` +
                            `(forsøk ${i + 1}/${attempts.length})`
                    );
                } else if (!remark) {
                    return json.elements as OsmElement[];
                } else {
                    console.log(
                        `    ${label}: ${endpoint} svarte 200 med remark «${remark}» ` +
                            `(forsøk ${i + 1}/${attempts.length})`
                    );
                }
            } else if (!OVERPASS_RETRY_STATUS.has(res.status)) {
                // Kun forbigående statuser er verdt å prøve på nytt; andre er faste feil.
                throw new Error(`Overpass HTTP ${res.status} (${label})`);
            } else {
                console.log(`    ${label}: ${endpoint} svarte ${res.status} (forsøk ${i + 1}/${attempts.length})`);
            }
        } catch (err) {
            // Ikke-retrybar HTTP-feil kastes videre; nettverks-/parse-feil retryes.
            if (err instanceof Error && err.message.startsWith('Overpass HTTP')) throw err;
            console.log(`    ${label}: ${endpoint} feilet (${err instanceof Error ? err.message : err}) (forsøk ${i + 1}/${attempts.length})`);
        }
        // Vi kom hit uten å returnere, altså feilet forsøket. Telles ÉN gang
        // per spørring, ikke per forsøk: tallet skal si «hvor mange spørringer
        // gikk ikke rett gjennom», ikke «hvor mange kall ble gjort».
        if (!omkamp) {
            omkamp = true;
            overpassTelling.medOmkamp += 1;
        }
        if (!isLast) {
            await sleep(OVERPASS_BACKOFF_MS[Math.min(i, OVERPASS_BACKOFF_MS.length - 1)]);
        }
    }
    throw new Error(`Alle Overpass-forsøk feilet for ${label}`);
}

/// 2a: én spørring PER kategori i stedet for én kombinert. Hver delspørring
/// (område + én selektor) er langt lettere enn område + syv selektorer, så den
/// holder seg godt under gateway-timeouten — særlig for Trondheims tunge
/// sammensatte kommunegrense. Resultatene slås sammen og dedupes på
/// type/id; første kategori som treffer et element vinner (samme match-
/// prioritet som før, siden PLACE_CATEGORIES itereres i rekkefølge).
/**
 * ÉN RAD I MELLOMLEDDET etter hentesteget.
 *
 * Flat, og med korte nøkler, fordi det blir én linje NDJSON per OSM-objekt og
 * en nasjonal kjøring er ~39 500 av dem (osmium mot Geofabrik, sep. 2026).
 * `c` = kategorinøkkel, `s` = settnavn, `e` = det rå elementet.
 *
 * KATEGORIEN LAGRES, selv om match-prioriteten avgjøres på nytt i berikelsen.
 * Grunnen er at et element bare kan berikes av den kategorien som hentet det:
 * Skianleggs bevissett gir ingen mening for Aking, og et bevisobjekt skal
 * aldri bli en rad. Uten `c` og `s` er den informasjonen tapt i det øyeblikket
 * settene skrives til disk.
 */
export interface FetchRecord {
    c: string;
    s: string;
    e: OsmElement;
}

/**
 * HENTESTEGET. Rå OSM-elementer for én chunk, per kategori og sett.
 *
 * ÉN SPØRRING PER KATEGORI, som før: hver delspørring (område + én selektor)
 * er langt lettere enn område + sju selektorer, og holder seg under
 * gateway-timeouten.
 *
 * Steget TOLKER ingenting. Verken dedupliseringen, klyngingen, den romlige
 * verifiseringen eller claims hører hjemme her — de er berikelse, og de skal
 * kunne kjøres om uten å hente på nytt. Det er hele grunnen til at sømmen går
 * nettopp her.
 */
export async function fetchChunk(
    chunk: ImportChunk,
    cats: PlaceCategory[] = PLACE_CATEGORIES
): Promise<{ records: FetchRecord[]; emptySets: string[] }> {
    const records: FetchRecord[] = [];
    const emptySets: string[] = [];
    for (const cat of cats) {
        const hent = async (): Promise<FetchSets> => {
            const query = overpassQuery(chunk, cat.selector, 'out center tags');
            // Skianlegg og Aking har egne hentere: de trenger `out geom`, og
            // Skianlegg i tillegg en ekstra bevisspørring.
            return cat.fetchSets
                ? await cat.fetchSets(chunk)
                : { main: await fetchOverpass(query, `${chunk.label}/${cat.key}`) };
        };

        let sets = await hent();
        let antall = Object.values(sets).reduce((n, liste) => n + liste.length, 0);

        // ─────────────────────────────────────────────────────────────────
        // TOM ER BÅDE ET GYLDIG SVAR OG DET MEST SANNSYNLIGE SYMPTOMET PÅ EN
        // FEIL, og ingenting i svaret skiller de to. Derfor tas en OBSERVASJON
        // TIL i stedet for å gjette.
        //
        // Observert sep. 2026: Oslo/park fikk 504 på første forsøk, deretter et
        // helt ordinært 200 med `elements: []` og ingen remark. fetchOverpass
        // hadde ingen grunn til å mistenke noe — og samme spørring ga 34
        // objekter både før og etter. Sømmen skrev da to tomme steg og markerte
        // begge ferdig, og neste --resume gjenopptok null rader uten å røre
        // nettet.
        //
        // Bekreftelsen koster ÉN ekstra spørring, og bare for kategorier som
        // faktisk kom tomme tilbake. Den gjør ikke en legitimt tom chunk til en
        // evig retry: bekreftet tom er et ENDELIG svar, steget markeres ferdig,
        // og --resume gjenbruker det.
        //
        // TERSKELEN ER HELE KATEGORIEN, ikke det enkelte settet. Ga ETT av
        // Skianleggs to sett data, har området løst seg og Overpass har svart —
        // det er nettopp det som skulle verifiseres. At `omrade` er tom mens
        // `bevis` har 4000 objekter er normalt i en kommune uten alpinanlegg,
        // og å kjøre den dyre bevisspørringen på nytt for det ville vært å
        // betale mest der signalet er svakest. Slike sett rapporteres likevel
        // (se [emptySets]).
        let merknad = '';
        if (antall === 0) {
            await sleep(OVERPASS_QUERY_PAUSE_MS);
            const andre = await hent();
            const antallAndre = Object.values(andre).reduce((n, liste) => n + liste.length, 0);
            if (antallAndre > 0) {
                merknad =
                    `  ← FØRSTE SVAR VAR TOMT, andre ga ${antallAndre}: ` +
                    'forbigående tomt svar, ikke et tomt område';
                sets = andre;
                antall = antallAndre;
            } else {
                merknad = '  ← BEKREFTET TOM (målt to ganger)';
            }
        }

        const deler: string[] = [];
        for (const [navn, elementer] of Object.entries(sets)) {
            for (const e of elementer) records.push({ c: cat.key, s: navn, e });
            deler.push(`${elementer.length} ${navn}`);
            if (elementer.length === 0) emptySets.push(`${cat.key}/${navn}`);
        }
        // Kategorier uten et eneste sett (en henter som returnerte {}) ville
        // ellers vært usynlige — verken tomme sett eller elementer.
        if (Object.keys(sets).length === 0) emptySets.push(`${cat.key}/(ingen sett)`);
        console.log(
            `  hent ${chunk.label}/${cat.key.padEnd(11)} ${deler.join(', ') || 'ingen sett'}${merknad}`
        );
        await sleep(OVERPASS_QUERY_PAUSE_MS);
    }
    return { records, emptySets };
}

/** Mellomleddet tilbake til navngitte sett per kategori. */
export function groupFetchRecords(records: readonly FetchRecord[]): Map<string, FetchSets> {
    const m = new Map<string, FetchSets>();
    for (const r of records) {
        let sets = m.get(r.c);
        if (!sets) m.set(r.c, (sets = {}));
        (sets[r.s] ??= []).push(r.e);
    }
    return m;
}

/**
 * Slår kategorienes berikede elementer sammen til ÉN liste, deduplisert på
 * `type/id`, i kategorirekkefølge.
 *
 * LØFTET UORENDRET UT AV overpassCity. Dedupliseringen var et
 * hente-biprodukt før sømmen, men den er en TOLKNING: den avgjør hvilken
 * kategori som får et objekt som to selektorer treffer, og svaret er «den
 * første i PLACE_CATEGORIES». Samme regel som [buildRows] bruker når den
 * kaller `cats.find(...)`, og de to må aldri komme i utakt — derfor er
 * rekkefølgen her kategorirekkefølgen, ikke noe annet.
 */
export function mergeEnriched(
    perCategory: readonly { cat: PlaceCategory; elements: readonly OsmElement[] }[]
): { merged: OsmElement[]; addedPerCategory: Map<string, number> } {
    const seen = new Set<string>();
    const merged: OsmElement[] = [];
    const addedPerCategory = new Map<string, number>();
    for (const { cat, elements } of perCategory) {
        let added = 0;
        for (const el of elements) {
            const id = `${el.type}/${el.id}`;
            if (seen.has(id)) continue;
            seen.add(id);
            merged.push(el);
            added += 1;
        }
        addedPerCategory.set(cat.key, added);
    }
    return { merged, addedPerCategory };
}

function coords(el: OsmElement): { lat: number; lng: number } | null {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

export interface ImportRow {
    external_id: string;
    kind: 'place';
    title: string;
    description: string;
    category: string;
    target_audience: string;
    venue_name: string | null;
    address: string | null;
    municipality: string;
    /**
     * «Hjemby» for et sted som ligger UTENFOR bykommunen (migrasjon 0012).
     *
     * SETTES IKKE i per-by-modus, og det er med vilje. Områdefilteret er
     * kommunegrensen (`admin_level=7`), så alt importen returnerer ligger i
     * byen — `municipality` er allerede sant, og «nær Oslo» på et anlegg som
     * ER i Oslo ville vært en usann påstand. Seeden følger samme regel:
     * Varingskollen i Nittedal får nearCity='Oslo', Korketrekkeren i Oslo får
     * ingen (seed-vintertilbud.ts, kommentaren øverst).
     *
     * Feltet står her fordi NASJONAL modus må fylle ett av de to — se
     * [rowsMissingCityAnchor]. En rad uten begge er usynlig i by-modus.
     */
    near_city?: string | null;
    lat: number;
    lng: number;
    opening_hours: string | null;
    is_free: boolean | null;
    price_text: string | null;
    url: string;
    // Alle rå OSM-tagger (migrasjon 0008). API-et plukker visningsfelter
    // herfra (surface/lit i første omgang, jf. tag-proben jul. 2026) —
    // nye visningsfelter senere krever da ingen ny import-runde.
    osm_tags: OsmTags;
    /**
     * Fasett-tokens (migrasjon 0016), utledet av [osmFacetTokens] eller av
     * kategoriens egen [PlaceCategoryDef.facetsFor]. Tom liste er den
     * normale verdien — kolonnen er `not null default '{}'`, så en tom
     * liste og «ingen fasetter» er samme ting hele veien.
     */
    facets: FacetToken[];
    status: 'published';
    // Kun rapportering, fjernes før upsert:
    titleSource: TitleSource;
    geocodeError?: string;
    osmName: string | null;
    /** Hvilken tagg navnet kom fra. Satt kun når det IKKE er `name`. */
    nameTag?: string;
    /** Kartverket svarte at det ikke finnes en adresse innen 200 m. Ikke en
     *  feil — se [GeocodeFailureKind]. Rapporteres, teller ikke. */
    addressMissing?: boolean;
}

/**
 * Rader som ville vært USYNLIGE i by-modus.
 *
 * By-modus i /api/activities matcher `municipality ilike X OR near_city ilike
 * X`. En rad uten noen av delene treffer ingen by og finnes bare i
 * radius-modus — den forsvinner uten at noe feiler.
 *
 * I dag er dette umulig: per-by-importen setter alltid `municipality` til byen
 * den kjøres for. Vakten finnes for nasjonal modus, der det ikke lenger
 * finnes én by å sette. Da må importen enten slå opp kommunen per rad eller
 * sette `near_city` — og denne funksjonen er stedet som nekter å la den
 * beslutningen bli glemt.
 */
export function rowsMissingCityAnchor(rows: readonly ImportRow[]): ImportRow[] {
    return rows.filter(
        (r) => !r.municipality?.trim() && !r.near_city?.trim()
    );
}

export interface ClaimSkip {
    el: OsmElement;
    /** Alle kuraterte rader som eier objektet. Flere ved én-til-mange. */
    claims: OsmClaim[];
    /** OSM-navnet stemte ikke med noen av claimenes [expectName]. */
    navnAvvik: boolean;
}

export interface ClaimFilter {
    kept: OsmElement[];
    skipped: ClaimSkip[];
}

/**
 * LAG 1 i eierskapsmekanismen: fjerner elementer en kuratert rad allerede
 * eier, før de rekker å bli rader.
 *
 * Nøkkelen er `type/id`, altså nøyaktig den strengen [buildRows] skriver til
 * `external_id`. Det er ikke en tilfeldighet, men hele kontrakten: en claim
 * navngir en EXTERNAL_ID. For Aking betyr det klyngens ANKER — en claim på
 * ett av Korketrekkerens 14 segmenter ville aldri truffet noe, og ville stått
 * som «traff ingenting» i rapporten.
 *
 * Ren funksjon, uten nettverk og uten database, så både filtreringen og
 * navnekontrollen kan testes mot den ekte claim-lista.
 */
export function applyOsmClaims(
    elements: readonly OsmElement[],
    claims: readonly OsmClaim[] = OSM_CLAIMS
): ClaimFilter {
    const index = claimsByOsmId(claims);
    const kept: OsmElement[] = [];
    const skipped: ClaimSkip[] = [];
    for (const el of elements) {
        const treff = index.get(`${el.type}/${el.id}`);
        if (!treff) {
            kept.push(el);
            continue;
        }
        skipped.push({
            el,
            claims: treff,
            // Avvik bare når INGEN av claimene kjenner igjen navnet. Ved
            // én-til-mange holder det at én gjør det: Tryvann og Wyller deler
            // relasjon, og relasjonens navn kan bare stemme med den ene.
            navnAvvik: !treff.some((c) => claimNameMatches(c, el.tags?.name)),
        });
    }
    return { kept, skipped };
}

/**
 * LAG 2: radene importen faktisk har lov til å skrive.
 *
 * Trukket ut av upsert-blokka og eksportert nettopp fordi den ER mekanismen
 * som hindrer at en erstattet OSM-rad gjenoppstår. Låsen settes av
 * 'unpublish' i lib/moderation.ts (status='rejected' + locked=true), og
 * 'publish' frigir den igjen — begge uten SQL-editoren.
 *
 * Backstop, ikke hovedvei: fjernes en claim ved et uhell, stopper låsen
 * fortsatt skrivingen. Låsen alene er derimot IKKE nok, fordi den slås opp
 * per kilde — se toppen av lib/osm-claims.ts.
 */
export function writableRows(
    rows: readonly ImportRow[],
    locked: ReadonlySet<string>
): ImportRow[] {
    return rows.filter((r) => !locked.has(r.external_id));
}

/**
 * Hvor `municipality` kommer fra når chunken ikke har ett svar.
 *
 * Returnerer null for et punkt UTENFOR Norge. Det er ikke en feil, men et
 * signal: en nasjonal henting med bbox tar med naboland, og de radene er ikke
 * våre. [buildRows] utelater dem og teller dem i rapporten.
 */
export type MunicipalityResolver = (lat: number, lng: number) => string | null;

export async function buildRows(
    /**
     * Kommunen alle radene får. `null` betyr «chunken dekker mer enn én
     * kommune» — da MÅ [resolveMunicipality] være oppgitt, og hver rad får
     * sin egen kommune fra koordinatet.
     */
    city: string | null,
    elements: OsmElement[],
    limit: number,
    cats: PlaceCategory[] = PLACE_CATEGORIES,
    resolveMunicipality?: MunicipalityResolver
): Promise<ImportRow[]> {
    // NULLTE pass: fjern objekter en kuratert rad allerede eier. Må skje FØR
    // kategorivalget, ellers teller et claimet objekt mot kategoriens `limit`
    // og fortrenger en ekte rad.
    // Rapporteringen ligger i [importCity], som er eneste produksjonskaller og
    // det eneste stedet som kan samle opp claims på tvers av byer. Her
    // filtreres det bare — også når buildRows kalles direkte fra en test.
    const { kept } = applyOsmClaims(elements);

    // Første pass: velg elementer (kategori + koordinater + limit), så vi
    // vet totalt geokodingsbehov før vi starter — gir ekte fremdriftslinje.
    const selected: { el: OsmElement; cat: (typeof PLACE_CATEGORIES)[number]; pos: { lat: number; lng: number } }[] = [];
    const perCategory = new Map<string, number>();
    for (const el of kept) {
        const tags = el.tags ?? {};
        const cat = cats.find((c) => c.matches(tags, el));
        const pos = coords(el);
        if (!cat || !pos) continue;
        if ((perCategory.get(cat.key) ?? 0) >= limit) continue;
        perCategory.set(cat.key, (perCategory.get(cat.key) ?? 0) + 1);
        selected.push({ el, cat, pos });
    }
    // KOMMUNEN PER RAD når chunken ikke har ett svar. Slås opp i
    // grensefila (lib/municipality.ts), ikke over nett.
    const kommuneFor = (pos: { lat: number; lng: number }): string => {
        if (city !== null) return city;
        if (!resolveMunicipality) {
            throw new Error(
                'buildRows fikk city=null uten resolveMunicipality. En chunk som dekker ' +
                    'mer enn én kommune må utlede municipality per rad — se ImportChunk.'
            );
        }
        return resolveMunicipality(pos.lat, pos.lng) ?? '';
    };

    // UTENFOR NORGE. En nasjonal henting med bbox tar med naboland, og de
    // radene er ikke våre. De utelates HER, ikke ved å la
    // rowsMissingCityAnchor kaste før upsert — en enkelt svensk alpinbakke
    // skal ikke velte hele chunken.
    if (city === null) {
        const utenfor = selected.filter(({ pos }) => kommuneFor(pos) === '');
        if (utenfor.length) {
            console.log(
                `  ${utenfor.length} objekter utelatt — punktet ligger utenfor norske ` +
                    `kommunegrenser (f.eks. ${utenfor[0].el.type}/${utenfor[0].el.id})`
            );
            for (const u of utenfor) {
                const i = selected.indexOf(u);
                if (i >= 0) selected.splice(i, 1);
            }
        }
    }

    const needGeocoding = selected.filter(({ el }) => !isUsablePlaceName(el.tags?.name)).length;
    console.log(`  ${selected.length} steder valgt, ${needGeocoding} trenger geokodet tittel`);

    const rows: ImportRow[] = [];
    let geocoded = 0;
    for (const { el, cat, pos } of selected) {
        const tags = el.tags ?? {};
        // Leser kategoriens egen navnekjede. For alle andre enn Aking er
        // dette `['name']`, altså nøyaktig samme test som før.
        const navnet = resolvePlaceName(tags, cat.nameTags);
        const usableName = navnet !== null;
        if (!usableName) {
            geocoded += 1;
            console.log(`  geokoder ${el.type}/${el.id} (${geocoded}/${needGeocoding})...`);
        }
        // Tittel-prefikset kan være sport-spesifikt (ballbane), ellers kategoriens.
        const titleLabel = cat.titleLabelFor?.(tags) ?? cat.label;
        const titled = await makePlaceTitleDetailed(titleLabel, navnet?.value ?? null, pos.lat, pos.lng);
        if (!usableName) await sleep(TITLE_PAUSE_MS); // punktsøk-høflighet ved cache-miss

        const addrStreet = tags['addr:street']
            ? `${tags['addr:street']}${tags['addr:housenumber'] ? ' ' + tags['addr:housenumber'] : ''}`
            : null;

        rows.push({
            external_id: `${el.type}/${el.id}`,
            kind: 'place',
            title: titled.title,
            description: tags.description ?? '',
            category: cat.category,
            target_audience: cat.audience,
            venue_name: navnet?.value ?? null,
            address: addrStreet,
            municipality: kommuneFor(pos),
            lat: pos.lat,
            lng: pos.lng,
            opening_hours: tags.opening_hours ?? null,
            is_free: resolveIsFree(tags, cat.isFree),
            price_text: tags.charge
                ? tags.charge.replace(/\bNOK\b/g, 'kr').trim().slice(0, 100) || null
                : null,
            // Anleggets EGEN side når OSM har den, ellers OSM-objektet.
            //
            // En forelder som skal sjekke åpningstider og pris før avreise er
            // ikke hjulpet av openstreetmap.org/relation/2259942 — Skimore
            // Oslo har tryvann.no i taggene, og det er den lenka som betyr
            // noe. Målt i prod: 243 av 7800 rader har website, men de er
            // konsentrert der det teller (102 av 159 museer, 57 av 76
            // biblioteker, 4 av 5 skianlegg mot 11 av 3996 lekeplasser).
            //
            // ODbL-ATTRIBUSJONEN BERØRES IKKE. Den ligger som eget felt i
            // API-svaret (route.ts, `attribution`) og som en konstant i appen
            // (DatahubService.osmAttribution), ikke i denne kolonnen — det er
            // verifisert før endringen. Og OSM-objektet er uansett ikke tapt:
            // external_id ER `<type>/<id>`, så lenka kan bygges når som helst.
            url:
                sanitizeWebsite(tags.website ?? tags['contact:website']) ??
                `https://www.openstreetmap.org/${el.type}/${el.id}`,
            osm_tags: tags,
            // Utledes på nytt hver kjøring, fra taggene alene.
            facets: cat.facetsFor?.(el) ?? osmFacetTokens(tags),
            status: 'published',
            titleSource: titled.source,
            geocodeError: titled.geocodeError,
            addressMissing: titled.addressMissing,
            // Det navnet som FAKTISK ble brukt, ikke bare `name`-taggen — ellers
            // ville rapportlinja for Sollibakken sagt «name=null -> Sollibakken».
            osmName: navnet?.value ?? tags.name ?? null,
            nameTag: navnet?.tag,
        });
    }
    return rows;
}

export interface EnrichedChunk {
    rows: ImportRow[];
    /** OSM-id-er undertrykt av en claim. Havner i manifestet, se der. */
    seenClaims: string[];
}

/**
 * BERIKELSESSTEGET. Rå elementer inn, ferdige rader ut. Ingen skriving.
 *
 * Rekkefølgen er den samme som før sømmen, og det er med vilje — dette
 * steget er de gamle linjene i importCity, flyttet, ikke skrevet om:
 *
 *   1. per kategori: [PlaceCategoryDef.enrichSets] (klynging, romlig test)
 *   2. sammenslåing + deduplisering på type/id, i kategorirekkefølge
 *   3. claims: rapporten her, filtreringen inne i [buildRows]
 *   4. [buildRows]: kategorivalg, --limit, geokoding, titler
 *   5. rapportblokka per kategori
 *
 * GEOKODINGEN LIGGER HER, og det er den dyre delen (~1,1 s per sted uten
 * brukbart OSM-navn). Derfor er det NØYAKTIG dette stegets utdata som er
 * verdt å lagre: `geocode_cache` gjør et gjenkall billig per koordinat, men
 * bare mellomleddet gjør hele chunken gratis.
 */
export async function enrichChunk(
    chunk: ImportChunk,
    fetched: readonly FetchRecord[],
    limit: number,
    cats: PlaceCategory[] = PLACE_CATEGORIES
): Promise<EnrichedChunk> {
    const perKategori = groupFetchRecords(fetched);
    const beriket: { cat: PlaceCategory; elements: OsmElement[] }[] = [];
    for (const cat of cats) {
        const sets = perKategori.get(cat.key) ?? {};
        const ut: EnrichOutput = cat.enrichSets
            ? cat.enrichSets(sets)
            : { elements: sets.main ?? [], rapport: [] };
        beriket.push({ cat, elements: ut.elements });
        if (ut.summary) console.log(`  ${chunk.label}/${cat.key.padEnd(11)} ${ut.summary}`);
        for (const linje of ut.rapport) console.log(linje);
    }

    const { merged: elements, addedPerCategory } = mergeEnriched(beriket);
    for (const { cat, elements: egne } of beriket) {
        console.log(
            `  berik ${chunk.label}/${cat.key.padEnd(11)} ` +
                `${String(egne.length).padStart(4)} elementer ` +
                `(${addedPerCategory.get(cat.key) ?? 0} nye)`
        );
    }
    console.log(`  ${elements.length} elementer etter deduplisering`);

    // EIERSKAP: hvilke objekter en kuratert rad allerede eier.
    //
    // BERIKELSEN EIER CLAIMS, ikke hentingen. To grunner: en områdespørring
    // kan ikke ekskludere en enkelt id billig (og et uttrekk i fase 3 leser
    // uansett alt), og et claimet objekt må heller ikke koste geokoding —
    // som skjer her. [buildRows] filtrerer dem selv; dette kallet er for
    // rapporten og for manifestet. Se lib/osm-claims.ts.
    const { skipped } = applyOsmClaims(elements);
    for (const s of skipped) {
        const eiere = s.claims.map((c) => `${c.source}/${c.externalId}`).join(' + ');
        console.log(
            `  claim ${s.el.type}/${s.el.id} «${s.el.tags?.name ?? '(uten navn)'}» ` +
                `→ ingen rad, eies av ${eiere}` +
                (s.claims.length > 1 ? ` (${s.claims.length} kuraterte rader, én relasjon)` : '')
        );
        if (s.navnAvvik) {
            // STOPPVILKÅR 1. Ikke en advarsel lenger: en claim med feil id
            // undertrykker FEIL sted OG slipper det rette gjennom som
            // duplikat, og begge deler er stille. Feilen ligger i koden, ikke
            // i dataene, så den gjentar seg i hver eneste chunk.
            throw claimMismatchStop(
                `${s.el.type}/${s.el.id}`,
                s.el.tags?.name,
                s.claims.map((c) => c.expectName)
            );
        }
    }
    const seenClaims = skipped.map((s) => `${s.el.type}/${s.el.id}`);

    // cityAnchor er chunkens ene kommune. Er den null — en flis, et fylke,
    // hele landet — utledes municipality per rad fra grensefila, og rader
    // utenfor Norge utelates. Se lib/municipality.ts.
    const rows = await buildRows(
        chunk.cityAnchor,
        elements,
        limit,
        cats,
        chunk.cityAnchor === null
            ? (lat, lng) => municipalityIndex().lookup(lat, lng)
            : undefined
    );

    // Vaktbikkje + tittelkilde-fordeling per kategori. 'kun-kategori' med
    // geocodeError betyr at revers-geokodingen FEILET — ikke at adressen mangler.
    for (const cat of cats) {
        const catRows = rows.filter((r) => r.category === cat.category);
        const bySource = (s: TitleSource) => catRows.filter((r) => r.titleSource === s).length;
        const failed = catRows.filter((r) => r.geocodeError).length;
        console.log(
            `  ${cat.category.padEnd(12)} ${String(catRows.length).padStart(5)} steder — titler: ` +
                `${bySource('osm-navn')} OSM-navn, ${bySource('ved-gate')} «ved gate», ` +
                `${bySource('i-poststed')} «i poststed», ${bySource('i-omraade')} «i område», ` +
                `${bySource('kun-kategori')} kun kategori` +
                (failed ? ` (HERAV ${failed} GEOKODINGSFEIL)` : '')
        );
        // Advarselen teller ELEMENTER, ikke rader. «0 rader» dekket tidligere to
        // helt ulike tilstander med hver sin handling: enten leverte Overpass
        // ingenting for kategorien (selektoren treffer ikke lenger, eller — før
        // remark-sjekken i fetchOverpass — en stille kjøretidsfeil), eller den
        // leverte, men ingenting overlevde koordinatkravet eller --limit. Det
        // siste er forventet oppførsel, ikke en datafeil, og skal ikke se ut som
        // en tag-endring i OSM. `=== cat` er samme identitetsregel som
        // buildRows bruker, så tallet er nøyaktig det kategorien fikk tildelt.
        //
        // ELEMENTET MÅ SENDES MED. matches() fikk et andre argument da
        // Skianlegg kom til, fordi tagger alene ikke kan skille et
        // alpinanlegg fra et langrennsstadion — dommen ligger på elementet
        // (skiVerified). buildRows ble oppdatert, denne linja ikke, og da
        // returnerte Skianlegg sin matches false for ALT: fem steder ble
        // hentet og skrevet, mens advarselen meldte «0 elementer».
        const catElements = elements.filter(
            (el) => cats.find((c) => c.matches(el.tags ?? {}, el)) === cat
        ).length;
        if (catElements === 0) {
            // Kategorier med egen berikelse filtrerer også ROMLIG, så «0» her
            // kan bety to ting: selektoren traff ingenting, eller den traff men
            // ingenting besto. Per-polygon-rapporten over skiller dem — uten
            // dette hintet leser man «sjekk selektoren» om en by som rett og
            // slett ikke har alpinanlegg.
            const hint = cat.enrichSets
                ? ` ${cat.category} filtrerer også romlig — se linjene over for hvert polygon.`
                : '';
            console.log(
                `    ADVARSEL: Overpass ga 0 elementer for ${cat.category} i ${chunk.label}` +
                    ` — sjekk selektoren og tag-endring i OSM.${hint}`
            );
        } else if (catRows.length === 0) {
            console.log(
                `    ADVARSEL: ${catElements} elementer for ${cat.category} i ${chunk.label}, men 0 rader` +
                    ` — alle manglet koordinater eller ble silt bort av --limit.`
            );
        }
        // Konkrete eksempler der name-taggen manglet/ble silt:
        for (const r of catRows.filter((x) => x.titleSource !== 'osm-navn').slice(0, 3)) {
            console.log(
                `    ${r.external_id}: name=${JSON.stringify(r.osmName)}` +
                    (r.nameTag && r.nameTag !== 'name' ? ` (fra ${r.nameTag})` : '') +
                    ` -> "${r.title}" [${r.titleSource}]`
            );
        }
    }
    const errors = rows.filter((r) => r.geocodeError);
    if (errors.length) {
        const reasons = new Map<string, number>();
        errors.forEach((r) => reasons.set(r.geocodeError!, (reasons.get(r.geocodeError!) ?? 0) + 1));
        console.log(`  GEOKODINGSFEIL (${errors.length} steder) — tjenesten svarte IKKE:`);
        for (const [reason, n] of reasons) console.log(`    ${n} × ${reason}`);
    }

    // ADRESSELØSE steder er en egen linje, og med vilje ikke under
    // «GEOKODINGSFEIL». Kartverket svarte; det finnes bare ingen adresse der.
    // For ski nasjonalt er dette normalen, ikke et symptom — og det er denne
    // tilstanden som gir titler som «Skianlegg i Fageråsen».
    const utenAdresse = rows.filter((r) => r.addressMissing).length;
    if (utenAdresse) {
        console.log(
            `  UTEN ADRESSE (${utenAdresse} steder) — Kartverket svarte at det ikke finnes ` +
                `en adresse innen 200 m. Ikke en feil; tittelen kommer fra områdenavn eller ` +
                `bare kategorien.`
        );
    }

    // STOPPVILKÅR 2. En rad som fikk tittelen «Lekeplass» fordi Kartverket var
    // nede, blir ikke bedre neste kjøring: upserten skriver samme tittel igjen.
    // Nevneren er FORSØK (rader uten brukbart OSM-navn), ikke alle rader —
    // ski er ~80 % navngitt, og en chunk uten geokodingsbehov skal ikke kunne
    // utløse noe.
    //
    // TELLEREN ER `geocodeError`, som etter sep. 2026 BARE er ekte
    // oppslagsfeil. Den første nasjonale tørrkjøringen stanset på 51 av 157
    // (32 %) der alle 51 var «ingen adresse innen 200 m» — Kartverket som
    // svarte korrekt at det ikke finnes en adresse i fjellet. Terskelen er
    // kalibrert for bykategorier; for ski nasjonalt er adresseløshet
    // normalen. Se [GeocodeFailureKind].
    const forsok = rows.filter((r) => r.titleSource !== 'osm-navn').length;
    const stopp = geocodeFailureStop(chunk.label, { forsok, feil: errors.length });
    if (stopp) throw stopp;

    return { rows, seenClaims };
}

/**
 * SKRIVESTEGET. Rader inn, upsert ut.
 *
 * ALDRI HOPPET OVER VED GJENOPPTAGELSE, og derfor heller ikke i manifestet:
 * upserten er idempotent på `(source_id, external_id)`, så å skrive samme
 * chunk to ganger koster sekunder. Hadde steget vært merket ferdig, ville en
 * kjøring som døde midt i bolkeløkka (500 rader om gangen) etterlatt en
 * halvskrevet chunk som så ferdig ut. Se [StageName].
 */
async function writeChunk(
    chunk: ImportChunk,
    rows: readonly ImportRow[],
    dryRun: boolean
): Promise<number> {
    if (dryRun) {
        console.log(`  [dry-run] Ingen databaseskriving. Revers-geokoding KJØRES (uten cache hvis Supabase-env mangler).`);
        console.log(`  [dry-run] ${rows.length} rader klare.`);
        return rows.length;
    }

    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');
    const db = supabaseAdmin();
    const { data: source, error: sourceError } = await db
        .from('sources')
        .select('id')
        .eq('slug', SOURCE_SLUG)
        .maybeSingle();
    if (sourceError || !source) throw new Error(`Kilden ${SOURCE_SLUG} mangler (kjør migrasjon 0005).`);

    // Rader låst av brukerrapporter/manuell korrigering skal aldri røres.
    //
    // Dette er også veien til å overstyre en UTLEDET fasett: viser antakelsen
    // i [SKATEBOARD_IMPLIES] seg feil for et konkret anlegg, settes locked på
    // raden og facets rettes for hånd. Raden filtreres bort under, så
    // importen skriver aldri antakelsen tilbake.
    //
    // MERK at låsen er per RAD, ikke per felt: en låst rad slutter å få ALLE
    // oppdateringer herfra — også et forbedret navn eller en rettet koordinat
    // fra OSM. Det er prisen, og den er den samme som for `fjern_sted`.
    const { data: lockedRows, error: lockedError } = await db
        .from('activities')
        .select('external_id')
        .eq('source_id', source.id)
        .eq('locked', true);
    if (lockedError) throw new Error(`Oppslag av låste rader feilet: ${lockedError.message}`);
    const locked = new Set((lockedRows ?? []).map((r) => r.external_id));

    // Se [rowsMissingCityAnchor]: en rad uten by-anker er usynlig i by-modus.
    // Umulig når chunken er én kommune; hard feil fordi det betyr at
    // arbeidsenheten er endret (f.eks. til en flis) uten at municipality er
    // tatt stilling til. Det er fase 2.
    const utenAnker = rowsMissingCityAnchor(rows);
    if (utenAnker.length > 0) {
        throw new Error(
            `${utenAnker.length} rader mangler både municipality og near_city ` +
                `(f.eks. ${utenAnker[0].external_id}) — de ville vært usynlige i ` +
                `by-modus. Sett ett av feltene før upsert.`
        );
    }

    const writable = writableRows(rows, locked);
    if (locked.size) console.log(`  Hopper over ${rows.length - writable.length} låste rader.`);

    for (let i = 0; i < writable.length; i += 500) {
        const bolk = writable
            .slice(i, i + 500)
            .map(({ titleSource: _ts, geocodeError: _ge, osmName: _on, nameTag: _nt, addressMissing: _am, ...row }) => ({
                ...row,
                source_id: source.id,
            }));
        const { error } = await db.from('activities').upsert(bolk, { onConflict: 'source_id,external_id' });
        if (error) throw new Error(`Upsert feilet (${chunk.label}, bolk ${i / 500}): ${error.message}`);
    }
    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${writable.length} steder (${chunk.label})` })
        .eq('id', source.id);
    console.log(`  Skrev ${writable.length} rader.`);
    return writable.length;
}

/**
 * Forutsetningene som bestemmer hvert stegs utdata, som hash.
 *
 * SELEKTORTEKSTEN ER MED, ikke bare kategorinøkkelen. Uten den ville «rett en
 * selektor og kjør med --resume» gitt gårsdagens hentede data uten en eneste
 * advarsel — den mest sannsynlige og mest kostbare gjenopptagelsesfeilen.
 *
 * `--limit` påvirker BARE berikelsen (den kappes i buildRows), så en kjøring
 * med og uten limit deler hentesteg. Det er riktig: hentingen er den dyre
 * delen mot Overpass, og limit endrer ingenting ved den.
 */
function stageFingerprints(
    chunk: ImportChunk,
    cats: PlaceCategory[],
    limit: number
): { fetch: string; enrich: string } {
    const fetchFp = fingerprint({
        v: 1,
        area: chunk.overpassArea,
        cats: cats.map((c) => [c.key, c.selector, Boolean(c.fetchSets)]),
    });
    return {
        fetch: fetchFp,
        enrich: fingerprint({
            v: 1,
            fetch: fetchFp,
            anchor: chunk.cityAnchor,
            limit: limit === Infinity ? 'inf' : limit,
            cats: cats.map((c) => [c.key, c.category, Boolean(c.enrichSets)]),
            claims: OSM_CLAIMS.map((c) => [c.osmId, c.source, c.externalId]),
        }),
    };
}

/** Kjører de tre stegene for én chunk, med gjenbruk fra mellomleddet der
 *  steget allerede er ferdig med de samme forutsetningene. */
async function runChunk(
    chunk: ImportChunk,
    opts: { dryRun: boolean; limit: number; cats: PlaceCategory[]; store: WorkStore; resume: boolean }
): Promise<{ rows: number; seenClaims: string[] }> {
    const { dryRun, limit, cats, store, resume } = opts;
    console.log(`\n=== ${chunk.label} (${chunk.id}) ===`);
    const fp = stageFingerprints(chunk, cats, limit);

    let fetched: FetchRecord[];
    if (resume && store.isDone(chunk, 'fetch', fp.fetch)) {
        fetched = store.read<FetchRecord>(chunk, 'fetch');
        const tomme = store.entries().get(`${chunk.id}/fetch`)?.emptySets ?? [];
        console.log(`  [gjenopptatt] hent: ${fetched.length} elementer fra mellomleddet`);
        // Gjenopptagelsen hopper over berikelsen, og dermed over ADVARSEL-linja
        // som ellers ville sagt fra om en tom kategori. Uten denne linja ville
        // en tom chunk vært helt usynlig i en gjenopptatt kjøring.
        if (tomme.length) {
            console.log(`  [gjenopptatt] BEKREFTET TOMME SETT: ${tomme.join(', ')}`);
        }
    } else {
        const ut = await fetchChunk(chunk, cats);
        fetched = ut.records;
        console.log(`  Overpass ga ${fetched.length} elementer`);
        store.write(chunk, 'fetch', fp.fetch, fetched, { emptySets: ut.emptySets });
    }

    let enriched: EnrichedChunk;
    if (resume && store.isDone(chunk, 'enrich', fp.enrich)) {
        const rows = store.read<ImportRow>(chunk, 'enrich');
        const entry = store.entries().get(`${chunk.id}/enrich`);
        enriched = { rows, seenClaims: [...(entry?.seenClaims ?? [])] };
        console.log(`  [gjenopptatt] berik: ${rows.length} rader fra mellomleddet (ingen geokoding)`);
    } else {
        enriched = await enrichChunk(chunk, fetched, limit, cats);
        store.write(chunk, 'enrich', fp.enrich, enriched.rows, { seenClaims: enriched.seenClaims });
    }

    const skrevet = await writeChunk(chunk, enriched.rows, dryRun);
    return { rows: skrevet, seenClaims: enriched.seenClaims };
}

export interface ImportArgs {
    dryRun: boolean;
    cities: string[];
    limit: number;
    cats: PlaceCategory[];
    catArg?: string;
    /** Arbeidskatalog for mellomleddet. `null` = ingen lagring (standard). */
    workDir: string | null;
    /** Hopp over steg som allerede er ferdige med samme forutsetninger. */
    resume: boolean;
    /** Bolk-fingeravtrykket som godkjennes. Kreves for å skrive med --work. */
    approve: string | null;
    /** Hele Norge som ÉN chunk, i stedet for fire by-chunks. */
    national: boolean;
}

/** Standard arbeidskatalog når --work eller --resume er gitt uten verdi.
 *  Ligger i repoet og er .gitignore-et: innholdet er mellomresultater, ikke
 *  kildekode, og en nasjonal kjøring legger igjen titalls MB. */
export const DEFAULT_WORK_DIR = '.import-work';

// Oppføringer som slutter på «=» er VERDIFLAGG og prefiksmatches; resten må
// treffe eksakt. Skillet ble nødvendig da --work kom til: den finnes både
// som `--work` og `--work=<dir>`, og med den gamle regelen (prefiks for alt)
// ville «--worksheet» sluppet gjennom som gyldig. Strammingen gjelder også de
// gamle flaggene — «--dry-runx» ble før akseptert og ignorert i stillhet,
// nøyaktig den klassen feil denne parseren finnes for å stoppe.
const KNOWN_FLAGS = ['--dry-run', '--city=', '--limit=', '--category=', '--work', '--work=', '--resume', '--approve=', '--national'];

function isKnownFlag(arg: string): boolean {
    return KNOWN_FLAGS.some((f) => (f.endsWith('=') ? arg.startsWith(f) : arg === f));
}

/**
 * Argumentparsing, streng med vilje. ALLE verdiflagg bruker `=`
 * (`--city=Oslo`, ikke `--city Oslo`). Skrivemåten med mellomrom ble tidligere
 * IGNORERT i stillhet, slik at `--city Oslo` kjørte alle fire byene — en dyr
 * overraskelse mot produksjonsdata. Ukjente argumenter avvises derfor nå.
 */
export function parseArgs(args: string[]): ImportArgs {
    const unknown = args.filter((a) => !isKnownFlag(a));
    if (unknown.length) {
        throw new Error(
            `Ukjent argument: ${unknown.join(', ')}\n` +
                `Verdiflagg krever «=»: --city=Oslo --limit=20 --category=ballbane\n` +
                `Gyldige flagg: ${KNOWN_FLAGS.join(' ')}`
        );
    }

    const dryRun = args.includes('--dry-run');
    const cityArg = args.find((a) => a.startsWith('--city='))?.split('=')[1];
    const limitRaw = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
    if (limitRaw !== undefined && !(Number(limitRaw) > 0)) {
        throw new Error(`--limit= må være et positivt tall, fikk «${limitRaw}».`);
    }
    const limit = limitRaw !== undefined ? Number(limitRaw) : Infinity;

    // --city=Oslo eller --city=Oslo,Bergen. Én by om gangen er den anbefalte
    // strategien når Overpass er ustabil: en feil isolerer seg til den byen.
    const cities = cityArg
        ? cityArg.split(',').map((c) => c.trim()).filter(Boolean)
        : DEFAULT_CITIES;
    if (cityArg && !cities.length) throw new Error('--city= er tom.');

    // NASJONAL MODUS KREVER ET EGET FLAGG. Den nærliggende varianten — la
    // FRAVÆR av --city bety «hele landet» — ble forkastet, og det er den
    // samme avveiningen som strammingen av argumentparseren: i dag betyr
    // fravær av --city de fire byene, og å endre det i stillhet ville gjort
    // at en kommando noen har kjørt i et år plutselig henter 55 000 objekter
    // fra fire land. Et nytt flagg kan ikke overraske noen.
    const national = args.includes('--national');
    if (national && cityArg) {
        throw new Error(
            '--national og --city= utelukker hverandre. --national er hele Norge som ÉN ' +
                'chunk; --city= er én chunk per kommune.'
        );
    }

    // --category=<key>[,<key>] kjører kun de valgte kategoriene, så et enkelt
    // feilende punkt (f.eks. den tunge «lekeplass»-selektoren) kan fylles inn
    // uten å hente hele byen på nytt. Sammen med --city=<by> gir det ett
    // presist by+kategori-kall.
    const catArg = args.find((a) => a.startsWith('--category='))?.split('=')[1];
    let cats: PlaceCategory[] = PLACE_CATEGORIES;
    if (catArg) {
        const wanted = catArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        cats = PLACE_CATEGORIES.filter((c) => wanted.includes(c.key));
        const found = new Set(cats.map((c) => c.key));
        const missing = wanted.filter((w) => !found.has(w));
        if (missing.length) {
            throw new Error(
                `Ukjent kategori: ${missing.join(', ')}. Gyldige: ${PLACE_CATEGORIES.map((c) => c.key).join(', ')}`
            );
        }
    }

    // MELLOMLEDDET ER OPT-IN, og det er et bevisst valg framfor standard PÅ.
    //
    // Uten --work skriver importen ingen nye filer noe sted, og en tørrkjøring
    // rører fortsatt ingenting. Kravet om ingen oppførselsendring er dermed
    // oppfylt bokstavelig: `--city=Oslo` gjør nøyaktig det samme som før
    // sømmen, med nøyaktig de samme bivirkningene (ingen).
    //
    // --resume innebærer --work: å be om gjenopptagelse uten et sted å
    // gjenoppta fra er alltid en skrivefeil, ikke et ønske.
    const workRaw = args.find((a) => a === '--work' || a.startsWith('--work='));
    const resume = args.includes('--resume');
    const workDir =
        workRaw !== undefined
            ? // slice framfor split('='): en katalogsti kan inneholde «=».
              workRaw === '--work'
                ? DEFAULT_WORK_DIR
                : workRaw.slice(workRaw.indexOf('=') + 1) || DEFAULT_WORK_DIR
            : resume
              ? DEFAULT_WORK_DIR
              : null;

    // --approve binder godkjenningen til ARTEFAKTET. Se [batchFingerprint]:
    // verdien er en hash over (chunk, berikelsens fingeravtrykk) for hele
    // planen, og den endres i det øyeblikket en selektor, en kategoriliste,
    // --limit eller claim-lista endres. Da nekter skrivingen.
    const approve = args.find((a) => a.startsWith('--approve='))?.slice('--approve='.length) ?? null;

    return { dryRun, cities, limit, cats, catArg, workDir, resume, approve, national };
}


/**
 * external_id-ene som ALLEREDE finnes i basen, blant dem kjøringen vil skrive.
 *
 * Leser, skriver ikke. Sendes i bolker på 500 fordi PostgREST har en
 * URL-lengdegrense, og en nasjonal kjøring har titusenvis av id-er.
 */
async function existingExternalIds(ider: readonly string[]): Promise<Set<string> | null> {
    if (!isDatahubConfigured()) return null;
    const db = supabaseAdmin();
    const { data: source } = await db.from('sources').select('id').eq('slug', SOURCE_SLUG).maybeSingle();
    if (!source) return null;
    const funnet = new Set<string>();
    for (let i = 0; i < ider.length; i += 500) {
        const { data, error } = await db
            .from('activities')
            .select('external_id')
            .eq('source_id', source.id)
            .in('external_id', ider.slice(i, i + 500));
        if (error) throw new Error(`Forhåndsdiff feilet: ${error.message}`);
        for (const r of data ?? []) funnet.add(r.external_id as string);
    }
    return funnet;
}

/**
 * FORHÅNDSDIFFEN + GODKJENNINGSOPPSUMMERINGEN.
 *
 * Berikelsesfilene ER radene, så en sammenligning mot `activities` svarer
 * eksakt på hva som kommer til å endre seg. Én lesning per 500 id-er, null
 * skriving — den billigste forsikringen mot at en feil selektor skriver
 * tusenvis av rader ingen har sett.
 *
 * SETTET AV EKSISTERENDE id-er LAGRES per chunk (`<chunk>.before.ndjson`). Da
 * er angringen eksakt for NYE rader: alt som finnes etterpå og ikke sto i
 * fila, kan avpubliseres i én setning.
 *
 * DEN ÆRLIGE BEGRENSNINGEN: OPPDATERTE RADER KAN IKKE GJENOPPRETTES. Importen
 * har ingen historikk, og upserten overskriver feltene. En rad som lå riktig
 * og blir skrevet feil, er feil til noen retter den for hånd. Det er grunnen
 * til at «nye vs. oppdaterer» står øverst i oppsummeringen, og til at den
 * første nasjonale kjøringen for en kategori helst skal treffe en kategori
 * som er tom fra før.
 */
async function rapporterGodkjenning(
    plan: readonly ImportChunk[],
    store: WorkStore,
    cats: PlaceCategory[],
    opts: { workDir: string; dryRun: boolean; limit: number; catArg?: string; national: boolean }
): Promise<{ dom: 'GO' | 'STOPP'; fingerprint: string | null; stoppGrunn?: string }> {
    const fp = batchFingerprint(
        plan.map((c) => c.id),
        (id) => store.entries().get(`${id}/enrich`)?.fingerprint
    );
    if (!fp) return { dom: 'STOPP', fingerprint: null, stoppGrunn: 'ikke alle chunks er beriket' };

    const perChunk = new Map<string, ImportRow[]>();
    for (const c of plan) perChunk.set(c.id, store.read<ImportRow>(c, 'enrich'));
    const alle = [...perChunk.values()].flat();

    // Forhåndsdiff + før-settet per chunk.
    let eksisterende: Set<string> | null = null;
    try {
        eksisterende = await existingExternalIds(alle.map((r) => r.external_id));
    } catch (err) {
        console.log(`  (forhåndsdiff hoppet over: ${err instanceof Error ? err.message : err})`);
    }
    let diff: ForhandsDiff | null = null;
    if (eksisterende) {
        diff = { nye: 0, oppdaterer: 0 };
        for (const r of alle) {
            if (eksisterende.has(r.external_id)) diff.oppdaterer += 1;
            else diff.nye += 1;
        }
        for (const c of plan) {
            const fantes = (perChunk.get(c.id) ?? [])
                .map((r) => r.external_id)
                .filter((id) => eksisterende!.has(id))
                .map((external_id) => ({ external_id }));
            store.writeSidecar(c, 'before', fantes);
        }
    }

    // Andelen av NORGE planen dekker, eller null når den ikke er kjent.
    // En per-kommune-plan får null, og da hoppes utbyttesjekken over — fire
    // byer er ikke en brøkdel av landet man kan regne ut fra antall chunks.
    // Se [nationalCoverage].
    const andel = nationalCoverage(plan);

    const radPerKategori = new Map<string, number>();
    for (const cat of cats) {
        radPerKategori.set(cat.key, alle.filter((r) => r.category === cat.category).length);
    }
    const kategorier: KategoriLinje[] = cats.map((cat) => {
        const rader = alle.filter((r) => r.category === cat.category);
        const nasjonalt = NATIONAL_EXPECTATION[cat.key];
        return {
            key: cat.key,
            rader: rader.length,
            forventet: nasjonalt === undefined || andel === null ? null : nasjonalt * andel,
            utenNavn: rader.filter((r) => r.titleSource !== 'osm-navn').length,
        };
    });

    const utbytte = andel === null ? null : yieldCollapseStop(radPerKategori, andel);
    const tommeSett = plan.flatMap((c) =>
        (store.entries().get(`${c.id}/fetch`)?.emptySets ?? []).map((sett) => `${c.id} ${sett}`)
    );
    const undertrykt = new Set(
        plan.flatMap((c) => [...(store.entries().get(`${c.id}/enrich`)?.seenClaims ?? [])])
    );
    const dupRader = alle.map((r) => ({
        external_id: r.external_id,
        category: r.category,
        title: r.title,
        lat: r.lat,
        lng: r.lng,
        osmNavn: r.titleSource === 'osm-navn',
    }));
    const duplikater = duplicateCandidates(dupRader);
    // Blindsonen fra den første nasjonale tørrkjøringen: tre navnløse
    // polygoner som alle fikk «Skianlegg i Fageråsen» fra Nominatim.
    const genererteKollisjoner = generatedTitleCollisions(dupRader);

    const dom: 'GO' | 'STOPP' = utbytte ? 'STOPP' : 'GO';
    const flagg = [
        opts.national ? '--national' : null,
        `--work=${opts.workDir}`,
        '--resume',
        opts.limit !== Infinity ? `--limit=${opts.limit}` : null,
        opts.catArg ? `--category=${opts.catArg}` : null,
        `--approve=${fp}`,
    ].filter(Boolean);

    if (andel === null) {
        console.log(
            '  (forventningskolonnen er tom: planen er per kommune, og andelen av Norge ' +
                'er ukjent. Utbyttesjekken gjelder den nasjonale planen.)'
        );
    }
    console.log(
        formatApproval({
            fingerprint: fp,
            chunks: plan.length,
            raderTotalt: alle.length,
            diff,
            kategorier,
            geokoding: {
                forsok: alle.filter((r) => r.titleSource !== 'osm-navn').length,
                feil: alle.filter((r) => r.geocodeError).length,
            },
            overpass: { ...overpassTelling },
            tommeSett,
            claims: { undertrykt: undertrykt.size, navneavvik: 0 },
            duplikatkandidater: duplikater,
            delteGenererteTitler: genererteKollisjoner,
            dom,
            stoppGrunn: utbytte?.message,
            skrivKommando: `npx --yes tsx scripts/import-places.ts ${flagg.join(' ')}`,
            naa: new Date().toISOString().slice(0, 16).replace('T', ' '),
        })
    );
    return { dom, fingerprint: fp, stoppGrunn: utbytte?.message };
}

async function main() {
    let parsed: ImportArgs;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
    const { dryRun, cities, limit, cats, catArg, workDir, resume, approve, national } = parsed;

    const plan = national ? [nationalChunk()] : planForCities(cities);
    const store: WorkStore = workDir ? new FileStore(workDir) : new NullStore();

    console.log(`Import av faste steder: ${national ? 'HELE NORGE (én chunk)' : cities.join(', ')}${dryRun ? ' [DRY-RUN]' : ''}${limit !== Infinity ? ` [limit=${limit}/kategori]` : ''}${catArg ? ` [kategori=${cats.map((c) => c.key).join(',')}]` : ''}`);
    console.log(`Arbeidskatalog: ${store.describe()}${resume ? ' [--resume]' : ''}`);

    // GJENOPPTAGELSE ER EKSPLISITT. Å hoppe over ferdige steg i stillhet er
    // den klassiske fella: man retter en selektor, kjører på nytt, og får
    // gårsdagens data. Fingeravtrykket fanger MYE av det (selektortekst,
    // kategoriliste, limit, claims), men ikke alt — en endring inne i
    // matches() eller i en klyngefunksjon er usynlig for det.
    //
    // Prisen er at man kan glemme flagget og betale en natt. Derfor sier vi
    // fra: finnes det ferdige steg i katalogen uten at --resume er gitt,
    // skrives det ut hvor mange og hva flagget heter.
    if (workDir && !resume) {
        const ferdige = plan.filter((c) => store.entries().has(`${c.id}/enrich`)).length;
        if (ferdige) {
            console.log(
                `  MERK: ${ferdige} av ${plan.length} chunks har et ferdig berikelsessteg i ` +
                    `${workDir}. Uten --resume hentes og geokodes de på nytt. Legg til --resume ` +
                    `for å gjenbruke dem.`
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // GODKJENNINGSPORTEN.
    //
    // Å SKRIVE MED --work KREVER --approve. Uten den er «ja» et ja til en
    // logg noen leste, og mellom lesingen og skrivingen ligger en ny prosess
    // som kan ha fått en annen selektor. Med den er «ja» bundet til
    // BERIKELSESFILENE — se [batchFingerprint].
    //
    // Den GAMLE veien (uten --work) er uendret: `--city=Oslo` skriver som før,
    // uten port. Porten hører til bolkeflyten, ikke til en enkelt by.
    let godkjent: { dom: 'GO' | 'STOPP'; fingerprint: string | null } | null = null;
    if (workDir) {
        // FERDIG BERIKET MED DENNE KJØRINGENS FORUTSETNINGER, ikke bare
        // «det ligger en manifestlinje der». Forskjellen er ikke teoretisk:
        // med --limit=1 mot en katalog beriket uten limit ville den løse
        // varianten skrevet ut en oppsummering av GÅRSDAGENS rader, med et
        // fingeravtrykk som ikke lenger gjaldt. Funnet ved en tørrkjøring.
        const ferdigBeriket = plan.every((c) =>
            store.isDone(c, 'enrich', stageFingerprints(c, cats, limit).enrich)
        );
        if (ferdigBeriket) {
            // Alt er beriket fra før: da kan forhåndsdiffen og oppsummeringen
            // regnes ut NÅ, før noe skrives.
            godkjent = await rapporterGodkjenning(plan, store, cats, {
                workDir,
                dryRun,
                limit,
                catArg,
                national,
            });
        }
        if (!dryRun) {
            if (!approve) {
                console.error(
                    ferdigBeriket
                        ? `\nSkriving med --work krever --approve. Fingeravtrykket står i ` +
                              `oppsummeringen over.`
                        : `\nSkriving med --work krever --approve, og ikke alle chunks er ` +
                              `beriket ennå. Kjør først:\n` +
                              `  npx --yes tsx scripts/import-places.ts --dry-run --work=${workDir}` +
                              `${resume ? ' --resume' : ''}`
                );
                process.exit(1);
            }
            if (!godkjent?.fingerprint) {
                console.error('\nIngen bolk å godkjenne: ikke alle chunks er beriket.');
                process.exit(1);
            }
            if (approve !== godkjent.fingerprint) {
                console.error(
                    `\nFINGERAVTRYKKET STEMMER IKKE.\n` +
                        `  godkjent: ${approve}\n` +
                        `  faktisk:  ${godkjent.fingerprint}\n` +
                        `Noe har endret seg siden godkjenningen — en selektor, en ` +
                        `kategoriliste, --limit eller claim-lista. Kjør tørrkjøringen på nytt ` +
                        `og les oppsummeringen før du godkjenner igjen.`
                );
                process.exit(1);
            }
            if (godkjent.dom === 'STOPP') {
                console.error('\nDommen er STOPP. Se oppsummeringen over. Ingenting skrives.');
                process.exit(1);
            }
        }
    }

    let total = 0;
    // Feiltoleranse per chunk: én chunks feil (f.eks. konsekvent Overpass-504
    // for Trondheim) skal IKKE avbryte hele kjøringen — de øvrige fullføres
    // og skrives, og de feilede oppsummeres til slutt med exit-kode 1.
    const failed: { city: string; error: string }[] = [];
    const seenClaims = new Set<string>();
    for (const chunk of plan) {
        try {
            const res = await runChunk(chunk, { dryRun, limit, cats, store, resume });
            total += res.rows;
            for (const id of res.seenClaims) seenClaims.add(id);
        } catch (err) {
            // ET STOPPVILKÅR AVBRYTER HELE KJØRINGEN, ikke bare chunken.
            // Skillet er poenget: en Overpass-504 for Trondheim skal ikke
            // stanse Bergen, men en claim med feil id eller et Kartverket som
            // er nede ville gjort samme feil i de neste 300 chunkene.
            if (err instanceof ImportStop) {
                console.error(`\n=== STOPP (${err.vilkaar}) ===`);
                console.error(err.message);
                console.error(
                    `\nKjøringen er avbrutt etter ${total} rader. Ingenting mer skrives. ` +
                        (workDir ? `Ferdige steg ligger i ${workDir} og gjenbrukes med --resume.` : '')
                );
                process.exit(1);
            }
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ✗ ${chunk.label} FEILET — hoppes over, fortsetter til neste: ${msg}`);
            failed.push({ city: chunk.label, error: msg });
        }
        if (chunk !== plan[plan.length - 1]) await sleep(CITY_PAUSE_MS);
    }
    const okCount = plan.length - failed.length;
    console.log(`\nFerdig: ${total} steder ${dryRun ? 'klare (ingenting skrevet)' : 'importert'} — ${okCount}/${plan.length} chunks gikk gjennom.`);
    if (failed.length) {
        console.log(`\nFEILEDE CHUNKS (${failed.length}):`);
        for (const f of failed) console.log(`  ✗ ${f.city}: ${f.error}`);
        // Importen er additiv (upsert på source_id+external_id, ingen sletting),
        // og en chunk skrives FØRST når hele chunken er bygget. En feilet
        // chunk har derfor ikke lagt igjen halv tilstand, og kan trygt kjøres
        // på nytt — alene. Vi skriver ut den nøyaktige kommandoen, så
        // gjenkjøringen ikke ved et uhell tar med det som allerede gikk.
        //
        // Med --work er dette billigere enn før: et ferdig hentesteg
        // gjenbrukes, så en gjenkjøring med --resume koster bare det som
        // faktisk feilet.
        const rerunFlags = [
            national ? '--national' : null,
            dryRun ? '--dry-run' : null,
            limit !== Infinity ? `--limit=${limit}` : null,
            catArg ? `--category=${catArg}` : null,
            workDir ? `--work=${workDir} --resume` : null,
        ].filter(Boolean);
        console.log('\nKjør de feilede på nytt, én om gangen (trygt — upsert er idempotent):');
        for (const f of failed) {
            console.log(
                (national
                    ? `  npx --yes tsx scripts/import-places.ts ${rerunFlags.join(' ')}`
                    : `  npx --yes tsx scripts/import-places.ts --city=${f.city} ${rerunFlags.filter((x) => x !== '--national').join(' ')}`
                ).trimEnd()
            );
        }
        // Delvis feil: de vellykkede byene er skrevet, men signaliser til
        // operatør/CI at minst én by mangler ved å avslutte med kode 1.
        process.exitCode = 1;
    }
    // GODKJENNINGSOPPSUMMERINGEN, når den ikke allerede ble skrevet ut før
    // løkka. Det er tilfellet ved den FØRSTE tørrkjøringen, der ingenting var
    // beriket på forhånd. Ingen skriving har skjedd: porten over slipper
    // ingen gjennom uten et fingeravtrykk, og et fingeravtrykk finnes ikke før
    // alt er beriket.
    if (workDir && !godkjent) {
        await rapporterGodkjenning(plan, store, cats, { workDir, dryRun, limit, catArg, national });
    }

    // TOMME SETT, samlet til slutt og lest fra MANIFESTET.
    //
    // Midt i utskriften er en tom kategori synlig for én chunk og usynlig for
    // 353 over en natt. Her står de samlet, og de står der enten chunken ble
    // kjørt denne gangen eller gjenopptatt fra mellomleddet.
    //
    // «Bekreftet tom» betyr målt to ganger, ikke antatt. Det er fortsatt
    // mulig at begge spørringene var forbigående tomme — sannsynligheten er
    // bare mye lavere, og lista er stedet å se etter et mønster: ÉN tom
    // kategori i én kommune er normalt, den SAMME kategorien tom i tjue
    // kommuner er ikke.
    const tommeSett: string[] = [];
    for (const chunk of plan) {
        for (const sett of store.entries().get(`${chunk.id}/fetch`)?.emptySets ?? []) {
            tommeSett.push(`${chunk.id.padEnd(16)} ${sett}`);
        }
    }
    if (tommeSett.length) {
        console.log(`\nTOMME SETT (${tommeSett.length}):`);
        for (const linje of tommeSett) console.log(`  ${linje}`);
        console.log(
            '  Hvert av disse ga 0 objekter. En kategori kan være legitimt tom i en ' +
                'kommune (ikke alle har en akebakke), og hele kategorien ble målt to ' +
                'ganger før den ble godtatt som tom. Se etter MØNSTER: samme kategori ' +
                'tom i mange chunks er en selektor- eller tag-endring, ikke geografi.'
        );
    } else if (workDir) {
        console.log('\nIngen tomme sett.');
    }

    // DØDE CLAIMS. Ei liste som vedlikeholdes for hånd rotner i stillhet, og
    // en claim som ikke lenger treffer noe undertrykker ingenting — men den
    // ser ut som om den gjør det. Ved nasjonal skala er dette den eneste
    // måten å oppdage at en relasjon er splittet eller slettet i OSM.
    //
    // TO TING ENDRET SEG MED SØMMEN:
    //
    //  1. Vilkåret var `cities.length === DEFAULT_CITIES.length && !catArg`.
    //     Det sluttet å bety noe i det øyeblikket enheten ikke lenger er en
    //     by. [runCoversEverything] uttrykker det samme i PLANEN, og
    //     overlever at standardplanen blir 353 fliser.
    //  2. Ved --resume hoppes ferdige chunks over, og et rent minnebasert
    //     sett ville manglet nettopp de chunkene som gikk bra — rapporten
    //     ville meldt levende claims som døde. Derfor leses `seenClaims`
    //     også fra MANIFESTET, som husker hva hver chunk fant.
    for (const [nokkel, entry] of store.entries()) {
        if (!nokkel.endsWith('/enrich')) continue;
        for (const id of entry.seenClaims ?? []) seenClaims.add(id);
    }
    const doede = staleClaims(seenClaims);
    if (doede.length) {
        const heleKjoringen = runCoversEverything(
            plan,
            planForCities(DEFAULT_CITIES),
            cats.length,
            PLACE_CATEGORIES.length
        );
        console.log(
            `\nCLAIMS SOM IKKE TRAFF NOE (${doede.length} av ${OSM_CLAIMS.length}):`
        );
        for (const c of doede) {
            console.log(`  ${c.osmId.padEnd(20)} → ${c.source}/${c.externalId}`);
        }
        console.log(
            heleKjoringen
                ? '  Kjøringen dekket hele standardplanen og alle kategorier. En claim her treffer ' +
                      'ikke lenger noe OSM-objekt importen henter — enten er objektet ' +
                      'delt/slettet i OSM, eller claimen peker på noe annet enn den ' +
                      'external_id-en raden ville fått (for Aking: ankeret, ikke et segment).'
                : `  Kjøringen dekket bare ${plan.map((c) => c.label).join(', ')}${catArg ? ` og kategori ${catArg}` : ''} — ` +
                      'en claim utenfor rekkevidden er IKKE død. Kjør uten --city og ' +
                      '--category før du fjerner noe.'
        );
    }

    console.log('Husk ODbL-attribusjon der dataene vises: «© OpenStreetMap contributors».');
}

const isDirectRun = process.argv[1]?.endsWith('import-places.ts');
if (isDirectRun) {
    main().catch((e) => {
        console.error('Import feilet:', e);
        process.exit(1);
    });
}
