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
    centerOfBounds,
    distanceMeters,
    type GeoBounds,
    type GeoPoint,
} from '../lib/geo-polygon';
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
const OVERPASS_QUERY_PAUSE_MS = 1000;
// Kartverket punktsøk svarte 502 under 100 ms-kadens og var treg (timeouts)
// ved 400 ms (jul. 2026). Pausen dekker nå OGSÅ Nominatim-bydeloppslaget
// (i-omraade), som krever ≥1 req/s — derfor 1100 ms default. Pausen kjøres
// etter hvert steds tittelgenerering, og bydeloppslaget er det siste eksterne
// kallet i kaskaden, så ≥1100 ms mellom to Nominatim-kall er garantert.
// Overstyr med PLACES_PAUSE_MS. Egen pause, uavhengig av Overpass.
const TITLE_PAUSE_MS = Number(process.env.PLACES_PAUSE_MS ?? 1100);
const SOURCE_SLUG = 'osm-steder';
const DEFAULT_CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

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
    // Fra `out geom` (kun Skianlegg-spørringen). Nodene i en way/relation.
    // `out geom` legger geometri på WAYS her …
    geometry?: GeoPoint[];
    bounds?: GeoBounds;
    // … men på RELASJONER ligger den per medlem, ikke på toppnivå. Å lese
    // el.geometry på en relation gir undefined, og det var grunnen til at
    // alle fire relasjonene i Oslo — Skimore Oslo med 11 heiser inkludert —
    // falt ut før bevistesten i det hele tatt kjørte.
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

/** BEVISENE. Hentes én gang per by og brukes til to ting:
 *   - kategoritesten: heis ELLER piste:type=downhill i/inntil polygonet
 *   - fasettene: ALT som ligger inne, inkludert sled, playground og mtb
 *  Derfor er settet bredere enn testen krever. */
