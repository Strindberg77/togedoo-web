// scripts/node-flate-dedup.test.ts
//
// SAMME STED, KARTLAGT TO GANGER: én gang som punkt, én gang som flate.
//
// I Kjelsås ga det seks rader som alle het «Lekeplass ved Gunnar Schjelderups
// vei», og to av dem — node/1095094457 og way/650069798 — lå FIRE meter fra
// hverandre. Nasjonalt er det 440 lekeplasser og 373 pitcher (Geofabrik
// norway-260908).
//
// Testene her låser tre ting, i stigende rekkefølge etter hvor lett de er å
// ødelegge uten å merke det:
//
//   1. Regelen for hvem som vinner — fem tilfeller, alle navngitt.
//   2. At utfallet er DETERMINISTISK. external_id er upsert-nøkkelen, så en
//      vinner som bytter mellom to kjøringer gir brukeren en ny rad og lar
//      den gamle bli stående. Stokketesten er det egentlige beviset.
//   3. At kategoriene holdes fra hverandre — en lekeplass og en ballbane fire
//      meter fra hverandre er to steder, ikke ett.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_QUERY_PAUSE_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

/** ~11,13 m per 0,0001 grad breddegrad. Brukes til å plassere presist. */
const LAT_M = 111_320;
const nord = (lat: number, meter: number) => lat + meter / LAT_M;

const BASE_LAT = 59.9556;
const BASE_LNG = 10.7684;

type Tags = Record<string, string>;
const flate = (id: number, meter = 0, tags: Tags = {}) => ({
    type: 'way' as const,
    id,
    tags: { leisure: 'playground', ...tags },
    center: { lat: nord(BASE_LAT, meter), lon: BASE_LNG },
});
const punkt = (id: number, meter = 0, tags: Tags = {}) => ({
    type: 'node' as const,
    id,
    lat: nord(BASE_LAT, meter),
    lon: BASE_LNG,
    tags: { leisure: 'playground', ...tags },
});

const ider = (els: readonly { type: string; id: number }[]) =>
    els.map((e) => `${e.type}/${e.id}`);

// ---------------------------------------------------------------------------
// REGELEN — hvem vinner
// ---------------------------------------------------------------------------

test('uten navn på noen av dem: FLATEN vinner, punktet droppes', async () => {
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([punkt(1, 4), flate(2, 0)]);
    assert.deepEqual(ider(ut.elements), ['way/2']);
    assert.equal(ut.par.length, 1);
    assert.equal(ut.par[0].utfall, 'droppet');
    assert.equal(ut.par[0].node, 'node/1');
    assert.equal(ut.par[0].flate, 'way/2');
    assert.ok(ut.par[0].meter <= 4.1 && ut.par[0].meter >= 3.9, `${ut.par[0].meter} m`);
});

test('bare FLATEN har navn: flaten vinner fortsatt', async () => {
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([
        punkt(1, 4),
        flate(2, 0, { name: 'Sagenehagen lekeplass' }),
    ]);
    assert.deepEqual(ider(ut.elements), ['way/2']);
    assert.equal(ut.par[0].utfall, 'droppet');
});

test('bare PUNKTET har navn: BEGGE beholdes', async () => {
    // Flaten ville tatt over raden og mistet navnet, og tittelen ville falt
    // tilbake til «Lekeplass ved <gate>». Et navn er det eneste en forelder
    // kan skille to like steder på — se de seks like titlene i Kjelsås.
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([
        punkt(1, 4, { name: 'Sagenehagen lekeplass' }),
        flate(2, 0),
    ]);
    assert.deepEqual(ider(ut.elements), ['node/1', 'way/2']);
    assert.equal(ut.par[0].utfall, 'navn-bare-pa-node');
    assert.equal(ut.par[0].nodeNavn, 'Sagenehagen lekeplass');
    assert.equal(ut.par[0].flateNavn, null);
});

