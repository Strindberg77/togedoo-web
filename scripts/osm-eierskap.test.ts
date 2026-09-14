// scripts/osm-eierskap.test.ts
// Eierskapsmekanismen SETT FRA IMPORTEN: at et claimet OSM-objekt aldri blir
// en rad, og at det blir en rad igjen straks claimen fjernes.
//
// Koordinatene er konstruerte. OSM-ID-ene er ekte (relation/1459739
// Korketrekkeren, relation/2259942 Tryvann/Wyller).
//
// Ingen nettverk. Kjør: node --import tsx --test scripts/osm-eierskap.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { OsmClaim } from '../lib/osm-claims';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

/** Korketrekkeren slik akingClusters leverer den til buildRows: ankeret,
 *  romlig verifisert, med senteret ferdig regnet ut. */
const korketrekkeren = () => ({
    type: 'relation' as const,
    id: 1459739,
    tags: { 'piste:type': 'sled', name: 'Korketrekkeren', route: 'piste' },
    center: { lat: 59.976, lon: 10.683 },
    akingVerified: true,
});

const akebakke = (id: number, name: string) => ({
    type: 'way' as const,
    id,
    tags: { 'piste:type': 'sled', name },
    center: { lat: 59.95, lon: 10.75 },
    akingVerified: true,
});

const claim = (over: Partial<OsmClaim> = {}): OsmClaim => ({
    osmId: 'relation/1459739',
    source: 'kuratert-vintertilbud',
    externalId: 'korketrekkeren-aking',
    expectName: 'Korketrekkeren',
    note: 'seed har verifisert startpunkt',
    ...over,
});

// ---------------------------------------------------------------------------
// LAG 1: objektet blir aldri en rad
// ---------------------------------------------------------------------------

test('et claimet objekt filtreres bort, resten står igjen', async () => {
    const { applyOsmClaims } = await load();
    const { kept, skipped } = applyOsmClaims(
        [korketrekkeren(), akebakke(1, 'Sollibakken')],
        [claim()]
    );
    assert.deepEqual(kept.map((e) => e.id), [1]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].claims[0].externalId, 'korketrekkeren-aking');
});

test('DEN EKTE FEILEN: Korketrekkeren blir ingen import-rad', async () => {
    // Det som allerede har skjedd én gang: importen laget relation/1459739
    // med punkt midt i løypa, ved siden av seed-raden med verifisert punkt
    // ved Frognerseteren. Import-raden ble slettet for hånd og ville kommet
    // tilbake ved neste kjøring av Aking for Oslo.
    //
    // Kjører mot den EKTE claim-lista og den EKTE kategoridefinisjonen.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const aking = PLACE_CATEGORIES.find((c) => c.key === 'aking')!;
    const rows = await buildRows('Oslo', [korketrekkeren()], 50, [aking]);
    assert.deepEqual(rows, []);
});

test('REVERSIBELT: uten claimen blir den en rad igjen', async () => {
    // Å angre er å slette én linje i lib/osm-claims.ts. Ingen rad-id har vært
    // innom noe annet, fordi ingen rad er flyttet mellom kilder.
    const { applyOsmClaims } = await load();
    const { kept, skipped } = applyOsmClaims([korketrekkeren()], []);
    assert.equal(kept.length, 1);
    assert.equal(skipped.length, 0);
});

test('claimen brukes FØR limit, så den ikke spiser en kvoteplass', async () => {
    // Sto filteret etter kategorivalget, ville et claimet objekt telt mot
    // kategoriens limit og fortrengt en ekte rad ved --limit=1.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const aking = PLACE_CATEGORIES.find((c) => c.key === 'aking')!;
    const rows = await buildRows(
        'Oslo',
        [korketrekkeren(), akebakke(1, 'Sollibakken')],
        1,
        [aking]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].external_id, 'way/1', 'den ekte bakken, ikke den claimede');
});

// ---------------------------------------------------------------------------
// ÉN-TIL-MANGE
// ---------------------------------------------------------------------------

test('én relasjon eid av TO kuraterte rader gir én hoppet-over-linje', async () => {
    const { applyOsmClaims } = await load();
    const relasjon = {
        type: 'relation' as const,
        id: 2259942,
        tags: { name: 'Tryvann vinterpark', landuse: 'winter_sports' },
        skiVerified: true,
    };
    const { kept, skipped } = applyOsmClaims(
        [relasjon],
        [
            claim({ osmId: 'relation/2259942', externalId: 'tryvann', expectName: 'Tryvann' }),
            claim({ osmId: 'relation/2259942', externalId: 'wyller', expectName: 'Wyller' }),
        ]
    );
    assert.equal(kept.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].claims.length, 2);
    // Relasjonens navn kan bare stemme med den ene av de to. Det er ikke et
    // avvik — det er hele grunnen til at anleggene seedes hver for seg.
    assert.equal(skipped[0].navnAvvik, false);
});

test('navneavvik når INGEN av claimene kjenner igjen objektet', async () => {
    const { applyOsmClaims } = await load();
    const feilObjekt = {
        type: 'relation' as const,
        id: 1459739,
        tags: { 'piste:type': 'sled', name: 'Grefsenkleiva' },
    };
    const { skipped } = applyOsmClaims([feilObjekt], [claim()]);
    assert.equal(skipped[0].navnAvvik, true, 'feil id undertrykker feil sted');
});

// ---------------------------------------------------------------------------
// LAG 2: låsen, som backstop
// ---------------------------------------------------------------------------

test('en låst rad skrives ikke, uavhengig av claims', async () => {
    // Backstop for det tilfellet at en claim fjernes ved et uhell. Låsen
    // settes av 'unpublish' i lib/moderation.ts (status='rejected' +
    // locked=true), og 'publish' frigir den igjen.
    const { writableRows } = await load();
    const rad = (external_id: string) => ({ external_id }) as any;
    const ut = writableRows(
        [rad('relation/1459739'), rad('way/1')],
        new Set(['relation/1459739'])
    );
    assert.deepEqual(ut.map((r) => r.external_id), ['way/1']);
});

test('låsen alene er IKKE nok — den slås opp per kilde', async () => {
    // Grunnen til at claims må finnes i det hele tatt: begge skriverne gjør
    // .eq('source_id', source.id).eq('locked', true). En låst seed-rad ligger
    // under 'kuratert-vintertilbud' og er usynlig for importens oppslag, som
    // spør 'osm-steder'. Her er det modellert som et tomt låsesett.
    const { writableRows } = await load();
    const rad = { external_id: 'relation/1459739' } as any;
    assert.equal(
        writableRows([rad], new Set()).length,
        1,
        'importen ser ingen lås fra en annen kilde — derfor lag 1'
    );
});
