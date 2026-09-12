// scripts/facets.test.ts
// Fasett-utledningen fra OSM-tagger (migrasjon 0016). Ingen nettverk, ingen
// database — en ren funksjon.
// Kjør: node --import tsx --test scripts/facets.test.ts
//
// MERK: ingen kategori i PLACE_CATEGORIES bruker disse tokenene ennå. Det er
// med vilje — ski-selektoren finnes ikke, og fasettene er ikke lagt inn i
// filteret. Denne testen låser MEKANISMEN, så regelen er riktig den dagen
// kategorien kommer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACET_TOKENS } from '../lib/facets';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

test('piste:type gir alpint, aking og skileik', async () => {
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'downhill' }), ['alpint']);
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'sled' }), ['aking']);
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'playground' }), ['skileik']);
});

test('mtb:type og route gir sykkelfasettene', async () => {
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ 'mtb:type': 'downhill' }), ['downhill']);
    assert.deepEqual(osmFacetTokens({ route: 'mtb' }), ['terrengsykling']);
});

test('semikolonseparert piste:type gir flere tokens', async () => {
    // «downhill;nordic» er vanlig. Nordic har ingen fasett ennå og skal ikke
    // gi et token — men downhill skal fortsatt finnes.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'downhill;nordic' }), ['alpint']);
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'sled;downhill' }), ['alpint', 'aking']);
});

test('et anlegg med både ski og sykkel får begge — det er hele poenget', async () => {
    // Trysil-tilfellet: samme sted, to sesonger, én rad.
    const { osmFacetTokens } = await load();
    assert.deepEqual(
        osmFacetTokens({ 'piste:type': 'downhill', 'mtb:type': 'downhill', route: 'mtb' }),
        ['alpint', 'downhill', 'terrengsykling']
    );
});

test('tagger uten fasett gir tom liste, aldri null', async () => {
    // Kolonnen er `not null default '{}'`. Utledningen må speile det, ellers
    // må hver leser håndtere to former for «ingenting».
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({}), []);
    assert.deepEqual(osmFacetTokens({ leisure: 'playground' }), []);
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'nordic' }), []);
});

test('ice_skate gir INGEN fasett — bevisst', async () => {
    // Skøyter er en kategori, ikke en fasett. Et token ingen fasett leser
    // ville vært en påstand uten mottaker.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'ice_skate' }), []);
});

test('sport-taggen gir ingen fasett — den kanalen er sports', async () => {
    // Disjunkte mengder med vilje: API-et utleder `sports` fra osm_tags.sport,
    // klienten tar unionen. Kom det samme tokenet fra to kanaler, ville det
    // vært umulig å feilsøke den dagen de er uenige.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ sport: 'skateboard' }), []);
    assert.deepEqual(osmFacetTokens({ sport: 'soccer;basketball' }), []);
});

test('lekeplass-taggen playground forveksles ikke med piste:type=playground', async () => {
    // `leisure=playground` er en lekeplass. `piste:type=playground` er
    // skileikområdet i en alpinbakke. Samme ord, ulike nøkler.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ leisure: 'playground' }), []);
    assert.deepEqual(osmFacetTokens({ 'piste:type': 'playground' }), ['skileik']);
});

test('ingen kategori er koblet på facetsFor ennå', async () => {
    // Standardregelen er kategoriuavhengig, så kroken skal stå ubrukt til en
    // kategori faktisk trenger en annen regel. Feiler denne, har noen koblet
    // på en override — og da bør de også ha skrevet en test for den.
    const { PLACE_CATEGORIES } = await load();
    const koblet = PLACE_CATEGORIES.filter((c) => c.facetsFor).map((c) => c.key);
    assert.deepEqual(koblet, []);
});

test('utledningen emitterer bare tokens fra vokabularet', async () => {
    // FACET_TOKENS er delt med seed-vintertilbud.ts, der `tsc` fanger en
    // skrivefeil i SPLIT-tabellen. Her låses den andre siden: utledningen
    // kan ikke finne på et token som ingen fasett vil lese.
    const { osmFacetTokens } = await load();
    const alle = [
        { 'piste:type': 'downhill;sled;playground', 'mtb:type': 'downhill', route: 'mtb' },
        { 'piste:type': 'nordic;ice_skate' },
        { sport: 'skateboard' },
        {},
    ].flatMap((t) => osmFacetTokens(t));
    for (const token of alle) {
        assert.ok(
            (FACET_TOKENS as readonly string[]).includes(token),
            `«${token}» står ikke i FACET_TOKENS`
        );
    }
    // Og motsatt: hvert token i vokabularet skal kunne utledes fra EN tagg,
    // ellers er det dødt. (Alle fem er dekket av taggene over.)
    assert.deepEqual([...new Set(alle)].sort(), [...FACET_TOKENS].sort());
});
