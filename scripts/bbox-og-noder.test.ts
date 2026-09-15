// scripts/bbox-og-noder.test.ts
//
// TRE FUNN fra work-report etter første nasjonale tørrkjøring (sep. 2026):
//
//   1. 63–71 % av de hentede objektene lå utenfor Norge. Testene her dekker
//      de to KONSEKVENSENE av det, ikke boksvalget selv (det ligger i
//      lib/norway-boxes.test.ts): at flere bokser kan brukes i det hele tatt,
//      og at utenlandske objekter ikke lenger spiser --limit.
//   2. 774 objekter ble meldt «HOPPET OVER — ingen geometri», og alle var
//      noder. De får nå en dom på bevis i stedet for å forsvinne.
//
// Ingen nettverk, ingen database.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    NATIONAL_BBOX,
    NORWAY_BANDS_4,
    chunkForCity,
    nationalChunk,
    scopedSelector,
} from '../lib/import-chunks';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_QUERY_PAUSE_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

// ---------------------------------------------------------------------------
// FUNN 1a — FLERE BOKSER
// ---------------------------------------------------------------------------

test('scopedSelector gjentar hver LINJE per boks, ikke hvert filter per setning', async () => {
    // DET AVGJØRENDE: to bbox-filtre på SAMME setning ville gitt snittet av
    // boksene — altså tomt, siden båndene knapt overlapper. Og tomt ser ut
    // som et land uten alpinanlegg.
    const { PLACE_CATEGORIES } = await load();
    const ski = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!;
    const linjer = ski.selector.split('\n').map((l) => l.trim()).filter(Boolean);
    const ut = scopedSelector(ski.selector, nationalChunk(NORWAY_BANDS_4));

    const utLinjer = ut.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.equal(utLinjer.length, linjer.length * NORWAY_BANDS_4.length);
    assert.ok(!ut.includes('(area.a)'), 'ingen rest av den kanoniske formen');
    for (const l of utLinjer) {
        const treff = NORWAY_BANDS_4.filter((b) => l.includes(b));
        assert.equal(treff.length, 1, `«${l}» har ${treff.length} bokser, skal ha nøyaktig én`);
    }
    // Hver boks skal ha fått ALLE linjene.
    for (const boks of NORWAY_BANDS_4) {
        assert.equal(utLinjer.filter((l) => l.includes(boks)).length, linjer.length);
    }
});

test('én boks og én area gir nøyaktig samme utdata som før', async () => {
    // Ingen regresjon for de to bruksmåtene som finnes i dag.
    const { PLACE_CATEGORIES } = await load();
    const ski = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!;
    assert.equal(
        scopedSelector(ski.selector, nationalChunk()),
        ski.selector.split('(area.a)').join(NATIONAL_BBOX)
    );
    assert.equal(scopedSelector(ski.selector, chunkForCity('Oslo')), ski.selector);
});

test('bokssettet ligger i hentestegets fingeravtrykk', async () => {
    // FEILEN SOM BLE RETTET: fingeravtrykket hashet `overpassArea`, og den er
    // TOM STRENG for den nasjonale chunken. Bboksen lå altså ikke i det i det
    // hele tatt, og «bytt boks og kjør med --resume» ville gjenbrukt
    // gårsdagens objekter uten en eneste advarsel.
    const { overpassQuery } = await load();
    const { fingerprint } = await import('../lib/import-chunks');
    const en = nationalChunk();
    const fire = nationalChunk(NORWAY_BANDS_4);
    const fp = (c: ReturnType<typeof nationalChunk>) =>
        fingerprint({ v: 2, area: c.overpassArea, scopes: [...c.overpassScopes] });
    assert.notEqual(fp(en), fp(fire), 'et nytt bokssett MÅ gi et nytt fingeravtrykk');
    assert.equal(en.overpassArea, fire.overpassArea, 'og det er ikke area som skiller dem');
    // Og spørringen som faktisk sendes inneholder alle fire boksene.
    const q = overpassQuery(fire, 'nwr["leisure"="park"](area.a);', 'out center tags');
    for (const b of NORWAY_BANDS_4) assert.ok(q.includes(b), `mangler ${b}`);
});

