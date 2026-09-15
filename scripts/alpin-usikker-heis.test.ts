// scripts/alpin-usikker-heis.test.ts
//
// FIRE ANLEGG MED HEIS, UTEN UTFORLØYPE.
//
// Den nasjonale tørrkjøringen (sep. 2026) ga Kolsås, Finse, Ringkollen og
// Gråkallparken dommen «usikker-heis»: heis i OSM, men ingen
// `piste:type=downhill` innenfor polygonet. Kravet står — uten det kommer
// Holmenkollen, Granåsen og Linderudkollen inn som alpinanlegg — så anleggene
// seedes i stedet.
//
// Ingen nettverk, ingen database. Seed-modulen kan importeres uten å kjøre
// seeden (isDirectRun-vakten).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    assertClaimsResolve,
    awakenedClaims,
    claimNameMatches,
    claimsByOsmId,
    OSM_CLAIMS,
    staleClaims,
} from '../lib/osm-claims';
import { distanceKm, CITY_CENTRES } from '../lib/cities';
import { SEED, SOURCE, splitFor, toRow } from './seed-vintertilbud';
import { municipalityIndex } from './municipality-index';

process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';
const load = () => import('./import-places');

/** De fire, med OSM-objektet sitt og kommunen de skal få. */
const FIRE = [
    { id: 'kolsas-skisenter', osm: 'way/43656613', kommune: 'Bærum', nearCity: 'Oslo' },
    { id: 'finse-skisenter', osm: 'way/544124493', kommune: 'Ulvik', nearCity: undefined },
    { id: 'ringkollen', osm: 'relation/16471584', kommune: 'Ringerike', nearCity: 'Oslo' },
    { id: 'grakallparken', osm: 'way/1489390372', kommune: 'Trondheim', nearCity: undefined },
] as const;

const finn = (id: string) => SEED.find((s) => s.externalId === id);

// ---------------------------------------------------------------------------
// RADENE
// ---------------------------------------------------------------------------

test('de fire finnes som seed-rader, med manuelt punkt og uten lenke', () => {
    for (const { id } of FIRE) {
        const s = finn(id);
        assert.ok(s, `${id} mangler i SEED`);
        assert.ok(s!.manualCoord, `${id} må ha manualCoord — den skal ikke geokodes`);
        // manualCoord og fallback skal være samme punkt. Er de ulike, er det
        // uklart hvilket som gjelder når geokodingen slås av.
        assert.equal(s!.manualCoord!.lat, s!.fallbackLat);
        assert.equal(s!.manualCoord!.lng, s!.fallbackLng);
        assert.equal(s!.isFree, false);
        // INGEN LENKE. En rad uten lenke er ærligere enn en lenke til feil
        // sted; jf. akeforeningen.no på Korketrekkeren, som er en
        // interesseorganisasjon og ikke bakken.
        assert.equal(s!.url, undefined, `${id} skal ikke ha url`);
    }
});

test('alle fire er Skianlegg, ute, med fasetten alpint', () => {
    for (const { id } of FIRE) {
        assert.deepEqual(splitFor(id), {
            category: 'Skianlegg',
            isIndoor: false,
            facets: ['alpint'],
        });
    }
});

test('url skrives som null, ikke som tom streng', () => {
    // Kolonnen er `url text` (nullbar, migrasjon 0001). Tom streng ville
    // vært en tredje tilstand ingen leser skiller fra de to andre.
    const rad = toRow(finn('kolsas-skisenter')!, 'kilde-id', 59.9, 10.5, true);
    assert.equal(rad.url, null);
    assert.equal(rad.municipality, 'Bærum');
    assert.equal(rad.near_city, 'Oslo');
    assert.equal(rad.category, 'Skianlegg');
    assert.deepEqual(rad.facets, ['alpint']);
    assert.equal(rad.is_indoor, false);
    assert.equal(rad.is_free, false);
    assert.equal(rad.status, 'published');
    // De gamle radene beholder sin lenke.
    assert.equal(toRow(finn('tryvann')!, 'k', 0, 0, true).url, 'https://oslo.skimore.no');
    // Finse har ingen hjemby — near_city er null, ikke tom streng.
    assert.equal(toRow(finn('finse-skisenter')!, 'k', 0, 0, true).near_city, null);
});

// ---------------------------------------------------------------------------
// KOMMUNEN — ETTERPRØVD, IKKE ANTATT
// ---------------------------------------------------------------------------

test('kommunen kommer fra grensefila og stemmer med seed-raden', () => {
    const idx = municipalityIndex();
    for (const { id, kommune } of FIRE) {
        const s = finn(id)!;
        const slaattOpp = idx.lookup(s.manualCoord!.lat, s.manualCoord!.lng);
        assert.equal(slaattOpp, kommune, `${id}: grensefila sier ${slaattOpp}`);
        assert.equal(s.municipality, kommune, `${id}: seed-raden sier noe annet`);
    }
});

