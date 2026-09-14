// scripts/import-sommen.test.ts
// SØMMEN: hent → berik → skriv.
//
// Testene her vokter det som er lett å ødelegge i en deling: at
// dedupliseringen fortsatt gir samme match-prioritet, at berikelsen er ren,
// at claims fortsatt eies av berikelsen, og at de gamle flaggene virker som
// før.
//
// Ingen nettverk. Kjør: node --import tsx --test scripts/import-sommen.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chunkForCity } from '../lib/import-chunks';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

const el = (type: 'node' | 'way' | 'relation', id: number, tags: Record<string, string> = {}) => ({
    type,
    id,
    tags,
    center: { lat: 59.95, lon: 10.75 },
});

// ---------------------------------------------------------------------------
// MELLOMLEDDETS FORM
// ---------------------------------------------------------------------------

test('hentesteget bærer kategori OG sett gjennom mellomleddet', async () => {
    // Uten `s` er Skianleggs to sett umulige å skille etter en tur innom
    // disk, og et bevisobjekt ville blitt en rad.
    const { groupFetchRecords } = await load();
    const grupper = groupFetchRecords([
        { c: 'skianlegg', s: 'omrade', e: el('way', 1) },
        { c: 'skianlegg', s: 'bevis', e: el('way', 2) },
        { c: 'park', s: 'main', e: el('way', 3) },
    ]);
    assert.deepEqual(Object.keys(grupper.get('skianlegg')!).sort(), ['bevis', 'omrade']);
    assert.equal(grupper.get('skianlegg')!.omrade.length, 1);
    assert.equal(grupper.get('park')!.main.length, 1);
});

test('gruppering av et tomt mellomledd gir ingen kategorier', async () => {
    const { groupFetchRecords } = await load();
    assert.equal(groupFetchRecords([]).size, 0);
});

// ---------------------------------------------------------------------------
// DEDUPLISERINGEN — løftet ut av overpassCity, må gi SAMME prioritet
// ---------------------------------------------------------------------------

