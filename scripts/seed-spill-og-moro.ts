// scripts/seed-spill-og-moro.ts
//
// Kuratert seed for kategorien Spill og moro (sep. 2026): lasertag, escape
// room, gokart, minigolf, bowling og spillehall. Pulje 1 er stedene som besto
// kontrollen mot egen nettside i docs/spill-og-moro-pulje-1.md (på grenen
// claude/spill-og-aktivitet-maling til den er merget), pluss tre fra
// ventelista (Harald Huysman Karting, Lucky Duck, Underground Golf).
//
//   npx tsx scripts/seed-spill-og-moro.ts --dry-run --only=a,b   (vis radene, ingen skriving)
//   npx tsx scripts/seed-spill-og-moro.ts --only=a,b             (upsert)
//   npx tsx scripts/seed-spill-og-moro.ts --nedtak --dry-run     (vis OSM-radene som skal ned)
//   npx tsx scripts/seed-spill-og-moro.ts --nedtak               (ta dem ned: rejected + locked)
//
// Krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. --dry-run LESER basen
// (kilden, eksisterende rader, nedtakslista), men skriver aldri.
//
// EGEN KILDE: kuratert-spill-og-moro. Radene kunne ligget under
// kuratert-vintertilbud, men den kilden heter noe den ikke er, og en kilde
// per kuratert område gjør at hvert område kan settes på pause
// (sources.active) og har sin egen last_sync_status.
//
// PUNKTENE er satt for hånd fra OSM (adressenoden til adressen stedet selv
// oppgir, eller en inngangsnode), aldri geokodet ved kjøring. Da gjør ikke
// seeden noe kall til Kartverket, og et tvetydig geokodingssvar kan ikke gjøre
// en rad 'pending'. Kilden til hvert punkt står i `punktKilde`.
//
// BESKRIVELSENE følger reglene: ingen priser, datoer, åpningstider, antall
// eller superlativer. Aldersgrense på kveldstid sies uten tall og klokkeslett,
// med «sjekk med stedet». Ordet for aktiviteten står i teksten, fordi
// fritekstsøket (q) ikke leser fasettene. [beskrivelsesbrudd] vokter reglene.
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';
import { SPILL_OG_MORO, type FacetToken } from '../lib/facets';
import { assertClaimsResolve } from '../lib/osm-claims';
import { velgUtvalg } from './seed-vintertilbud';

export const SOURCE = {
    slug: 'kuratert-spill-og-moro',
    name: 'Kuratert: Spill og moro',
    kind: 'manual' as const,
};

export interface SpillSeed {
    externalId: string;
    /** Slik stedet selv skriver navnet (sidetittel eller liste over avdelinger). */
    title: string;
    description: string;
    category: string;
    isIndoor: boolean;
    facets: FacetToken[];
    municipality: string;
    /** Adressen stedet oppgir på egen nettside. */
    address: string;
    point: { lat: number; lng: number };
    /** Hvor punktet kommer fra, for neste person. */
    punktKilde: string;
    /** false = punktet er ikke stedets inngang eller adresse, kan finjusteres. */
    coordVerified: boolean;
    isFree: boolean | null;
    url: string;
    /** Nettsiden(e) som ble lest i kontrollen, og datoen. */
    kontrollert: string;
    targetAudience?: string;
}

const KONTROLL = '19.09.2026';

