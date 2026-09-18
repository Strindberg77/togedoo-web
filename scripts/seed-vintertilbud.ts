// scripts/seed-vintertilbud.ts
//
// Kuratert seed for «nærliggende utflukter»: kommersielle/innendørs vinter- og
// fritidstilbud som ofte ligger UTENFOR de fire kommunegrensene, men hører til
// byens nærområde. OSM-dekningen er lav og sprikende (trampolineparker,
// innendørs skianlegg, badeland tagges inkonsistent), så de vedlikeholdes
// manuelt her — samme mønster som seed-dyremote.ts.
//
//   npx tsx scripts/seed-vintertilbud.ts --dry-run     (geokod + rapport, ingen skriving)
//   npx tsx scripts/seed-vintertilbud.ts               (geokod + upsert)
//   npx tsx scripts/seed-vintertilbud.ts --no-geocode  (bruk kun estimerte fallbacks)
//
// Krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (unntatt --dry-run), OG at
// migrasjon 0012 (near_city-kolonnen) er kjørt mot databasen.
//
// nearCity knytter et utenbys-sted til en «hjemby» (f.eks. Varingskollen i
// Nittedal → nearCity 'Oslo'). municipality beholder den EKTE kommunen for
// adresse/attribusjon. By-modus i /api/activities matcher (municipality OR
// near_city). Steder som ligger i selve byen (f.eks. Korketrekkeren i Oslo)
// setter kun municipality og lar nearCity være undefined.
//
// KOORDINATER: web-verifiserte adresser geokodes mot Kartverket ved kjøring
// (samme /sok-API som seed-dyremote). Entydig treff → published. Tvetydig/
// ingen treff → estimert fallback beholdes, status='pending' (API-et serverer
// bare 'published'), med advarsel i rapporten. manualCoord hopper over
// geokoding (for steder uten gateadresse, som en akebakke).
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';
import type { FacetToken } from '../lib/facets';
import { assertClaimsResolve } from '../lib/osm-claims';

// Vinter-splitt (steg 5): «Vinter & innendørs» er avviklet og fordelt på fem
// nye kategorier + inne/ute-flagg (is_indoor). Nøkkel = seed.externalId. HVER
// ENESTE seed-rad MÅ finnes her — toRow feiler hardt hvis en mangler (fanges i
// --dry-run). Tallet sto her før og var 25; det er utelatt med vilje, fordi et
// tall i en kommentar går ut på dato i stillhet mens vakten i splitFor() ikke
// gjør det.
//
// FASETTER (migrasjon 0016) settes samme sted, av samme grunn som is_indoor:
// seed-rader har osm_tags = null, så API-et utleder sports = [] for dem. Uten
// en eksplisitt verdi her forsvinner raden i det øyeblikket brukeren huker av
// én fasett. Tom liste er normalen — kun vinterradene har fasetter i dag.
//
// Tokenene er ASCII og oversettes aldri; etiketten er klientens.
const SPLIT: Record<
    string,
    { category: string; isIndoor: boolean; facets?: FacetToken[] }
> = {
    // Skianlegg (10): SNØ er innendørs, resten ute. Korketrekkeren lå her til
    // sep. 2026 og er nå Aking (1) — se under.
    // SNØ Lørenskog er alpint selv om det er innendørs — fasetten sier hva du
    // GJØR der, is_indoor sier hvor. De to aksene er uavhengige.
    'sno-lorenskog': { category: 'Skianlegg', isIndoor: true, facets: ['alpint'] },
    'varingskollen-alpinsenter': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'kirkerudbakken-skisenter': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'eikedalen-skisenter': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'vassfjellet-skisenter': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    // OSLO-ALPINT (sep. 2026). Fem anlegg, to OSM-relasjoner, fem rader.
    // Se kommentaren over seed-entryene og lib/osm-claims.ts.
    'tryvann': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'wyller': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'tommkleiva': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'trollvannskleiva': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'grefsenkleiva': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    // HEIS UTEN UTFORLØYPE (sep. 2026). Fire ekte anlegg som importens
    // nedfartskrav ikke slipper gjennom. Se seed-entryene og
    // docs/runbooks/alpin-usikker-heis.md.
    'kolsas-skisenter': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'finse-skisenter': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'ringkollen': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'grakallparken': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    // STORANLEGG (sep. 2026). Tre anlegg der importens bbox-senter lå i
    // fjellsiden. Fasettene er kopiert fra importradene de erstatter — en
    // seed-rad utleder ingenting fra OSM, og uten dem ville Trysil forsvunnet
    // fra aking-filteret. Se docs/skianlegg-adkomst.md.
    'voss-resort': { category: 'Skianlegg', isIndoor: false, facets: ['alpint'] },
    'trysil-skisenter': { category: 'Skianlegg', isIndoor: false, facets: ['alpint', 'aking', 'terrengsykling', 'downhill'] },
    'skigeilo': { category: 'Skianlegg', isIndoor: false, facets: ['alpint', 'skileik', 'aking'] },
    // Korketrekkeren er en akebakke, ikke et alpinanlegg — og fra sep. 2026
    // er det en EGEN kategori, ikke bare en fasett på Skianlegg. Raden lå
    // under Skianlegg med «(akebakke)» skrevet inn i tittelen, som er en
    // omskriving av at kategorien var feil. Fasetten står igjen fordi
    // kategorien og fasetten svarer på hvert sitt spørsmål: hva stedet ER, og
    // hva du GJØR der. Importen setter den samme fasetten på alle Aking-rader.
    'korketrekkeren-aking': { category: 'Aking', isIndoor: false, facets: ['aking'] },
    // Badeland (8 inne, Bø Sommarland ute — se nederst).
    'risenga-svommehall': { category: 'Badeland', isIndoor: true },
    'bolgen-bad-drobak': { category: 'Badeland', isIndoor: true },
    'jessheimbadet': { category: 'Badeland', isIndoor: true },
    'ado-arena-bergen': { category: 'Badeland', isIndoor: true },
    'vannkanten-badeland-loddefjord': { category: 'Badeland', isIndoor: true },
    'pirbadet-trondheim': { category: 'Badeland', isIndoor: true },
    'stavanger-svommehall': { category: 'Badeland', isIndoor: true },
    'austratt-svommehall-sandnes': { category: 'Badeland', isIndoor: true },
    // Trampolinepark (5): alle inne.
    'jumpyard-sno-lorenskog': { category: 'Trampolinepark', isIndoor: true },
    'rush-trampolinepark-oslo': { category: 'Trampolinepark', isIndoor: true },
    'rush-trampolinepark-bergen': { category: 'Trampolinepark', isIndoor: true },
    'rush-trampolinepark-trondheim': { category: 'Trampolinepark', isIndoor: true },
    'rush-trampolinepark-stavanger': { category: 'Trampolinepark', isIndoor: true },
    // Innendørs lekeland (5): alle inne.
    'leos-lekeland-baerum-grini': { category: 'Innendørs lekeland', isIndoor: true },
    'leos-lekeland-oslo': { category: 'Innendørs lekeland', isIndoor: true },
    'leos-lekeland-bergen': { category: 'Innendørs lekeland', isIndoor: true },
    'leos-lekeland-trondheim': { category: 'Innendørs lekeland', isIndoor: true },
    'playground-forus': { category: 'Innendørs lekeland', isIndoor: true },
    // Skøyter (1): innendørs ishall. INGEN fasett: Skøyter er en kategori, og
    // det finnes ingen skøytefasett å peke på. Et token ingen fasett leser
    // ville vært en påstand uten mottaker.
    'sormarka-arena-stavanger': { category: 'Skøyter', isIndoor: true },
    // FORNØYELSESPARK (sep. 2026). Seks rader, alle ute. Ingen fasett: det
    // finnes ingen fasett i appen som ville lest den, og kategorien sier
    // allerede hva stedet er. Målingen bak utvalget:
    // docs/fornoyelsespark-maling.md.
    'tusenfryd': { category: 'Fornøyelsespark', isIndoor: false },
    'kongeparken': { category: 'Fornøyelsespark', isIndoor: false },
    'hunderfossen-eventyrpark': { category: 'Fornøyelsespark', isIndoor: false },
    'lilleputthammer': { category: 'Fornøyelsespark', isIndoor: false },
    'foldvik-familiepark': { category: 'Fornøyelsespark', isIndoor: false },
    'mikkelparken': { category: 'Fornøyelsespark', isIndoor: false },
    // Dyreparken er både dyrepark og fornøyelsespark, og skal komme opp
    // under begge. ÉN rad, ikke to: to rader for samme port ville stått som
    // to steder på kartet, og en forelder som lagrer den ene ser ikke den
    // andre. Hovedkategorien er Dyremøte (det er det stedet ER); fasetten
    // sier at det også er en fornøyelsespark. Samme deling som Trysil
    // skisenter med fasetten aking — og samme mangel: kategorifilteret ser
    // ikke fasetter ennå.
    'dyreparken': { category: 'Dyremøte', isIndoor: false, facets: ['fornoyelsespark'] },
    // Badeland, men UTE. Badeland var «alle inne» fram til nå; is_indoor er
    // aksen som skiller Bø Sommarland fra svømmehallene, ikke kategorien.
    'bo-sommarland': { category: 'Badeland', isIndoor: false },
};