test('første kategori i rekkefølgen vinner et delt objekt', async () => {
    // Regelen fra før sømmen, uendret: dedupliseringen avgjør hvem som får et
    // objekt to selektorer treffer, og svaret er den første i
    // PLACE_CATEGORIES. Samme regel som buildRows sin cats.find(...).
    const { mergeEnriched, PLACE_CATEGORIES } = await load();
    const lekeplass = PLACE_CATEGORIES.find((c) => c.key === 'lekeplass')!;
    const aking = PLACE_CATEGORIES.find((c) => c.key === 'aking')!;
    const delt = el('way', 42, { leisure: 'playground', 'piste:type': 'sled' });
    const { merged, addedPerCategory } = mergeEnriched([
        { cat: lekeplass, elements: [delt] },
        { cat: aking, elements: [delt] },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(addedPerCategory.get('lekeplass'), 1);
    assert.equal(addedPerCategory.get('aking'), 0);
});

test('rekkefølgen i den sammenslåtte lista er kategorirekkefølgen', async () => {
    const { mergeEnriched, PLACE_CATEGORIES } = await load();
    const a = PLACE_CATEGORIES[0];
    const b = PLACE_CATEGORIES[1];
    const { merged } = mergeEnriched([
        { cat: a, elements: [el('way', 1), el('way', 2)] },
        { cat: b, elements: [el('way', 3)] },
    ]);
    assert.deepEqual(merged.map((e) => e.id), [1, 2, 3]);
});

test('samme id fra to sett i SAMME kategori telles én gang', async () => {
    const { mergeEnriched, PLACE_CATEGORIES } = await load();
    const cat = PLACE_CATEGORIES[0];
    const { merged } = mergeEnriched([{ cat, elements: [el('way', 7), el('way', 7)] }]);
    assert.equal(merged.length, 1);
});

// ---------------------------------------------------------------------------
// BERIKELSEN ER REN
// ---------------------------------------------------------------------------

test('Skianleggs romlige test kjører uten nettverk', async () => {
    // Verifiseringen er en TOLKNING av hentede data. Ligger den i henteren,
    // følger den med når kilden byttes i fase 3.
    const { skianleggVerify } = await load();
    const polygon = {
        type: 'way' as const,
        id: 1,
        tags: { landuse: 'winter_sports', name: 'Testbakken' },
        geometry: [
            { lat: 59.95, lon: 10.75 },
            { lat: 59.96, lon: 10.75 },
            { lat: 59.96, lon: 10.76 },
            { lat: 59.95, lon: 10.76 },
            { lat: 59.95, lon: 10.75 },
        ],
    };
    const nedfart = {
        type: 'way' as const,
        id: 2,
        tags: { 'piste:type': 'downhill' },
        geometry: [{ lat: 59.955, lon: 10.755 }],
    };
    const ut = skianleggVerify({ omrade: [polygon], bevis: [nedfart] });
    assert.equal(ut.elements.length, 1);
    assert.equal(ut.elements[0].skiVerified, true);
    assert.ok(ut.summary?.includes('alpinanlegg'));
});

test('et bevisobjekt blir aldri en rad', async () => {
    // Settnavnene bærer rollen: `bevis` er inndata til testen, ikke kandidat.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({ omrade: [], bevis: [el('way', 99, { 'piste:type': 'downhill' })] });
    assert.deepEqual(ut.elements, []);
});

test('berikelsen tåler et sett som mangler', async () => {
    // En chunk der kategorien ikke ga noe skal gi tom liste, ikke kaste.
    const { skianleggVerify, akingEnrich } = await load();
    assert.deepEqual(skianleggVerify({}).elements, []);
    assert.deepEqual(akingEnrich({}).elements, []);
});

// ---------------------------------------------------------------------------
// HVEM EIER HVA
// ---------------------------------------------------------------------------

test('klyngingen og den romlige testen ligger i BERIKELSEN, ikke hentingen', async () => {
    const { PLACE_CATEGORIES } = await load();
    const medBerikelse = PLACE_CATEGORIES.filter((c) => c.enrichSets).map((c) => c.key);
    const medHenting = PLACE_CATEGORIES.filter((c) => c.fetchSets).map((c) => c.key);
    assert.deepEqual(medBerikelse, ['aking', 'skianlegg']);
    assert.deepEqual(medHenting, ['aking', 'skianlegg']);
});

test('claims eies fortsatt av berikelsen — buildRows filtrerer selv', async () => {
    // Hentingen kan ikke ekskludere en enkelt id billig fra en
    // områdespørring, og et claimet objekt skal heller ikke koste geokoding.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const aking = PLACE_CATEGORIES.find((c) => c.key === 'aking')!;
    const rows = await buildRows(
        'Oslo',
        [
            {
                type: 'relation',
                id: 1459739,
                tags: { 'piste:type': 'sled', name: 'Korketrekkeren' },
                center: { lat: 59.976, lon: 10.683 },
                akingVerified: true,
            },
        ],
        50,
        [aking]
    );
    assert.deepEqual(rows, []);
});

// ---------------------------------------------------------------------------
// FLAGGENE — de gamle må virke som før, de nye som beskrevet
// ---------------------------------------------------------------------------

test('de gamle flaggene er uendret', async () => {
    const { parseArgs, PLACE_CATEGORIES } = await load();
    const a = parseArgs(['--dry-run', '--city=Oslo', '--limit=25', '--category=aking']);
    assert.equal(a.dryRun, true);
    assert.deepEqual(a.cities, ['Oslo']);
    assert.equal(a.limit, 25);
    assert.deepEqual(a.cats.map((c) => c.key), ['aking']);
    const b = parseArgs([]);
    assert.equal(b.limit, Infinity);
    assert.equal(b.cats.length, PLACE_CATEGORIES.length);
});

test('uten --work lagres ingenting — standardveien er uendret', async () => {
    const { parseArgs } = await load();
    assert.equal(parseArgs([]).workDir, null);
    assert.equal(parseArgs(['--dry-run']).workDir, null);
    assert.equal(parseArgs(['--dry-run']).resume, false);
});

test('--work slår på mellomleddet, med og uten katalog', async () => {
    const { parseArgs, DEFAULT_WORK_DIR } = await load();
    assert.equal(parseArgs(['--work']).workDir, DEFAULT_WORK_DIR);
    assert.equal(parseArgs(['--work=/tmp/annet']).workDir, '/tmp/annet');
});

test('--resume innebærer --work', async () => {
    // Å be om gjenopptagelse uten et sted å gjenoppta fra er alltid en
    // skrivefeil, ikke et ønske.
    const { parseArgs, DEFAULT_WORK_DIR } = await load();
    const a = parseArgs(['--resume']);
    assert.equal(a.resume, true);
    assert.equal(a.workDir, DEFAULT_WORK_DIR);
});

test('gjenopptagelse er EKSPLISITT — --work alene hopper ikke over noe', async () => {
    // Å gjenbruke i stillhet er den klassiske fella: man retter en selektor,
    // kjører på nytt, og får gårsdagens data.
    const { parseArgs } = await load();
    assert.equal(parseArgs(['--work']).resume, false);
});

test('ukjente flagg avvises fortsatt', async () => {
    const { parseArgs } = await load();
    assert.throws(() => parseArgs(['--worksheet']), /Ukjent argument/);
    assert.throws(() => parseArgs(['--city', 'Oslo']), /Ukjent argument/);
});

// ---------------------------------------------------------------------------
// HENTESTEGET MOT EN MOCKET OVERPASS
// ---------------------------------------------------------------------------

test('områdeklausulen kommer fra chunken, ikke fra en hardkodet by', async (t) => {
    // Det som gjør at enheten kan slutte å være en by: spørringen bygges av
    // chunk.overpassArea. Fase 3 bytter henteren og det feltet, ikke resten.
    const realFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = realFetch; });
    const sendt: string[] = [];
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
        sendt.push(decodeURIComponent(String(init?.body ?? '')));
        return new Response(JSON.stringify({ elements: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;

    const { PLACE_CATEGORIES } = await load();
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    // Standardveien har ingen fetchSets; den bygges i fetchChunk. Her testes
    // den kategorien som HAR en, og som derfor bruker chunken direkte.
    const aking = PLACE_CATEGORIES.find((c) => c.key === 'aking')!;
    await aking.fetchSets!(chunkForCity('Trondheim'));
    assert.match(sendt[0], /"admin_level"="7"/);
    assert.match(sendt[0], /"name"="Trondheim"/);
    assert.ok(park.selector.length > 0);
});