export const SEED: SpillSeed[] = [
    // --- LASERTAG -------------------------------------------------------
    {
        externalId: 'megazone-oslo',
        title: 'Megazone Oslo',
        description: 'Lasertag i labyrinter midt i Oslo sentrum, med escape-spill i samme hus.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['lasertag', 'escaperom'],
        municipality: 'Oslo',
        address: 'Mariboes gate 2, 0179 Oslo',
        // Siden sier «inngang vis a vis Rockefeller». Ingen av de tre
        // inngangsnodene i nærheten er knyttet til Megazone i OSM.
        point: { lat: 59.91612, lng: 10.74927 },
        punktKilde: 'OSM-POI node/4736654480',
        coordVerified: false,
        isFree: false,
        url: 'https://megazone.no/',
        kontrollert: `megazone.no/, /sporsmal-og-svar/, /kontakt/, /laserspill — ${KONTROLL}`,
    },
    {
        externalId: 'megazone-bergen',
        title: 'Megazone Bergen',
        description: 'Lasertag i Bergen, i samme hus som Fangene på Fortet.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['lasertag'],
        municipality: 'Bergen',
        address: 'Michael Krohns gate 86, 5057 Bergen',
        // Samme adresse som Fangene på Fortet Bergen. Samme punkt med vilje:
        // to tilbud i samme hus, ingen oppdiktet forskyvning.
        point: { lat: 60.381463, lng: 5.317511 },
        punktKilde: 'OSM-adressenode node/3126102168 (Michael Krohns gate 86)',
        coordVerified: true,
        isFree: null,
        url: 'https://bergen.megazone.no/',
        kontrollert: `bergen.megazone.no/, /kontakt/, /sporsmalogsvar/ — ${KONTROLL}`,
    },
    // --- ESCAPE ROOM: FANGENE PÅ FORTET ---------------------------------
    {
        externalId: 'fangene-pa-fortet-oslo',
        title: 'Fangene på Fortet Oslo',
        description:
            'Escape room-inspirert lagaktivitet i Nydalen, der laget går fra celle til celle og løser oppgaver.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['escaperom'],
        municipality: 'Oslo',
        address: 'Nydalsveien 28, 0484 Oslo',
        point: { lat: 59.949649, lng: 10.764105 },
        punktKilde: 'OSM-adressenode node/2789383634 (Nydalsveien 28)',
        coordVerified: true,
        isFree: null,
        url: 'https://oslo.fangenepafortet.no/',
        kontrollert: `oslo.fangenepafortet.no/, /sporsmalogsvar/, /kontakt/ — ${KONTROLL}`,
    },
    {
        externalId: 'fangene-pa-fortet-bergen',
        title: 'Fangene på Fortet Bergen',
        description:
            'Escape room-inspirert lagaktivitet i Bergen, der laget løser oppgaver i celle etter celle. I samme hus som Megazone.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['escaperom'],
        municipality: 'Bergen',
        address: 'Michael Krohns gate 86, 5057 Bergen',
        point: { lat: 60.381463, lng: 5.317511 },
        punktKilde: 'OSM-adressenode node/3126102168 (Michael Krohns gate 86)',
        coordVerified: true,
        isFree: null,
        url: 'https://bergen.fangenepafortet.no/',
        kontrollert: `bergen.fangenepafortet.no/, /kontakt/, /sporsmalogsvar/ — ${KONTROLL}`,
    },
    {
        externalId: 'fangene-pa-fortet-stavanger',
        title: 'Fangene på Fortet Stavanger',
        description: 'Escape room-inspirert lagaktivitet i Stavanger, med celler for ulik form og alder.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['escaperom'],
        municipality: 'Stavanger',
        address: 'Lagårdsveien 61, 4010 Stavanger',
        point: { lat: 58.960248, lng: 5.738078 },
        punktKilde: 'OSM-adressenode node/2840920768 (Lagårdsveien 61)',
        coordVerified: true,
        isFree: null,
        url: 'https://stavanger.fangenepafortet.no/',
        kontrollert: `stavanger.fangenepafortet.no/, /kontakt/, /sporsmalogsvar/ — ${KONTROLL}`,
    },
    // --- INNENDØRS LEKELAND MED LASERTAG OG BOWLING ---------------------
    // Kaller seg lekepark, så hovedkategorien er Innendørs lekeland. Kommer
    // opp under Spill og moro via fasettene (FASETT_SOM_KATEGORI).
    {
        externalId: 'lykkeland-steinkjer',
        title: 'Lykkeland',
        description: 'Innendørs lekepark i Steinkjer, med lasertag og bowling i samme hus.',
        category: 'Innendørs lekeland',
        isIndoor: true,
        facets: ['lasertag', 'bowling'],
        municipality: 'Steinkjer',
        address: 'Sjøfartsgata 12, Steinkjer',
        point: { lat: 64.007495, lng: 11.496098 },
        punktKilde: 'OSM-adressenode node/3125272888 (Sjøfartsgata 12)',
        coordVerified: true,
        isFree: false,
        url: 'https://lykkelandsteinkjer.no/',
        kontrollert: `lykkelandsteinkjer.no/, /lykkeland-lekepark/, /laserland/, /bowling/ — ${KONTROLL}`,
    },
    // --- BOWLING MED GOKART (henger med i pulje 1 for gokartens skyld) ---
    {
        externalId: 'lucky-bowl-trondheim',
        // OSM-navnet «Bowling1 & Gocart» er utdatert: bowling1.no/trondheim
        // sender videre til luckybowl.no/trondheim.
        title: 'Lucky Bowl Trondheim',
        description:
            'Bowling, gokart, lasertag og lekeland på Heggstadmoen i Trondheim. Aldersgrense på kveldstid i helgene – sjekk med stedet.',
        category: SPILL_OG_MORO,
        // Om gokartbanen er inne, er ikke bekreftet.
        isIndoor: true,
        facets: ['bowling', 'lasertag', 'gokart', 'spillehall'],
        municipality: 'Trondheim',
        address: 'Heggstadmoen 55, 7080 Trondheim',
        point: { lat: 63.330497, lng: 10.34931 },
        punktKilde: 'OSM-inngang node/8543977715 (entrance=main, access=customers) ved Heggstadmoen 55',
        coordVerified: true,
        isFree: null,
        url: 'https://luckybowl.no/trondheim/',
        kontrollert: `bowling1.no/trondheim → luckybowl.no/trondheim, /faq/, /om-oss/ — ${KONTROLL}`,
    },
    // --- GOKART ---------------------------------------------------------
    {
        externalId: 'harald-huysman-karting',
        title: 'Harald Huysman Karting',
        description: 'Innendørs gokart på Alnabru, med egne gokarter for barn og restaurant i samme hus.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['gokart'],
        municipality: 'Oslo',
        address: 'Smalvollveien 34, 0667 Oslo',
        // Bare Alnabru. Utebanen på Rudskogen krever førerkort og er ikke med.
        point: { lat: 59.918972, lng: 10.83619 },
        punktKilde: 'OSM-adressenode node/2793878253 (Smalvollveien 34)',
        coordVerified: true,
        isFree: null,
        url: 'https://hhk.no/',
        kontrollert: `hhk.no/, /alnabru/sporsmal-og-svar/, /apningstider/, /alnabru/kidkart/, /kontakt-oss/ — ${KONTROLL}`,
    },
    {
        externalId: 'kragero-actionpark',
        title: 'Kragerø Actionpark',
        description: 'Gokartbane ute i Sannidal med doserte svinger og egne gokarter for barn. Her er også paintball.',
        category: SPILL_OG_MORO,
        isIndoor: false,
        facets: ['gokart'],
        municipality: 'Kragerø',
        address: 'Kjølebrøndsveien 210, 3766 Sannidal',
        point: { lat: 58.880068, lng: 9.269315 },
        punktKilde: 'OSM-adressenode node/7725840079 (Kjølebrøndsveien 210)',
        coordVerified: true,
        isFree: false,
        url: 'https://www.krap.no/',
        kontrollert: `krap.no/, /openbooking/, /gruppebooking/ — ${KONTROLL}`,
    },
    {
        externalId: 'dagali-opplevelser-gokart',
        title: 'Dagali Opplevelser',
        description: 'Gokartbane i Dagali med egne barnekarter, og is-karting når det er vinter.',
        category: SPILL_OG_MORO,
        isIndoor: false,
        facets: ['gokart'],
        municipality: 'Hol',
        address: 'Bygdeveien 185, 3588 Dagali',
        // Adressen finnes ikke i OSM. Punktet er midt på banen.
        point: { lat: 60.41658, lng: 8.50211 },
        punktKilde: 'Midt på banen, OSM way/1110871267',
        coordVerified: false,
        isFree: null,
        url: 'https://www.dagaliopplevelser.no/sommeraktiviteter/gokart/',
        kontrollert: `dagaliopplevelser.no/, /sommeraktiviteter/gokart/, /kontakt-oss/ — ${KONTROLL}`,
    },
    {
        externalId: 'nmk-halsa-gokart',
        title: 'NMK Halsa',
        description: 'Motorklubbens gokartbane i Halsa, med utleie på faste drop-in-dager.',
        category: SPILL_OG_MORO,
        isIndoor: false,
        facets: ['gokart'],
        municipality: 'Heim',
        address: 'Glåmsmyrvegen 343, 6683 Vågland',
        point: { lat: 63.123292, lng: 8.376962 },
        punktKilde: 'OSM-adressenode node/3118631931 (klubblokalene, ca. 50 m fra banen)',
        coordVerified: true,
        isFree: null,
        url: 'https://www.nmkhalsa.no/',
        kontrollert: `nmkhalsa.no — ${KONTROLL}`,
    },
    // --- MINIGOLF -------------------------------------------------------
    {
        externalId: 'oslo-camping-minigolf',
        title: 'Oslo Camping',
        description:
            'Innendørs minigolf og bar ved Youngstorget. Barn er velkomne på dagtid, men om kvelden er det aldersgrense – sjekk med stedet.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['minigolf'],
        municipality: 'Oslo',
        address: 'Møllergata 12, Oslo',
        point: { lat: 59.914584, lng: 10.747373 },
        punktKilde: 'OSM-adressenode node/2785634860 (Møllergata 12)',
        coordVerified: true,
        isFree: false,
        url: 'https://campingen.no/oslo',
        kontrollert: `campingen.no/oslo, campingen.no/p/faq — ${KONTROLL}`,
    },
    {
        externalId: 'lucky-duck-oslo',
        title: 'Lucky Duck',
        description:
            'Digital minigolf og dart med bar i Oslo sentrum. Aldersgrense utenom egne familietider – sjekk med stedet.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['minigolf'],
        municipality: 'Oslo',
        address: 'Badstugata 5, 0183 Oslo',
        point: { lat: 59.916153, lng: 10.751059 },
        punktKilde: 'OSM-adressenode node/2785550895 (Badstugata 5)',
        coordVerified: true,
        isFree: null,
        url: 'https://luckyduck.no/',
        kontrollert: `luckyduck.no, /minigolf — ${KONTROLL}`,
    },
    {
        externalId: 'underground-golf-oslo',
        title: 'Underground Golf Oslo',
        description:
            'Innendørs crazy minigolf med restaurant på Majorstuen. Aldersgrense utenom familiegolf – sjekk med stedet.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['minigolf'],
        municipality: 'Oslo',
        address: 'Industrigata 36, 0357 Oslo',
        point: { lat: 59.92604, lng: 10.719687 },
        punktKilde: 'OSM-adressenode node/2788287792 (Industrigata 36)',
        coordVerified: true,
        isFree: false,
        url: 'https://undergroundgolf.no/start-oslo/',
        kontrollert: `undergroundgolf.no/start-oslo, /oslo/kontakt-oss/ — ${KONTROLL}`,
    },
    {
        externalId: 'underground-golf-drammen',
        title: 'Underground Golf Drammen',
        description:
            'Innendørs crazy minigolf med restaurant i Drammen. Aldersgrense utenom familiegolf – sjekk med stedet.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['minigolf'],
        municipality: 'Drammen',
        address: 'Amtmand Bloms gate 2, 3015 Drammen',
        point: { lat: 59.7439, lng: 10.206327 },
        punktKilde: 'OSM-adressenode node/3129953294 (Amtmand Bloms gate 2)',
        coordVerified: true,
        isFree: null,
        url: 'https://undergroundgolf.no/drammen/',
        kontrollert: `undergroundgolf.no/drammen/ — ${KONTROLL}`,
    },
    {
        externalId: 'underground-golf-stavanger',
        title: 'Underground Golf Stavanger',
        description:
            'Innendørs crazy minigolf med restaurant i Stavanger. Aldersgrense utenom familiegolf – sjekk med stedet.',
        category: SPILL_OG_MORO,
        isIndoor: true,
        facets: ['minigolf'],
        municipality: 'Stavanger',
        address: 'Kongsgårdbakken 3, 4005 Stavanger',
        point: { lat: 58.969712, lng: 5.731156 },
        punktKilde: 'OSM-adressenode node/2840917445 (Kongsgårdbakken 3)',
        coordVerified: true,
        isFree: false,
        url: 'https://undergroundgolf.no/startside-stavanger/',
        kontrollert: `undergroundgolf.no/startside-stavanger/, /kontakt-oss-stavanger/, /faq-stavanger/ — ${KONTROLL}`,
    },
];

