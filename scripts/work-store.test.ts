// scripts/work-store.test.ts
// Mellomleddet: at «ferdig» betyr ferdig, og at en krasj ikke kan lyve.
// Kjør: node --import tsx --test scripts/work-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { chunkForCity } from '../lib/import-chunks';
import { FileStore, MANIFEST_FILE, NullStore, parseNdjson } from './work-store';

const oslo = chunkForCity('Oslo');

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'import-work-'));
}

// ---------------------------------------------------------------------------
// NullStore — standardveien, som ikke skal røre noe
// ---------------------------------------------------------------------------

test('uten arbeidskatalog lagres ingenting og ingenting er ferdig', () => {
    // Kravet om ingen oppførselsendring: `--city=Oslo` uten --work skal ha
    // nøyaktig de samme bivirkningene som før sømmen, altså ingen.
    const s = new NullStore();
    assert.equal(s.isDone(), false);
    s.write();
    assert.equal(s.entries().size, 0);
    assert.throws(() => s.read(oslo, 'fetch'), /--work/);
});

// ---------------------------------------------------------------------------
// FileStore
// ---------------------------------------------------------------------------

test('et skrevet steg kan leses tilbake uendret', () => {
    const dir = tmpDir();
    const s = new FileStore(dir);
    const rader = [{ c: 'aking', s: 'main', e: { type: 'way', id: 1 } }, { c: 'park', s: 'main', e: { type: 'way', id: 2 } }];
    s.write(oslo, 'fetch', 'fp1', rader);
    assert.deepEqual(s.read(oslo, 'fetch'), rader);
});

test('ingen .tmp-fil blir liggende igjen', () => {
    // Skrivingen går til .tmp og renames. En .tmp som blir stående betyr at
    // renamet ikke skjedde, og da skal steget IKKE se ferdig ut.
    const dir = tmpDir();
    new FileStore(dir).write(oslo, 'fetch', 'fp1', [{ a: 1 }]);
    assert.deepEqual(
        fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')),
        []
    );
});

test('manifestlinja kommer ETTER fila — aldri motsatt', () => {
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'fetch', 'fp1', [{ a: 1 }]);
    const manifest = parseNdjson<{ chunkId: string; stage: string }>(
        fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')
    );
    assert.equal(manifest.length, 1);
    assert.ok(fs.existsSync(path.join(dir, 'by-oslo.fetch.ndjson')));
});

test('ferdig krever at fingeravtrykket stemmer', () => {
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'fetch', 'fp1', [{ a: 1 }]);
    assert.equal(s.isDone(oslo, 'fetch', 'fp1'), true);
    assert.equal(s.isDone(oslo, 'fetch', 'fp2'), false, 'endret selektor/limit');
});

test('en slettet fil gjør steget uferdig, ikke ødelagt', () => {
    // Rydder noen i katalogen for hånd, skal steget kjøres om — ikke kaste.
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'fetch', 'fp1', [{ a: 1 }]);
    fs.unlinkSync(path.join(dir, 'by-oslo.fetch.ndjson'));
    assert.equal(s.isDone(oslo, 'fetch', 'fp1'), false);
});

test('manifestet overlever en ny prosess', () => {
    const dir = tmpDir();
    new FileStore(dir).write(oslo, 'enrich', 'fp9', [{ a: 1 }], { seenClaims: ['relation/1459739'] });
    const gjenapnet = new FileStore(dir);
    assert.equal(gjenapnet.isDone(oslo, 'enrich', 'fp9'), true);
    assert.deepEqual(gjenapnet.entries().get('by-oslo/enrich')!.seenClaims, ['relation/1459739']);
});

test('seenClaims overlever mellomleddet — ellers lyver dødt-claim-rapporten', () => {
    // Ved --resume hoppes ferdige chunks over. Lå settet bare i minnet, ville
    // rapporten meldt levende claims som døde.
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'enrich', 'fp1', [], { seenClaims: ['relation/1459739'] });
    assert.deepEqual(new FileStore(dir).entries().get('by-oslo/enrich')!.seenClaims, [
        'relation/1459739',
    ]);
});

