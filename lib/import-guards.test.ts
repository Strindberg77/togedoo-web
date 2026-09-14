// lib/import-guards.test.ts
// Stoppvilkårene. Rene funksjoner, ingen nettverk.
// Kjør: node --import tsx --test lib/import-guards.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    claimMismatchStop,
    geocodeFailureStop,
    GEOCODE_FAILURE_THRESHOLD,
    GEOCODE_MIN_SAMPLE,
    ImportStop,
    NATIONAL_EXPECTATION,
    yieldCollapseStop,
    YIELD_FLOOR,
    YIELD_MIN_PROGRESS,
} from './import-guards';

// ---------------------------------------------------------------------------
// 1) CLAIM-NAVNEAVVIK
// ---------------------------------------------------------------------------

test('ett navneavvik er nok — det er ikke et forhold', () => {
    const stop = claimMismatchStop('relation/2259942', 'Oslo Skisenter', ['Skimore Oslo']);
    assert.ok(stop instanceof ImportStop);
    assert.equal(stop.vilkaar, 'claim-navneavvik');
    assert.match(stop.message, /relation\/2259942/);
    assert.match(stop.message, /Skimore Oslo/);
    assert.match(stop.message, /Oslo Skisenter/);
});

test('et objekt uten navn skrives ut lesbart, ikke som undefined', () => {
    const stop = claimMismatchStop('way/1', undefined, [null, 'Tryvann']);
    assert.match(stop.message, /\(uten navn\)/);
});

// ---------------------------------------------------------------------------
// 2) GEOKODINGSFEIL
// ---------------------------------------------------------------------------

test('over terskelen stopper kjøringen', () => {
    const stop = geocodeFailureStop('Oslo', { forsok: 100, feil: 30 });
    assert.ok(stop);
    assert.equal(stop!.vilkaar, 'geokodingsfeil');
    assert.match(stop!.message, /30 av 100/);
});

test('på terskelen stopper den IKKE — grensen er «over»', () => {
    assert.equal(geocodeFailureStop('Oslo', { forsok: 100, feil: 20 }), null);
    assert.equal(geocodeFailureStop('Oslo', { forsok: 100, feil: 21 })?.vilkaar, 'geokodingsfeil');
    assert.equal(GEOCODE_FAILURE_THRESHOLD, 0.2);
});

test('et lite utvalg kan ikke utløse stoppet', () => {
    // Uten gulvet ville tre navnløse steder og én feil gitt 33 % og stanset
    // en nasjonal kjøring på et enkelt uhell.
    assert.equal(geocodeFailureStop('Utsira', { forsok: 3, feil: 3 }), null);
    assert.equal(geocodeFailureStop('Utsira', { forsok: 9, feil: 9 }), null);
    assert.ok(geocodeFailureStop('Utsira', { forsok: 10, feil: 9 }));
    assert.equal(GEOCODE_MIN_SAMPLE, 10);
});

test('en chunk uten geokodingsbehov stopper ingenting', () => {
    // Ski er ~80 % navngitt; mange chunks vil ha null forsøk.
    assert.equal(geocodeFailureStop('Oslo', { forsok: 0, feil: 0 }), null);
});

// ---------------------------------------------------------------------------
// 3) UTBYTTEKOLLAPS
// ---------------------------------------------------------------------------

const telling = (o: Record<string, number>) => new Map(Object.entries(o));

test('tidlig i planen sier tallene ingenting', () => {
    // En kategori kan mangle i de fem første kommunene av rene geografiske
    // grunner.
    assert.equal(yieldCollapseStop(telling({ lekeplass: 0 }), 0.1), null);
    assert.equal(YIELD_MIN_PROGRESS, 0.25);
});

test('under gulvet etter en firedel av planen stopper kjøringen', () => {
    // 11 901 lekeplasser × 0,5 = ~5 950 forventet. 100 er 1,7 %.
    const stop = yieldCollapseStop(telling({ lekeplass: 100 }), 0.5);
    assert.ok(stop);
    assert.equal(stop!.vilkaar, 'utbyttekollaps');
    assert.match(stop!.message, /lekeplass/);
    assert.match(stop!.message, /selektor/);
});

test('gulvet er løst nok til at et unøyaktig forventningstall går klar', () => {
    // Forventningstallene er TAK (dominerende tagg), så en kategori som
    // leverer en tredel av taket er normalt, ikke en feil.
    assert.equal(yieldCollapseStop(telling({ ballbane: 5141 }), 1.0), null, 'en tredel');
    assert.equal(YIELD_FLOOR, 0.2);
});

test('ÉN NASJONAL CHUNK: antakelsen om jevn fordeling er da eksakt', () => {
    // Dette er kjøringen vakten bygges for. andelPlanenDekker = 1, så
    // forventningen er hele det nasjonale tallet.
    assert.equal(yieldCollapseStop(telling({ skianlegg: 203, aking: 70 }), 1.0), null);
    const stop = yieldCollapseStop(telling({ skianlegg: 12, aking: 70 }), 1.0);
    assert.ok(stop, '12 av 254 er under gulvet');
    assert.match(stop!.message, /skianlegg/);
    assert.ok(!stop!.message.includes('aking'), 'aking er over gulvet');
});

test('en kategori som ikke kjøres vurderes ikke', () => {
    // --category=aking skal ikke stanse på at lekeplass ga null.
    assert.equal(yieldCollapseStop(telling({ aking: 80 }), 1.0), null);
});

test('en kategori uten målt nasjonalt tall hoppes over', () => {
    // rullesport og klatring er ikke målt. Å gjette et tall ville gjort
    // vakten til en tilfeldighetsgenerator.
    assert.ok(!('rullesport' in NATIONAL_EXPECTATION));
    assert.ok(!('klatring' in NATIONAL_EXPECTATION));
    assert.equal(yieldCollapseStop(telling({ rullesport: 0 }), 1.0), null);
});

test('forventningstallene er de målte', () => {
    // Låser tallene mot en utilsiktet endring. Kilde: osmium mot
    // Geofabrik-fila, sep. 2026.
    assert.deepEqual(NATIONAL_EXPECTATION, {
        ballbane: 15423,
        lekeplass: 11901,
        badeplass: 4841,
        park: 3070,
        idrettshall: 2312,
        museum: 1241,
        bibliotek: 721,
        skianlegg: 254,
        aking: 89,
    });
});

test('null av 22 forventede stopper — det er hele poenget', () => {
    // 89 akebakker × 0,25 av planen = 22. Finner kjøringen ingen, er det en
    // selektor som ikke treffer.
    const stop = yieldCollapseStop(telling({ aking: 0 }), 0.25);
    assert.ok(stop);
    assert.match(stop!.message, /aking: 0 rader mot 22 forventet/);
});

test('en kategori med under én forventet rad vurderes ikke', () => {
    // Forholdstall er meningsløse når forventningen er en brøkdel av en rad.
    // Med dagens tabell er dette utenfor rekkevidde (minste tall er 89, og
    // sjekken slår først inn ved 25 % av planen = 22), så det testes mot en
    // egen tabell — grenen finnes for den dagen en liten kategori måles.
    assert.equal(yieldCollapseStop(telling({ nisje: 0 }), 0.3, { nisje: 2 }), null);
    assert.ok(yieldCollapseStop(telling({ nisje: 0 }), 0.3, { nisje: 20 }));
});