/**
 * OSM-radene som tas ned ETTER at seeden er skrevet. Hver har en kuratert
 * erstatning (`erstattesAv`), og nedtaket nekter å røre en rad før
 * erstatningen er published — ellers ville stedet vært borte fra appen i
 * mellomtiden. Samme overgang som 'unpublish' i lib/moderation.ts:
 * published → rejected, locked = true. Ingenting slettes.
 */
export const NEDTAK: readonly {
    id: string;
    osmId: string;
    tittel: string;
    erstattesAv: { source: string; externalId: string };
}[] = [
    { id: '1390579e-14aa-419b-9471-54deb9f64e6e', osmId: 'node/4736654480', tittel: 'Megazone (Idrettshall, Oslo)', erstattesAv: { source: SOURCE.slug, externalId: 'megazone-oslo' } },
    { id: 'c8b31a07-967a-4ca5-b78b-6ab1eefe5c51', osmId: 'node/7197772245', tittel: 'Megazone (Idrettshall, Bergen)', erstattesAv: { source: SOURCE.slug, externalId: 'megazone-bergen' } },
    { id: '1cf3b57c-40b2-4197-91be-c7098b09837e', osmId: 'way/1030656428', tittel: 'Harald Huysman Karting (Idrettshall, Oslo)', erstattesAv: { source: SOURCE.slug, externalId: 'harald-huysman-karting' } },
    { id: '51c4bff0-137b-424c-be08-ddbbc696d602', osmId: 'node/13716750101', tittel: 'Rush trampolinepark (Idrettshall, Bergen)', erstattesAv: { source: 'kuratert-vintertilbud', externalId: 'rush-trampolinepark-bergen' } },
    { id: '08050ce2-4a5a-41e7-99b1-aa8d588da4cb', osmId: 'node/5549490417', tittel: 'Rush Trampolinepark (Lekeplass, Trondheim)', erstattesAv: { source: 'kuratert-vintertilbud', externalId: 'rush-trampolinepark-trondheim' } },
    { id: '7975f15c-961d-47e0-980d-08a2f94acb28', osmId: 'node/12181644169', tittel: "Leo's lekeland (Lekeplass, Oslo)", erstattesAv: { source: 'kuratert-vintertilbud', externalId: 'leos-lekeland-oslo' } },
    { id: 'bda3698d-c8c5-43db-8094-c55bda334c1e', osmId: 'node/5793918551', tittel: "Leo's Lekeland (Lekeplass, Bergen)", erstattesAv: { source: 'kuratert-vintertilbud', externalId: 'leos-lekeland-bergen' } },
    { id: 'c423be99-3076-4058-b332-d8dc3526fc2c', osmId: 'node/4394667412', tittel: "Leo's lekeland (Lekeplass, Trondheim)", erstattesAv: { source: 'kuratert-vintertilbud', externalId: 'leos-lekeland-trondheim' } },
];