export function splitFor(
    externalId: string
): { category: string; isIndoor: boolean; facets: FacetToken[] } {
    const s = SPLIT[externalId];
    if (!s) throw new Error(`Mangler vinter-splitt-mapping for externalId="${externalId}"`);
    return { ...s, facets: s.facets ?? [] };
}

export const SOURCE = {
    slug: 'kuratert-vintertilbud',
    name: 'Kuratert: Vinter & innendørs',
    kind: 'manual' as const,
};

const KARTVERKET_UA = 'Togedoo datahub (hello@togedoo.com)';

interface VinterSeed {
    externalId: string; // stabil upsert-nøkkel
    title: string;
    description: string; // kort, kuratert
    municipality: string; // EKTE kommune (adresse/attribusjon)
    nearCity?: string; // «hjemby» når stedet ligger utenfor kommunegrensen
    address: string; // web-verifisert, geokodes mot Kartverket
    addressAlternatives?: string[];
    manualCoord?: { lat: number; lng: number }; // hopp over geokoding (f.eks. akebakke)
    coordVerified?: boolean; // false = manualCoord er OMTRENTLIG, kan finjusteres (default true)
    fallbackLat: number; // estimert — brukes hvis geokoding feiler/tvetydig
    fallbackLng: number;
    isFree: boolean | null; // true=gratis, false=betalt, null=ukjent
    priceText?: string | null;
    /**
     * Stedets egen side. VALGFRI fra sep. 2026, og fraværet er et VALG:
     * en rad uten lenke er ærligere enn en lenke til feil sted.
     *
     * Skrives som `null`, ikke tom streng — kolonnen er `url text` (nullbar,
     * migrasjon 0001), og tom streng ville vært en tredje tilstand ingen
     * leser skiller fra de to andre.
     */
    url?: string;
    targetAudience?: string; // default 'For alle'
    openingHours?: string | null;
}

