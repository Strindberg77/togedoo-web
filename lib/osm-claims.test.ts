// lib/osm-claims.test.ts
// Eierskapsmekanismen: hvem eier raden når et sted finnes både i en kuratert
// seed og i OSM.
//
// Ingen nettverk, ingen database.
// Kjør: node --import tsx --test lib/osm-claims.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    assertClaimsResolve,
    claimNameMatches,
    claimsByOsmId,
    OSM_CLAIMS,
    staleClaims,
    type OsmClaim,
} from './osm-claims';

const claim = (over: Partial<OsmClaim> = {}): OsmClaim => ({
    osmId: 'relation/1',
    source: 'kuratert-test',
    externalId: 'et-sted',
    expectName: 'Et sted',
    note: 'test',
    ...over,
});

// ---------------------------------------------------------------------------
// ÉN-TIL-MANGE — grunnen til at en claim ikke er en nøkkel
// ---------------------------------------------------------------------------

test('to kuraterte rader kan eie SAMME OSM-objekt', () => {
    // Tryvann og Wyller er to anlegg med hvert sitt startpunkt 30 minutters
    // kjøretur fra hverandre, men ÉN relasjon i OSM. Den forrige anbefalingen
    // — flytt seed-raden til source_id='osm-steder' med external_id=<osm-id> —
    // kunne ikke uttrykt dette: to rader kan ikke dele external_id innenfor
    // samme kilde. En claim er ingen nøkkel, så her er det ikke et problem.
    const index = claimsByOsmId([
        claim({ osmId: 'relation/2259942', externalId: 'tryvann', expectName: 'Tryvann' }),
        claim({ osmId: 'relation/2259942', externalId: 'wyller', expectName: 'Wyller' }),
        claim({ osmId: 'relation/1', externalId: 'annet' }),
    ]);
    assert.equal(index.get('relation/2259942')!.length, 2);
    assert.equal(index.get('relation/1')!.length, 1);
});

// ---------------------------------------------------------------------------
// NAVNEKONTROLLEN — vernet mot en feilmatch
// ---------------------------------------------------------------------------

test('navnekontrollen er delstreng og ser bort fra store bokstaver', () => {
    const c = claim({ expectName: 'Korketrekkeren' });
    assert.equal(claimNameMatches(c, 'Korketrekkeren'), true);
    assert.equal(claimNameMatches(c, 'korketrekkeren akebakke'), true);
    assert.equal(claimNameMatches(c, 'Øvre Korketrekkeren'), true);
});

test('feil id fanges av navnet — det er hele poenget med kontrollen', () => {
    // Den realistiske feilen er å lime inn feil id. Da undertrykker claimen
    // et helt annet sted, og det stedet forsvinner fra appen i stillhet.
    const c = claim({ expectName: 'Korketrekkeren' });
    assert.equal(claimNameMatches(c, 'Grefsenkleiva'), false);
    assert.equal(claimNameMatches(c, undefined), false);
});

test('expectName: null slår av kontrollen, men er et eksplisitt valg', () => {
    // Typen er `string | null` og ikke valgfri: en claim uten kontroll er en
    // claim ingen har verifisert. `null` betyr «objektet har ikke navn i OSM».
    const c = claim({ expectName: null });
    assert.equal(claimNameMatches(c, undefined), true);
    assert.equal(claimNameMatches(c, 'hva som helst'), true);
});

// ---------------------------------------------------------------------------
// DØDE CLAIMS — lista rotner i stillhet uten dette
// ---------------------------------------------------------------------------

test('en claim som ikke traff noe kommer med i staleClaims', () => {
    const claims = [claim({ osmId: 'relation/1' }), claim({ osmId: 'way/2' })];
    assert.deepEqual(
        staleClaims(new Set(['relation/1']), claims).map((c) => c.osmId),
        ['way/2']
    );
    assert.deepEqual(staleClaims(new Set(['relation/1', 'way/2']), claims), []);
});

// ---------------------------------------------------------------------------
// VAKTEN PÅ SEED-SIDEN
// ---------------------------------------------------------------------------

test('en claim mot et seed-entry som ikke finnes kaster', () => {
    // Uten den kan et entry døpes om mens claimen blir stående. Da
    // undertrykker importen et OSM-objekt til fordel for en rad som ikke
    // finnes, og stedet forsvinner helt.
    assert.throws(
        () => assertClaimsResolve('kuratert-test', ['noe-annet'], [claim()]),
        /et-sted/
    );
});

test('vakten gjelder kun sin egen kilde', () => {
    // seed-dyremote skal ikke feile på en claim som tilhører vintertilbudet.
    assert.doesNotThrow(() =>
        assertClaimsResolve('kuratert-dyremote', ['en-gard'], [claim()])
    );
});

test('vakten slipper gjennom når entryet finnes', () => {
    assert.doesNotThrow(() =>
        assertClaimsResolve('kuratert-test', ['et-sted', 'et-til'], [claim()])
    );
});

// ---------------------------------------------------------------------------
// DEN EKTE LISTA
// ---------------------------------------------------------------------------

test('hver claim i den ekte lista har gyldig form', () => {
    for (const c of OSM_CLAIMS) {
        assert.match(c.osmId, /^(node|way|relation)\/\d+$/, c.osmId);
        assert.match(c.source, /^kuratert-/, `${c.osmId}: kilden skal være en kuratert seed`);
        assert.ok(c.externalId.length > 0, c.osmId);
        // Eksplisitt valg, ikke utelatelse: `undefined` er ikke lov.
        assert.ok(
            typeof c.expectName === 'string' || c.expectName === null,
            `${c.osmId}: expectName må settes, også når svaret er null`
        );
        assert.ok(c.note.length > 10, `${c.osmId}: begrunnelsen skrives for neste person`);
    }
});

test('Korketrekkeren er claimet — tilfellet som allerede har skjedd', () => {
    const c = OSM_CLAIMS.find((x) => x.osmId === 'relation/1459739');
    assert.ok(c, 'claimen mangler');
    assert.equal(c!.source, 'kuratert-vintertilbud');
    assert.equal(c!.externalId, 'korketrekkeren-aking');
    assert.equal(claimNameMatches(c!, 'Korketrekkeren'), true);
});
