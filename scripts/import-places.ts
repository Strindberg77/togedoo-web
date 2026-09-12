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
import { makePlaceTitleDetailed, isUsablePlaceName, TitleSource } from '../lib/places';

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

interface PlaceCategoryDef {
    key: string;
    /** Kategoriens navn OG standard tittel-prefiks. */
    label: string;
    /** Verdien som lagres i activities.category. */
    category: string;
    audience: string;
    selector: string;
    matches: (t: OsmTags) => boolean;
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
    facetsFor?: (t: OsmTags) => FacetToken[];
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
        const elements = await fetchOverpass(query, `${city}/${cat.key}`);
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
        const cat = cats.find((c) => c.matches(tags));
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
            url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
            osm_tags: tags,
            // Utledes på nytt hver kjøring, fra taggene alene.
            facets: cat.facetsFor?.(tags) ?? osmFacetTokens(tags),
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
        const catElements = elements.filter(
            (el) => cats.find((c) => c.matches(el.tags ?? {})) === cat
        ).length;
        if (catElements === 0) {
            console.log(
                `    ADVARSEL: Overpass ga 0 elementer for ${cat.category} i ${city}` +
                    ` — sjekk selektoren og tag-endring i OSM.`
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