export const SEED: VinterSeed[] = [
    // --- Oslo-regionen: utenfor kommunegrensen (nearCity = Oslo) ---
    {
        externalId: 'sno-lorenskog',
        title: 'SNØ Lørenskog',
        description: 'Innendørs skianlegg — alpint, langrenn, snowboard og akebakke under tak hele året, ca. 17 min fra Oslo.',
        municipality: 'Lørenskog', nearCity: 'Oslo',
        address: 'Snøfonna 5, 1470 Lørenskog',
        fallbackLat: 59.9268, fallbackLng: 10.9583,
        isFree: false, url: 'https://snooslo.no',
    },
    {
        externalId: 'jumpyard-sno-lorenskog',
        title: 'JumpYard SNØ (trampolinepark)',
        description: 'Stor innendørs trampolinepark i SNØ-anlegget på Lørenskog — hoppegroper, hinderløyper og aktiviteter for alle aldre.',
        municipality: 'Lørenskog', nearCity: 'Oslo',
        address: 'Snøfonna 5, 1470 Lørenskog',
        fallbackLat: 59.9268, fallbackLng: 10.9583,
        isFree: false, url: 'https://jumpyard.no/sno/',
    },
    {
        externalId: 'varingskollen-alpinsenter',
        title: 'Varingskollen Alpinsenter',
        description: 'Lokalt alpinsenter i Hakadal med bakker for alle nivåer og eget barneområde — 50 m fra Varingskollen stasjon.',
        municipality: 'Nittedal', nearCity: 'Oslo',
        address: 'Vargveien 21, 1488 Hakadal',
        fallbackLat: 60.1085, fallbackLng: 10.8330,
        isFree: false, url: 'https://www.varingskollen.no',
    },
    {
        externalId: 'kirkerudbakken-skisenter',
        title: 'Kirkerudbakken Skisenter',
        description: 'Asker og Bærums største alpinanlegg, ved Vøyenenga — varierte bakker, gratis barneheis og barnebakke.',
        municipality: 'Bærum', nearCity: 'Oslo',
        address: 'Borkenveien 2, 1339 Vøyenenga',
        fallbackLat: 59.9330, fallbackLng: 10.4680,
        isFree: false, url: 'https://www.skimore.no/kirkerudbakken',
    },
    {
        externalId: 'risenga-svommehall',
        title: 'Risenga svømmehall (badeland)',
        description: 'Badeland i Asker sentrum med sklier, bølgebasseng, barnebasseng, varmtvannsbasseng, stupetårn og klatrevegg.',
        municipality: 'Asker', nearCity: 'Oslo',
        address: 'Brages vei 8, 1387 Asker',
        addressAlternatives: ['Bragesvei 8, 1387 Asker'],
        fallbackLat: 59.8360, fallbackLng: 10.4350,
        isFree: false, url: 'https://svom.no/svommehall/risenga-svommehall',
    },
    {
        externalId: 'bolgen-bad-drobak',
        title: 'Bølgen bad & aktivitetssenter',
        description: 'Badeanlegg på Seiersten i Drøbak med sklier og basseng — ca. 40 min fra Oslo.',
        municipality: 'Frogn', nearCity: 'Oslo',
        address: 'Belsjøveien 2, 1443 Drøbak',
        fallbackLat: 59.6620, fallbackLng: 10.6300,
        isFree: false, url: 'https://www.bolgenbad.no',
    },
    {
        externalId: 'jessheimbadet',
        title: 'Jessheimbadet',
        description: 'Moderne badeanlegg i Jessheim med seks basseng, 41 m vannsklie og i ferier Norges største innendørs hinderløype i vann.',
        municipality: 'Ullensaker', nearCity: 'Oslo',
        address: 'Kanalvegen 100, 2069 Jessheim',
        fallbackLat: 60.1470, fallbackLng: 11.1770,
        isFree: false, url: 'https://www.jessheimbadet.no',
    },
    {
        externalId: 'leos-lekeland-baerum-grini',
        title: 'Leos Lekeland Bærum (Grini)',
        description: 'Stort innendørs lekeland i Grini Næringspark — klatring, sklier og hoppeslott for barn.',
        municipality: 'Bærum', nearCity: 'Oslo',
        address: 'Grini Næringspark 8, 1361 Østerås',
        fallbackLat: 59.9430, fallbackLng: 10.6050,
        isFree: false, url: 'https://www.leoslekeland.no/vare-lekeland/oslo/baerum',
        targetAudience: 'Barn',
    },
    // --- Inne i Oslo kommune (kun municipality, ingen nearCity) ---
    {
        externalId: 'leos-lekeland-oslo',
        title: 'Leos Lekeland Oslo',
        description: 'Innendørs lekeland med klatring, sklier og aktiviteter for barn.',
        municipality: 'Oslo',
        address: 'John G. Mattesons vei 4, 0687 Oslo',
        fallbackLat: 59.9070, fallbackLng: 10.8250,
        isFree: false, url: 'https://www.leoslekeland.no/vare-lekeland/oslo',
        targetAudience: 'Barn',
    },
    {
        externalId: 'rush-trampolinepark-oslo',
        title: 'Rush Trampolinepark Oslo',
        description: 'Norges første Rush-trampolinepark (2016) ved Rosenholm på Holmlia — trampoliner, airbag og hinderløyper.',
        municipality: 'Oslo',
        address: 'Rosenholmveien 22, 1252 Oslo',
        fallbackLat: 59.8355, fallbackLng: 10.8065,
        isFree: false, url: 'https://www.rushtrampolinepark.no/oslo',
    },
    {
        externalId: 'korketrekkeren-aking',
        // «(akebakke)» er borte: den sto der fordi kategorien var Skianlegg
        // og tittelen måtte bære motsigelsen. Nå sier kategorien det.
        title: 'Korketrekkeren',
        description: 'Oslos mest kjente akebakke — ca. 2 km fra Frognerseteren til Midtstuen. Gratis å ake; kjelke kan leies. Åpen når det er nok snø.',
        municipality: 'Oslo',
        // Akebakke uten gateadresse — manuelt verifisert startpunkt ved
        // Frognerseteren (Kartverket ville ikke gitt entydig gateadresse).
        address: 'Frognerseteren, 0791 Oslo',
        manualCoord: { lat: 59.9836, lng: 10.6790 },
        fallbackLat: 59.9836, fallbackLng: 10.6790,
        isFree: true, url: 'https://akeforeningen.no', targetAudience: 'For alle',
    },


    // --- OSLO-ALPINT (sep. 2026) --------------------------------------
    //
    // FEM RADER FOR TO OSM-RELASJONER. OSM har én relasjon per
    // DRIFTSSELSKAP — relation/2259942 «Skimore Oslo» og relation/1762278
    // «Oslo Skisenter» — men anleggene har hvert sitt startpunkt. Tryvann og
    // Wyller er 30 minutters kjøretur fra hverandre; Trollvannskleiva og
    // Grefsenkleiva har parkering i hver sin ende av åsen. Bakkene henger
    // sammen i toppen og deler heiskort, men en forelder må velge hvor hun
    // parkerer, og ett kartpunkt for to anlegg kan sende henne feil.
    //
    // Importen ga derfor to rader (bbox-senteret til hver relasjon), og de er
    // claimet i lib/osm-claims.ts slik at den slutter å lage dem. Fem claims,
    // ikke to: én per (OSM-objekt, kuratert rad).
    //
    // NAVN UTEN «SKIMORE». Det er et heiskortsystem, ikke et stedsnavn —
    // ingen sier «Skimore Tryvann». Merk at det gjør OSM-navnet
    // («Skimore Oslo») ULIKT radnavnet; det er nettopp derfor claimens
    // expectName beskriver OSM-OBJEKTET og ikke raden.
    //
    // ÉN URL PER GRUPPE, fordi det er én drift per gruppe. Tre rader deler
    // oslo.skimore.no, to deler oslo-skisenter.no.
    //
    // KOORDINATENE er manuelt verifisert i kart av Frederik, ved parkering
    // eller naturlig startpunkt — derfor manualCoord, som hopper over
    // geokodingen helt. Kommunen er ETTERPRØVD ved punkt-i-polygon mot
    // Kartverkets kommunegrenser (2024): alle fem ligger i Oslo (0301).
    // Wyller, den eneste som var i tvil, ligger ~1,9 km innenfor grensen mot
    // Bærum.
    //
    // SLUGENE ER FROSNE. external_id er upsert-nøkkelen; endres den, blir
    // radene duplisert i stedet for oppdatert (docs/nasjonal-dekning.md).
    {
        externalId: 'tryvann',
        title: 'Tryvann',
        description: 'Oslos største alpinanlegg, på Tryvann i Nordmarka — nedfarter for alle nivåer, terrengpark og barnebakke. Krever heiskort.',
        municipality: 'Oslo',
        // Ved Tryvannstårnet. Ingen gateadresse — manuelt verifisert punkt.
        address: 'Tryvannstårnet, Oslo',
        manualCoord: { lat: 59.98870, lng: 10.66812 },
        fallbackLat: 59.98870, fallbackLng: 10.66812,
        isFree: false, url: 'https://oslo.skimore.no',
    },
    {
        externalId: 'wyller',
        title: 'Wyller',
        description: 'Alpinanlegg på vestsiden av Tryvann, med egen parkering i Sørkedalen. Samme heiskort som Tryvann, men en halvtimes kjøretur unna.',
        municipality: 'Oslo',
        // Parkeringen ved Wyllerløypa. Manuelt verifisert punkt.
        address: 'Wyllerløypa, Sørkedalen, Oslo',
        manualCoord: { lat: 59.9909, lng: 10.6304 },
        fallbackLat: 59.9909, fallbackLng: 10.6304,
        isFree: false, url: 'https://oslo.skimore.no',
    },
    {
        externalId: 'tommkleiva',
        title: 'Tommkleiva',
        description: 'Nedfart ved Øvresetertjern, i samme anlegg som Tryvann. Krever heiskort.',
        municipality: 'Oslo',
        // Toppen, ved Øvresetertjern. Manuelt verifisert punkt.
        address: 'Øvresetertjern, Oslo',
        manualCoord: { lat: 59.983264, lng: 10.669012 },
        fallbackLat: 59.983264, fallbackLng: 10.669012,
        isFree: false, url: 'https://oslo.skimore.no',
    },
    {
        externalId: 'trollvannskleiva',
        title: 'Trollvannskleiva',
        description: 'Alpinbakke i Grefsenåsen, med parkering og servering ved Trollvannstua. Krever heiskort.',
        municipality: 'Oslo',
        // Bunnen, ved Trollvannstua. Manuelt verifisert punkt.
        address: 'Trollvannstua, Oslo',
        manualCoord: { lat: 59.96172, lng: 10.80608 },
        fallbackLat: 59.96172, fallbackLng: 10.80608,
        isFree: false, url: 'http://www.oslo-skisenter.no/',
    },
    {
        externalId: 'grefsenkleiva',
        title: 'Grefsenkleiva',
        description: 'Alpinbakke i sørenden av Grefsenåsen, med egen parkering mot Østreheimsveien. Samme heiskort som Trollvannskleiva, men annen atkomst.',
        municipality: 'Oslo',
        // Parkeringen mot Østreheimsveien. Manuelt verifisert punkt.
        address: 'Østreheimsveien, Oslo',
        manualCoord: { lat: 59.951768, lng: 10.814618 },
        fallbackLat: 59.951768, fallbackLng: 10.814618,
        isFree: false, url: 'http://www.oslo-skisenter.no/',
    },

    // --- HEIS UTEN UTFORLØYPE (sep. 2026) ------------------------------
    //
    // FIRE ANLEGG SOM IMPORTEN IKKE KAN TA. Den nasjonale tørrkjøringen ga
    // dem dommen `usikker-heis`: de har heis i OSM, men ingen
    // `piste:type=downhill` innenfor polygonet, og [skiVerdict] krever en
    // nedfart.
    //
    // KRAVET SKAL IKKE MYKES OPP. Uten det kommer Holmenkollen, Granåsen
    // skistadion og Linderudkollen hoppbakke inn som alpinanlegg — de har
    // også heis og ingen utforløype. Prisen er disse fire, og prisen betales
    // her, i en kuratert rad.
    //
    // ET TREDJE SIGNAL FINNES IKKE. Kolsås ble slått opp i OSM: den har bare
    // `landuse=recreation_ground`, `lit=yes`, `name` og `sport=skiing`.
    // Hverken `piste:difficulty` eller `piste:lit`. Og `sport=skiing` alene
    // er nøyaktig det Varingskollen SKISTADION (langrenn) har — altså kan
    // ikke den taggen skille dem.
    //
    // DE FINNES IKKE I BASEN FRA FØR. Til forskjell fra Oslo-seeden er det
    // ingenting å ta ned med unpublish: disse fire har aldri blitt rader.
    //
    // GRUPPERT PÅ ÅRSAK, IKKE PÅ REGION — i motsetning til resten av fila.
    // De fire deler én årsak og én kjørebok, og Gråkallparken ville vært
    // uforklarlig alene nede i Trondheim-seksjonen.
    //
    // KOORDINATENE er manuelt verifisert i kart av Frederik, ved parkering
    // eller bunnstasjon. Kommunen er ETTERPRØVD ved punkt-i-polygon mot
    // Kartverkets kommunegrenser (2024), og ingen av de fire ligger nærmere
    // en nabogrense enn 4,1 km — altså godt utenfor forenklingsfeilen i
    // L-kvaliteten.
    //
    // INGEN LENKE. `url` er utelatt med vilje: en rad uten lenke er ærligere
    // enn en lenke til feil sted. (Korketrekkeren peker i dag på
    // akeforeningen.no, som er en interesseorganisasjon og ikke bakken.)
    //
    // BESKRIVELSENE ER BEVISST TYNNE. De sier bare det som er etterprøvd —
    // hvor stedet er og at det er en alpinbakke. Antall nedfarter, barnebakke
    // og åpningstider er IKKE slått opp, og skal ikke gjettes her.
    {
        externalId: 'kolsas-skisenter',
        title: 'Kolsås Skisenter',
        description: 'Alpinbakke i Kolsåsområdet i Bærum, ca. 13 km fra Oslo sentrum.',
        // nearCity: Bærum er ikke en av appens fire by-chiper. Uten
        // near_city ville raden vært usynlig i by-modus, som matcher
        // `municipality ILIKE X OR near_city ILIKE X`. Kirkerudbakken, også
        // i Bærum og 16 km fra Oslo, har allerede nearCity 'Oslo'; Kolsås er
        // 13 km unna, altså nærmere enn presedensen.
        municipality: 'Bærum', nearCity: 'Oslo',
        address: 'Kolsåsbakken, Bærum',
        manualCoord: { lat: 59.936150, lng: 10.522875 },
        fallbackLat: 59.936150, fallbackLng: 10.522875,
        isFree: false,
    },
    {
        externalId: 'finse-skisenter',
        title: 'Finse Skisenter',
        description: 'Alpinbakke på Finse i Ulvik. Finse har ingen veiforbindelse — atkomst med Bergensbanen.',
        // INGEN nearCity, og det er det eneste stedet i denne fila der
        // avstanden alene avgjør: 122 km til Bergen sentrum og 195 km til
        // Oslo. Den lengste eksisterende nearCity-tilknytningen er 35 km
        // (Eikedalen → Bergen, Jessheimbadet → Oslo). Å kalle Finse en
        // «nærliggende utflukt» fra Bergen ville vært feil, og uten
        // veiforbindelse er det ikke engang en kjøretur.
        //
        // FØLGEN, som er ekte: raden er ikke synlig i noen av appens fire
        // by-chiper. Den finnes i radius-modus og for en kommune-filtrering
        // som ikke finnes i appen ennå. Det er det samme som vil gjelde de
        // tusen importerte radene utenfor de fire byene.
        municipality: 'Ulvik',
        address: 'Finse, 5719 Finse',
        manualCoord: { lat: 60.603992, lng: 7.503743 },
        fallbackLat: 60.603992, fallbackLng: 7.503743,
        isFree: false,
    },
    {
        externalId: 'ringkollen',
        title: 'Ringkollen',
        description: 'Alpinbakke på Ringkollen i Ringerike, ca. 35 km fra Oslo sentrum.',
        // Samme avstand til Oslo som Jessheimbadet (35 km) og samme avstand
        // som Eikedalen har til Bergen — altså innenfor presedensen for
        // nearCity, og Ringerike er ingen by-chip.
        municipality: 'Ringerike', nearCity: 'Oslo',
        address: 'Ringkollen, Ringerike',
        manualCoord: { lat: 60.166439, lng: 10.387994 },
        fallbackLat: 60.166439, fallbackLng: 10.387994,
        isFree: false,
    },
    {
        externalId: 'grakallparken',
        title: 'Gråkallparken',
        description: 'Alpinbakke i Gråkallen-området vest for Trondheim sentrum.',
        // Ligger I Trondheim kommune, altså ingen nearCity — samme regel som
        // Pirbadet og de fem Oslo-anleggene.
        municipality: 'Trondheim',
        address: 'Gråkallen, Trondheim',
        manualCoord: { lat: 63.415211, lng: 10.266573 },
        fallbackLat: 63.415211, fallbackLng: 10.266573,
        isFree: false,
    },

    // ================= STORANLEGG (sep. 2026) =================
    // Importen ga disse tre bbox-senteret til OSM-polygonet: 658 moh. i
    // skogen på Voss, 861 moh. midt i Trysilfjellet, og 430 m utenfor begge
    // ringene på Geilo. Punktet her er basen en familie uten lokalkunnskap
    // bør reise til; de andre basene står i beskrivelsen. Kandidatene og
    // målingen bak valget: docs/skianlegg-adkomst.md.
    //
    // HVER RAD EIER FLERE OSM-OBJEKTER — anleggspolygonet og de navngitte
    // delene inni (Alphapark, «child ski area», Geilolia og Geilo-ringene).
    // Se lib/osm-claims.ts.
    //
    // Ingen nearCity: anleggene ligger i sin egen kommune, samme regel som
    // Gråkallparken og Oslo-anleggene.
    {
        externalId: 'voss-resort',
        title: 'Voss Resort',
        description:
            'Stort alpinanlegg med gondol fra Voss sentrum, like ved jernbanestasjonen. ' +
            'Kommer dere med bil, kan dere også starte i Bavallen, der det er parkering og billettsalg, ' +
            'eller på Tråstølen, som også har parkering.',
        municipality: 'Voss',
        // Dalstasjonen til Voss Gondol (OSM way/675982736), 60 m fra Voss stasjon.
        address: 'Voss Gondol, Voss sentrum',
        manualCoord: { lat: 60.62919, lng: 6.41115 },
        fallbackLat: 60.62919, fallbackLng: 6.41115,
        isFree: false, url: 'https://vossresort.no/no/vinter/',
    },
    {
        externalId: 'trysil-skisenter',
        title: 'Trysil skisenter',
        description:
            'Stort alpinanlegg i Trysilfjellet. Gondolen går fra Turistsenteret. ' +
            'Høyfjellsenteret har eget barneområde og Familietrekket, og Skihytta og Høgegga er egne innganger til bakkene.',
        municipality: 'Trysil',
        // Dalstasjonen til Trysilgondolen (OSM way/1385891650).
        address: 'Turistsenteret, Trysil',
        manualCoord: { lat: 61.31111, lng: 12.24674 },
        fallbackLat: 61.31111, fallbackLng: 12.24674,
        isFree: false, url: 'https://www.skistar.com/no/vare-skisteder/trysil/vinter-i-trysil/',
    },
    {
        externalId: 'skigeilo',
        title: 'SkiGeilo',
        description:
            'Skianlegg på begge sider av Geilo, med heis rett fra sentrum. ' +
            'Slaatta ligger også ved sentrum, og Vestlia, Kikut og Havsdalen har egne parkeringer.',
        municipality: 'Hol',
        // Dalstasjonen til Geiloheisen Express (OSM way/31468685), ved Hegnavegen.
        address: 'Geiloheisen, Geilo sentrum',
        manualCoord: { lat: 60.53463, lng: 8.19813 },
        fallbackLat: 60.53463, fallbackLng: 8.19813,
        isFree: false, url: 'https://www.skigeilo.no/',
    },

    // --- FORNØYELSESPARKER (sep. 2026) --------------------------------
    //
    // Åtte parker fra målingen i docs/fornoyelsespark-maling.md: seks under
    // Fornøyelsespark, Dyreparken under Dyremøte med fasett, og Bø Sommarland
    // under Badeland (ute). tourism=theme_park i OSM gir 24 treff, og
    // halvparten er klatreparker, museer og feiltagging — derfor kuratert.
    //
    // PUNKTET ER HOVEDINNGANGEN fra OSM (entrance=main), ikke polygonets
    // midtpunkt, som ligger 100–270 m inne i parken. OSM-noden står i
    // kommentaren over hver manualCoord. To unntak:
    //   - Lilleputthammer har bare entrance=yes. Valgt: den ene av tre som
    //     ligger på selve parkgrensen og ytre gjerde, 45 m fra
    //     kundeparkeringen. De to andre sitter på et indre gjerde.
    //   - Mikkelparken har INGEN inngang i OSM. Punktet er på parkgrensen
    //     nærmest kundeparkeringen (access=customers, 70 plasser). OMTRENTLIG
    //     — coordVerified:false, Frederik kontrollerer.
    //
    // BESKRIVELSENE sier hva stedet er og hvem det passer for. Ingen priser,
    // datoer, åpningstider, høydegrenser, antall eller superlativer: alt det
    // endrer seg hver sesong, og parkens egen side (url) er fasiten.
    //
    // Kommunen er Kartverkets (kommuneinfo /punkt) for inngangspunktet.
    {
        externalId: 'tusenfryd',
        // Parken skriver navnet «TusenFryd» (tusenfryd.no, og.site_name).
        title: 'TusenFryd',
        description:
            'Fornøyelsespark på Vinterbro sør for Oslo, med karuseller og berg-og-dal-baner for både små og store barn, ' +
            'og et eget badeland i parken.',
        municipality: 'Ås', nearCity: 'Oslo',
        // Hovedinngangen, OSM node/7687702285 (entrance=main).
        address: 'Hovedinngangen, Fryds vei, 1407 Vinterbro',
        manualCoord: { lat: 59.74797, lng: 10.7758 },
        fallbackLat: 59.74797, fallbackLng: 10.7758,
        isFree: false, url: 'https://www.tusenfryd.no/',
    },
    {
        externalId: 'kongeparken',
        title: 'Kongeparken',
        description:
            'Fornøyelsespark på Ålgård med karuseller, berg-og-dal-baner og egne områder for de minste.',
        municipality: 'Gjesdal', nearCity: 'Stavanger',
        // Hovedinngangen, OSM node/686254300 (entrance=main, barrier=gate).
        address: 'Hovedinngangen, Kongsgata 20, 4331 Ålgård',
        manualCoord: { lat: 58.77875, lng: 5.84046 },
        fallbackLat: 58.77875, fallbackLng: 5.84046,
        isFree: false, url: 'https://www.kongeparken.no/',
    },
    {
        externalId: 'hunderfossen-eventyrpark',
        // OSM heter den fortsatt «Hunderfossen Familiepark»; parken selv
        // kaller seg Hunderfossen Eventyrpark (hunderfossen.no).
        title: 'Hunderfossen Eventyrpark',
        description:
            'Familiepark nord for Lillehammer med troll, eventyr og karuseller, og aktiviteter for både små og store barn.',
        municipality: 'Lillehammer',
        // Hovedinngangen, OSM node/2794927148 (entrance=main), ved parkeringen.
        address: 'Hovedinngangen, Fossekrovegen 22, 2625 Fåberg',
        manualCoord: { lat: 61.22579, lng: 10.43579 },
        fallbackLat: 61.22579, fallbackLng: 10.43579,
        isFree: false, url: 'https://hunderfossen.no/',
    },
    {
        externalId: 'lilleputthammer',
        title: 'Lilleputthammer',
        description:
            'Familiepark for de minste i Hafjell, med Lillehammer bygget i barnestørrelse og karuseller for små barn.',
        municipality: 'Øyer',
        // OSM node/2786099980 (entrance=yes). Eneste av tre innganger som
        // ligger på parkgrensen og ytre gjerde (way/273798857); de to andre
        // sitter på et indre gjerde. 45 m fra kundeparkeringen.
        address: 'Inngangen, Hundervegen 41, 2636 Øyer',
        manualCoord: { lat: 61.238928, lng: 10.439116 },
        fallbackLat: 61.238928, fallbackLng: 10.439116,
        isFree: false, url: 'https://lilleputthammer.no/',
        targetAudience: 'Barn',
    },
    {
        externalId: 'foldvik-familiepark',
        title: 'Foldvik Familiepark',
        description:
            'Familiepark i Brunlanes med dyr å hilse på, minibiler, lekeområder og aktiviteter for barn.',
        municipality: 'Larvik',
        // Hovedinngangen, OSM node/6542382397 (entrance=main).
        address: 'Hovedinngangen, Foldvikveien, 3294 Stavern',
        manualCoord: { lat: 59.00216, lng: 9.97083 },
        fallbackLat: 59.00216, fallbackLng: 9.97083,
        isFree: false, url: 'https://foldvik.no/',
    },
    {
        externalId: 'mikkelparken',
        title: 'Mikkelparken',
        description:
            'Familiepark i Kinsarvik for barn, med vannsklier, lekeområder og aktiviteter ute.',
        municipality: 'Ullensvang',
        // INGEN inngang i OSM, bare polygonet (way/120864609). Punktet er på
        // parkgrensen nærmest kundeparkeringen (way/131565985,
        // access=customers). OMTRENTLIG: Frederik kontrollerer.
        address: 'Ved Kinsarvikvegen, 5780 Kinsarvik',
        manualCoord: { lat: 60.37666, lng: 6.72607 },
        coordVerified: false,
        fallbackLat: 60.37666, fallbackLng: 6.72607,
        isFree: false, url: 'https://mikkelparken.no/',
        targetAudience: 'Barn',
    },
    {
        externalId: 'dyreparken',
        // Parken kaller seg «Dyreparken» (dyreparken.no); OSM-navnet er
        // «Kristiansand Dyrepark». Kristiansand står i municipality.
        title: 'Dyreparken',
        description:
            'Dyrepark og fornøyelsespark øst for Kristiansand, med dyr fra hele verden, Kardemomme by og eget badeland.',
        municipality: 'Kristiansand',
        // «Byporten», OSM node/1257106325 (entrance=main).
        address: 'Byporten, Dyreparkveien, 4636 Kristiansand',
        manualCoord: { lat: 58.18709, lng: 8.14012 },
        fallbackLat: 58.18709, fallbackLng: 8.14012,
        isFree: false, url: 'https://www.dyreparken.no/',
    },
    {
        externalId: 'bo-sommarland',
        title: 'Bø Sommarland',
        description:
            'Vannpark ute i Bø i Telemark, med vannsklier, basseng og egne områder for de minste.',
        municipality: 'Midt-Telemark',
        // Hovedinngangen, OSM node/3131762432 (entrance=main, turnstile).
        address: 'Hovedinngangen, Steintjønnvegen 2, 3804 Bø i Telemark',
        manualCoord: { lat: 59.4468, lng: 9.07352 },
        fallbackLat: 59.4468, fallbackLng: 9.07352,
        isFree: false, url: 'https://www.sommarland.no/',
    },

    // ================= BERGEN =================
    {
        externalId: 'ado-arena-bergen',
        title: 'AdO arena',
        description: 'Badeanlegg i Bergen sentrum med sklier (26 m og 68 m), stupetårn og barnebasseng.',
        municipality: 'Bergen',
        address: 'Lungegårdskaien 40, 5015 Bergen',
        fallbackLat: 60.3830, fallbackLng: 5.3390,
        isFree: false, priceText: 'Barn 50 kr', url: 'https://adoarena.no',
    },
    {
        externalId: 'vannkanten-badeland-loddefjord',
        title: 'Vannkanten Badeland',
        description: 'Bergens største badeland i Vestkanten Storsenter, Loddefjord — Norges lengste innendørs sklie (120 m).',
        municipality: 'Bergen',
        // Primær fra Brønnøysundregistrene/180.no; Apple Maps-adressen som
        // fallback (samme mønster som EKT/Risenga).
        address: 'Loddefjordveien 2, 5171 Loddefjord',
        addressAlternatives: ['Lyderhornsveien 351, 5171 Loddefjord'],
        fallbackLat: 60.3648, fallbackLng: 5.2345,
        isFree: false, url: 'https://svom.no/bad/bergen/vannkanten-badeland',
    },
    {
        externalId: 'rush-trampolinepark-bergen',
        title: 'Rush Trampolinepark Bergen',
        description: 'Stor innendørs trampolinepark på Kokstad — hoppegroper, hinderløyper og aktiviteter for alle aldre.',
        municipality: 'Bergen',
        // Offisielle kilder (Brønnøysund/1881/Rush) bruker «-vegen»; behold
        // «-veien»-skrivemåten som fallback.
        address: 'Kokstadvegen 23, 5257 Kokstad',
        addressAlternatives: ['Kokstadveien 23, 5257 Kokstad'],
        fallbackLat: 60.2900, fallbackLng: 5.2580,
        isFree: false, url: 'https://www.rushtrampolinepark.no/bergen',
    },
    {
        externalId: 'leos-lekeland-bergen',
        title: 'Leos Lekeland Bergen',
        description: 'Innendørs lekeland på Kokstad — klatring, sklier, ballhav og hoppeslott for barn.',
        municipality: 'Bergen',
        address: 'Kokstaddalen 18, 5257 Kokstad',
        fallbackLat: 60.2890, fallbackLng: 5.2560,
        isFree: false, url: 'https://www.leoslekeland.no/', targetAudience: 'Barn',
    },
    {
        externalId: 'eikedalen-skisenter',
        title: 'Eikedalen Skisenter',
        description: 'Familievennlig alpinanlegg ved Kvamskogen (8 heiser, 12 løyper), ca. 1 t fra Bergen.',
        municipality: 'Samnanger', nearCity: 'Bergen',
        address: 'Kråvegen 108, 5650 Tysse',
        fallbackLat: 60.4000, fallbackLng: 5.9600,
        isFree: false, url: 'https://www.eikedalen.no/',
    },

    // ================= TRONDHEIM =================
    {
        externalId: 'pirbadet-trondheim',
        title: 'Pirbadet',
        description: 'Trondheims store innendørs badeland på Brattøra — basseng, sklier, boblebad og barneområde.',
        municipality: 'Trondheim',
        address: 'Havnegata 12, 7010 Trondheim',
        fallbackLat: 63.4370, fallbackLng: 10.3980,
        isFree: false, url: 'https://pirbadet.no',
    },
    {
        externalId: 'rush-trampolinepark-trondheim',
        title: 'Rush Trampolinepark Trondheim',
        description: 'Innendørs aktivitetspark på Tiller — trampoliner, airbag, skumgroper og hinderløyper.',
        municipality: 'Trondheim',
        // FLAGG: drives som «Rush Trampolinepark Trondheim» (Instagram
        // @rushtrondheim, BarnasNorge, Moovit) på Østre Rosten 20, men står
        // IKKE på rushtrampolinepark.no sin offisielle avdelingsliste — kan
        // være franchise eller nedlagt. VERIFISER at den er åpen før
        // publisering. URL peker til hovedsiden (/trondheim finnes trolig ikke).
        address: 'Østre Rosten 20, 7075 Tiller',
        fallbackLat: 63.3580, fallbackLng: 10.3770,
        isFree: false, url: 'https://www.rushtrampolinepark.no/',
    },
    {
        externalId: 'leos-lekeland-trondheim',
        title: 'Leos Lekeland Trondheim',
        description: 'Innendørs lekeland på Lade — klatrestativ, ballhav, tunneler, trampoliner og sklier.',
        municipality: 'Trondheim',
        // Kilder oppgir både Ladebekken 6 og 3 — bruker 6, med 3 som fallback.
        address: 'Ladebekken 6, 7041 Trondheim',
        addressAlternatives: ['Ladebekken 3, 7041 Trondheim'],
        fallbackLat: 63.4420, fallbackLng: 10.4300,
        isFree: false, url: 'https://www.leoslekeland.no/', targetAudience: 'Barn',
    },
    {
        externalId: 'vassfjellet-skisenter',
        title: 'Vassfjellet Skisenter',
        description: 'Familievennlig alpinanlegg (12 løyper, barneheis, skiskole) ca. 40 min sør for Trondheim.',
        municipality: 'Melhus', nearCity: 'Trondheim',
        // Ingen gateadresse finnes for anlegget. manualCoord er OMTRENTLIG
        // (~1–2 km — godt nok for et alpinsenter med stort areal).
        // coordVerified:false markerer at koordinaten kan finjusteres senere.
        address: 'Vassfjellet, 7224 Melhus',
        manualCoord: { lat: 63.2930, lng: 10.3690 },
        coordVerified: false,
        fallbackLat: 63.2930, fallbackLng: 10.3690,
        isFree: false, url: 'https://vassfjellet.no/',
    },

    // ================= STAVANGER =================
    {
        externalId: 'stavanger-svommehall',
        title: 'Stavanger svømmehall',
        description: 'Svømmehall i Stavanger sentrum med 25 m-basseng, barnebasseng og plaskebasseng.',
        municipality: 'Stavanger',
        address: 'Lars Hertervigs gate 4, 4005 Stavanger',
        fallbackLat: 58.9680, fallbackLng: 5.7350,
        isFree: false, url: 'https://www.stavanger.kommune.no/kultur-og-fritid/svommehaller/stavanger-svommehall2/',
    },
    {
        // KORRIGERT: Lagerveien 2 er 4033 Stavanger (Forus/Stavanger-siden) →
        // ligger I Stavanger kommune, så INGEN near_city (ville gitt feil
        // «· nær Stavanger»-merke).
        externalId: 'playground-forus',
        title: 'Playground',
        description: 'Norges/regionens største innendørs aktivitetspark (3 500 m²) på Forus — klatring, trampoliner, nettpark, skate.',
        municipality: 'Stavanger',
        address: 'Lagerveien 2, 4033 Stavanger',
        fallbackLat: 58.9130, fallbackLng: 5.7170,
        isFree: false, url: 'https://playground.no/',
    },
    {
        // KORRIGERT: Lagerveien 13 er 4033 Stavanger → I Stavanger kommune,
        // ingen near_city.
        externalId: 'rush-trampolinepark-stavanger',
        title: 'Rush Trampolinepark Stavanger',
        description: 'Stor innendørs trampolinepark på Forus — trampoliner, airbag, hinderløyper.',
        municipality: 'Stavanger',
        address: 'Lagerveien 13, 4033 Stavanger',
        fallbackLat: 58.9120, fallbackLng: 5.7160,
        isFree: false, url: 'https://www.rushtrampolinepark.no/',
    },
    {
        externalId: 'austratt-svommehall-sandnes',
        title: 'Austrått svømmehall',
        description: 'Svømmehall i Sandnes med basseng for hele familien.',
        municipality: 'Sandnes', nearCity: 'Stavanger',
        address: 'Kjervastadveien 2, 4325 Sandnes',
        fallbackLat: 58.8420, fallbackLng: 5.7450,
        isFree: false, priceText: 'Barn under 10 gratis',
        url: 'https://www.sandnes.kommune.no/sti/idrett-park-og-friluftsliv/svommehaller/austratt-svommehall/',
    },
    {
        // KORRIGERT: Sørmarkveien 20 er 4019 Stavanger → I Stavanger kommune,
        // ingen near_city.
        externalId: 'sormarka-arena-stavanger',
        title: 'Sørmarka Arena',
        description: 'Innendørs skøytehall og flerbrukshall med 17 m klatrevegg, ved Sørmarka.',
        municipality: 'Stavanger',
        address: 'Sørmarkveien 20, 4019 Stavanger',
        fallbackLat: 58.9260, fallbackLng: 5.7420,
        isFree: false, url: 'https://www.sormarka-arena.no/',
    },
];