test('BEGGE har navn, LIKT: flaten vinner', async () => {
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([
        punkt(1, 4, { name: 'Sagenehagen lekeplass' }),
        // Ulik skrivemåte, samme navn.
        flate(2, 0, { name: '  SAGENEHAGEN Lekeplass ' }),
    ]);
    assert.deepEqual(ider(ut.elements), ['way/2']);
    assert.equal(ut.par[0].utfall, 'droppet');
});

test('BEGGE har navn, ULIKT: begge beholdes — premisset holder ikke', async () => {
    // Regelen hviler på at de to beskriver SAMME sted. To ulike navn motsier
    // det. Da er det OSM som skal rettes, ikke raden som skal forsvinne her.
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([
        punkt(1, 4, { name: 'Sandkassen' }),
        flate(2, 0, { name: 'Torshovparken lekeplass' }),
    ]);
    assert.deepEqual(ider(ut.elements), ['node/1', 'way/2']);
    assert.equal(ut.par[0].utfall, 'navn-uenighet');
});

test('et navn som bare er gatenavnet teller ikke som navn', async () => {
    // «Navn» betyr her det samme som overalt ellers i importen:
    // isUsablePlaceName. ÉN definisjon, ikke to — ellers kunne et punkt bli
    // reddet av et «navn» tittelgeneratoren likevel ville forkastet.
    //
    // Mønsteret er ekte: en bidragsyter kopierer gata inn i name-taggen.
    // «Gunnar Schjelderups vei» ender på «vei» og er et mistankemønster.
    const { dedupNodeOverFlate } = await load();
    const { isUsablePlaceName } = await import('../lib/places');
    assert.equal(
        isUsablePlaceName('Gunnar Schjelderups vei'),
        false,
        'forutsetningen for testen'
    );
    const ut = dedupNodeOverFlate([
        punkt(1, 4, { name: 'Gunnar Schjelderups vei' }),
        flate(2, 0),
    ]);
    assert.deepEqual(ider(ut.elements), ['way/2']);
    assert.equal(ut.par[0].utfall, 'droppet');
});

test('«Lekeplass» ER et brukbart navn, og det er med vilje', async () => {
    // Overraskende, men konsistent: «lekeplass» står i TRUSTED_WORDS i
    // lib/places.ts, så tittelgeneratoren bruker det som tittel. Dedupen
    // arver den definisjonen framfor å lage sin egen — prisen er at et punkt
    // med et generisk navn overlever, og det er den riktige prisen: to rader
    // er en synlig feil, en forsvunnet rad er ikke det.
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([punkt(1, 4, { name: 'Lekeplass' }), flate(2, 0)]);
    assert.deepEqual(ider(ut.elements), ['node/1', 'way/2']);
    assert.equal(ut.par[0].utfall, 'navn-bare-pa-node');
});

// ---------------------------------------------------------------------------
// TERSKELEN
// ---------------------------------------------------------------------------

test('akkurat 10 m er innenfor, 10 m + litt er utenfor', async () => {
    const { dedupNodeOverFlate, NODE_OVER_FLATE_M } = await load();
    assert.equal(NODE_OVER_FLATE_M, 10, 'terskelen er MÅLT — se filhodet');

    const paa = dedupNodeOverFlate([punkt(1, NODE_OVER_FLATE_M), flate(2, 0)]);
    assert.deepEqual(ider(paa.elements), ['way/2'], 'nøyaktig på terskelen: innenfor');

    const utenfor = dedupNodeOverFlate([punkt(1, NODE_OVER_FLATE_M + 0.5), flate(2, 0)]);
    assert.deepEqual(ider(utenfor.elements), ['node/1', 'way/2']);
    assert.deepEqual(utenfor.par, [], 'ingen par utenfor terskelen');
});

