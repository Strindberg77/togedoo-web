// lib/import-chunks.test.ts
// Arbeidsenheten og manifestet. Ingen nettverk, ingen filer.
// Kjør: node --import tsx --test lib/import-chunks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    chunkForCity,
    chunkId,
    fingerprint,
    latestEntries,
    planForCities,
    runCoversEverything,
    stageIsDone,
    type ManifestEntry,
} from './import-chunks';

// ---------------------------------------------------------------------------
// ARBEIDSENHETEN
// ---------------------------------------------------------------------------

test('chunk-id-en er filnavnsikker — den blir et filnavn', () => {
    // Id-en brukes både som manifest-nøkkel og som filnavn i arbeidskatalogen.
    assert.equal(chunkId('Oslo'), 'oslo');
    assert.equal(chunkId('Møre og Romsdal'), 'moere-og-romsdal');
    assert.equal(chunkId('Troms og Finnmark'), 'troms-og-finnmark');
    assert.equal(chunkId('Ålesund'), 'aalesund');
});

test('en id kan ikke inneholde skilletegn som lager en sti', () => {
    // Uten dette kunne et navn med «/» eller «..» skrevet utenfor katalogen.
    assert.equal(chunkId('../../etc'), 'etc');
    assert.equal(chunkId('a/b'), 'a-b');
    assert.throws(() => chunkId('///'), /Kan ikke lage chunk-id/);
});

test('en by-chunk bærer kommunen som by-anker', () => {
    const c = chunkForCity('Oslo');
    assert.equal(c.id, 'by-oslo');
    assert.equal(c.label, 'Oslo');
    assert.equal(c.cityAnchor, 'Oslo', 'blir activities.municipality');
    assert.match(c.overpassArea, /"admin_level"="7"/);
    assert.match(c.overpassArea, /"name"="Oslo"/);
    assert.ok(!c.overpassArea.endsWith(';'), 'semikolon settes av kallstedet');
});

test('planen er chunkene i oppgitt rekkefølge', () => {
    assert.deepEqual(
        planForCities(['Oslo', 'Bergen']).map((c) => c.id),
        ['by-oslo', 'by-bergen']
    );
});

// ---------------------------------------------------------------------------
// FINGERAVTRYKKET — «ferdig» er ikke nok, det må være ferdig MED SAMME INNDATA
// ---------------------------------------------------------------------------

test('feltrekkefølge endrer ikke fingeravtrykket', () => {
    assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
    assert.equal(fingerprint({ x: { p: 1, q: 2 } }), fingerprint({ x: { q: 2, p: 1 } }));
});

test('en endret selektor endrer fingeravtrykket', () => {
    // Den viktigste enkeltegenskapen: «rett en selektor og kjør med --resume»
    // skal IKKE gi gårsdagens data.
    const a = fingerprint({ cats: [['lekeplass', 'nwr["leisure"="playground"](area.a);']] });
    const b = fingerprint({ cats: [['lekeplass', 'nwr["leisure"="playground"]["access"!="private"](area.a);']] });
    assert.notEqual(a, b);
});

test('fingeravtrykket er stabilt mellom kjøringer', () => {
    // Ingen tidsstempel, ingen tilfeldighet — ellers ville ingenting noen gang
    // blitt gjenbrukt.
    assert.equal(fingerprint({ v: 1, area: 'Oslo' }), fingerprint({ v: 1, area: 'Oslo' }));
});

// ---------------------------------------------------------------------------
// MANIFESTET
// ---------------------------------------------------------------------------

const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
    chunkId: 'by-oslo',
    stage: 'fetch',
    fingerprint: 'abc',
    count: 3,
    at: '2026-09-14T00:00:00.000Z',
    ...over,
});

test('logga er append-only — siste oppføring per (chunk, steg) vinner', () => {
    const m = latestEntries([
        entry({ fingerprint: 'gammel', count: 1 }),
        entry({ fingerprint: 'ny', count: 9 }),
    ]);
    assert.equal(m.size, 1);
    assert.equal(m.get('by-oslo/fetch')!.count, 9);
});

test('et steg er ferdig bare når fingeravtrykket også stemmer', () => {
    const m = latestEntries([entry({ fingerprint: 'abc' })]);
    const oslo = chunkForCity('Oslo');
    assert.equal(stageIsDone(m, oslo, 'fetch', 'abc'), true);
    assert.equal(stageIsDone(m, oslo, 'fetch', 'annet'), false);
    assert.equal(stageIsDone(m, oslo, 'enrich', 'abc'), false, 'annet steg');
    assert.equal(stageIsDone(m, chunkForCity('Bergen'), 'fetch', 'abc'), false);
});

// ---------------------------------------------------------------------------
// DEKNING — erstatningen for cities.length === DEFAULT_CITIES.length
// ---------------------------------------------------------------------------

test('full plan og alle kategorier dekker alt', () => {
    const standard = planForCities(['Oslo', 'Bergen', 'Trondheim', 'Stavanger']);
    assert.equal(runCoversEverything(standard, standard, 10, 10), true);
});

test('én by dekker ikke alt', () => {
    const standard = planForCities(['Oslo', 'Bergen']);
    assert.equal(runCoversEverything(planForCities(['Oslo']), standard, 10, 10), false);
});

test('én kategori dekker ikke alt, uansett plan', () => {
    const standard = planForCities(['Oslo']);
    assert.equal(runCoversEverything(standard, standard, 1, 10), false);
});

test('vilkåret er uttrykt i PLANEN, ikke i bynavn', () => {
    // Det er hele poenget med erstatningen: en standardplan på 353 fliser
    // skal virke uten at noe her endres.
    const fliser = Array.from({ length: 5 }, (_, i) => ({
        id: `flis-${i}`,
        label: `flis ${i}`,
        cityAnchor: null,
        overpassArea: '',
        overpassScope: '(57.5,4.0,71.5,31.5)',
        overpassTimeout: 300,
    }));
    assert.equal(runCoversEverything(fliser, fliser, 10, 10), true);
    assert.equal(runCoversEverything(fliser.slice(0, 4), fliser, 10, 10), false);
});
