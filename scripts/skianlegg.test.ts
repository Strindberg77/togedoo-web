// scripts/skianlegg.test.ts
// Skianlegg-kategorien: selektoren, plasseringen i match-prioriteten, og
// skillet mellom alpint og langrenn.
//
// Ingen nettverk. Den romlige funksjonen selv er testet i
// lib/geo-polygon.test.ts; her testes reglene rundt den.
// Kjør: node --import tsx --test scripts/skianlegg.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anyInsideOrNear } from '../lib/geo-polygon';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

const ski = async () => {
    const { PLACE_CATEGORIES } = await load();
    const cat = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg');
    assert.ok(cat, 'skianlegg-kategorien mangler');
    return cat!;
};

test('selektoren dekker alle fire tagge-mønstrene', async () => {
    const cat = await ski();
    // winter_sports
    assert.match(cat.selector, /"landuse"="winter_sports"/);
    // recreation_ground med piste:* — tre varianter, fordi Varingskollen bare
    // har piste:lit og Skimore Kongsberg bare piste:difficulty.
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["piste:type"\]/);
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["piste:lit"\]/);
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["piste:difficulty"\]/);
    // recreation_ground med sport~ski
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["sport"~"ski",i\]/);
    // sports_centre med sport~ski
    assert.match(cat.selector, /"leisure"="sports_centre"\]\["sport"~"ski",i\]/);
});

test('hver selektorlinje verner mot nedlagte anlegg', async () => {
    // disused:landuse=... har ingen landuse-nøkkel og treffes uansett ikke.
    // Vakten her er mot den andre formen: en aktiv nøkkel + disused=yes.
    const cat = await ski();
    const linjer = cat.selector.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(linjer.length >= 6, `forventet minst 6 linjer, fikk ${linjer.length}`);
    for (const l of linjer) {
        assert.match(l, /\["disused"!~"\."\]/, `mangler disused-vakt: ${l}`);
        assert.match(l, /\["abandoned"!~"\."\]/, `mangler abandoned-vakt: ${l}`);
    }
});

test('Skianlegg står FØR idrettshall i match-prioriteten', async () => {
    // Den viktigste enkeltlinja i denne endringen. idrettshall er en
    // ukvalifisert oppsamler for leisure=sports_centre, og rekkefølgen er
    // match-prioritet. Snus den, havner alpinanleggene i Idrettshall.
    const { PLACE_CATEGORIES } = await load();
    const keys = PLACE_CATEGORIES.map((c) => c.key);
    const iSki = keys.indexOf('skianlegg');
    const iHall = keys.indexOf('idrettshall');
    assert.ok(iSki >= 0 && iHall >= 0);
    assert.ok(iSki < iHall, `skianlegg (${iSki}) må stå før idrettshall (${iHall})`);
});

test('cable_car er IKKE en skiheis', async () => {
    // Krossobanen og Fløibanen er turistbaner. En generisk ["aerialway"]
    // ville gjort Fløyen til et alpinanlegg.
    const { SKI_LIFT_VALUES } = await load();
    assert.ok(!SKI_LIFT_VALUES.split('|').includes('cable_car'));
    for (const v of ['drag_lift', 't-bar', 'j-bar', 'platter', 'rope_tow',
        'magic_carpet', 'chair_lift', 'gondola', 'mixed_lift']) {
        assert.ok(SKI_LIFT_VALUES.split('|').includes(v), `mangler heisverdi ${v}`);
    }
});

test('bevis-selektoren henter mer enn kategoritesten trenger', async () => {
    // Bevisene brukes til TO ting: kategoritesten (heis eller downhill) og
    // fasettene (også sled, playground og mtb). Derfor er settet bredere.
    const { SKI_EVIDENCE_SELECTOR } = await load();
    assert.match(SKI_EVIDENCE_SELECTOR, /"aerialway"~/);
    assert.match(SKI_EVIDENCE_SELECTOR, /\["piste:type"\]/);
    assert.match(SKI_EVIDENCE_SELECTOR, /\["mtb:type"\]/);
    assert.match(SKI_EVIDENCE_SELECTOR, /"route"="mtb"/);
});

