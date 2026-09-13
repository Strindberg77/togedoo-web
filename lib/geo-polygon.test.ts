// lib/geo-polygon.test.ts
// Punkt-i-polygon og nærhet. Ingen nettverk, ingen database — rene funksjoner
// mot koordinater vi skriver selv.
// Kjør: node --import tsx --test lib/geo-polygon.test.ts
//
// Dette er testen som gjør at den romlige logikken kan stoles på uten å
// spørre Overpass. Feiler den, er skillet mellom alpint og langrenn brutt.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    anyInsideOrNear,
    boundsOf,
    centerOfBounds,
    insideOrNear,
    padBounds,
    pointInBounds,
    pointInRing,
} from './geo-polygon';

/** Et kvadrat på ~1 km rundt (60.00, 10.00). */
const KVADRAT = [
    { lat: 60.0, lon: 10.0 },
    { lat: 60.0, lon: 10.02 },
    { lat: 60.01, lon: 10.02 },
    { lat: 60.01, lon: 10.0 },
];

/** Konkav L-form: alpinanlegg følger terrenget og er sjelden konvekse. */
const L_FORM = [
    { lat: 60.0, lon: 10.0 },
    { lat: 60.0, lon: 10.03 },
    { lat: 60.01, lon: 10.03 },
    { lat: 60.01, lon: 10.01 },
    { lat: 60.03, lon: 10.01 },
    { lat: 60.03, lon: 10.0 },
];

test('punkt inne i et enkelt polygon', () => {
    assert.equal(pointInRing({ lat: 60.005, lon: 10.01 }, KVADRAT), true);
});

test('punkt utenfor et enkelt polygon', () => {
    assert.equal(pointInRing({ lat: 60.005, lon: 10.05 }, KVADRAT), false);
    assert.equal(pointInRing({ lat: 59.99, lon: 10.01 }, KVADRAT), false);
    assert.equal(pointInRing({ lat: 60.02, lon: 10.01 }, KVADRAT), false);
});

test('konkav form: hakket er UTENFOR', () => {
    // Det indre hjørnet i L-en. En konveks tilnærming ville sagt «inne», og
    // da ville en heis i nabodalen gjort et langrennsstadion til alpinanlegg.
    assert.equal(pointInRing({ lat: 60.02, lon: 10.02 }, L_FORM), false);
    // Begge armene er innenfor.
    assert.equal(pointInRing({ lat: 60.005, lon: 10.02 }, L_FORM), true);
    assert.equal(pointInRing({ lat: 60.02, lon: 10.005 }, L_FORM), true);
});

test('en ring med færre enn tre punkter er ikke et polygon', () => {
    assert.equal(pointInRing({ lat: 60.0, lon: 10.0 }, []), false);
    assert.equal(pointInRing({ lat: 60.0, lon: 10.0 }, [{ lat: 60, lon: 10 }]), false);
    assert.equal(
        pointInRing({ lat: 60.0, lon: 10.0 }, [
            { lat: 60, lon: 10 },
            { lat: 60, lon: 11 },
        ]),
        false
    );
});

test('ringen trenger ikke være lukket', () => {
    // Overpass leverer normalt en lukket ring (første = siste), men ikke
    // alltid for relations. Begge former skal gi samme svar.
    const lukket = [...KVADRAT, KVADRAT[0]];
    const p = { lat: 60.005, lon: 10.01 };
    assert.equal(pointInRing(p, lukket), pointInRing(p, KVADRAT));
});

test('bounds og senter', () => {
    const b = boundsOf(KVADRAT);
    assert.deepEqual(b, { minlat: 60.0, minlon: 10.0, maxlat: 60.01, maxlon: 10.02 });
    const c = centerOfBounds(b!);
    assert.ok(Math.abs(c.lat - 60.005) < 1e-9);
    assert.ok(Math.abs(c.lon - 10.01) < 1e-9);
    assert.equal(boundsOf([]), null);
});

test('padBounds tar hensyn til at lengdegrader krymper mot polene', () => {
    const b = { minlat: 60.0, minlon: 10.0, maxlat: 60.0, maxlon: 10.0 };
    const p = padBounds(b, 1000);
    const dLat = p.maxlat - b.maxlat;
    const dLon = p.maxlon - b.maxlon;
    // 1000 m nord/sør ≈ 0,00898 grader.
    assert.ok(Math.abs(dLat - 1000 / 111320) < 1e-9);
    // På 60°N er cos ≈ 0,5, så lengdegrad-utvidelsen skal være omtrent
    // dobbelt så stor i grader for samme avstand i meter.
    assert.ok(dLon > dLat * 1.9 && dLon < dLat * 2.1, `dLon=${dLon} dLat=${dLat}`);
});

test('pointInBounds', () => {
    const b = { minlat: 60.0, minlon: 10.0, maxlat: 60.01, maxlon: 10.02 };
    assert.equal(pointInBounds({ lat: 60.005, lon: 10.01 }, b), true);
    assert.equal(pointInBounds({ lat: 60.0, lon: 10.0 }, b), true, 'hjørnet er med');
    assert.equal(pointInBounds({ lat: 60.02, lon: 10.01 }, b), false);
});

test('insideOrNear: inne teller, og like utenfor teller innenfor tolleransen', () => {
    const ring = KVADRAT;
    // Inne.
    assert.equal(insideOrNear({ lat: 60.005, lon: 10.01 }, ring, 50), true);
    // ~55 m nord for kanten: utenfor med 50 m tolleranse, innenfor med 100.
    const littNord = { lat: 60.0105, lon: 10.01 };
    assert.equal(insideOrNear(littNord, ring, 50), false);
    assert.equal(insideOrNear(littNord, ring, 100), true);
});

test('insideOrNear med tolleranse 0 er ren containment mot boksen', () => {
    // Et punkt i hakket på L-formen er utenfor ringen, men INNE i boksen.
    // Med tolleranse 0 slipper det likevel gjennom — nærhet måles mot boksen,
    // ikke mot kanten. Dokumentert avveining, og den gjør testen sjenerøs,
    // aldri restriktiv.
    assert.equal(pointInRing({ lat: 60.02, lon: 10.02 }, L_FORM), false);
    assert.equal(insideOrNear({ lat: 60.02, lon: 10.02 }, L_FORM, 0), true);
});

test('anyInsideOrNear: ett treff holder', () => {
    const langtUnna = { lat: 61.0, lon: 11.0 };
    const inne = { lat: 60.005, lon: 10.01 };
    assert.equal(anyInsideOrNear([langtUnna, inne], KVADRAT, 50), true);
    assert.equal(anyInsideOrNear([langtUnna], KVADRAT, 50), false);
    assert.equal(anyInsideOrNear([], KVADRAT, 50), false);
});

test('en heis som krysser polygonkanten teller — den har punkter inne', () => {
    // Vanlig i OSM: heisen er tegnet fra parkeringsplassen utenfor polygonet
    // og opp i bakken. Bare ETT punkt inne skal holde.
    const heis = [
        { lat: 59.998, lon: 9.998 }, // bunnstasjon utenfor
        { lat: 60.005, lon: 10.01 }, // midt i anlegget
    ];
    assert.equal(anyInsideOrNear(heis, KVADRAT, 50), true);
});
