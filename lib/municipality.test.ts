// lib/municipality.test.ts
// Kommune fra koordinat, offline. Leser den EKTE grensefila i data/.
// Kjør: node --import tsx --test lib/municipality.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    BILINGUAL_MUNICIPALITIES,
    buildMunicipalityIndex,
    canonicalMunicipality,
    municipalityName,
    type KommuneFeature,
} from './municipality';

const FIL = path.join(process.cwd(), 'data', 'kommuner.geojson');
const features: KommuneFeature[] = JSON.parse(fs.readFileSync(FIL, 'utf8')).features;
const index = buildMunicipalityIndex(features);

// ---------------------------------------------------------------------------
// FILA
// ---------------------------------------------------------------------------

test('grensefila har alle kommunene', () => {
    // Slår ut hvis fila byttes mot en annen kvalitet eller en delmengde.
    assert.equal(index.count, 357);
});

test('fila har lisensen vi tror — Kartverket krever attribusjon', () => {
    const readme = fs.readFileSync(path.join(process.cwd(), 'data', 'README.md'), 'utf8');
    assert.match(readme, /CC BY 4\.0/);
    assert.match(readme, /Kartverket/);
});

// ---------------------------------------------------------------------------
// OPPSLAGET
// ---------------------------------------------------------------------------

test('kjente punkter havner i riktig kommune', () => {
    // De fem Oslo-alpinanleggene, pluss kontroller i hver av de fire byene og
    // de to utenbys seedede anleggene.
    const fasit: [string, number, number, string][] = [
        ['Tryvann', 59.98870, 10.66812, 'Oslo'],
        ['Wyller', 59.9909, 10.6304, 'Oslo'],
        ['Tommkleiva', 59.983264, 10.669012, 'Oslo'],
        ['Trollvannskleiva', 59.96172, 10.80608, 'Oslo'],
        ['Grefsenkleiva', 59.951768, 10.814618, 'Oslo'],
        ['Korketrekkeren', 59.9836, 10.6790, 'Oslo'],
        ['Oslo S', 59.9106, 10.7522, 'Oslo'],
        ['Bergen', 60.3913, 5.3221, 'Bergen'],
        ['Trondheim', 63.4305, 10.3951, 'Trondheim'],
        ['Stavanger', 58.97, 5.7331, 'Stavanger'],
        ['Kirkerudbakken', 59.9330, 10.4680, 'Bærum'],
        ['Varingskollen', 60.1085, 10.8330, 'Nittedal'],
    ];
    for (const [navn, lat, lng, kommune] of fasit) {
        assert.equal(index.lookup(lat, lng), kommune, navn);
    }
});

test('Wyller ligger i Oslo, ikke Bærum — den ene som var i tvil', () => {
    assert.equal(index.lookup(59.9909, 10.6304), 'Oslo');
    // Kontrollpunkt på den andre siden av grensen.
    assert.equal(index.lookup(59.8916, 10.5261), 'Bærum', 'Sandvika');
});

test('et punkt utenfor Norge gir null, ikke en gjetning', () => {
    // Nasjonal modus henter med bbox, og en bbox over Norge tar med naboland.
    // Null er signalet om at raden ikke er vår.
    assert.equal(index.lookup(59.3293, 18.0686), null, 'Stockholm');
    assert.equal(index.lookup(55.6761, 12.5683), null, 'København');
    assert.equal(index.lookup(60.1699, 24.9384), null, 'Helsinki');
    assert.equal(index.lookup(0, 0), null, 'Null Island');
});

test('et punkt i havet utenfor kysten gir null', () => {
    assert.equal(index.lookup(62.0, 3.0), null, 'Nordsjøen');
});

// ---------------------------------------------------------------------------
// TOSPRÅKLIGE NAVN
// ---------------------------------------------------------------------------

test('Trondheim heter Trondheim, ikke «Trondheim - Tråante»', () => {
    // Den konkrete skaden: by-modus matcher municipality.ilike UTEN jokertegn,
    // og de 7800 eksisterende radene sier «Trondheim». To former i samme
    // kolonne ville gjort Trondheim-chipen blind for de nye radene.
    assert.equal(index.lookup(63.4305, 10.3951), 'Trondheim');
    assert.ok(index.names.has('Trondheim'));
    assert.ok(!index.names.has('Trondheim - Tråante'));
});

test('rekkefølgen i fila varierer — «første ledd» ville gitt feil navn', () => {
    // Rosse - Røros og Guovdageaidnu - Kautokeino har samisk navn FØRST.
    // Derfor en tabell og ikke en strengoperasjon.
    const somNavn = (nr: string) =>
        municipalityName(features.find((f) => f.properties.kommunenummer === nr)!);
    assert.equal(somNavn('5025'), 'Røros');
    assert.equal(somNavn('5612'), 'Kautokeino');
    assert.equal(somNavn('5001'), 'Trondheim');
});

test('HVER tospråklig kommune i fila har tatt stilling til navnet', () => {
    // VAKTEN. Kommer en ny tospråklig kommune i en senere utgave av fila,
    // feiler denne til noen har valgt navnet. Uten den ville et navn med
    // « - » sneket seg inn i municipality og blitt usynlig i by-modus.
    const uavklarte = features
        .filter((f) => (f.properties.name ?? '').includes(' - '))
        .filter((f) => !(f.properties.kommunenummer! in BILINGUAL_MUNICIPALITIES))
        .map((f) => `${f.properties.kommunenummer} ${f.properties.name}`);
    assert.deepEqual(uavklarte, []);
});

test('ingen valgt navn inneholder « - » — da var poenget borte', () => {
    for (const [nr, navn] of Object.entries(BILINGUAL_MUNICIPALITIES)) {
        assert.ok(!navn.includes(' - '), `${nr}: ${navn}`);
    }
});

test('overstyringstabellen har ingen oppføringer for kommuner som ikke finnes', () => {
    const nummer = new Set(features.map((f) => f.properties.kommunenummer));
    for (const nr of Object.keys(BILINGUAL_MUNICIPALITIES)) {
        assert.ok(nummer.has(nr), `${nr} finnes ikke i fila`);
    }
});

// ---------------------------------------------------------------------------
// NORMALISERING — «OSLO» fra Kartverket punktsøk
// ---------------------------------------------------------------------------

test('«OSLO» blir «Oslo»', () => {
    // Punktsøket svarer i store bokstaver. Normaliseringen ligger her, sammen
    // med utledningen, så de to aldri kan komme i utakt.
    assert.equal(canonicalMunicipality('OSLO', index), 'Oslo');
    assert.equal(canonicalMunicipality('oslo', index), 'Oslo');
    assert.equal(canonicalMunicipality('  Oslo  ', index), 'Oslo');
});

test('navn med bindestrek og norske tegn mangles ikke', () => {
    // En naiv tittelkasse ville gjort «SØR-VARANGER» til «Sør-varanger».
    // Oppslaget mot fila kan ikke bomme på den måten.
    assert.equal(canonicalMunicipality('SØR-VARANGER', index), 'Sør-Varanger');
    assert.equal(canonicalMunicipality('NORD-FRON', index), 'Nord-Fron');
    assert.equal(canonicalMunicipality('ÅL', index), 'Ål');
});

test('et ukjent navn gir null, ikke en gjetning', () => {
    assert.equal(canonicalMunicipality('Kristiania', index), null);
    assert.equal(canonicalMunicipality('', index), null);
    assert.equal(canonicalMunicipality(null, index), null);
});

test('«TRONDHEIM» normaliseres til appens form', () => {
    assert.equal(canonicalMunicipality('TRONDHEIM', index), 'Trondheim');
});