/**
 * Brudd på reglene for beskrivelser: ingen priser, datoer, åpningstider,
 * antall eller superlativer. En vakt, ikke en fasit — den fanger tall,
 * kroner, ukedager, måneder, klokkeslett og de vanlige superlativene.
 */
export function beskrivelsesbrudd(tekst: string): string[] {
    const brudd: string[] = [];
    if (/\d/.test(tekst)) brudd.push('tall');
    if (/\b(kr|kroner|nok|gratis|pris)\b/i.test(tekst)) brudd.push('pris');
    if (/\b(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\b/i.test(tekst)) {
        brudd.push('dag eller måned');
    }
    if (/\bkl\.?\s|\bklokk/i.test(tekst)) brudd.push('klokkeslett');
    if (/\b(størst\w*|best\w*|råest\w*|finest\w*|eneste|første|mest|ledende|unik\w*|beste)\b/i.test(tekst)) {
        brudd.push('superlativ');
    }
    return brudd;
}

/** Seed-entry → rad i activities. Eksportert for test. */
export function toRow(seed: SpillSeed, sourceId: string) {
    return {
        source_id: sourceId,
        external_id: seed.externalId,
        kind: 'place',
        title: seed.title,
        description: seed.description,
        category: seed.category,
        is_indoor: seed.isIndoor,
        facets: seed.facets,
        target_audience: seed.targetAudience ?? 'For alle',
        address: seed.address,
        municipality: seed.municipality,
        near_city: null,
        lat: seed.point.lat,
        lng: seed.point.lng,
        is_free: seed.isFree,
        price_text: null,
        url: seed.url,
        opening_hours: null,
        status: 'published',
    };
}

const GYLDIGE = ['--dry-run', '--nedtak'];
export function ukjenteFlagg(args: readonly string[]): string[] {
    return args.filter((a) => !(GYLDIGE.includes(a) || a.startsWith('--only=')));
}

function visRad(s: SpillSeed) {
    console.log(`  ${s.externalId}`);
    console.log(`    tittel:       ${s.title}`);
    console.log(`    kategori:     ${s.category}`);
    console.log(`    fasetter:     ${s.facets.join(', ')}`);
    console.log(`    inne/ute:     ${s.isIndoor ? 'inne' : 'ute'}`);
    console.log(`    punkt:        ${s.point.lat}, ${s.point.lng}${s.coordVerified ? '' : '  (coordVerified: false)'}`);
    console.log(`    punktkilde:   ${s.punktKilde}`);
    console.log(`    kommune:      ${s.municipality}`);
    console.log(`    adresse:      ${s.address}`);
    console.log(`    beskrivelse:  ${s.description}`);
    console.log(`    betalt:       ${s.isFree === null ? 'ukjent' : s.isFree ? 'gratis' : 'betalt'}`);
    console.log(`    url:          ${s.url}`);
    console.log(`    kontrollert:  ${s.kontrollert}`);
}

async function seed(dryRun: boolean, only: string | undefined) {
    // Vaktene kjører over HELE seeden, utvalget begrenser bare skrivingen.
    assertClaimsResolve(SOURCE.slug, SEED.map((s) => s.externalId));
    for (const s of SEED) {
        const b = beskrivelsesbrudd(s.description);
        if (b.length) throw new Error(`${s.externalId}: beskrivelsen bryter reglene (${b.join(', ')})`);
    }
    const utvalg = velgUtvalg(SEED, only);
    console.log(`Spill og moro-seed: ${utvalg.length} av ${SEED.length} rader.${dryRun ? ' [dry-run]' : ''}\n`);

    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');
    const db = supabaseAdmin();

    const { data: finnes, error: kildeFeil } = await db
        .from('sources')
        .select('id, active')
        .eq('slug', SOURCE.slug)
        .maybeSingle();
    if (kildeFeil) throw new Error(`Oppslag mot sources feilet: ${kildeFeil.message}`);

    let eksisterende = new Map<string, { status: string; locked: boolean }>();
    if (finnes) {
        const { data, error } = await db
            .from('activities')
            .select('external_id, status, locked')
            .eq('source_id', finnes.id)
            .in('external_id', utvalg.map((s) => s.externalId));
        if (error) throw new Error(`Oppslag av eksisterende rader feilet: ${error.message}`);
        eksisterende = new Map((data ?? []).map((r) => [r.external_id, { status: r.status, locked: r.locked }]));
    }

    console.log(
        finnes
            ? `Kilde: ${SOURCE.slug} finnes (active=${finnes.active}).`
            : `Kilde: ${SOURCE.slug} finnes IKKE. Opprettes: slug=${SOURCE.slug}, name=«${SOURCE.name}», kind=${SOURCE.kind}, active=true.`
    );
    console.log('');
    for (const s of utvalg) {
        const e = eksisterende.get(s.externalId);
        const hva = !e ? 'NY RAD, status published' : e.locked ? `LÅST (${e.status}) — hoppes over` : `OPPDATERES (i dag ${e.status})`;
        console.log(`[${hva}]`);
        visRad(s);
        console.log('');
    }

    if (dryRun) {
        console.log('[dry-run] Ingen skriving.');
        return;
    }

    const { data: kilde, error: upsertFeil } = await db
        .from('sources')
        .upsert({ slug: SOURCE.slug, name: SOURCE.name, kind: SOURCE.kind, active: true }, { onConflict: 'slug' })
        .select('id')
        .single();
    if (upsertFeil || !kilde) throw new Error(`Kunne ikke sikre kilden: ${upsertFeil?.message}`);

    const rows = utvalg
        .filter((s) => !eksisterende.get(s.externalId)?.locked)
        .map((s) => toRow(s, kilde.id));
    const { error } = await db.from('activities').upsert(rows, { onConflict: 'source_id,external_id' });
    if (error) throw new Error(`Upsert feilet: ${error.message}`);

    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${rows.length} steder (Spill og moro)` })
        .eq('id', kilde.id);
    console.log(`Ferdig: upsertet ${rows.length} rader under ${SOURCE.slug}.`);
}

async function nedtak(dryRun: boolean) {
    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');
    const db = supabaseAdmin();

    const { data: kilder, error: kildeFeil } = await db.from('sources').select('id, slug');
    if (kildeFeil) throw new Error(`Oppslag mot sources feilet: ${kildeFeil.message}`);
    const kildeId = new Map((kilder ?? []).map((k) => [k.slug, k.id]));

    const { data: gamle, error: gammelFeil } = await db
        .from('activities')
        .select('id, title, category, municipality, status, locked, external_id')
        .in('id', NEDTAK.map((n) => n.id));
    if (gammelFeil) throw new Error(`Oppslag av nedtaksradene feilet: ${gammelFeil.message}`);
    const gammel = new Map((gamle ?? []).map((r) => [r.id, r]));

    console.log(`Nedtak: ${NEDTAK.length} OSM-rader. Overgang: published → rejected, locked = true.${dryRun ? ' [dry-run]' : ''}\n`);
    const klare: string[] = [];
    for (const n of NEDTAK) {
        const g = gammel.get(n.id);
        const sid = kildeId.get(n.erstattesAv.source);
        let erstatning = 'kilden finnes ikke';
        if (sid) {
            const { data } = await db
                .from('activities')
                .select('status')
                .eq('source_id', sid)
                .eq('external_id', n.erstattesAv.externalId)
                .maybeSingle();
            erstatning = data ? data.status : 'finnes ikke';
        }
        const ok = g?.status === 'published' && g.external_id === n.osmId && erstatning === 'published';
        if (ok) klare.push(n.id);
        console.log(
            `  ${n.id}  ${n.osmId.padEnd(18)} ${n.tittel}\n` +
                `      i dag: ${g ? `${g.status}${g.locked ? ', låst' : ''}` : 'FINNES IKKE'}` +
                `   erstatning ${n.erstattesAv.source}/${n.erstattesAv.externalId}: ${erstatning}` +
                `   → ${ok ? 'tas ned' : 'VENTER (erstatningen må være published først)'}`
        );
    }

    if (dryRun) {
        console.log(`\n[dry-run] Ingen skriving. ${klare.length} av ${NEDTAK.length} er klare til nedtak nå.`);
        return;
    }
    if (klare.length !== NEDTAK.length) {
        throw new Error(`Bare ${klare.length} av ${NEDTAK.length} er klare. Kjør seeden først. Ingenting er tatt ned.`);
    }
    const { data, error } = await db
        .from('activities')
        .update({ status: 'rejected', locked: true })
        .in('id', klare)
        .eq('status', 'published')
        .select('id');
    if (error) throw new Error(`Nedtak feilet: ${error.message}`);
    console.log(`\nFerdig: ${data?.length ?? 0} rader tatt ned (rejected + locked).`);
}

async function main() {
    const args = process.argv.slice(2);
    const ukjente = ukjenteFlagg(args);
    if (ukjente.length) throw new Error(`Ukjent argument: ${ukjente.join(', ')}. Gyldige: --dry-run --nedtak --only=a,b`);
    const dryRun = args.includes('--dry-run');
    const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
    if (args.includes('--nedtak')) {
        if (only !== undefined) throw new Error('--nedtak tar ikke --only=. Lista står i NEDTAK.');
        await nedtak(dryRun);
    } else {
        await seed(dryRun, only);
    }
}

// Samme vakt som seed-vintertilbud.ts: modulen skal kunne importeres av en
// test uten å kjøre seeden.
if (process.argv[1]?.endsWith('seed-spill-og-moro.ts')) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
