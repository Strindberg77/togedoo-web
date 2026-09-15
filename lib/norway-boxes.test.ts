// lib/norway-boxes.test.ts
//
// VAKTENE rundt bboks-alternativet til den nasjonale hentingen.
//
// Det testene her faktisk verner mot er en STILLE innsnevring: et bokssett
// som ser riktig ut, men som ikke dekker Vardø, Utsira eller Ny-Ålesund,
// ville gitt en import som bare mangler noen kommuner — og ingenting i
// kjøringen ville sagt fra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import { boundsOf, type GeoBounds, type GeoPoint } from './geo-polygon';
import {
    BOX_MARGIN_M,
    bboxFilter,
    boxAreaKm2,
    optimalBands,
    padBox,
    pointInBox,
    uncovered,
} from './norway-boxes';
import { NATIONAL_BBOX, NORWAY_BANDS_4, NORWAY_BANDS_5, nationalBoxes, nationalChunk } from './import-chunks';
import { MUNICIPALITY_FILE } from '../scripts/municipality-index';

/** `(minlat,minlon,maxlat,maxlon)` tilbake til en boks. */
function parseBox(s: string): GeoBounds {
    const [minlat, minlon, maxlat, maxlon] = s.slice(1, -1).split(',').map(Number);
    return { minlat, minlon, maxlat, maxlon };
}

let punkterCache: GeoPoint[] | null = null;
let kommunerCache: { navn: string; punkter: GeoPoint[] }[] | null = null;
function kommuner(): { navn: string; punkter: GeoPoint[] }[] {
    if (kommunerCache) return kommunerCache;
    const gj = JSON.parse(fs.readFileSync(MUNICIPALITY_FILE, 'utf8'));
    kommunerCache = gj.features.map((f: { properties: { name: string }; geometry: { coordinates: unknown } }) => {
        const punkter: GeoPoint[] = [];
        const walk = (c: unknown): void => {
            const a = c as number[] | unknown[];
            if (typeof a[0] === 'number') punkter.push({ lat: a[1] as number, lon: a[0] as number });
            else for (const d of a) walk(d);
        };
        walk(f.geometry.coordinates);
        return { navn: f.properties.name, punkter };
    });
    return kommunerCache!;
}
function allePunkter(): GeoPoint[] {
    if (!punkterCache) punkterCache = kommuner().flatMap((k) => k.punkter);
    return punkterCache;
}

test('båndene i lib/import-chunks.ts er de samme som regnes ut fra grensefila', () => {
    // REGENERERINGSVAKTEN. Konstantene er skrevet inn for hånd, så de kan
    // komme i utakt med data/kommuner.geojson den dagen fila oppdateres.
    // Feiler denne, kjør `npx tsx scripts/bbox-candidates.ts` og lim inn på
    // nytt — IKKE endre tallene for hånd.
    const punkter = allePunkter();
    for (const [k, fasit] of [
        [4, NORWAY_BANDS_4],
        [5, NORWAY_BANDS_5],
    ] as const) {
        const regnet = optimalBands(punkter, k).map((b) => bboxFilter(padBox(b, BOX_MARGIN_M)));
        assert.deepEqual(regnet, [...fasit], `k=${k}`);
    }
});

test('hvert punkt i hver kommune ligger i minst én boks', () => {
    // Avrundingen til to desimaler i bboxFilter kan flytte en kant inntil
    // ~550 m. Testen gjøres derfor på de AVRUNDEDE tallene — altså på det
    // som faktisk sendes til Overpass, ikke på flyttallene bak dem.
    for (const [navn, bokser] of [
        ['4 bånd', NORWAY_BANDS_4],
        ['5 bånd', NORWAY_BANDS_5],
        ['dagens', [NATIONAL_BBOX]],
    ] as const) {
        const parsed = bokser.map(parseBox);
        const ute = uncovered(allePunkter(), parsed);
        const mangler = kommuner()
            .filter((k) => k.punkter.some((p) => !parsed.some((b) => pointInBox(p, b))))
            .map((k) => k.navn);
        assert.equal(
            ute.length,
            0,
            `${navn}: ${ute.length} punkter utenfor, i ${mangler.slice(0, 5).join(', ')}`
        );
    }
});

test('marginen er der — boksene klipper ikke på grensa', () => {
    // Uten margin mister et grenseanlegg bevis som ligger noen titalls meter
    // inn i Sverige, og faller stille fra «alpint» til «ikke-alpint».
    const norge = boundsOf(allePunkter())!;
    const sor = parseBox(NORWAY_BANDS_4[0]);
    assert.ok(sor.minlat < norge.minlat, 'sørkanten skal ligge under Norges sørligste punkt');
    assert.ok(sor.minlon < norge.minlon, 'vestkanten skal ligge vest for Norges vestligste punkt');
    const nord = parseBox(NORWAY_BANDS_4[3]);
    assert.ok(nord.maxlat > norge.maxlat);
    assert.ok(nord.maxlon > norge.maxlon);
});

test('båndene er MINDRE enn dagens boks, og flere bånd er ikke verre', () => {
    // Med LIKE HØYE bånd var k=6 faktisk større enn k=5, fordi et fast snitt
    // kan legges midt i den brede delen av landet. Den optimale delingen kan
    // ikke bli verre av et bånd til — det er hele grunnen til at delingen
    // regnes ut i stedet for å velges.
    const punkter = allePunkter();
    const areal = (bokser: readonly GeoBounds[]) =>
        bokser.reduce((s, b) => s + boxAreaKm2(b), 0);
    let forrige = Infinity;
    for (const k of [1, 2, 3, 4, 5, 6, 8]) {
        const a = areal(optimalBands(punkter, k).map((b) => padBox(b, BOX_MARGIN_M)));
        assert.ok(a <= forrige + 1, `k=${k} ga større areal enn k=${k - 1}`);
        forrige = a;
    }
    assert.ok(areal([parseBox(NATIONAL_BBOX)]) > forrige);
});

test('nationalBoxes velges av miljøvariabelen, og standarden er den MÅLTE boksen', () => {
    assert.deepEqual(nationalBoxes(undefined), [NATIONAL_BBOX]);
    assert.deepEqual(nationalBoxes(''), [NATIONAL_BBOX]);
    assert.deepEqual(nationalBoxes('4'), NORWAY_BANDS_4);
    assert.deepEqual(nationalBoxes('5'), NORWAY_BANDS_5);
    // En skrivefeil skal ikke bety «dagens boks» i stillhet.
    assert.throws(() => nationalBoxes('fire'), /PLACES_NATIONAL_BANDS/);
    assert.throws(() => nationalBoxes('6'), /PLACES_NATIONAL_BANDS/);
    assert.deepEqual(nationalChunk().overpassScopes, [NATIONAL_BBOX]);
});