export const SKI_EVIDENCE_SELECTOR = [
    `nwr["aerialway"~"^(${SKI_LIFT_VALUES})$"]${NOT_DISUSED}(area.a);`,
    `nwr["piste:type"]${NOT_DISUSED}(area.a);`,
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
async function skianleggElements(city: string): Promise<OsmElement[]> {
    const q = (selector: string) => `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;
(
  ${selector}
);
out geom tags;`;

    const polygons = await fetchOverpass(q(SKI_AREA_SELECTOR), `${city}/skianlegg:omrade`);
    await sleep(OVERPASS_QUERY_PAUSE_MS);
    const evidence = await fetchOverpass(q(SKI_EVIDENCE_SELECTOR), `${city}/skianlegg:bevis`);

    const withPoints = evidence.map((el) => ({ el, points: elementPoints(el) }));
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

        const inside = withPoints.filter(({ points }) =>
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
    console.log(
        `  ${city}/skianlegg   ${String(polygons.length).padStart(4)} polygoner, ` +
            `${evidence.length} bevisobjekter → ${verified.length} alpinanlegg` +
            (usikre ? `, ${usikre} med heis uten utforløype (se under)` : '')
    );
    for (const linje of rapport) console.log(linje);
    return verified;
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
    if (!isUsablePlaceName(t.name)) return 'uten-navn';
    return 'aking';
}

/** Navnet som GRUPPERINGSNØKKEL. Bare trimming, småbokstaver og kollapset
 *  mellomrom — ingen fjerning av ord. «Øvre Akebakken» og «Akebakken» er to
 *  navn, og importen har ingen kilde som sier at de er samme bakke. */
export function akingNameKey(name: string | undefined): string {
    return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
    for (const el of elements) {
        const d = akingVerdict(el.tags ?? {});
        dom.set(el, d);
        domTelling[d] += 1;
    }

    // Pass 2: hvilke medlemmer er allerede dekket av en relasjon?
    const dekket = new Set<string>();
    for (const el of elements) {
        if (el.type !== 'relation') continue;
        const d = dom.get(el);
        if (d !== 'aking' && d !== 'alpint-blandet') continue;
        for (const m of el.members ?? []) dekket.add(`${m.type}/${m.ref}`);
    }

    const godkjent = elements.filter((el) => dom.get(el) === 'aking');
    const relasjoner = godkjent.filter((el) => el.type === 'relation');
    const frie = godkjent.filter(
        (el) => el.type !== 'relation' && !dekket.has(`${el.type}/${el.id}`)
    );

    // Pass 3: grupper de frie på navn, så på avstand innenfor navnet.
    const perNavn = new Map<string, OsmElement[]>();
    for (const el of frie) {
        const key = akingNameKey(el.tags?.name);
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
    for (const { medlemmer, grunnlag } of grupper) {
        const anker = [...medlemmer].sort(akingAnchorOrder)[0];
        const punkter = medlemmer.flatMap((el) => elementPoints(el));
        const punkt = akingAnchorPoint(punkter);
        const id = `${anker.type}/${anker.id}`;
        const navn = anker.tags?.name ?? '(uten navn)';
        if (!punkt) {
            rapport.push(`    ${id.padEnd(18)} ${navn.padEnd(32)} HOPPET OVER — ingen geometri`);
            continue;
        }
        // Utstrekningen skrives ut fordi kartpunktet er et kompromiss: en
        // bakke på 2 km har en nål som ikke står ved starten, og da skal
        // tallet stå i rapporten framfor å oppdages på kartet.
        const b = boundsOf(punkter)!;
        const lengde = Math.round(
            distanceMeters(
                { lat: b.minlat, lon: b.minlon },
                { lat: b.maxlat, lon: b.maxlon }
            )
        );
        rapport.push(
            `    ${id.padEnd(18)} ${navn.padEnd(32)} ${grunnlag.padEnd(16)} ` +
                `[${medlemmer.length} objekt, bbox-diagonal ${lengde} m]`
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

    return { anchors, rapport, domTelling };
}

/** Henter Aking for én by. `out geom` fordi grupperingen og kartpunktet
 *  trenger geometrien; `out center` gir ingen av delene på en relasjon. */
async function akingElements(city: string): Promise<OsmElement[]> {
    const raw = await fetchOverpass(
        `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;
(
  ${AKING_SELECTOR}
);
out geom tags;`,
        `${city}/aking:objekter`
    );
    const { anchors, rapport, domTelling } = akingClusters(raw);
    console.log(
        `  ${city}/aking       ${String(raw.length).padStart(4)} objekter → ` +
            `${anchors.length} akebakker (avvist: ${domTelling['alpint-blandet']} alpint-blandet, ` +
            `${domTelling.lekeplass} lekeplass, ${domTelling['uten-navn']} uten navn)`
    );
    for (const linje of rapport) console.log(linje);
    return anchors;
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
     * kategorien. Satt kun for Skianlegg, som trenger `out geom`, en ekstra
     * bevisspørring og et romlig filter.
     */
    fetchElements?: (city: string) => Promise<OsmElement[]>;
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
        fetchElements: akingElements,
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
        fetchElements: skianleggElements,
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
export async function fetchOverpass(query: string, label: string): Promise<OsmElement[]> {
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
                if (!remark) return (json.elements ?? []) as OsmElement[];
                console.log(
                    `    ${label}: ${endpoint} svarte 200 med remark «${remark}» ` +
                        `(forsøk ${i + 1}/${attempts.length})`
                );
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
async function overpassCity(
    city: string,
    cats: PlaceCategory[] = PLACE_CATEGORIES
): Promise<OsmElement[]> {
    const seen = new Set<string>();
    const all: OsmElement[] = [];
    for (const cat of cats) {
        const query = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;
(
  ${cat.selector}
);
out center tags;`;
        // Skianlegg har egen henter: den trenger `out geom`, en ekstra
        // bevisspørring og et romlig filter. Alle andre går standardveien.
        const elements = cat.fetchElements
            ? await cat.fetchElements(city)
            : await fetchOverpass(query, `${city}/${cat.key}`);
        let added = 0;
        for (const el of elements) {
            const id = `${el.type}/${el.id}`;
            if (seen.has(id)) continue;
            seen.add(id);
            all.push(el);
            added += 1;
        }
        console.log(`  ${city}/${cat.key.padEnd(11)} ${String(elements.length).padStart(4)} elementer (${added} nye)`);
        await sleep(OVERPASS_QUERY_PAUSE_MS);
    }
    return all;
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

export async function buildRows(
    city: string,
    elements: OsmElement[],
    limit: number,
    cats: PlaceCategory[] = PLACE_CATEGORIES
): Promise<ImportRow[]> {
    // Første pass: velg elementer (kategori + koordinater + limit), så vi
    // vet totalt geokodingsbehov før vi starter — gir ekte fremdriftslinje.
    const selected: { el: OsmElement; cat: (typeof PLACE_CATEGORIES)[number]; pos: { lat: number; lng: number } }[] = [];
    const perCategory = new Map<string, number>();
    for (const el of elements) {
        const tags = el.tags ?? {};
        const cat = cats.find((c) => c.matches(tags, el));
        const pos = coords(el);
        if (!cat || !pos) continue;
        if ((perCategory.get(cat.key) ?? 0) >= limit) continue;
        perCategory.set(cat.key, (perCategory.get(cat.key) ?? 0) + 1);
        selected.push({ el, cat, pos });
    }
    const needGeocoding = selected.filter(({ el }) => !isUsablePlaceName(el.tags?.name)).length;
    console.log(`  ${selected.length} steder valgt, ${needGeocoding} trenger geokodet tittel`);

    const rows: ImportRow[] = [];
    let geocoded = 0;
    for (const { el, cat, pos } of selected) {
        const tags = el.tags ?? {};
        const usableName = isUsablePlaceName(tags.name);
        if (!usableName) {
            geocoded += 1;
            console.log(`  geokoder ${el.type}/${el.id} (${geocoded}/${needGeocoding})...`);
        }
        // Tittel-prefikset kan være sport-spesifikt (ballbane), ellers kategoriens.
        const titleLabel = cat.titleLabelFor?.(tags) ?? cat.label;
        const titled = await makePlaceTitleDetailed(titleLabel, tags.name ?? null, pos.lat, pos.lng);
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
            venue_name: usableName ? tags.name!.trim() : null,
            address: addrStreet,
            municipality: city,
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
            osmName: tags.name ?? null,
        });
    }
    return rows;
}

async function importCity(
    city: string,
    dryRun: boolean,
    limit: number,
    cats: PlaceCategory[] = PLACE_CATEGORIES
) {
    console.log(`\n=== ${city} ===`);
    const elements = await overpassCity(city, cats);
    console.log(`  Overpass ga ${elements.length} elementer`);
    const rows = await buildRows(city, elements, limit, cats);

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
            // Kategorier med egen henter filtrerer også ROMLIG, så «0» her kan
            // bety to ting: selektoren traff ingenting, eller den traff men
            // ingenting besto. Per-polygon-rapporten over skiller dem — uten
            // dette hintet leser man «sjekk selektoren» om en by som rett og
            // slett ikke har alpinanlegg.
            const hint = cat.fetchElements
                ? ` ${cat.category} filtrerer også romlig — se linjene over for hvert polygon.`
                : '';
            console.log(
                `    ADVARSEL: Overpass ga 0 elementer for ${cat.category} i ${city}` +
                    ` — sjekk selektoren og tag-endring i OSM.${hint}`
            );
        } else if (catRows.length === 0) {
            console.log(
                `    ADVARSEL: ${catElements} elementer for ${cat.category} i ${city}, men 0 rader` +
                    ` — alle manglet koordinater eller ble silt bort av --limit.`
            );
        }
        // Konkrete eksempler der name-taggen manglet/ble silt:
        for (const r of catRows.filter((x) => x.titleSource !== 'osm-navn').slice(0, 3)) {
            console.log(`    ${r.external_id}: name=${JSON.stringify(r.osmName)} -> "${r.title}" [${r.titleSource}]`);
        }
    }
    const errors = rows.filter((r) => r.geocodeError);
    if (errors.length) {
        const reasons = new Map<string, number>();
        errors.forEach((r) => reasons.set(r.geocodeError!, (reasons.get(r.geocodeError!) ?? 0) + 1));
        console.log(`  GEOKODINGSFEIL (${errors.length} steder):`);
        for (const [reason, n] of reasons) console.log(`    ${n} × ${reason}`);
    }

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
    // Umulig i per-by-modus; hard feil fordi det betyr at kjøremodusen er
    // endret uten at dette ble tatt stilling til.
    const utenAnker = rowsMissingCityAnchor(rows);
    if (utenAnker.length > 0) {
        throw new Error(
            `${utenAnker.length} rader mangler både municipality og near_city ` +
                `(f.eks. ${utenAnker[0].external_id}) — de ville vært usynlige i ` +
                `by-modus. Sett ett av feltene før upsert.`
        );
    }

    const writable = rows.filter((r) => !locked.has(r.external_id));
    if (locked.size) console.log(`  Hopper over ${rows.length - writable.length} låste rader.`);

    for (let i = 0; i < writable.length; i += 500) {
        const chunk = writable
            .slice(i, i + 500)
            .map(({ titleSource: _ts, geocodeError: _ge, osmName: _on, ...row }) => ({
                ...row,
                source_id: source.id,
            }));
        const { error } = await db.from('activities').upsert(chunk, { onConflict: 'source_id,external_id' });
        if (error) throw new Error(`Upsert feilet (${city}, chunk ${i / 500}): ${error.message}`);
    }
    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${writable.length} steder (${city})` })
        .eq('id', source.id);
    console.log(`  Skrev ${writable.length} rader.`);
    return writable.length;
}

export interface ImportArgs {
    dryRun: boolean;
    cities: string[];
    limit: number;
    cats: PlaceCategory[];
    catArg?: string;
}

const KNOWN_FLAGS = ['--dry-run', '--city=', '--limit=', '--category='];

/**
 * Argumentparsing, streng med vilje. ALLE verdiflagg bruker `=`
 * (`--city=Oslo`, ikke `--city Oslo`). Skrivemåten med mellomrom ble tidligere
 * IGNORERT i stillhet, slik at `--city Oslo` kjørte alle fire byene — en dyr
 * overraskelse mot produksjonsdata. Ukjente argumenter avvises derfor nå.
 */
export function parseArgs(args: string[]): ImportArgs {
    const unknown = args.filter((a) => !KNOWN_FLAGS.some((f) => a === f || a.startsWith(f)));
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

    return { dryRun, cities, limit, cats, catArg };
}

async function main() {
    let parsed: ImportArgs;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
    const { dryRun, cities, limit, cats, catArg } = parsed;

    console.log(`Import av faste steder: ${cities.join(', ')}${dryRun ? ' [DRY-RUN]' : ''}${limit !== Infinity ? ` [limit=${limit}/kategori]` : ''}${catArg ? ` [kategori=${cats.map((c) => c.key).join(',')}]` : ''}`);
    let total = 0;
    // Feiltoleranse per by: én bys feil (f.eks. konsekvent Overpass-504 for
    // Trondheim) skal IKKE avbryte hele kjøringen — de øvrige byene fullføres
    // og skrives, og de feilede oppsummeres til slutt med exit-kode 1.
    const failed: { city: string; error: string }[] = [];
    for (const city of cities) {
        try {
            total += await importCity(city, dryRun, limit, cats);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ✗ ${city} FEILET — hoppes over, fortsetter til neste by: ${msg}`);
            failed.push({ city, error: msg });
        }
        if (city !== cities[cities.length - 1]) await sleep(CITY_PAUSE_MS);
    }
    const okCount = cities.length - failed.length;
    console.log(`\nFerdig: ${total} steder ${dryRun ? 'klare (ingenting skrevet)' : 'importert'} — ${okCount}/${cities.length} byer gikk gjennom.`);
    if (failed.length) {
        console.log(`\nFEILEDE BYER (${failed.length}):`);
        for (const f of failed) console.log(`  ✗ ${f.city}: ${f.error}`);
        // Importen er additiv (upsert på source_id+external_id, ingen sletting),
        // og en by skrives FØRST når hele byen er bygget. En feilet by har
        // derfor ikke lagt igjen halv tilstand, og kan trygt kjøres på nytt —
        // alene. Vi skriver ut den nøyaktige kommandoen, så gjenkjøringen ikke
        // ved et uhell tar med byene som allerede gikk gjennom.
        const rerunFlags = [
            dryRun ? '--dry-run' : null,
            limit !== Infinity ? `--limit=${limit}` : null,
            catArg ? `--category=${catArg}` : null,
        ].filter(Boolean);
        console.log('\nKjør de feilede på nytt, én by om gangen (trygt — upsert er idempotent):');
        for (const f of failed) {
            console.log(
                `  npx --yes tsx scripts/import-places.ts --city=${f.city} ${rerunFlags.join(' ')}`.trimEnd()
            );
        }
        // Delvis feil: de vellykkede byene er skrevet, men signaliser til
        // operatør/CI at minst én by mangler ved å avslutte med kode 1.
        process.exitCode = 1;
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
