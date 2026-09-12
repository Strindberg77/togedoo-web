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

test('sport-tokens utenfor rullesport gir ingen fasett', async () => {
    // Denne testen hevdet tidligere at INGEN sport-tagg ga fasett — «disjunkte
    // mengder med vilje». Det ble endret sep. 2026: skateboard og bmx skrives
    // nå inn i facets også, så kolonnen kan beskrive raden alene den dagen
    // sports avvikles. Overlappet er ufarlig (klienten slår opp i unionen).
    //
    // Det som fortsatt gjelder, og som testes her: utledningen plukker BARE
    // rullesport-tokens fra sport-taggen. Ballbanenes sporter hører hjemme i
    // `sports` og skal ikke lekke inn.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ sport: 'soccer;basketball' }), []);
    assert.deepEqual(osmFacetTokens({ sport: 'tennis' }), []);
    assert.deepEqual(osmFacetTokens({ sport: 'climbing' }), []);
});

test('skateboard gir tre tokens — antakelsen, ikke en avlesning', async () => {
    // Kjernen i endringen. OSM kan ikke fylle sparkesykkel og rulleskøyter:
    // kick_scooter finnes 3 ganger i hele Norge, roller_skating i 5
    // sammensetninger. Antakelsen står på SKATEBOARD_IMPLIES i lib/facets.ts.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ sport: 'skateboard' }).sort(), [
        'rulleskoyter',
        'skateboard',
        'sparkesykkel',
    ]);
    // 68 av 81 Rullesport-rader i prod har skateboard, så dette er raden
    // regelen faktisk treffer.
    assert.deepEqual(osmFacetTokens({ sport: 'skateboard;cycling' }).sort(), [
        'rulleskoyter',
        'skateboard',
        'sparkesykkel',
    ]);
});

test('bmx alene gir BARE bmx — retningen er enveis', async () => {
    // En BMX-bane i skogen er ikke et sted for rulleskøyter. Snus retningen,
    // blir fasetten usann for jordbane og hoppkuler. 10 av 81 rader i prod.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ sport: 'bmx' }), ['bmx']);
    assert.deepEqual(osmFacetTokens({ sport: 'bmx;cycling' }), ['bmx']);
    assert.deepEqual(osmFacetTokens({ sport: 'cycling;bmx' }), ['bmx']);
    for (const token of ['sparkesykkel', 'rulleskoyter', 'skateboard']) {
        assert.ok(
            !osmFacetTokens({ sport: 'bmx' }).includes(token),
            `bmx skal ikke gi ${token}`
        );
    }
});

test('skateboard OG bmx gir alle fire — reglene er additive', async () => {
    // 0 rader i prod har begge i dag, men regelen må holde uansett.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ sport: 'skateboard;bmx' }).sort(), [
        'bmx',
        'rulleskoyter',
        'skateboard',
        'sparkesykkel',
    ]);
    assert.deepEqual(
        osmFacetTokens({ sport: 'bmx;skateboard' }).sort(),
        osmFacetTokens({ sport: 'skateboard;bmx' }).sort(),
        'rekkefølgen i taggen skal ikke bety noe'
    );
});

test('kick_scooter og roller_skating leses direkte når de finnes', async () => {
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ sport: 'kick_scooter' }), ['sparkesykkel']);
    assert.deepEqual(osmFacetTokens({ sport: 'roller_skating' }), ['rulleskoyter']);
});

test('roller_skiing forveksles ALDRI med roller_skating', async () => {
    // Rulleski og rulleskøyter er to ulike sporter med nesten like tagger.
    // sportTokens splitter på «;» og «,», så treffet er på hele tokenet —
    // men fella er nær nok til å fortjene en egen vakt.
    const { osmFacetTokens } = await load();
    assert.deepEqual(osmFacetTokens({ sport: 'roller_skiing' }), [],
        'rulleski har fasett via sports, ikke via facets');
    assert.deepEqual(osmFacetTokens({ sport: 'roller_skating' }), ['rulleskoyter']);
});

test('overlappende regler gir hvert token én gang', async () => {
    // «skateboard;kick_scooter» treffer to regler som begge gir sparkesykkel.
    const { osmFacetTokens } = await load();
    const treff = osmFacetTokens({ sport: 'skateboard;kick_scooter;roller_skating' });
    assert.deepEqual(treff.sort(), ['rulleskoyter', 'skateboard', 'sparkesykkel']);
    assert.equal(new Set(treff).size, treff.length, 'ingen duplikater');
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
        { sport: 'skateboard;bmx' },
        { sport: 'soccer' },
        {},
    ].flatMap((t) => osmFacetTokens(t));
    for (const token of alle) {
        assert.ok(
            (FACET_TOKENS as readonly string[]).includes(token),
            `«${token}» står ikke i FACET_TOKENS`
        );
    }
    // Og motsatt: hvert token i vokabularet skal kunne utledes fra EN tagg,
    // ellers er det dødt. Alle ni er dekket av taggene over — sparkesykkel og
    // rulleskoyter via SKATEBOARD_IMPLIES, ikke via en egen tagg.
    assert.deepEqual([...new Set(alle)].sort(), [...FACET_TOKENS].sort());
});
