// lib/website.test.ts
// Validering av nettadresser fra OSM. Ingen nettverk — en ren funksjon.
// Kjør: node --import tsx --test lib/website.test.ts
//
// Funksjonen deles av API-et (`website` i /api/activities, som driver
// «Besøk nettside» i appen) og av importen (`url`-kolonnen). Lå regelen to
// steder, kunne knappen og kolonnen pekt ulike steder for samme rad.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeWebsite } from './website';

test('en ryddig adresse slipper gjennom uendret', () => {
    // Skimore Oslo, slik den faktisk står i OSM.
    assert.equal(sanitizeWebsite('http://www.tryvann.no/'), 'http://www.tryvann.no/');
    assert.equal(sanitizeWebsite('https://a.no/sti?q=1#x'), 'https://a.no/sti?q=1#x');
});

test('manglende skjema får https', () => {
    // Den vanligste slurven i OSM. Intensjonen er utvetydig.
    assert.equal(sanitizeWebsite('www.example.no'), 'https://www.example.no/');
    assert.equal(sanitizeWebsite('example.no'), 'https://example.no/');
    assert.equal(sanitizeWebsite('//a.no'), 'https://a.no/');
});

test('e-postadresse gir null — ikke en nettside med brukernavn', () => {
    // REGRESJON. Den gamle regelen gjorde dette til «https://post@example.no/»:
    // en gyldig URL der «post» er et brukernavn, som tar brukeren til
    // example.no med en etterlatt legitimasjonsdel. Feilen var synlig for
    // brukeren, siden `website` er feltet «Besøk nettside» leser.
    assert.equal(sanitizeWebsite('post@example.no'), null);
    assert.equal(sanitizeWebsite('mailto:post@example.no'), null);
    assert.equal(sanitizeWebsite('bruker:passord@a.no'), null);
});

test('flere adresser: første brukbare vinner', () => {
    // Semikolon er OSMs konvensjon for flere verdier. Den gamle regelen ga
    // «https://a.no;https//b.no» — en adresse som verken er den ene eller
    // den andre.
    assert.equal(sanitizeWebsite('https://a.no;https://b.no'), 'https://a.no/');
    assert.equal(sanitizeWebsite('www.a.no;www.b.no'), 'https://www.a.no/');
    // Komma er ikke konvensjon, men forekommer — og en adresse inneholder
    // aldri komma.
    assert.equal(sanitizeWebsite('a.no,b.no'), 'https://a.no/');
});

test('en ugyldig først i lista hopper videre til neste', () => {
    assert.equal(sanitizeWebsite('post@a.no;www.b.no'), 'https://www.b.no/');
    assert.equal(sanitizeWebsite('tull;;www.b.no'), 'https://www.b.no/');
});

test('andre skjemaer gir null', () => {
    // Kun http/https kan åpnes trygt i appens webview. javascript: er den
    // som gjør dette til mer enn ryddighet.
    assert.equal(sanitizeWebsite('tel:+4712345678'), null);
    assert.equal(sanitizeWebsite('ftp://a.no/fil'), null);
    assert.equal(sanitizeWebsite('javascript:alert(1)'), null);
});

test('søppel og tomt gir null', () => {
    assert.equal(sanitizeWebsite('ikke en url'), null);
    assert.equal(sanitizeWebsite(''), null);
    assert.equal(sanitizeWebsite('   '), null);
    assert.equal(sanitizeWebsite(null), null);
    assert.equal(sanitizeWebsite(undefined), null);
    // Et vertsnavn uten punktum er ikke et domene.
    assert.equal(sanitizeWebsite('localhost'), null);
    assert.equal(sanitizeWebsite('http://localhost:3000'), null);
});

test('mellomrom rundt trimmes', () => {
    assert.equal(sanitizeWebsite('  https://a.no  '), 'https://a.no/');
});

test('absurd lange verdier avvises framfor å lagres', () => {
    assert.equal(sanitizeWebsite('https://a.no/' + 'x'.repeat(600)), null);
    assert.equal(sanitizeWebsite('x'.repeat(600) + '.no'), null);
});
