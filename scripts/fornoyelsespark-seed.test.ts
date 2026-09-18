// scripts/fornoyelsespark-seed.test.ts
// De åtte parkene fra docs/fornoyelsespark-maling.md: riktig kategori,
// punktet fra inngangen, og beskrivelser som ikke går ut på dato.
//
// Ingen nettverk, ingen database.
// Kjør: npx tsx --test scripts/fornoyelsespark-seed.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEED, splitFor, toRow } from './seed-vintertilbud';
import { OSM_CLAIMS } from '../lib/osm-claims';

const PARKER = [
    'tusenfryd',
    'kongeparken',
    'hunderfossen-eventyrpark',
    'lilleputthammer',
    'foldvik-familiepark',
    'mikkelparken',
    'dyreparken',
    'bo-sommarland',
];

const rad = (id: string) => {
    const s = SEED.find((x) => x.externalId === id);
    assert.ok(s, `mangler seed-rad ${id}`);
    return s;
};

test('kategoriene: seks Fornøyelsespark, Dyreparken Dyremøte med fasett, Bø Sommarland Badeland ute', () => {
    const fp = PARKER.filter((id) => splitFor(id).category === 'Fornøyelsespark');
    assert.equal(fp.length, 6);
    assert.deepEqual(splitFor('dyreparken'), {
        category: 'Dyremøte',
        isIndoor: false,
        facets: ['fornoyelsespark'],
    });
    const bo = splitFor('bo-sommarland');
    assert.equal(bo.category, 'Badeland');
    assert.equal(bo.isIndoor, false, 'Bø Sommarland er ute');
    for (const id of PARKER) assert.equal(splitFor(id).isIndoor, false, `${id} er ute`);
});

test('hver park har et fast punkt og betalt inngang', () => {
    for (const id of PARKER) {
        const s = rad(id);
        assert.ok(s.manualCoord, `${id}: punktet er inngangen, ikke en geokodet adresse`);
        assert.equal(s.isFree, false, `${id}: is_free = false`);
        assert.ok(s.municipality, `${id}: municipality`);
        assert.ok(s.url?.startsWith('https://'), `${id}: url`);
    }
    // Mikkelparken har ingen inngang i OSM — punktet er et forslag.
    assert.equal(rad('mikkelparken').coordVerified, false);
});

test('beskrivelsene har ingen tall og ingen superlativer', () => {
    // Priser, åpningstider, høydegrenser og antall har alle sifre; det er
    // det enkleste som fanger dem. Superlativene står i parkenes egne
    // titler («Norges største …») og skal ikke smitte over hit.
    for (const id of PARKER) {
        const d = rad(id).description;
        assert.doesNotMatch(d, /\d/, `${id}: tall i beskrivelsen`);
        assert.doesNotMatch(d, /største|beste|mest|lengste|høyeste|eneste/i, `${id}: superlativ`);
    }
});

test('hver park er claimet, og alle claimene er forebyggende', () => {
    for (const id of PARKER) {
        const claims = OSM_CLAIMS.filter((c) => c.externalId === id);
        assert.equal(claims.length, 1, `${id}: én claim`);
        assert.equal(claims[0].expectNoHit, true, `${id}: importen henter ikke theme_park i dag`);
    }
});

test('Kongeparkene i Tromsø, Bodø og Trysil er IKKE claimet', () => {
    // leisure=park med navnet «Kongeparken» — ekte byparker langt fra Ålgård.
    for (const osmId of ['way/103268212', 'way/189732650', 'way/614558426']) {
        assert.ok(!OSM_CLAIMS.some((c) => c.osmId === osmId), `${osmId} er claimet`);
    }
});

test('toRow: raden blir published med fasett og uten near_city der den ikke er satt', () => {
    const r = toRow(rad('dyreparken'), 'kilde', 58.18709, 8.14012, true);
    assert.equal(r.status, 'published');
    assert.equal(r.category, 'Dyremøte');
    assert.deepEqual(r.facets, ['fornoyelsespark']);
    assert.equal(r.near_city, null);
    assert.equal(r.is_free, false);
});