interface GeoResult {
    lat?: number;
    lng?: number;
    total: number;
    verified: boolean;
    note: string;
}

// Forover-geokoding mot Kartverket (samme API/UA/retry-filosofi som
// seed-dyremote; /sok, fuzzy=false for presisjon).
async function geocode(address: string): Promise<GeoResult> {
    const params = new URLSearchParams({ sok: address, fuzzy: 'false', treffPerSide: '5' });
    const url = `https://ws.geonorge.no/adresser/v1/sok?${params}`;
    const TIMEOUT_MS = Number(process.env.KARTVERKET_TIMEOUT_MS ?? 8000);
    const BACKOFFS_MS = [2000, 4000];

    let res: Response | null = null;
    let transient = '';
    for (let attempt = 0; ; attempt++) {
        try {
            res = await fetch(url, { headers: { 'User-Agent': KARTVERKET_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
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
                return { total: 0, verified: false, note: `geokoding feilet: HTTP ${res.status}` };
            }
            transient = `HTTP ${res.status}`;
        }
        if (attempt >= BACKOFFS_MS.length) {
            return { total: 0, verified: false, note: `geokoding utilgjengelig: ${transient}` };
        }
        await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt]));
    }

    const data = await res!.json();
    const total: number = data?.metadata?.totaltAntallTreff ?? (data?.adresser?.length ?? 0);
    const hit = data?.adresser?.[0];
    const p = hit?.representasjonspunkt;
    if (!hit || typeof p?.lat !== 'number' || typeof p?.lon !== 'number') {
        return { total, verified: false, note: total > 1 ? `tvetydig (${total} treff)` : 'ingen treff' };
    }
    if (total === 1) {
        return { lat: p.lat, lng: p.lon, total, verified: true, note: `entydig: ${hit.adressetekst}` };
    }
    return { lat: p.lat, lng: p.lon, total, verified: false, note: `tvetydig (${total} treff), topp: ${hit.adressetekst}` };
}

