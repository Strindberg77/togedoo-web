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

test('forventningstallene er de målte, og de er OBJEKTER', () => {
    // Låser tallene mot en utilsiktet endring. Kilde: osmium mot
    // Geofabrik-fila, sep. 2026. Taggen og settet står med fordi tallet uten
    // dem ikke kan sammenlignes med noe — se NasjonalForventning.
    assert.deepEqual(NATIONAL_EXPECTATION, {
        ballbane: { objekter: 15423, tag: 'leisure=pitch', sett: 'main' },
        lekeplass: { objekter: 11901, tag: 'leisure=playground', sett: 'main' },
        badeplass: { objekter: 4841, tag: 'natural=beach', sett: 'main' },
        park: { objekter: 3070, tag: 'leisure=park', sett: 'main' },
        idrettshall: { objekter: 2312, tag: 'leisure=sports_centre', sett: 'main' },
        museum: { objekter: 1241, tag: 'tourism=museum', sett: 'main' },
        bibliotek: { objekter: 721, tag: 'amenity=library', sett: 'main' },
        skianlegg: { objekter: 254, tag: 'landuse=winter_sports', sett: 'omrade' },
        aking: { objekter: 89, tag: 'piste:type=sled', sett: 'main' },
    });
});

test('SKIANLEGG teller «omrade», ikke «bevis» — ellers er vakten ubrukelig', () => {
    // Bevissettet hentet 4536 objekter i områdekjøringen okt. 2026, og de blir
    // ALDRI rader: de er inndata til den romlige testen. Summerte vakten
    // begge settene, ville forholdstallet vært rundt 1950 % og kategorien
    // kunne aldri stanset — heller ikke om områdeselektoren sluttet å treffe.
    assert.equal(NATIONAL_EXPECTATION.skianlegg.sett, 'omrade');
    // 423 objekter i «omrade» er det målte, og det går klar.
    assert.equal(yieldCollapseStop(telling({ skianlegg: 423 }), 1.0), null);
    // 0 i «omrade» stanser, selv om bevissettet var fullt.
    assert.ok(yieldCollapseStop(telling({ skianlegg: 0 }), 1.0));
});

test('DE MÅLTE TALLENE FRA OMRÅDEKJØRINGEN GÅR KLAR', () => {
    // Kjøringen okt. 2026 som utløste et FALSKT stopp med den gamle vakten:
    // aking 13 rader mot 89 forventet (15 %). Med objekter mot objekter er
    // aking 91 mot 89 — 102 %.
    assert.equal(yieldCollapseStop(telling({ skianlegg: 423, aking: 91 }), 1.0), null);
});

test('null av 22 forventede stopper — det er hele poenget', () => {
    // 89 akebakker × 0,25 av planen = 22. Finner kjøringen ingen, er det en
    // selektor som ikke treffer.
    const stop = yieldCollapseStop(telling({ aking: 0 }), 0.25);
    assert.ok(stop);
    assert.match(stop!.message, /aking: 0 objekter i settet «main» mot 22 forventet/);
    assert.match(stop!.message, /piste:type=sled/, 'meldingen sier hva tallet er talt på');
    assert.match(stop!.message, /OBJEKTER fra OSM, ikke rader/, 'enheten står i klartekst');
});

test('en kategori med under én forventet rad vurderes ikke', () => {
    // Forholdstall er meningsløse når forventningen er en brøkdel av en rad.
    // Med dagens tabell er dette utenfor rekkevidde (minste tall er 89, og
    // sjekken slår først inn ved 25 % av planen = 22), så det testes mot en
    // egen tabell — grenen finnes for den dagen en liten kategori måles.
    const nisje = (objekter: number) => ({ nisje: { objekter, tag: 'x=y', sett: 'main' } });
    assert.equal(yieldCollapseStop(telling({ nisje: 0 }), 0.3, nisje(2)), null);
    assert.ok(yieldCollapseStop(telling({ nisje: 0 }), 0.3, nisje(20)));
});

test('en vakt som slaar seg av skal SI det', async () => {
    // Et hentesteg gjenopptatt fra en .import-work skrevet før okt. 2026 har
    // ingen settelling. Da kan vakten ikke telle noe, og den hopper over
    // kategorien — riktig, siden alternativet er å stoppe på et tall som ikke
    // finnes. Men stillhet ville gjort det umulig å oppdage.
    const { hoppetOverIUtbytte } = await import('./import-guards');
    const kjort = ['skianlegg', 'aking', 'rullesport'];

    // Ingenting talt: begge målte kategorier hoppes over. rullesport har
    // ingen forventning i det hele tatt og er ikke «hoppet over».
    assert.deepEqual(hoppetOverIUtbytte(new Map(), kjort), ['skianlegg', 'aking']);
    // Og vakten stopper ikke på dem.
    assert.equal(yieldCollapseStop(new Map(), 1.0), null);

    // Delvis: bare den som mangler meldes.
    assert.deepEqual(hoppetOverIUtbytte(telling({ skianlegg: 423 }), kjort), ['aking']);
    assert.deepEqual(hoppetOverIUtbytte(telling({ skianlegg: 423, aking: 91 }), kjort), []);

    // 0 ER IKKE MANGLENDE. Forskjellen er hele poenget: 0 objekter er et
    // målt tall og skal stanse kjøringen.
    assert.deepEqual(hoppetOverIUtbytte(telling({ skianlegg: 0 }), ['skianlegg']), []);
    assert.ok(yieldCollapseStop(telling({ skianlegg: 0 }), 1.0));
});