// ---------------------------------------------------------------------------
// FUNN 1b — --limit TELLES ETTER NORGE-FILTERET
// ---------------------------------------------------------------------------

test('--limit teller NORSKE rader, ikke hentede objekter', async () => {
    // Med 63–71 % utenlandske objekter i den nasjonale hentingen betydde den
    // gamle rekkefølgen at de utenlandske spiste kvoten. Her er to av tre
    // objekter svenske, og --limit=2 skal likevel gi de to NORSKE.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const { municipalityIndex } = await import('./municipality-index');
    const rows = await buildRows(
        null,
        [
            { type: 'way', id: 1, tags: { leisure: 'park', name: 'Humlegarden' }, center: { lat: 59.3419, lon: 18.0784 } },
            { type: 'way', id: 2, tags: { leisure: 'park', name: 'Kungstradgarden' }, center: { lat: 59.3307, lon: 18.0716 } },
            { type: 'way', id: 3, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } },
            { type: 'way', id: 4, tags: { leisure: 'park', name: 'Nygaardsparken' }, center: { lat: 60.386, lon: 5.324 } },
        ],
        2,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.deepEqual(
        rows.map((r) => r.title),
        ['Sofienbergparken', 'Nygaardsparken'],
        'de to svenske skal ikke ha brukt opp kvoten'
    );
});

test('--limit er uendret for en by-chunk', async () => {
    // Per-kommune-modus har ingen Norge-filter i det hele tatt, og skal
    // oppføre seg nøyaktig som før rettingen.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const rows = await buildRows(
        'Oslo',
        ['Frognerparken', 'Torshovparken', 'Stovnerparken'].map((navn, i) => ({
            type: 'way' as const,
            id: i + 1,
            tags: { leisure: 'park', name: navn },
            center: { lat: 59.9 + i / 1000, lon: 10.7 },
        })),
        2,
        [park]
    );
    assert.deepEqual(rows.map((r) => r.title), ['Frognerparken', 'Torshovparken']);
});

// ---------------------------------------------------------------------------
// FUNN 2 — PUNKTOBJEKTENE
// ---------------------------------------------------------------------------

/** En firkant rundt (lat, lon) med gitt halvbredde i grader. */
const rute = (lat: number, lon: number, d: number) => [
    { lat: lat - d, lon: lon - d },
    { lat: lat - d, lon: lon + d },
    { lat: lat + d, lon: lon + d },
    { lat: lat + d, lon: lon - d },
    { lat: lat - d, lon: lon - d },
];

test('en node med nedfart innen radiusen blir alpint', async () => {
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            { type: 'node', id: 1, lat: 62.98, lon: 8.65, tags: { landuse: 'winter_sports', name: 'Surnadal alpinsenter' } },
        ],
        bevis: [
            // ~110 m nord for noden.
            { type: 'way', id: 9, tags: { 'piste:type': 'downhill' }, geometry: [
                { lat: 62.981, lon: 8.65 },
                { lat: 62.985, lon: 8.652 },
            ] },
        ],
    });
    assert.deepEqual(ut.elements.map((e) => e.tags?.name), ['Surnadal alpinsenter']);
    assert.match(ut.rapport.join('\n'), /alpint.*punkt, 1 bevis innen 250 m/);
});

test('en node UTEN utforbevis blir ikke-alpint — langrennsstadionene faller ut på bevis', async () => {
    // Den viktige forskjellen fra før: de falt ut fordi en node ikke har
    // geometri. Nå faller de ut fordi det ikke er en utforløype der, som er
    // den samme regelen flatene dømmes etter.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            { type: 'node', id: 2, lat: 59.56, lon: 7.35, tags: { landuse: 'winter_sports', name: 'Hovden Langrennsarena' } },
        ],
        // nordic hentes ikke som bevis i det hele tatt — her er en mtb-løype,
        // som er et bevis, men ikke et alpint et.
        bevis: [{ type: 'way', id: 9, tags: { 'mtb:type': 'flow' }, geometry: [{ lat: 59.5605, lon: 7.35 }] }],
    });
    assert.deepEqual(ut.elements, []);
    assert.match(ut.rapport.join('\n'), /ikke-alpint/);
});

