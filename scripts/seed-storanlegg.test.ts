// scripts/seed-storanlegg.test.ts
//
// Forslaget skal ikke kunne gli inn i drift ved et uhell: claimene må stå
// UTENFOR OSM_CLAIMS til valgene er gjort, og TODO-ene må telles.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OSM_CLAIMS } from '../lib/osm-claims';
import { SEED } from './seed-vintertilbud';
import { FORESLATTE_CLAIMS, FORSLAG, TODO, aapneTodo, qNavn, strukturfeil } from './seed-storanlegg';

test('forslaget er strukturelt gyldig mot dagens claims og seed', () => {
    assert.deepEqual(strukturfeil(FORSLAG, FORESLATTE_CLAIMS, OSM_CLAIMS, SEED.map((s) => s.externalId)), []);
});

test('ingen foreslått claim er aktiv — importen skal ikke hoppe over anleggene ennå', () => {
    for (const c of FORESLATTE_CLAIMS) {
        assert.ok(!OSM_CLAIMS.some((e) => e.osmId === c.osmId), c.osmId);
    }
});

test('de tre anleggene og delflatene fra oppdraget er claimet', () => {
    const ider = FORESLATTE_CLAIMS.map((c) => c.osmId);
    for (const id of ['relation/4107373', 'way/1210019615', 'relation/17004845', 'way/55606470', 'way/1348055350']) {
        assert.ok(ider.includes(id), id);
    }
});

test('hvert adkomstpunkt ligger nærmere enn 5 km fra dagens punkt — fanger byttet lat/lng', () => {
    for (const f of FORSLAG) {
        for (const a of f.adkomster) {
            const dlat = (a.lat - f.dagens.lat) * 111_320;
            const dlon = (a.lng - f.dagens.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
            assert.ok(Math.hypot(dlat, dlon) < 5000, `${f.externalId}/${a.base}`);
        }
    }
});

test('TODO telles, og en valgt base må finnes blant kandidatene', () => {
    const f = FORSLAG[0];
    assert.deepEqual(aapneTodo(f), ['title', 'valgtBase', 'description']);
    const valgt = { ...f, title: 'Voss Resort', valgtBase: 'Bavallen', description: 'Ferdig.' };
    assert.deepEqual(aapneTodo(valgt), []);
    assert.equal(aapneTodo({ ...valgt, valgtBase: 'Myrkdalen' }).length, 1);
    assert.equal(TODO, 'TODO');
});

test('strukturfeil fanger claim uten rad og dobbel claim', () => {
    const feil = strukturfeil(
        FORSLAG,
        [...FORESLATTE_CLAIMS, { ...FORESLATTE_CLAIMS[0], externalId: 'finnes-ikke' }],
        [FORESLATTE_CLAIMS[1]],
        []
    );
    assert.ok(feil.some((f) => f.includes('finnes-ikke')));
    assert.ok(feil.some((f) => f.includes('allerede claimet')));
});

test('navnespørringen bruker out tags', () => {
    assert.match(qNavn(['relation/1', 'way/2']), /relation\(1\);\n {2}way\(2\);\n\);\nout tags;$/);
});
