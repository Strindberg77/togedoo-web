// lib/flatemaal.test.ts
//
// Analysen kan testes uten nett — det er hele grunnen til at den er skilt fra
// hentingen. Kjør: npx tsx --test lib/flatemaal.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    boksMeter,
    langsdekning,
    fordeling,
    maalFlater,
    median,
    snitt,
    STORRELSE_BOTTER,
    type FlateInn,
    type LinjeInn,
} from './flatemaal';

const boks = (minlat: number, minlon: number, maxlat: number, maxlon: number) => ({
    minlat,
    minlon,
    maxlat,
    maxlon,
});

// Trysil, omtrent. 0,01° bredde ≈ 1113 m; 0,01° lengde på 61°N ≈ 540 m.
const FLATE = boks(61.28, 12.26, 61.29, 12.27);

test('bredde og hoyde regnes i meter, ikke i grader', () => {
    const { breddeM, hoydeM } = boksMeter(FLATE);
    assert.ok(Math.abs(hoydeM - 1113) < 5, `hoyde ${hoydeM}`);
    // Lengdegradene er kortere jo lenger nord. På 61,285°N er 0,01° ≈ 538 m.
    assert.ok(Math.abs(breddeM - 538) < 10, `bredde ${breddeM}`);
    assert.ok(breddeM < hoydeM, 'en kvadratisk gradboks er IKKE kvadratisk i meter');
});

test('en rett loype ned hele flata dekker den HELT', () => {
    // GRUNNEN TIL AT DEKNING IKKE MÅLES PÅ AREAL ELLER PÅ SVAKESTE AKSE. En
    // nedfart rett nord–sør har en boks med NULL bredde. Begge de åpenbare
    // målene ville gitt 0 — «dekker ingenting» — om en linje som går tvers
    // gjennom hele flata. Lengdeaksen gir 1, som er det saken handler om.
    const loddrett = boks(61.28, 12.265, 61.29, 12.265);
    assert.equal(langsdekning(FLATE, loddrett), 1);
});

test('lengste akse er HOYDEN her — en gradkvadrat er ikke kvadratisk', () => {
    // 0,01° bredde ≈ 1113 m, 0,01° lengde på 61°N ≈ 538 m. Lengdeaksen er
    // altså nord–sør, og en løype øst–vest dekker bare en brøkdel.
    const tvers = boks(61.285, 12.26, 61.285, 12.27);
    assert.equal(langsdekning(FLATE, tvers), 0, 'null utstrekning langs lengdeaksen');
});

test('en loype utenfor flata dekker ingenting', () => {
    assert.equal(langsdekning(FLATE, boks(61.3, 12.3, 61.31, 12.31)), 0);
    assert.equal(snitt(FLATE, boks(61.3, 12.3, 61.31, 12.31)), null);
});

test('halve lengden gir halv dekning', () => {
    const halv = boks(61.28, 12.26, 61.285, 12.27);
    const d = langsdekning(FLATE, halv);
    assert.ok(Math.abs(d - 0.5) < 0.02, `dekning ${d}`);
});

// ---------------------------------------------------------------------------
// DE TRE SPØRSMÅLENE
// ---------------------------------------------------------------------------

const flate = (id: string, b: ReturnType<typeof boks> | null): FlateInn => ({
    id,
    tags: { landuse: 'recreation_ground', sport: 'skiing' },
    bounds: b,
});
const loype = (id: string, pts: [number, number][]): LinjeInn => ({
    id,
    tags: { 'piste:type': 'downhill' },
    points: pts.map(([lat, lon]) => ({ lat, lon })),
});

test('en flate som er EN loypes areal kjennes igjen', () => {
    // Nedfarten går fra topp til bunn gjennom hele flata. Da er flata løypas
    // areal, og raden en dublett av noe som allerede finnes som linje.
    const m = maalFlater(
        [flate('way/1', FLATE)],
        [loype('way/900', [[61.28, 12.262], [61.285, 12.265], [61.29, 12.268]])],
        []
    );
    assert.equal(m[0].kryssende, 1, 'ÉN linje — det er halve signalet');
    assert.ok(m[0].stersteDekning > 0.95, `dekning ${m[0].stersteDekning}`);
    assert.equal(m[0].stersteLinje, 'way/900');
});

test('et ekte anlegg har FLERE loyper og ingen som dekker alene', () => {
    const m = maalFlater(
        [flate('way/2', FLATE)],
        [
            loype('way/901', [[61.281, 12.261], [61.283, 12.262]]),
            loype('way/902', [[61.285, 12.264], [61.287, 12.265]]),
            loype('way/903', [[61.288, 12.268], [61.289, 12.269]]),
        ],
        []
    );
    assert.equal(m[0].kryssende, 3);
    assert.ok(
        m[0].stersteDekning < 0.35,
        `ingen enkeltløype går hele lengden: ${m[0].stersteDekning}`
    );
});

test('en loype som bare passerer utenfor teller ikke som kryssende', () => {
    // Boksene kan overlappe uten at linja er innom. Derfor måles kryssende på
    // PUNKTENE og ikke på boksen.
    const m = maalFlater(
        [flate('way/3', FLATE)],
        [loype('way/904', [[61.275, 12.255], [61.295, 12.255]])],
        []
    );
    assert.equal(m[0].kryssende, 0, 'linja går nord–sør vest for flata');
});

test('relasjonsmedlemskap slaas opp, og NAVNET er det som spoerres om', () => {
    const m = maalFlater(
        [flate('way/4', FLATE), flate('way/5', FLATE)],
        [],
        [
            { id: 'relation/70', tags: {}, medlemmer: ['way/4'] },
            { id: 'relation/71', tags: { name: 'Trysilfjellet' }, medlemmer: ['way/4', 'way/5'] },
        ]
    );
    // way/4 er medlem av begge. Den NAVNGITTE vinner — det er den som kan
    // brukes som tittel, uansett rekkefølge i svaret.
    assert.equal(m[0].relasjon, 'relation/71');
    assert.equal(m[0].relasjonNavn, 'Trysilfjellet');
    assert.equal(m[1].relasjonNavn, 'Trysilfjellet');
});

test('en flate uten boks gir null, ikke 0 — de betyr ulike ting', () => {
    const m = maalFlater([flate('node/6', null)], [], []);
    assert.equal(m[0].breddeM, null);
    assert.equal(m[0].arealKm2, null);
});

// ---------------------------------------------------------------------------
// FORDELING, ikke bare snitt
// ---------------------------------------------------------------------------

test('fordelingen har faste botter og mister ingen verdi', () => {
    const v = [10, 60, 150, 300, 800, 1500, 5000, 49, 50];
    const f = fordeling(v, STORRELSE_BOTTER);
    assert.equal(
        f.reduce((s, b) => s + b.antall, 0),
        v.length,
        'hver verdi havner i nøyaktig én bøtte'
    );
    assert.deepEqual(
        f.map((b) => [b.merke, b.antall]),
        [
            ['< 50', 2], //      10, 49
            ['50–100', 2], //    50, 60   (grensa hører til bøtta OVER)
            ['100–200', 1], //   150
            ['200–500', 1], //   300
            ['500–1000', 1], //  800
            ['1000–2000', 1], // 1500
            ['> 2000', 1], //    5000
        ]
    );
});

test('medianen sorterer ikke kallerens liste', () => {
    const v = [5, 1, 3];
    assert.equal(median(v), 3);
    assert.deepEqual(v, [5, 1, 3]);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), null);
});
