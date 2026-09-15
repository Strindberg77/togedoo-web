// scripts/dedup-kallere.test.ts
//
// DE TO KALLERNE AV SAMME REGEL — og vakten som sier fra hvis de blir uenige.
//
// Problemet har to halvdeler: importen skal slutte å lage dubletter, og
// oppryddingen skal ta ned de 263 parene som allerede ligger i basen. Er de
// to uenige om hvem som vinner, tar oppryddingen ned rad A mens neste import
// bygger A og fjerner B. Basen svinger da mellom to tilstander, og ingen av
// dem er den vi ville hatt.
//
// Regelen selv er testet i lib/dedup.test.ts. Her testes at de to VEIENE inn
// til den gir samme svar, og at grupperingen per kategori holder.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_QUERY_PAUSE_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

const LAT_M = 111_320;
const BASE_LAT = 59.9556;
const BASE_LNG = 10.7684;
const nord = (meter: number) => BASE_LAT + meter / LAT_M;

type Tags = Record<string, string>;

/** Ett sted, i BEGGE former: som OSM-element og som rad i basen. */
interface Sted {
    readonly externalId: string;
    readonly meter: number;
    readonly tags: Tags;
}

const osmElement = (s: Sted) => {
    const [type, id] = s.externalId.split('/');
    return type === 'node'
        ? { type: 'node' as const, id: Number(id), lat: nord(s.meter), lon: BASE_LNG, tags: s.tags }
        : {
              type: type as 'way' | 'relation',
              id: Number(id),
              tags: s.tags,
              center: { lat: nord(s.meter), lon: BASE_LNG },
          };
};

const baseRad = (s: Sted, category: string) => ({
    external_id: s.externalId,
    category,
    title: s.tags.name ?? `${category} ved Et eller annet`,
    lat: nord(s.meter),
    lng: BASE_LNG,
    osm_tags: s.tags,
});

// ---------------------------------------------------------------------------
// VAKTEN: samme regel, to veier inn
// ---------------------------------------------------------------------------

test('importen og oppryddingen tar ut NØYAKTIG de samme objektene', async () => {
    // DETTE ER VAKTEN OPPGAVEN BA OM. Den kjører det samme scenarioet gjennom
    // begge kodeveiene — OSM-elementer gjennom enrichChunk, databaserader
    // gjennom oppryddingsplan — og krever samme svar.
    //
    // Den ville feilet hvis noen: kopierte regelen tilbake inn i importen,
    // endret navneregelen ett sted, byttet id-sammenligningen, eller lot de
    // to lese ulik radius.
    const { enrichChunk, PLACE_CATEGORIES } = await load();
    const { oppryddingsplan } = await import('./dedup-opprydding');
    const { chunkForCity } = await import('../lib/import-chunks');

    const LEK: Tags = { leisure: 'playground' };
    const steder: Sted[] = [
        // node over flate
        { externalId: 'node/1095094457', meter: 4, tags: LEK },
        { externalId: 'way/650069798', meter: 0, tags: LEK },
        // node mot node: laveste id vinner
        { externalId: 'node/14091419612', meter: 300, tags: LEK },
        { externalId: 'node/2785549850', meter: 300, tags: LEK },
        // to flater: ingen tas ut
        { externalId: 'way/1044252661', meter: 600, tags: LEK },
        { externalId: 'way/1044252659', meter: 600, tags: LEK },
        // navn bare på taperen: begge beholdes
        { externalId: 'node/5000', meter: 900, tags: { ...LEK, name: 'Sagenehagen lekeplass' } },
        { externalId: 'way/5001', meter: 900, tags: LEK },
        // ulike navn: begge beholdes
        { externalId: 'node/6000', meter: 1200, tags: { ...LEK, name: 'Sandkassen' } },
        { externalId: 'way/6001', meter: 1200, tags: { ...LEK, name: 'Torshovparken' } },
        // alene
        { externalId: 'node/7000', meter: 2000, tags: LEK },
    ];

    const cats = PLACE_CATEGORIES.filter((c) => c.key === 'lekeplass');
    const ut = await enrichChunk(
        chunkForCity('Oslo'),
        steder.map((s) => ({ c: 'lekeplass', s: 'main', e: osmElement(s) })),
        Infinity,
        cats
    );
    const fraImporten = [...ut.deduped].sort();

    const plan = oppryddingsplan(steder.map((s) => baseRad(s, 'Lekeplass')));
    const fraOppryddingen = plan.tapere;

    assert.deepEqual(
        fraImporten,
        fraOppryddingen,
        'importen og oppryddingen er uenige om hvem som taper'
    );
    // Og svaret er det regelen lover, ikke bare «det samme to ganger».
    assert.deepEqual(fraImporten, ['node/1095094457', 'node/14091419612']);
    // Radene som blir igjen etter importen er komplementet.
    assert.deepEqual(
        ut.rows.map((r) => r.external_id).sort(),
        steder.map((s) => s.externalId).filter((id) => !fraImporten.includes(id)).sort()
    );
});

