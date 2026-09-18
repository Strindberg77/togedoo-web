// lib/kart.test.ts
//
// Rutenettet og svarformen for /api/kart. Ingen base: tellingen og
// klyngingen skjer i activities_map (0018), og verifikasjonen mot ekte data
// står i docs/api-kart.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QueryParamError } from './activities-query';
import {
    KART_KOLONNER,
    KART_TERSKEL,
    formKartSvar,
    parseKartBbox,
    ruteBbox,
    rutenettFor,
    type KartRpcSvar,
} from './kart';

const OSLO = { west: 10.68, south: 59.89, east: 10.82, north: 59.945 };

// ── Rutenettet ──────────────────────────────────────────────────────────────

test('aldri flere enn 72 ruter, uansett utsnitt', () => {
    const utsnitt = [
        OSLO,
        { west: 4.5, south: 57.9, east: 12.5, north: 63.5 }, // Sør-Norge
        { west: 10.755, south: 59.92, east: 10.765, north: 59.925 }, // kvartal
        { west: 0, south: 0, east: 0.001, north: 60 }, // absurd smalt og høyt
        { west: 0, south: 60, east: 60, north: 60.0001 }, // absurd bredt og lavt
    ];
    for (const b of utsnitt) {
        const g = rutenettFor(b);
        assert.equal(g.kolonner, KART_KOLONNER);
        assert.ok(g.rader >= 4 && g.rader <= 12, `rader=${g.rader}`);
        assert.ok(g.kolonner * g.rader <= 72);
    }
});

test('rutene er omtrent kvadratiske i kilometer, ikke i grader', () => {
    // Et utsnitt som er like stort i GRADER begge veier, er på 60° nord
    // dobbelt så høyt som bredt i km (cos 60° = 0,5). Rutenettet skal da få
    // flere rader enn kolonner.
    const g = rutenettFor({ west: 10, south: 59.5, east: 11, north: 60.5 });
    assert.ok(g.rader > g.kolonner, `rader=${g.rader}, kolonner=${g.kolonner}`);
});

test('et stående telefonkart får flere rader enn kolonner', () => {
    // 400 × 700 pt ved zoom 13 over Oslo er omtrent 7 × 12 km.
    const g = rutenettFor({ west: 10.69, south: 59.86, east: 10.815, north: 59.968 });
    assert.ok(g.rader >= 10);
});

// ── bbox ───────────────────────────────────────────────────────────────────

test('bbox er påkrevd på kartet', () => {
    assert.throws(() => parseKartBbox(null), QueryParamError);
    assert.throws(() => parseKartBbox(''), QueryParamError);
});

test('et utsnitt uten utstrekning er 400, ikke en deling på null', () => {
    assert.throws(() => parseKartBbox('10.7,59.9,10.7,60'), QueryParamError);
    assert.throws(() => parseKartBbox('10.7,59.9,10.8,59.9'), QueryParamError);
});

test('halv bbox er fortsatt 400', () => {
    assert.throws(() => parseKartBbox('10.7,59.9,10.8'), QueryParamError);
});

// ── Rutas utsnitt ──────────────────────────────────────────────────────────

test('rutene dekker utsnittet uten hull og uten overlapp', () => {
    const g = { kolonner: 6, rader: 8 };
    const forste = ruteBbox(0, 0, OSLO, g);
    const siste = ruteBbox(5, 7, OSLO, g);
    assert.equal(forste.west, OSLO.west);
    assert.equal(forste.south, OSLO.south);
    assert.ok(Math.abs(siste.east - OSLO.east) < 1e-12);
    assert.ok(Math.abs(siste.north - OSLO.north) < 1e-12);
    const nabo = ruteBbox(1, 0, OSLO, g);
    assert.ok(Math.abs(nabo.west - forste.east) < 1e-12, 'naboruta starter der forrige slutter');
});

// ── Svarformen ─────────────────────────────────────────────────────────────

const RAD = {
    id: 'a1',
    kind: 'place',
    title: 'SkiGeilo',
    description: '',
    category: 'Skianlegg',
    target_audience: 'For alle',
    venue_name: null,
    address: null,
    municipality: 'Hol',
    near_city: null,
    lat: 60.53,
    lng: 8.2,
    starts_at: null,
    ends_at: null,
    is_free: false,
    price_text: null,
    url: null,
    image_url: null,
    opening_hours: null,
    osm_tags: null,
    is_indoor: null,
    facets: ['alpint'],
    distance_m: 157000.4,
};

test('stedsmodus: samme radform som /api/activities, og ingen klynger', () => {
    const svar = formKartSvar(
        { total: 1, modus: 'steder', steder: [RAD] } as KartRpcSvar,
        OSLO,
        { kolonner: 6, rader: 8 }
    );
    assert.equal(svar.modus, 'steder');
    assert.equal(svar.total, 1);
    assert.equal(svar.terskel, KART_TERSKEL);
    assert.deepEqual(svar.klynger, []);
    assert.equal(svar.data[0].title, 'SkiGeilo');
    assert.equal(svar.data[0].distanceM, 157000);
    assert.deepEqual(svar.data[0].facets, ['alpint']);
});

test('klyngemodus: tyngdepunkt fra basen, rutas utsnitt, kategorier størst først', () => {
    const rpc: KartRpcSvar = {
        total: 900,
        modus: 'klynger',
        klynger: [
            { cx: 2, cy: 3, antall: 600, lat: 59.912, lng: 10.74, kategorier: { Park: 100, Lekeplass: 500 } },
            { cx: 0, cy: 0, antall: 300, lat: 59.895, lng: 10.69, kategorier: { Museum: 300 } },
        ],
    };
    const svar = formKartSvar(rpc, OSLO, { kolonner: 6, rader: 8 });
    assert.equal(svar.modus, 'klynger');
    assert.deepEqual(svar.data, []);
    const sum = svar.klynger.reduce((a, k) => a + k.antall, 0);
    assert.equal(sum, svar.total, 'summen av klyngene er totalen');
    const [stor] = svar.klynger;
    assert.equal(stor.lat, 59.912, 'tyngdepunktet brukes som det er, ikke rutas midte');
    assert.deepEqual(Object.keys(stor.kategorier), ['Lekeplass', 'Park']);
    const [w, s, e, n] = stor.bbox;
    assert.ok(stor.lng >= w && stor.lng <= e && stor.lat >= s && stor.lat <= n,
        'tyngdepunktet ligger i sin egen rute');
});

test('en klynge uten kategorier (null fra basen) gir et tomt objekt, ikke en krasj', () => {
    const svar = formKartSvar(
        { total: 1, modus: 'klynger', klynger: [{ cx: 0, cy: 0, antall: 1, lat: 59.9, lng: 10.7, kategorier: null }] },
        OSLO,
        { kolonner: 6, rader: 8 }
    );
    assert.deepEqual(svar.klynger[0].kategorier, {});
});
