// scripts/skianlegg-adkomst.test.ts
//
// De rene delene av adkomstmålingen. Feilene her ville vært tause: en usydd
// ring gir tilfeldig «inne/ute», og en for grådig mellomstasjonsregel
// gjemmer hele Turistsenteret i Trysil.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    avstandTilPolygon,
    erDalstasjon,
    idSetning,
    klynger,
    orienter,
    qAdkomst,
    qHeiser,
    ringer,
    type Heis,
} from './skianlegg-adkomst';

const p = (lat: number, lon: number) => ({ lat, lon });
const boks = { minlat: 60, minlon: 6, maxlat: 60.01, maxlon: 6.02 };

test('id-setningen avviser noe annet enn type/tall', () => {
    assert.equal(idSetning('relation/4107373'), 'relation(4107373);');
    assert.throws(() => idSetning('relation/4107373;out'));
    assert.throws(() => idSetning('area/1'));
});

test('heisspørringen bruker out geom UTEN tags', () => {
    const q = qHeiser(boks);
    assert.match(q, /out geom;$/);
    assert.ok(!q.includes('out geom tags'));
    assert.match(q, /aerialway"="station"/);
});

test('adkomstspørringen henter parkering og billettsalg', () => {
    const q = qAdkomst(boks);
    assert.match(q, /amenity"="parking"/);
    assert.match(q, /shop"="ticket"/);
    assert.match(q, /out center tags;$/);
});

test('en relasjon med to ÅPNE ytterways sys til én ring — Voss', () => {
    const a = [p(0, 0), p(0, 1), p(1, 1)];
    const b = [p(1, 1), p(1, 0), p(0, 0)];
    const el = {
        type: 'relation',
        id: 1,
        members: [
            { type: 'way', ref: 1, role: 'outer', geometry: a },
            { type: 'way', ref: 2, role: 'outer', geometry: b },
        ],
    } as unknown as Parameters<typeof ringer>[0];
    const rs = ringer(el);
    assert.equal(rs.length, 1);
    assert.equal(avstandTilPolygon(p(0.5, 0.5), rs), 0);
    assert.ok(avstandTilPolygon(p(0.5, 1.001), rs) > 0);
});

test('bunnen er den LAVESTE enden, også når heisen er tegnet nedover', () => {
    const hoyde = new Map([['0,0', 800], ['1,1', 60]]);
    const o = orienter(p(0, 0), p(1, 1), (x) => hoyde.get(`${x.lat},${x.lon}`) ?? null);
    assert.deepEqual(o.bunn, p(1, 1));
    assert.equal(o.avgjortAv, 'høyde');
    const uten = orienter(p(0, 0), p(1, 1), () => null);
    assert.deepEqual(uten.bunn, p(0, 0));
    assert.equal(uten.avgjortAv, 'tegneretning');
});

const heis = (id: string, bunn: [number, number], topp: [number, number], bunnMoh: number, toppMoh: number): Heis => ({
    id, navn: id, type: 'x', tags: {}, avgjortAv: 'høyde',
    bunn: p(...bunn), topp: p(...topp), bunnMoh, toppMoh,
});

test('et BARNETREKK gjør ikke gondolens bunn til mellomstasjon — Trysil', () => {
    const barnetrekk = heis('eventyr', [61.3101, 12.2470], [61.3111, 12.2467], 415, 480);
    const gondol = heis('gondol', [61.3111, 12.2467], [61.3300, 12.2000], 415, 807);
    assert.equal(erDalstasjon(gondol, [barnetrekk, gondol]), true);
});

test('en heis som starter på toppen av en stor heis er mellomstasjon', () => {
    const stor = heis('stor', [60.0, 6.0], [60.01, 6.0], 300, 800);
    const oppe = heis('oppe', [60.01, 6.0005], [60.02, 6.0], 800, 950);
    assert.equal(erDalstasjon(oppe, [stor, oppe]), false);
});

test('klyngene er enkeltlenke', () => {
    const k = klynger([p(60, 6), p(60.003, 6), p(60.006, 6), p(60.1, 6)], (x) => x, 400);
    assert.deepEqual(k.map((g) => g.length).sort(), [1, 3]);
});