test('begge veier ser de ULØSTE parene, og teller dem likt', async () => {
    // Restbeholdningen må være synlig begge steder — ellers sier den ene
    // rapporten «ferdig» om en base den andre vet har par igjen.
    const { dedupElements } = await load();
    const { oppryddingsplan } = await import('./dedup-opprydding');
    const { uloste } = await import('../lib/dedup');

    const LEK: Tags = { leisure: 'playground' };
    const steder: Sted[] = [
        { externalId: 'way/1', meter: 0, tags: LEK },
        { externalId: 'way/2', meter: 0, tags: LEK },
        { externalId: 'node/3', meter: 300, tags: { ...LEK, name: 'Sandkassen' } },
        { externalId: 'way/4', meter: 300, tags: LEK },
    ];

    const fraImporten = uloste(dedupElements(steder.map(osmElement)).par);
    const plan = oppryddingsplan(steder.map((s) => baseRad(s, 'Lekeplass')));
    const fraOppryddingen = uloste([...plan.perKategori.values()].flat());

    assert.deepEqual(fraImporten, fraOppryddingen);
    assert.deepEqual(fraImporten, {
        'to-flater': 1,
        'navn-bare-pa-taper': 1,
        'navn-uenighet': 0,
    });
});

// ---------------------------------------------------------------------------
// KATEGORIENE
// ---------------------------------------------------------------------------

test('en lekeplass og en ballbane fire meter fra hverandre er TO steder', async () => {
    const { enrichChunk, PLACE_CATEGORIES } = await load();
    const { chunkForCity } = await import('../lib/import-chunks');
    const cats = PLACE_CATEGORIES.filter((c) => c.key === 'lekeplass' || c.key === 'ballbane');

    const ut = await enrichChunk(
        chunkForCity('Oslo'),
        [
            { c: 'lekeplass', s: 'main', e: osmElement({ externalId: 'node/1', meter: 4, tags: { leisure: 'playground' } }) },
            { c: 'ballbane', s: 'main', e: osmElement({ externalId: 'way/2', meter: 0, tags: { leisure: 'pitch', sport: 'basketball' } }) },
        ],
        Infinity,
        cats
    );
    assert.deepEqual(ut.rows.map((r) => r.external_id).sort(), ['node/1', 'way/2']);
    assert.deepEqual(ut.deduped, []);
});

test('oppryddingen grupperer også per kategori', async () => {
    const { oppryddingsplan } = await import('./dedup-opprydding');
    const plan = oppryddingsplan([
        baseRad({ externalId: 'node/1', meter: 4, tags: { leisure: 'playground' } }, 'Lekeplass'),
        baseRad({ externalId: 'way/2', meter: 0, tags: { leisure: 'pitch' } }, 'Ballbane'),
    ]);
    assert.deepEqual(plan.tapere, []);
    assert.equal(plan.perKategori.size, 0);
});