/** Seed-entry → rad. Eksportert kun for test: url-null-kontrakten kan ikke
 *  etterprøves gjennom SEED alene. */
export function toRow(seed: VinterSeed, sourceId: string, lat: number, lng: number, verified: boolean) {
    return {
        source_id: sourceId,
        external_id: seed.externalId,
        kind: 'place',
        title: seed.title,
        description: seed.description,
        category: splitFor(seed.externalId).category,
        is_indoor: splitFor(seed.externalId).isIndoor,
        facets: splitFor(seed.externalId).facets,
        target_audience: seed.targetAudience ?? 'For alle',
        address: seed.address,
        municipality: seed.municipality,
        near_city: seed.nearCity ?? null,
        lat,
        lng,
        is_free: seed.isFree,
        price_text: seed.priceText ?? null,
        url: seed.url ?? null,
        opening_hours: seed.openingHours ?? null,
        status: verified ? 'published' : 'pending',
    };
}

/**
 * `--only=a,b,c`: bare disse radene geokodes, vises og skrives.
 *
 * HVORFOR DEN FINNES. Uten den upserter en kjøring HELE seeden og geokoder
 * hver adresse på nytt mot Kartverket. Et tvetydig svar den dagen gjør en
 * rad som er published i dag til 'pending' — en endring på rader ingen ba om
 * å røre. Når en runde skal legge til tre rader, skal den skrive tre rader.
 *
 * Vaktene (splitFor, assertClaimsResolve) kjører fortsatt over HELE seeden:
 * utvalget begrenser skrivingen, ikke kontrollen.
 */
