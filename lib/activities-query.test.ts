// lib/activities-query.test.ts
//
// Vaktene rundt parametrene til /api/activities. Alt her er rent — ingen
// base, ingen nett. Verifikasjonen mot ekte data står i docs/api-activities.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    QueryParamError,
    assertCursorMatchesSort,
    decodeCursor,
    encodeCursor,
    parseBbox,
    parseLimit,
    parsePoint,
    parseRadius,
    sanitizeQueryForOr,
    sanitizeQueryForRpc,
    splitPage,
    usesSearchFunction,
} from './activities-query';

// ── q ──────────────────────────────────────────────────────────────────────

test('q beholder wildcards som tegn, men escaper dem', () => {
    // Uten escape ville «50 %» matchet alt som begynner på «50 ».
    assert.equal(sanitizeQueryForRpc('50 %'), '50 \\%');
    assert.equal(sanitizeQueryForRpc('a_b'), 'a\\_b');
});

test('backslash escapes først, ellers escaper vi vårt eget escape', () => {
    assert.equal(sanitizeQueryForRpc('a\\%'), 'a\\\\\\%');
});

test('q beholder norske bokstaver og bindestrek', () => {
    assert.equal(sanitizeQueryForRpc('Trøndelag-øst'), 'Trøndelag-øst');
});

test('q trimmes, kappes på 50 tegn, og tomt blir null', () => {
    assert.equal(sanitizeQueryForRpc('  Geilo  '), 'Geilo');
    assert.equal(sanitizeQueryForRpc('x'.repeat(80))!.length, 50);
    assert.equal(sanitizeQueryForRpc('   '), null);
    assert.equal(sanitizeQueryForRpc(null), null);
});

test('den flate veiens sanering er uendret: metategn fjernes helt', () => {
    // By-modus limer q inn i .or(), der komma og parentes er metategn.
    assert.equal(sanitizeQueryForOr('ball,(x)*'), 'ballx');
    assert.equal(sanitizeQueryForOr('50 %'), '50');
});

// ── bbox ───────────────────────────────────────────────────────────────────

test('bbox med alle fire verdier parses', () => {
    assert.deepEqual(parseBbox('8.1,60.4,8.3,60.6'), {
        west: 8.1,
        south: 60.4,
        east: 8.3,
        north: 60.6,
    });
});

test('bbox med tre verdier er 400, ikke et gjettet utsnitt', () => {
    assert.throws(() => parseBbox('8.1,60.4,8.3'), QueryParamError);
    assert.throws(() => parseBbox('8.1,60.4,8.3,60.6,1'), QueryParamError);
    assert.throws(() => parseBbox('8.1,60.4,8.3,nord'), QueryParamError);
});

test('bbox med snudde hjørner er 400', () => {
    assert.throws(() => parseBbox('8.1,60.6,8.3,60.4'), QueryParamError);
    assert.throws(() => parseBbox('8.3,60.4,8.1,60.6'), QueryParamError);
});

test('bbox utenfor kloden er 400', () => {
    assert.throws(() => parseBbox('8.1,60.4,8.3,95'), QueryParamError);
});

test('ingen bbox er ikke en feil', () => {
    assert.equal(parseBbox(null), null);
    assert.equal(parseBbox(''), null);
});

// ── posisjon og radius ─────────────────────────────────────────────────────

test('en halv posisjon er en feil, ikke «ingen posisjon»', () => {
    assert.throws(() => parsePoint('59.9139', null), QueryParamError);
    assert.throws(() => parsePoint(null, '10.7522'), QueryParamError);
    assert.equal(parsePoint(null, null), null);
});

test('posisjon parses og valideres', () => {
    assert.deepEqual(parsePoint('59.9139', '10.7522'), { lat: 59.9139, lng: 10.7522 });
    assert.throws(() => parsePoint('91', '10.7522'), QueryParamError);
    assert.throws(() => parsePoint('x', '10.7522'), QueryParamError);
});

