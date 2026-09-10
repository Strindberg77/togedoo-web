// lib/cities.test.ts
// By-modus-sortering: avstand fra bysentrum. Ingen nettverk, ingen database —
// rene funksjoner.
// Kjør: node --import tsx --test lib/cities.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CITY_CENTRES,
    cityCentre,
    distanceFromCityKm,
    distanceKm,
    sortByDistanceFromCity,
} from './cities';

// Koordinatene som utløste hele saken.
const VASSFJELLET = { lat: 63.2333, lng: 10.3167 }; // Melhus, ~20 km fra Trondheim
const OPPDAL = { lat: 62.5947, lng: 9.6889 }; // ~120 km fra Trondheim

test('bysentrene slås opp uavhengig av store og små bokstaver', () => {
    assert.deepEqual(cityCentre('Oslo'), CITY_CENTRES.oslo);
    assert.deepEqual(cityCentre('  trondheim '), CITY_CENTRES.trondheim);
    // Ukjent by er ikke en feil — da beholdes databasens rekkefølge.
    assert.equal(cityCentre('Melhus'), null);
    assert.equal(cityCentre(''), null);
    assert.equal(cityCentre(null), null);
    assert.equal(cityCentre(undefined), null);
});

test('alle fire byene er dekket', () => {
    assert.deepEqual(Object.keys(CITY_CENTRES).sort(), [
        'bergen',
        'oslo',
        'stavanger',
        'trondheim',
    ]);
});

test('avstanden treffer størrelsesordenen som betyr noe', () => {
    const trondheim = CITY_CENTRES.trondheim;
    const nær = distanceKm(trondheim, VASSFJELLET);
    const langt = distanceKm(trondheim, OPPDAL);
    // Grove grenser med vilje: tallet skal skille 20 km fra 120 km, ikke
    // planlegge en kjørerute. Fugleflukt, så det ligger under kjøreavstand.
    assert.ok(nær > 15 && nær < 30, `Vassfjellet ble ${nær.toFixed(1)} km`);
    assert.ok(langt > 85 && langt < 130, `Oppdal ble ${langt.toFixed(1)} km`);
    assert.ok(langt > nær * 3, 'de to skal ikke være i nærheten av hverandre');
});

test('avstanden er null når vi ikke vet — ikke null kilometer', () => {
    const oslo = CITY_CENTRES.oslo;
    assert.equal(distanceFromCityKm(null, 59.9, 10.7), null, 'ukjent by');
    assert.equal(distanceFromCityKm(oslo, null, 10.7), null, 'mangler lat');
    assert.equal(distanceFromCityKm(oslo, 59.9, null), null, 'mangler lng');
    // ...og et ekte tall når vi vet.
    assert.equal(typeof distanceFromCityKm(oslo, 59.9, 10.7), 'number');
});

test('avstanden avrundes til hele kilometer', () => {
    const km = distanceFromCityKm(CITY_CENTRES.trondheim, OPPDAL.lat, OPPDAL.lng);
    assert.ok(km !== null && Number.isInteger(km), `fikk ${km}`);
});

test('DEFEKTEN: nærmeste anlegg sorteres først, ikke alfabetisk', () => {
    // «Oppdal» < «Vassfjellet» alfabetisk. Det var hele feilen.
    const rows = [
        { title: 'Oppdal Skisenter', ...OPPDAL },
        { title: 'Vassfjellet Skisenter', ...VASSFJELLET },
    ];
    const sortert = sortByDistanceFromCity(rows, CITY_CENTRES.trondheim);
    assert.deepEqual(sortert.map((r) => r.title), [
        'Vassfjellet Skisenter',
        'Oppdal Skisenter',
    ]);
});

test('steder uten koordinater havner sist, ikke først', () => {
    const rows = [
        { title: 'uten koordinater', lat: null, lng: null },
        { title: 'Oppdal', ...OPPDAL },
        { title: 'Vassfjellet', ...VASSFJELLET },
    ];
    const sortert = sortByDistanceFromCity(rows, CITY_CENTRES.trondheim);
    assert.deepEqual(sortert.map((r) => r.title), [
        'Vassfjellet',
        'Oppdal',
        'uten koordinater',
    ]);
});

test('ukjent by lar rekkefølgen stå — ingen vilkårlig omstokking', () => {
    const rows = [
        { title: 'b', ...OPPDAL },
        { title: 'a', ...VASSFJELLET },
    ];
    assert.deepEqual(
        sortByDistanceFromCity(rows, null).map((r) => r.title),
        ['b', 'a']
    );
});

test('sorteringen er stabil og muterer ikke inndata', () => {
    // Fire steder på nøyaktig samme punkt: rekkefølgen fra databasen skal stå.
    const rows = ['a', 'b', 'c', 'd'].map((title) => ({ title, ...VASSFJELLET }));
    const original = rows.map((r) => r.title);
    const sortert = sortByDistanceFromCity(rows, CITY_CENTRES.trondheim);
    assert.deepEqual(sortert.map((r) => r.title), original);
    assert.deepEqual(rows.map((r) => r.title), original, 'inndata skal være urørt');
    assert.notEqual(sortert, rows, 'skal returnere en ny liste');
});

test('hver by sorterer sine egne nærmest — ikke bare Trondheim', () => {
    // Samme to steder sett fra Oslo: begge er langt unna, men Oppdal er
    // nærmere Oslo enn Vassfjellet er. Rekkefølgen skal snu.
    const rows = [
        { title: 'Vassfjellet', ...VASSFJELLET },
        { title: 'Oppdal', ...OPPDAL },
    ];
    const fraOslo = sortByDistanceFromCity(rows, CITY_CENTRES.oslo);
    assert.deepEqual(fraOslo.map((r) => r.title), ['Oppdal', 'Vassfjellet']);
});