test('oppryddingen rører aldri kuraterte rader', async () => {
    // Seed-rader har external_id som «tryvann». De eies av en annen kilde og
    // styres av lib/osm-claims.ts — en avstandsregel her ville vært en tredje
    // mekanisme på samme sted.
    const { oppryddingsplan } = await import('./dedup-opprydding');
    const plan = oppryddingsplan([
        {
            external_id: 'tryvann',
            category: 'Skianlegg',
            title: 'Tryvann',
            lat: BASE_LAT,
            lng: BASE_LNG,
            osm_tags: null,
        },
        baseRad({ externalId: 'node/1', meter: 1, tags: {} }, 'Skianlegg'),
    ]);
    assert.deepEqual(plan.tapere, []);
    assert.equal(plan.hoppetOver.ikkeOsm, 1);
});

test('en generert TITTEL er ikke et navn', async () => {
    // Basen har `title` = «Lekeplass ved Kapellveien» på navnløse rader.
    // Leste oppryddingen navnet derfra, ville hver eneste navnløse rad sett
    // navngitt ut, og regelen ville aldri tatt noe ut.
    const { oppryddingsplan } = await import('./dedup-opprydding');
    const plan = oppryddingsplan([
        {
            external_id: 'node/1',
            category: 'Lekeplass',
            title: 'Lekeplass ved Kapellveien',
            lat: nord(4),
            lng: BASE_LNG,
            osm_tags: { leisure: 'playground' },
        },
        {
            external_id: 'way/2',
            category: 'Lekeplass',
            title: 'Lekeplass ved Kapellveien',
            lat: BASE_LAT,
            lng: BASE_LNG,
            osm_tags: { leisure: 'playground' },
        },
    ]);
    assert.deepEqual(plan.tapere, ['node/1']);
});

// ---------------------------------------------------------------------------
// FLAGGET
// ---------------------------------------------------------------------------

test('bare kategorier med et MÅLT grunnlag har dedupen på', async () => {
    const { PLACE_CATEGORIES } = await load();
    const paa = PLACE_CATEGORIES.filter((c) => c.dedupDubletter).map((c) => c.key);
    assert.deepEqual(paa.sort(), ['ballbane', 'lekeplass', 'rullesport']);
});

test('ingen kategori har BÅDE enrichSets og dedupDubletter', async () => {
    // Aking og Skianlegg har allerede hvert sitt, bedre svar på det samme
    // spørsmålet: verifyPointFacilities gjør en ekte punkt-i-polygon-test, og
    // akingClusters samler på relasjon og navnegruppe.
    const { PLACE_CATEGORIES } = await load();
    const begge = PLACE_CATEGORIES.filter((c) => c.enrichSets && c.dedupDubletter);
    assert.deepEqual(begge.map((c) => c.key), []);
});

test('oppryddingsskriptet har ingen skrivevei', async () => {
    // Kravet er at det ikke kan skrive, ikke at det lar være. En insert,
    // update, upsert eller delete i fila skal feile testen.
    const fs = await import('node:fs');
    const rå = fs.readFileSync('scripts/dedup-opprydding.ts', 'utf8');
    // KOMMENTARENE FJERNES FØRST. Fila FORKLARER hvorfor den ikke sletter, og
    // en vakt som leser sin egen begrunnelse som et brudd er en vakt ingen
    // beholder. Strippingen kan bare fjerne tekst, aldri legge til, så den
    // kan ikke få et ekte kall til å slippe gjennom.
    const kilde = rå
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
    // SQL-en i utskriften er en STRENG i lib/dedup.ts, ikke et kall her.
    for (const forbudt of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
        assert.ok(!kilde.includes(forbudt), `fant ${forbudt} i oppryddingsskriptet`);
    }
    // Og vakten skal kunne feile: den ville sett et ekte kall.
    assert.ok(
        'const x = db.from(\'a\').delete();'.includes('.delete('),
        'vaktens eget mønster'
    );
});