test('avstanden til nærmeste bevis står i rapporten UANSETT dom', async () => {
    // Det er denne linja som gjør at radiusen kan velges på data i stedet
    // for på begrunnelsen i [SKI_NODE_RADIUS_M]. Uten den ville én
    // tørrkjøring ikke sagt noe om hvor tallet burde ligge.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [{ type: 'node', id: 3, lat: 61.0, lon: 9.0, tags: { landuse: 'winter_sports' } }],
        bevis: [
            // ~220 m unna: innenfor, men langt nok til at tallet er lesbart.
            { type: 'way', id: 9, tags: { 'piste:type': 'downhill' }, geometry: [{ lat: 61.002, lon: 9.0 }] },
        ],
    });
    assert.match(ut.rapport.join('\n'), /nærmeste 22\d m/);
});

test('et bevis UTENFOR radiusen gir «> radius», ikke et tall', async () => {
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [{ type: 'node', id: 4, lat: 61.0, lon: 9.0, tags: { landuse: 'winter_sports' } }],
        bevis: [{ type: 'way', id: 9, tags: { 'piste:type': 'downhill' }, geometry: [{ lat: 61.02, lon: 9.0 }] }],
    });
    assert.deepEqual(ut.elements, []);
    assert.match(ut.rapport.join('\n'), /nærmeste > 250 m/);
});

test('en node INNE i en flate er en dublett, ikke en ny rad', async () => {
    // Uten dette ville et anlegg kartlagt både som node og som polygon blitt
    // TO rader, med hver sin external_id — altså usynlig for upsert-nøkkelen.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            { type: 'way', id: 10, tags: { landuse: 'winter_sports', name: 'Anlegget' }, geometry: rute(61, 9, 0.01) },
            { type: 'node', id: 11, lat: 61.0, lon: 9.0, tags: { landuse: 'winter_sports', name: 'Anlegget' } },
        ],
        bevis: [{ type: 'way', id: 9, tags: { 'piste:type': 'downhill' }, geometry: [{ lat: 61.001, lon: 9.001 }] }],
    });
    assert.deepEqual(ut.elements.map((e) => `${e.type}/${e.id}`), ['way/10']);
    assert.match(ut.rapport.join('\n'), /dublett.*ligger i en flate/);
});

test('oppsummeringen teller punktobjektene for seg', async () => {
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            { type: 'node', id: 1, lat: 62.98, lon: 8.65, tags: { landuse: 'winter_sports' } },
            { type: 'node', id: 2, lat: 59.56, lon: 7.35, tags: { landuse: 'winter_sports' } },
        ],
        bevis: [{ type: 'way', id: 9, tags: { 'piste:type': 'downhill' }, geometry: [{ lat: 62.981, lon: 8.65 }] }],
    });
    assert.match(ut.summary!, /punktobjekter: 2 \(1 alpint, 0 i en flate, 1 ikke-alpint\)/);
});

test('radiusen kan settes uten en kodeendring', async () => {
    const { verifyPointFacilities } = await load();
    const node = { type: 'node' as const, id: 1, lat: 61.0, lon: 9.0, tags: { landuse: 'winter_sports' } };
    const bevis = [
        {
            el: { type: 'way' as const, id: 9, tags: { 'piste:type': 'downhill' } },
            points: [{ lat: 61.004, lon: 9.0 }], // ~445 m
            bounds: { minlat: 61.004, minlon: 9.0, maxlat: 61.004, maxlon: 9.0 },
        },
    ];
    assert.equal(verifyPointFacilities([node], bevis, [], 250).verified.length, 0);
    assert.equal(verifyPointFacilities([node], bevis, [], 600).verified.length, 1);
});

test('et objekt uten hverken flate eller punkt hoppes fortsatt over', async () => {
    // Den gamle meldingen skal ikke forsvinne — den skal bare slutte å gjelde
    // noder. Ordlyden er endret nettopp for at de to ikke skal forveksles.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [{ type: 'relation', id: 5, tags: { landuse: 'winter_sports' } }],
        bevis: [],
    });
    assert.match(ut.rapport.join('\n'), /HOPPET OVER — verken flate eller punkt/);
    assert.match(ut.summary!, /1 objekter uten geometri i det hele tatt/);
});