test('deduped overlever mellomleddet — den ble tapt i stillhet fram til okt. 2026', () => {
    // FEILEN: `deduped` sto i Pick-typen på write(), så kalleren kunne sende
    // den og typesjekken godtok det — men feltet ble aldri spredt inn i
    // manifestoppføringen. `entry?.deduped` ved --resume var dermed ALLTID
    // undefined, og dedup-rapporten for en gjenopptatt chunk var tom uten at
    // noe feilet. Fanget mens settellingen ble lagt inn samme sted.
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'enrich', 'fp1', [], { seenClaims: ['node/9'], deduped: ['node/2', 'node/3'] });
    const entry = new FileStore(dir).entries().get('by-oslo/enrich')!;
    assert.deepEqual(entry.deduped, ['node/2', 'node/3']);
    assert.deepEqual(entry.seenClaims, ['node/9'], 'og den som virket fra før virker fortsatt');
});

test('settAntall overlever mellomleddet — uten det slår utbyttevakten seg av', () => {
    // Vakten kjører til slutt, etter at alle chunkene er beriket. Med --resume
    // har hentesteget for de fleste chunkene ikke kjørt i denne prosessen, så
    // tallet MÅ ligge i manifestet. Gjør det ikke det, hopper vakten over
    // kategorien — og en vakt som slår seg av i stillhet er verre enn ingen.
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'fetch', 'fp1', [], {
        emptySets: [],
        settAntall: { skianlegg: { omrade: 423, bevis: 4536 }, aking: { main: 91 } },
    });
    const entry = new FileStore(dir).entries().get('by-oslo/fetch')!;
    // PER SETT, ikke summert: 423 og 4536 er ikke samme størrelse, og bare
    // «omrade» blir rader.
    assert.equal(entry.settAntall?.skianlegg?.omrade, 423);
    assert.equal(entry.settAntall?.skianlegg?.bevis, 4536);
    assert.equal(entry.settAntall?.aking?.main, 91);
});

test('en gammel .import-work uten settAntall gir undefined, ikke null eller 0', () => {
    // Forskjellen avgjør: 0 ville stanset kjøringen på et tall som ikke
    // finnes, undefined lar vakten hoppe over og SI det.
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'fetch', 'fp1', [], { emptySets: [] });
    assert.equal(new FileStore(dir).entries().get('by-oslo/fetch')!.settAntall, undefined);
});

// ---------------------------------------------------------------------------
// KRASJTOLERANSE — grunnen til at formatet er NDJSON og ikke ett JSON-array
// ---------------------------------------------------------------------------

test('en halv siste linje forkastes, resten leses', () => {
    // Nøyaktig formen en fil har etter at prosessen døde under skrivingen.
    // Et JSON-array ville vært uleselig i sin helhet.
    assert.deepEqual(parseNdjson<{ a: number }>('{"a":1}\n{"a":2}\n{"a":'), [{ a: 1 }, { a: 2 }]);
});

test('tomme linjer og etterfølgende linjeskift er ufarlige', () => {
    assert.deepEqual(parseNdjson<{ a: number }>('\n{"a":1}\n\n'), [{ a: 1 }]);
    assert.deepEqual(parseNdjson(''), []);
});

test('et tomt steg skriver en tom fil, ikke ingen fil', () => {
    // «Null elementer» og «aldri kjørt» er to ulike tilstander, og bare den
    // ene skal gjenbrukes ved --resume.
    const dir = tmpDir();
    const s = new FileStore(dir);
    s.write(oslo, 'fetch', 'fp1', []);
    assert.equal(s.isDone(oslo, 'fetch', 'fp1'), true);
    assert.deepEqual(s.read(oslo, 'fetch'), []);
});