test('to flater rører ikke hverandre, uansett hvor nær de ligger', async () => {
    // Flate-mot-flate er bevisst ikke med: klyngekurven (3,7 → 8,4 → 13,0 →
    // 21,7 %) har intet flatt parti, altså finnes det ingen naturlig terskel.
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([flate(1, 0), flate(2, 2)]);
    assert.deepEqual(ider(ut.elements), ['way/1', 'way/2']);
    assert.deepEqual(ut.par, []);
});

test('to punkter rører ikke hverandre', async () => {
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([punkt(1, 0), punkt(2, 2)]);
    assert.deepEqual(ider(ut.elements), ['node/1', 'node/2']);
});

test('relasjon teller som flate', async () => {
    const { dedupNodeOverFlate } = await load();
    const ut = dedupNodeOverFlate([
        punkt(1, 4),
        {
            type: 'relation' as const,
            id: 9,
            tags: { leisure: 'playground', type: 'multipolygon' },
            center: { lat: BASE_LAT, lon: BASE_LNG },
        },
    ]);
    assert.deepEqual(ider(ut.elements), ['relation/9']);
});

// ---------------------------------------------------------------------------
// DETERMINISME — det egentlige beviset
// ---------------------------------------------------------------------------

test('utfallet er uavhengig av rekkefølgen elementene kommer i', async () => {
    // external_id er upsert-nøkkelen. Bytter vinneren mellom to kjøringer,
    // får brukeren en ny rad OG beholder den gamle — importen sletter aldri.
    //
    // Konstruksjonen er med vilje ubehagelig: to flater like nær samme punkt,
    // et punkt med navn, en kjede punkt–flate–punkt, og et par nøyaktig på
    // terskelen.
    const { dedupNodeOverFlate } = await load();
    const scenario = [
        punkt(1, 4),
        flate(2, 0),
        flate(3, 8),
        punkt(4, 4, { name: 'Sagenehagen lekeplass' }),
        punkt(5, 20),
        flate(6, 20 + 10),
        punkt(7, 100),
        flate(8, 0, { name: 'Torshovparken lekeplass' }),
    ];

    const fasit = dedupNodeOverFlate(scenario);
    const fasitIder = ider(fasit.elements).sort();
    const fasitPar = JSON.stringify(fasit.par);

    // Deterministisk stokking, så en feil kan gjenskapes.
    let frø = 12345;
    const neste = () => (frø = (frø * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let runde = 0; runde < 200; runde++) {
        const stokket = [...scenario];
        for (let i = stokket.length - 1; i > 0; i--) {
            const j = Math.floor(neste() * (i + 1));
            [stokket[i], stokket[j]] = [stokket[j], stokket[i]];
        }
        const ut = dedupNodeOverFlate(stokket);
        assert.deepEqual(ider(ut.elements).sort(), fasitIder, `runde ${runde}`);
        assert.equal(JSON.stringify(ut.par), fasitPar, `runde ${runde}: rapporten`);
    }
});

test('et punkt like nær TO flater gir samme rapportlinje hver gang', async () => {
    // Utfallet for punktet er det samme uansett hvilken flate det taper mot,
    // men rapporten skal ikke veksle. Ved nøyaktig lik avstand avgjør id-en.
    const { dedupNodeOverFlate } = await load();
    const a = flate(20, -5);
    const b = flate(3, 5);
    const forventet = dedupNodeOverFlate([punkt(1, 0), a, b]).par[0].flate;
    assert.equal(forventet, 'way/20', 'way/20 sorterer foran way/3 som streng');
    assert.equal(dedupNodeOverFlate([punkt(1, 0), b, a]).par[0].flate, forventet);
});

// ---------------------------------------------------------------------------
// KATEGORIENE
// ---------------------------------------------------------------------------

test('en lekeplass og en ballbane fire meter fra hverandre er TO steder', async () => {
    // Dedupen kjører PER KATEGORI inne i enrichChunk. Testen går derfor
    // gjennom enrichChunk og ikke gjennom den rene funksjonen — det er
    // grupperingen som er garantien.
    const { enrichChunk, PLACE_CATEGORIES } = await load();
    const { chunkForCity } = await import('../lib/import-chunks');
    const cats = PLACE_CATEGORIES.filter((c) => c.key === 'lekeplass' || c.key === 'ballbane');

    const ut = await enrichChunk(
        chunkForCity('Oslo'),
        [
            { c: 'lekeplass', s: 'main', e: punkt(1, 4) },
            {
                c: 'ballbane',
                s: 'main',
                e: {
                    type: 'way' as const,
                    id: 2,
                    tags: { leisure: 'pitch', sport: 'basketball' },
                    center: { lat: BASE_LAT, lon: BASE_LNG },
                },
            },
        ],
        Infinity,
        cats
    );
    assert.deepEqual(
        ut.rows.map((r) => r.external_id).sort(),
        ['node/1', 'way/2'],
        'ulike kategorier skal ikke kunne slå hverandre ut'
    );
    assert.deepEqual(ut.deduped, []);
});

test('innenfor SAMME kategori slår den til, og id-en havner i manifestfeltet', async () => {
    const { enrichChunk, PLACE_CATEGORIES } = await load();
    const { chunkForCity } = await import('../lib/import-chunks');
    const cats = PLACE_CATEGORIES.filter((c) => c.key === 'lekeplass');

    const ut = await enrichChunk(
        chunkForCity('Oslo'),
        [
            { c: 'lekeplass', s: 'main', e: punkt(1, 4) },
            { c: 'lekeplass', s: 'main', e: flate(2, 0) },
        ],
        Infinity,
        cats
    );
    assert.deepEqual(ut.rows.map((r) => r.external_id), ['way/2']);
    assert.deepEqual(ut.deduped, ['node/1']);
});

test('bare kategorier med et MÅLT grunnlag har dedupen på', async () => {
    const { PLACE_CATEGORIES } = await load();
    const paa = PLACE_CATEGORIES.filter((c) => c.dedupNodeOverFlate).map((c) => c.key);
    assert.deepEqual(paa.sort(), ['ballbane', 'lekeplass', 'rullesport']);
});

test('ingen kategori har BÅDE enrichSets og dedupNodeOverFlate', async () => {
    // Aking og Skianlegg har allerede hvert sitt, bedre svar på det samme
    // spørsmålet: verifyPointFacilities gjør en ekte punkt-i-polygon-test, og
    // akingClusters samler på relasjon og navnegruppe. To mekanismer for
    // samme sak ville latt den strengeste vinne i stillhet.
    const { PLACE_CATEGORIES } = await load();
    const begge = PLACE_CATEGORIES.filter((c) => c.enrichSets && c.dedupNodeOverFlate);
    assert.deepEqual(begge.map((c) => c.key), []);
});

// ---------------------------------------------------------------------------
// NEDTAKINGSRAPPORTEN
// ---------------------------------------------------------------------------

test('SQL-en nevner hver id, og bare overgangen unpublish ville gjort', async () => {
    const { nedtakingsRapport } = await load();
    const ut = nedtakingsRapport(['node/1347155489', 'node/1095094457']);
    assert.match(ut, /node\/1347155489/);
    assert.match(ut, /node\/1095094457/);
    assert.match(ut, /set status = 'rejected', locked = true/);
    assert.match(ut, /and a\.status = 'published'/);
    assert.match(ut, /s\.slug = 'osm-steder'/);
});

test('en id med uventet form stopper SQL-en, den pyntes ikke på', async () => {
    // Strengen limes inn i en SQL-editor. En id som ikke ser ut som en id
    // skal stoppe utskriften.
    const { nedtakingsRapport } = await load();
    const ut = nedtakingsRapport(["node/1'; drop table activities; --"]);
    assert.match(ut, /uventet form/);
    assert.ok(!ut.includes('update public.activities'), 'ingen SQL skrives ut');
});