test('uten radius er det ingen grense — ikke 10 km', () => {
    assert.equal(parseRadius(null), null);
    assert.equal(parseRadius(''), null);
});

test('radius har ikke lenger noe tak på 100 km', () => {
    assert.equal(parseRadius('250000'), 250000);
    assert.equal(parseRadius('3000000'), 3000000);
});

test('radius må være positiv', () => {
    assert.throws(() => parseRadius('0'), QueryParamError);
    assert.throws(() => parseRadius('-5'), QueryParamError);
    assert.throws(() => parseRadius('langt'), QueryParamError);
});

test('limit er uendret: standard 200, tak 500', () => {
    assert.equal(parseLimit(null), 200);
    assert.equal(parseLimit('20'), 20);
    assert.equal(parseLimit('9000'), 500);
    assert.equal(parseLimit('tull'), 200);
});

// ── markør ─────────────────────────────────────────────────────────────────

test('markøren bærer avstanden urundet gjennom koding', () => {
    const d = 157342.48179231234;
    const back = decodeCursor(encodeCursor({ distanceM: d, title: 'SkiGeilo', id: 'abc' }));
    assert.equal(back!.distanceM, d);
});

test('markøren er ugjennomsiktig, men rundturen bevarer alt', () => {
    const cursor = { distanceM: null, title: 'Åsen', id: 'id-1' };
    assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
});

test('ødelagt markør er 400, ikke side 1 på nytt', () => {
    assert.throws(() => decodeCursor('ikke-base64!!'), QueryParamError);
    assert.throws(() => decodeCursor(Buffer.from('7').toString('base64url')), QueryParamError);
    assert.throws(
        () => decodeCursor(Buffer.from(JSON.stringify({ d: 1, t: null })).toString('base64url')),
        QueryParamError
    );
});

test('markør fra feil sortering avvises', () => {
    // Uten posisjon sorteres det på tittel. Brukes en slik markør MED
    // posisjon, ville side 2 hoppet et vilkårlig sted ut i avstandslista.
    assert.throws(
        () => assertCursorMatchesSort({ distanceM: null, title: 'A', id: 'x' }, true),
        QueryParamError
    );
    assert.throws(
        () => assertCursorMatchesSort({ distanceM: 12, title: null, id: 'x' }, false),
        QueryParamError
    );
    assert.doesNotThrow(() =>
        assertCursorMatchesSort({ distanceM: 12, title: 'A', id: 'x' }, true)
    );
});

// ── veivalg og sidedeling ──────────────────────────────────────────────────

test('by-modus blir liggende på den flate veien, også med søk', () => {
    assert.equal(usesSearchFunction({ hasPoint: false, hasBbox: false, hasCursor: false }), false);
    assert.equal(
        usesSearchFunction({
            hasPoint: false,
            hasBbox: false,
            hasCursor: false,
            hasQuery: true,
            hasMunicipality: true,
        }),
        false
    );
});

test('rent tekstsøk uten sted går nasjonalt, ikke til den flate veien', () => {
    assert.equal(
        usesSearchFunction({ hasPoint: false, hasBbox: false, hasCursor: false, hasQuery: true }),
        true
    );
});

test('posisjon, utsnitt eller markør går til activities_search', () => {
    assert.equal(usesSearchFunction({ hasPoint: true, hasBbox: false, hasCursor: false }), true);
    assert.equal(usesSearchFunction({ hasPoint: false, hasBbox: true, hasCursor: false }), true);
    assert.equal(usesSearchFunction({ hasPoint: false, hasBbox: false, hasCursor: true }), true);
});

test('den ekstra raden avgjør hasMore og vises aldri', () => {
    const rows = [1, 2, 3, 4];
    assert.deepEqual(splitPage(rows, 3), { page: [1, 2, 3], hasMore: true });
    assert.deepEqual(splitPage([1, 2], 3), { page: [1, 2], hasMore: false });
    // Nøyaktig full side uten ekstrarad: ingen flere.
    assert.deepEqual(splitPage([1, 2, 3], 3), { page: [1, 2, 3], hasMore: false });
});