test('nearCity settes der kommunen IKKE er en by-chip, og bare da', () => {
    // By-modus i /api/activities matcher `municipality ILIKE X OR near_city
    // ILIKE X`, og appen har fire by-chiper. En rad i Bærum eller Ringerike
    // uten near_city er derfor usynlig i alle fire.
    for (const { id, nearCity } of FIRE) {
        assert.equal(finn(id)!.nearCity, nearCity, `${id}`);
    }
    // Og den er ikke satt vilkårlig: begge ligger nærmere Oslo enn den
    // lengste tilknytningen som allerede finnes i fila.
    const lengsteEksisterende = 35; // Eikedalen→Bergen og Jessheimbadet→Oslo
    for (const id of ['kolsas-skisenter', 'ringkollen']) {
        const s = finn(id)!;
        const km = distanceKm(
            { lat: s.manualCoord!.lat, lng: s.manualCoord!.lng },
            CITY_CENTRES.oslo
        );
        assert.ok(km <= lengsteEksisterende + 1, `${id} er ${km.toFixed(0)} km fra Oslo`);
    }
    // Finse er utenfor enhver presedens — og har ingen veiforbindelse.
    const finse = finn('finse-skisenter')!;
    const tilBergen = distanceKm(
        { lat: finse.manualCoord!.lat, lng: finse.manualCoord!.lng },
        CITY_CENTRES.bergen
    );
    assert.ok(tilBergen > 100, `Finse er ${tilBergen.toFixed(0)} km fra Bergen`);
});

// ---------------------------------------------------------------------------
// CLAIMENE
// ---------------------------------------------------------------------------

test('hvert av de fire OSM-objektene er claimet av sin egen rad', () => {
    const index = claimsByOsmId();
    for (const { id, osm } of FIRE) {
        const claims = index.get(osm);
        assert.ok(claims, `${osm} er ikke claimet`);
        assert.deepEqual(claims!.map((c) => c.externalId), [id]);
        assert.equal(claims![0].source, SOURCE.slug);
        assert.equal(claims![0].expectNoHit, true);
    }
});

test('expectName beskriver OSM-OBJEKTET, ikke raden', () => {
    const index = claimsByOsmId();
    // Kolsås heter «Kolsås Skisenter (Kolsåsbakken)» i OSM og «Kolsås
    // Skisenter» som rad. Ringkollen heter «Ringkollen alpinbakke» i OSM.
    const kolsas = index.get('way/43656613')![0];
    assert.ok(claimNameMatches(kolsas, 'Kolsås Skisenter (Kolsåsbakken)'));
    assert.ok(!claimNameMatches(kolsas, 'Kolsås Skisenter'), 'radnavnet er ikke OSM-navnet');
    const ringkollen = index.get('relation/16471584')![0];
    assert.ok(claimNameMatches(ringkollen, 'Ringkollen alpinbakke'));
});

test('claimene peker på rader som finnes — ellers forsvinner stedet i stillhet', () => {
    assert.doesNotThrow(() =>
        assertClaimsResolve(SOURCE.slug, SEED.map((s) => s.externalId))
    );
    // Vakten skal se hver enkelt av de fire.
    for (const { id } of FIRE) {
        const uten = SEED.map((s) => s.externalId).filter((x) => x !== id);
        assert.throws(() => assertClaimsResolve(SOURCE.slug, uten), new RegExp(id));
    }
});

test('forebyggende claims meldes IKKE som døde, men meldes når de våkner', () => {
    // UTEN flagget ville disse fire stått i «CLAIMS SOM IKKE TRAFF NOE» ved
    // hver eneste nasjonale kjøring, fordi et polygon som berikelsen
    // forkaster aldri når applyOsmClaims. En rapport med fire faste falske
    // treff er en rapport ingen leser.
    const ingenting = new Set<string>();
    const doede = staleClaims(ingenting).map((c) => c.externalId);
    for (const { id } of FIRE) assert.ok(!doede.includes(id), `${id} meldt som død`);
    // Korketrekkeren er IKKE forebyggende og skal fortsatt meldes.
    assert.ok(doede.includes('korketrekkeren-aking'));

    // Og motstykket: et treff betyr at OSM har fått dataene som manglet.
    const sett = new Set(['way/43656613']);
    assert.deepEqual(
        awakenedClaims(sett).map((c) => c.externalId),
        ['kolsas-skisenter']
    );
    assert.deepEqual(awakenedClaims(ingenting), []);
});