test('isAlpineEvidence: heis eller utforløype, ikke langrenn', async () => {
    const { isAlpineEvidence } = await load();
    assert.equal(isAlpineEvidence({ aerialway: 'chair_lift' }), true);
    assert.equal(isAlpineEvidence({ aerialway: 'rope_tow' }), true);
    assert.equal(isAlpineEvidence({ 'piste:type': 'downhill' }), true);
    assert.equal(isAlpineEvidence({ 'piste:type': 'downhill;nordic' }), true);

    assert.equal(isAlpineEvidence({ 'piste:type': 'nordic' }), false);
    assert.equal(isAlpineEvidence({ 'piste:type': 'sled' }), false,
        'en akebakke alene gjør ikke polygonet til et alpinanlegg');
    assert.equal(isAlpineEvidence({ 'mtb:type': 'downhill' }), false,
        'en sykkelløype er ikke bevis for SKIanlegg');
    assert.equal(isAlpineEvidence({}), false);
});

test('matches krever romlig verifisering — tagger alene holder ikke', async () => {
    // Uten dette ville et ski-tagget polygon som kom inn via en ANNEN
    // kategoris spørring (idrettshall henter alle sports_centre) blitt
    // hevdet av Skianlegg, uten at heis-testen noen gang kjørte.
    const cat = await ski();
    const tags = { landuse: 'winter_sports', name: 'Et anlegg' };
    assert.equal(cat.matches(tags), false, 'uten element: ikke verifisert');
    assert.equal(cat.matches(tags, { type: 'way', id: 1, tags }), false);
    assert.equal(
        cat.matches(tags, { type: 'way', id: 1, tags, skiVerified: true }),
        true
    );
});

test('is_free er UKJENT, ikke «betalt»', async () => {
    // Samme rettelse som museene fikk: en gal default er verre enn ingen.
    // Kategorien rommer heisanlegg som koster penger OG kommunale
    // barnebakker med gratis rope_tow.
    const cat = await ski();
    assert.equal(cat.isFree, null);
});

test('is_free leser fee-taggen når OSM faktisk har den', async () => {
    const { resolveIsFree } = await load();
    const cat = await ski();
    assert.equal(resolveIsFree({ fee: 'yes' }, cat.isFree), false);
    assert.equal(resolveIsFree({ fee: 'no' }, cat.isFree), true);
    assert.equal(resolveIsFree({}, cat.isFree), null);
});

test('Varingskollen skistadion faller ut, Kirkerudbakken består', async () => {
    // Det avgjørende tilfellet, gjenskapt med koordinater. Begge er
    // landuse=recreation_ground; forskjellen er heisen.
    const { isAlpineEvidence } = await load();

    const polygon = [
        { lat: 60.0, lon: 10.0 },
        { lat: 60.0, lon: 10.02 },
        { lat: 60.01, lon: 10.02 },
        { lat: 60.01, lon: 10.0 },
    ];

    // Langrennsstadion: en nordic-løype inne i polygonet, ingen heis.
    const langrenn = [{ tags: { 'piste:type': 'nordic' }, points: [{ lat: 60.005, lon: 10.01 }] }];
    const langrennInne = langrenn.filter((e) => anyInsideOrNear(e.points, polygon, 50));
    assert.equal(langrennInne.length, 1, 'løypa ligger inne');
    assert.equal(
        langrennInne.some((e) => isAlpineEvidence(e.tags)),
        false,
        'men ingenting av det er alpint — polygonet skal IKKE bli Skianlegg'
    );

    // Alpinsenter: samme polygon, men en stolheis krysser det.
    const alpint = [
        { tags: { 'piste:type': 'nordic' }, points: [{ lat: 60.005, lon: 10.01 }] },
        {
            tags: { aerialway: 'chair_lift' },
            points: [
                { lat: 59.998, lon: 9.998 }, // bunnstasjon utenfor polygonet
                { lat: 60.008, lon: 10.015 }, // toppen inne
            ],
        },
    ];
    const alpintInne = alpint.filter((e) => anyInsideOrNear(e.points, polygon, 50));
    assert.equal(
        alpintInne.some((e) => isAlpineEvidence(e.tags)),
        true,
        'heisen gjør polygonet til Skianlegg'
    );
});

test('en heis langt unna smitter ikke over på nabopolygonet', async () => {
    // Motprøven til testen over: tolleransen er 50 m, og den skal ikke la et
    // alpinanlegg i nabodalen gjøre langrennsstadionet til Skianlegg.
    const polygon = [
        { lat: 60.0, lon: 10.0 },
        { lat: 60.0, lon: 10.02 },
        { lat: 60.01, lon: 10.02 },
        { lat: 60.01, lon: 10.0 },
    ];
    const heisINabodalen = [{ lat: 60.05, lon: 10.06 }, { lat: 60.06, lon: 10.07 }];
    assert.equal(anyInsideOrNear(heisINabodalen, polygon, 50), false);
});
