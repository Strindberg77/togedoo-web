// scripts/storanlegg.test.ts
//
// Voss Resort, Trysil skisenter og SkiGeilo: tre seed-rader som eier åtte
// OSM-objekter. Se docs/skianlegg-adkomst.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OSM_CLAIMS, assertClaimsResolve, claimsByOsmId } from '../lib/osm-claims';
import { SEED, SOURCE, splitFor, toRow, ukjenteFlagg, velgUtvalg } from './seed-vintertilbud';

const NYE = {
    'voss-resort': { title: 'Voss Resort', municipality: 'Voss', lat: 60.62919, lng: 6.41115 },
    'trysil-skisenter': { title: 'Trysil skisenter', municipality: 'Trysil', lat: 61.31111, lng: 12.24674 },
    'skigeilo': { title: 'SkiGeilo', municipality: 'Hol', lat: 60.53463, lng: 8.19813 },
} as const;

const EIERSKAP: Record<string, readonly string[]> = {
    'voss-resort': ['relation/4107373', 'way/1348055350'],
    'trysil-skisenter': ['way/1210019615', 'way/55606470'],
    'skigeilo': ['relation/17004845', 'relation/10859554', 'way/1238316509', 'way/1238316510'],
};

test('de tre radene har valgt tittel, basepunkt og EKTE kommune', () => {
    for (const [id, v] of Object.entries(NYE)) {
        const s = SEED.find((x) => x.externalId === id);
        assert.ok(s, id);
        assert.equal(s!.title, v.title);
        // Uten kommune faller de ut av kommunetallet for Skianlegg.
        assert.equal(s!.municipality, v.municipality);
        assert.equal(s!.nearCity, undefined, 'ligger i egen kommune');
        assert.deepEqual(s!.manualCoord, { lat: v.lat, lng: v.lng });
        assert.ok(s!.address && s!.url, 'adresse og nettside');
    }
});

test('beskrivelsene har ingen tall som går ut på dato', () => {
    for (const id of Object.keys(NYE)) {
        const s = SEED.find((x) => x.externalId === id)!;
        assert.doesNotMatch(s.description, /\d/, id);
        assert.doesNotMatch(s.description, /TODO/, id);
    }
});

test('fasettene er kopiert fra importradene', () => {
    assert.deepEqual(splitFor('voss-resort').facets, ['alpint']);
    assert.deepEqual(splitFor('trysil-skisenter').facets, ['alpint', 'aking', 'terrengsykling', 'downhill']);
    assert.deepEqual(splitFor('skigeilo').facets, ['alpint', 'skileik', 'aking']);
});

test('raden som skrives er published med basepunktet', () => {
    const s = SEED.find((x) => x.externalId === 'voss-resort')!;
    const r = toRow(s, 'kilde', s.manualCoord!.lat, s.manualCoord!.lng, true);
    assert.equal(r.status, 'published');
    assert.equal(r.category, 'Skianlegg');
    assert.equal(r.municipality, 'Voss');
    assert.equal(r.near_city, null);
    assert.equal(r.address, 'Voss Gondol, Voss sentrum');
});

test('åtte claims, og hver rad eier nøyaktig objektene sine', () => {
    const faktisk = OSM_CLAIMS.filter((c) => c.externalId in EIERSKAP);
    assert.equal(faktisk.length, 8);
    for (const [id, objekter] of Object.entries(EIERSKAP)) {
        assert.deepEqual(faktisk.filter((c) => c.externalId === id).map((c) => c.osmId).sort(), [...objekter].sort());
    }
    for (const c of faktisk) {
        assert.equal(c.source, SOURCE.slug);
        assert.equal(claimsByOsmId().get(c.osmId)!.length, 1, `${c.osmId} har én eier`);
        assert.ok(!c.expectNoHit, 'importen skal treffe dem');
    }
    assert.doesNotThrow(() => assertClaimsResolve(SOURCE.slug, SEED.map((s) => s.externalId)));
});

test('--only skriver bare utvalget, og avviser ukjente id-er', () => {
    assert.equal(velgUtvalg(SEED, undefined).length, SEED.length);
    assert.deepEqual(
        velgUtvalg(SEED, 'voss-resort, trysil-skisenter,skigeilo').map((s) => s.externalId).sort(),
        ['skigeilo', 'trysil-skisenter', 'voss-resort']
    );
    assert.throws(() => velgUtvalg(SEED, 'voss-resort,myrkdalen'), /myrkdalen/);
    assert.throws(() => velgUtvalg(SEED, ''), /tom/);
});

test('en feilstavet --only gir stopp, ikke full upsert', () => {
    assert.deepEqual(ukjenteFlagg(['--dry-run', '--only=skigeilo']), []);
    assert.deepEqual(ukjenteFlagg(['--onli=skigeilo']), ['--onli=skigeilo']);
    assert.deepEqual(ukjenteFlagg(['--only', 'skigeilo']), ['--only', 'skigeilo']);
});