test('Siljan skisenter er hverken seedet eller claimet', () => {
    // relation/8359960 sto på samme liste, men ser nedlagt ut. Importen kan
    // ikke vite om et anlegg er i drift, så riktig utfall er at den forblir
    // utenfor — ikke at noen skriver en claim som later som noe annet.
    assert.equal(SEED.find((s) => s.externalId.includes('siljan')), undefined);
    assert.equal(OSM_CLAIMS.find((c) => c.osmId === 'relation/8359960'), undefined);
});

// ---------------------------------------------------------------------------
// «usikker-heis» SOM EGEN LISTE I RAPPORTEN
// ---------------------------------------------------------------------------

/** En firkant rundt (lat, lon) med halvbredde `d` grader. */
const rute = (lat: number, lon: number, d: number) => [
    { lat: lat - d, lon: lon - d },
    { lat: lat - d, lon: lon + d },
    { lat: lat + d, lon: lon + d },
    { lat: lat + d, lon: lon - d },
    { lat: lat - d, lon: lon - d },
];

test('et anlegg med heis og uten utforløype får en egen merknadslinje', async () => {
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            {
                type: 'way',
                id: 43656613,
                tags: { landuse: 'recreation_ground', sport: 'skiing', name: 'Kolsås Skisenter (Kolsåsbakken)' },
                geometry: rute(59.9362, 10.5229, 0.005),
            },
        ],
        bevis: [
            { type: 'way', id: 1, tags: { aerialway: 'drag_lift' }, geometry: [{ lat: 59.9362, lon: 10.5229 }] },
            { type: 'way', id: 2, tags: { aerialway: 'drag_lift' }, geometry: [{ lat: 59.9363, lon: 10.5230 }] },
        ],
    });
    assert.deepEqual(ut.elements, [], 'nedfartskravet står — den blir ingen rad');
    const m = (ut.merknader ?? []).join('\n');
    assert.match(m, /HEIS UTEN UTFORLØYPE \(1\)/);
    assert.match(m, /way\/43656613/);
    assert.match(m, /Kolsås Skisenter \(Kolsåsbakken\)/);
    assert.match(m, /drag_lift×2/);
    assert.match(m, /59\.93620,10\.52290/);
    assert.match(m, /https:\/\/www\.openstreetmap\.org\/way\/43656613/);
    assert.ok(!m.includes('HOPPANLEGG'), 'Kolsås er ikke et hoppanlegg');
});

test('et hoppanlegg med heis merkes, så de to gruppene kan skilles på ett blikk', async () => {
    // Holmenkollen, Granåsen og Linderudkollen får NØYAKTIG samme dom som
    // Kolsås. Det er hele grunnen til at nedfartskravet ikke kan mykes opp,
    // og merket er det som gjør lista brukbar uten ett oppslag per rad.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            {
                type: 'way',
                id: 99,
                tags: { landuse: 'recreation_ground', sport: 'ski_jumping', name: 'Linderudkollen' },
                geometry: rute(59.98, 10.79, 0.004),
            },
        ],
        bevis: [{ type: 'way', id: 1, tags: { aerialway: 'chair_lift' }, geometry: [{ lat: 59.98, lon: 10.79 }] }],
    });
    assert.deepEqual(ut.elements, []);
    assert.match((ut.merknader ?? []).join('\n'), /HOPPANLEGG — skal trolig IKKE seedes/);
});

test('merknader er tom når ingenting krever et menneske', async () => {
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            {
                type: 'way',
                id: 10,
                tags: { landuse: 'winter_sports', name: 'Et anlegg' },
                geometry: rute(61, 9, 0.005),
            },
        ],
        bevis: [{ type: 'way', id: 1, tags: { 'piste:type': 'downhill' }, geometry: [{ lat: 61, lon: 9 }] }],
    });
    assert.equal(ut.elements.length, 1, 'denne har utforløype og blir en rad');
    assert.equal(ut.merknader, undefined);
});

test('et PUNKTOBJEKT med heis uten utforløype havner i samme liste', async () => {
    // Nodene fikk en dom i forrige oppgave. En node med heis i nærheten og
    // ingen nedfart er samme sak som et polygon, og skal ikke falle mellom.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [{ type: 'node', id: 7, lat: 61, lon: 9, tags: { landuse: 'winter_sports', name: 'Node-anlegg' } }],
        bevis: [{ type: 'way', id: 1, tags: { aerialway: 'rope_tow' }, geometry: [{ lat: 61.001, lon: 9 }] }],
    });
    assert.deepEqual(ut.elements, []);
    assert.match((ut.merknader ?? []).join('\n'), /node\/7.*rope_tow/s);
});