export function velgUtvalg<T extends { externalId: string }>(seed: readonly T[], only: string | undefined): T[] {
    if (only === undefined) return [...seed];
    const onsket = only.split(',').map((s) => s.trim()).filter(Boolean);
    if (!onsket.length) throw new Error('--only= er tom.');
    const ukjent = onsket.filter((id) => !seed.some((s) => s.externalId === id));
    if (ukjent.length) throw new Error(`--only: ukjent externalId: ${ukjent.join(', ')}`);
    return seed.filter((s) => onsket.includes(s.externalId));
}

/**
 * Ukjente flagg STOPPER kjøringen. Før --only fantes, var et ignorert flagg
 * ufarlig; nå ville en skrivefeil som `--onli=` gitt en full upsert av hele
 * seeden i stillhet. Samme regel som parseArgs i import-places.ts.
 */
export function ukjenteFlagg(args: readonly string[]): string[] {
    return args.filter((a) => !(a === '--dry-run' || a === '--no-geocode' || a.startsWith('--only=')));
}

async function main() {
    const ukjente = ukjenteFlagg(process.argv.slice(2));
    if (ukjente.length) throw new Error(`Ukjent argument: ${ukjente.join(', ')}. Gyldige: --dry-run --no-geocode --only=a,b`);
    const dryRun = process.argv.includes('--dry-run');
    const noGeocode = process.argv.includes('--no-geocode');
    const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

    // EIERSKAP: noen av disse radene eier et OSM-objekt, så importen ikke
    // lager en rad ved siden av (lib/osm-claims.ts). Claimen peker på
    // externalId her; døpes et entry om eller slettes uten at claimen
    // følger med, undertrykker importen et OSM-objekt til fordel for en rad
    // som ikke finnes — og stedet forsvinner helt fra appen, i stillhet.
    // Kastes hardt, og fanges i --dry-run, som splitFor().
    assertClaimsResolve(SOURCE.slug, SEED.map((s) => s.externalId));
    for (const s of SEED) splitFor(s.externalId);
    const utvalg = velgUtvalg(SEED, only);
    if (only !== undefined) console.log(`--only: ${utvalg.length} av ${SEED.length} rader: ${utvalg.map((s) => s.externalId).join(', ')}\n`);

    const resolved: { seed: VinterSeed; lat: number; lng: number; verified: boolean; note: string }[] = [];
    const warnings: string[] = [];
    for (const seed of utvalg) {
        let lat = seed.fallbackLat;
        let lng = seed.fallbackLng;
        let verified = false;
        let note = 'estimert (--no-geocode)';
        let usedAddress = seed.address;
        if (seed.manualCoord) {
            lat = seed.manualCoord.lat;
            lng = seed.manualCoord.lng;
            // Publiseres uansett (koordinat finnes), men coordVerified:false
            // markerer at den er omtrentlig og kan finjusteres senere.
            verified = true;
            if (seed.coordVerified === false) {
                note = 'manualCoord OMTRENTLIG (coordVerified:false — finjuster senere)';
                warnings.push(`  ⚠ ${seed.title} — omtrentlig koordinat (coordVerified:false), finjuster senere`);
            } else {
                note = 'manuelt verifisert';
            }
        } else if (!noGeocode) {
            const candidates = [seed.address, ...(seed.addressAlternatives ?? [])];
            let best: { geo: GeoResult; addr: string } | null = null;
            for (const addr of candidates) {
                const geo = await geocode(addr);
                await new Promise((r) => setTimeout(r, 300));
                if (
                    !best ||
                    (geo.verified && !best.geo.verified) ||
                    (typeof geo.lat === 'number' && best.geo.lat == null)
                ) {
                    best = { geo, addr };
                }
                if (geo.verified) break;
            }
            const geo = best!.geo;
            usedAddress = best!.addr;
            note = candidates.length > 1 ? `${geo.note} [${usedAddress}]` : geo.note;
            if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
                lat = geo.lat;
                lng = geo.lng;
            }
            verified = geo.verified;
            if (!verified) warnings.push(`  ⚠ ${seed.title} — ${usedAddress}: ${note}`);
        }
        resolved.push({ seed, lat, lng, verified, note });
    }

    const verifiedCount = resolved.filter((r) => r.verified).length;
    console.log(`Vinter-splitt-seed: ${utvalg.length} steder — ${verifiedCount} entydig geokodet (published), ${utvalg.length - verifiedCount} pending.\n`);

    // Fordelings-rapport (verifiser 6/8/5/5/1 FØR ekte kjøring).
    const dist = new Map<string, { total: number; inne: number; ute: number }>();
    for (const r of resolved) {
        const s = splitFor(r.seed.externalId);
        const d = dist.get(s.category) ?? { total: 0, inne: 0, ute: 0 };
        d.total += 1;
        s.isIndoor ? (d.inne += 1) : (d.ute += 1);
        dist.set(s.category, d);
    }
    console.log('Kategori-fordeling (forventet 6/8/5/5/1):');
    for (const [cat, d] of dist) {
        console.log(`  ${cat.padEnd(20)} ${String(d.total).padStart(2)}  (inne ${d.inne}, ute ${d.ute})`);
    }
    const totalMapped = [...dist.values()].reduce((a, d) => a + d.total, 0);
    console.log(`  ${'SUM'.padEnd(20)} ${String(totalMapped).padStart(2)}${totalMapped === utvalg.length ? '' : '  ⚠ AVVIK fra ' + utvalg.length}\n`);
    for (const r of resolved) {
        const homeCity = r.seed.nearCity ? `→${r.seed.nearCity}` : '   ';
        console.log(
            `  [${r.verified ? 'PUBLISHED' : 'pending  '}] ${r.seed.municipality.padEnd(11)}${homeCity} ` +
                `${r.seed.title.padEnd(36)} ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}  (${r.note})`
        );
    }
    if (warnings.length) {
        console.log(`\nTrenger bekreftelse (${warnings.length}):`);
        warnings.forEach((w) => console.log(w));
    }

    if (dryRun) {
        console.log('\n[dry-run] Ingen skriving.');
        return;
    }
    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');

    const db = supabaseAdmin();

    const { data: source, error: sourceError } = await db
        .from('sources')
        .upsert({ slug: SOURCE.slug, name: SOURCE.name, kind: SOURCE.kind, active: true }, { onConflict: 'slug' })
        .select('id')
        .single();
    if (sourceError || !source) throw new Error(`Kunne ikke sikre kilden: ${sourceError?.message}`);

    const { data: lockedRows, error: lockedError } = await db
        .from('activities')
        .select('external_id')
        .eq('source_id', source.id)
        .eq('locked', true);
    if (lockedError) throw new Error(`Oppslag av låste rader feilet: ${lockedError.message}`);
    const locked = new Set((lockedRows ?? []).map((r) => r.external_id));

    const rows = resolved
        .filter((r) => !locked.has(r.seed.externalId))
        .map((r) => toRow(r.seed, source.id, r.lat, r.lng, r.verified));
    if (locked.size) console.log(`\nHopper over ${resolved.length - rows.length} låste rader.`);

    const { error } = await db.from('activities').upsert(rows, { onConflict: 'source_id,external_id' });
    if (error) throw new Error(`Upsert feilet: ${error.message}`);

    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${rows.length} vinter/innendørs-steder (${verifiedCount} geokodet)` })
        .eq('id', source.id);

    console.log(`\nFerdig: upsertet ${rows.length} steder (vinter-splitt: Skianlegg/Aking/Badeland/Trampolinepark/Innendørs lekeland/Skøyter).`);
}

// Samme vakt som i import-places.ts: modulen skal kunne IMPORTERES uten å
// kjøre seeden. Uten den kunne ingen test lese SEED — og det er nettopp
// koblingen mellom SEED og claim-lista i lib/osm-claims.ts som er verdt å
// vokte i CI framfor å oppdage i en --dry-run.
const isDirectRun = process.argv[1]?.endsWith('seed-vintertilbud.ts');
if (isDirectRun) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
