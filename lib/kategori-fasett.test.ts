// lib/kategori-fasett.test.ts
// Kategorifilteret som også treffer fasetter (migrasjon 0022): hvilke
// fasetter API-et sender, og hvordan den flate stien bygger .or()-filteret.
//
// Ingen nettverk, ingen database.
// Kjør: npx tsx --test lib/kategori-fasett.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACET_TOKENS, FASETT_SOM_KATEGORI, categoryFacetsFor } from './facets';
import { categoryOrFacetFilter } from './activities-query';

test('regelen: aking, fornoyelsespark og de seks Spill og moro-fasettene teller som kategoritreff', () => {
    assert.deepEqual(FASETT_SOM_KATEGORI, {
        aking: 'Aking',
        fornoyelsespark: 'Fornøyelsespark',
        bowling: 'Spill og moro',
        lasertag: 'Spill og moro',
        gokart: 'Spill og moro',
        escaperom: 'Spill og moro',
        spillehall: 'Spill og moro',
        minigolf: 'Spill og moro',
    });
    for (const t of Object.keys(FASETT_SOM_KATEGORI)) {
        assert.ok((FACET_TOKENS as readonly string[]).includes(t), `${t} står ikke i FACET_TOKENS`);
    }
});

test('fasettene sendes bare for kategorier som har en', () => {
    assert.deepEqual(categoryFacetsFor(['Fornøyelsespark']), ['fornoyelsespark']);
    assert.deepEqual(categoryFacetsFor(['Aking']), ['aking']);
    assert.deepEqual(categoryFacetsFor(['Aking', 'Fornøyelsespark', 'Park'])?.sort(), ['aking', 'fornoyelsespark']);
    // Uten fasett: null, så spørringen er nøyaktig som før byttet.
    assert.equal(categoryFacetsFor(['Skianlegg']), null);
    assert.equal(categoryFacetsFor(['Lekeplass', 'Park']), null);
    assert.equal(categoryFacetsFor([]), null);
    assert.equal(categoryFacetsFor(null), null);
});

test('Spill og moro sender alle seks fasettene, og bare dem', () => {
    assert.deepEqual(categoryFacetsFor(['Spill og moro'])?.sort(), [
        'bowling',
        'escaperom',
        'gokart',
        'lasertag',
        'minigolf',
        'spillehall',
    ]);
    // Sammen med en annen kategori med fasett: unionen.
    assert.deepEqual(categoryFacetsFor(['Spill og moro', 'Aking'])?.length, 7);
    // Innendørs lekeland har ingen fasett selv. Lykkeland (lekeland med
    // lasertag) kommer opp under Spill og moro, ikke omvendt.
    assert.equal(categoryFacetsFor(['Innendørs lekeland']), null);
});

test('den flate stien: Spill og moro gir kategori ELLER én av de seks fasettene', () => {
    assert.equal(
        categoryOrFacetFilter(['Spill og moro'], ['bowling', 'lasertag']),
        'category.in.("Spill og moro"),facets.ov.{bowling,lasertag}'
    );
});

test('presiserende fasetter blir aldri en kategori', () => {
    // «alpint» er en egenskap ved et Skianlegg, ikke en kategori. Heter en
    // kategori en dag Alpint, skal det være et bevisst valg i tabellen.
    assert.equal(categoryFacetsFor(['Alpint', 'alpint', 'Skileik']), null);
});

test('store og små bokstaver: kategorinøkkelen må stemme eksakt, som category=', () => {
    assert.equal(categoryFacetsFor(['aking']), null);
    assert.equal(categoryFacetsFor(['Fornoyelsespark']), null);
});

test('den flate stien: kategori ELLER fasett, med kategorinavnene sitert', () => {
    assert.equal(
        categoryOrFacetFilter(['Fornøyelsespark'], ['fornoyelsespark']),
        'category.in.("Fornøyelsespark"),facets.ov.{fornoyelsespark}'
    );
    // Mellomrom og ø er vanlige i kategorinavn.
    assert.equal(
        categoryOrFacetFilter(['Aking', 'Innendørs lekeland'], ['aking']),
        'category.in.("Aking","Innendørs lekeland"),facets.ov.{aking}'
    );
});

test('den flate stien: et kategorinavn kan ikke bryte ut av filteret', () => {
    // Uten sitering ville komma, parentes og punktum i verdien lagt til
    // egne betingelser i .or().
    const f = categoryOrFacetFilter(['x"),status.eq.rejected,category.in.("y'], ['aking']);
    assert.equal(
        f,
        'category.in.("x\\"),status.eq.rejected,category.in.(\\"y"),facets.ov.{aking}'
    );
    assert.equal(categoryOrFacetFilter(['a\\b'], ['aking']), 'category.in.("a\\\\b"),facets.ov.{aking}');
});
