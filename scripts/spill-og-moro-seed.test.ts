// scripts/spill-og-moro-seed.test.ts
// Seed-radene for Spill og moro (scripts/seed-spill-og-moro.ts): reglene for
// beskrivelser, fasetter, punkter, claims og nedtakslista.
//
// Ingen nettverk, ingen database.
// Kjør: npx tsx --test scripts/spill-og-moro-seed.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEED, SOURCE, NEDTAK, beskrivelsesbrudd, toRow, ukjenteFlagg } from './seed-spill-og-moro';
import { SEED as VINTER } from './seed-vintertilbud';
import { FACET_TOKENS, FASETT_SOM_KATEGORI, SPILL_OG_MORO, categoryFacetsFor } from '../lib/facets';
import { OSM_CLAIMS, assertClaimsResolve } from '../lib/osm-claims';

const SPILL_FASETTER = ['bowling', 'lasertag', 'gokart', 'escaperom', 'spillehall', 'minigolf'];

test('kilden er egen og kuratert, ikke kuratert-vintertilbud', () => {
    assert.equal(SOURCE.slug, 'kuratert-spill-og-moro');
    assert.equal(SOURCE.kind, 'manual');
});

test('pulje 1: de 11 som besto, pluss de 5 fra ventelista', () => {
    assert.deepEqual(SEED.map((s) => s.externalId).sort(), [
        'dagali-opplevelser-gokart',
        'fangene-pa-fortet-bergen',
        'fangene-pa-fortet-oslo',
        'fangene-pa-fortet-stavanger',
        'harald-huysman-karting',
        'kragero-actionpark',
        'lucky-bowl-trondheim',
        'lucky-duck-oslo',
        'lykkeland-steinkjer',
        'megazone-bergen',
        'megazone-oslo',
        'nmk-halsa-gokart',
        'oslo-camping-minigolf',
        'underground-golf-drammen',
        'underground-golf-oslo',
        'underground-golf-stavanger',
    ]);
    assert.equal(new Set(SEED.map((s) => s.externalId)).size, SEED.length, 'externalId er ikke unik');
});

test('ingen externalId kolliderer med vinterseeden', () => {
    const vinter = new Set(VINTER.map((s) => s.externalId));
    for (const s of SEED) assert.ok(!vinter.has(s.externalId), s.externalId);
});

test('beskrivelsene følger reglene', () => {
    for (const s of SEED) {
        assert.deepEqual(beskrivelsesbrudd(s.description), [], `${s.externalId}: ${s.description}`);
        assert.ok(s.description.length > 20, `${s.externalId}: for kort`);
    }
});

test('vakten for beskrivelser fanger det den skal', () => {
    assert.deepEqual(beskrivelsesbrudd('Åpent til kl. 22 på lørdag.'), ['tall', 'dag eller måned', 'klokkeslett']);
    assert.deepEqual(beskrivelsesbrudd('Norges største bowlinghall.'), ['superlativ']);
    assert.deepEqual(beskrivelsesbrudd('Inngang koster 200 kr.'), ['tall', 'pris']);
    assert.deepEqual(beskrivelsesbrudd('Aldersgrense på kveldstid – sjekk med stedet.'), []);
});

test('ordet for aktiviteten står i beskrivelsen, så fritekstsøket treffer', () => {
    // q leser ikke fasetter. En gokartbane uten «gokart» i teksten ville bare
    // blitt funnet på navnet.
    const ord: Record<string, RegExp> = {
        gokart: /gokart/i,
        lasertag: /lasertag/i,
        minigolf: /minigolf/i,
        escaperom: /escape/i,
        bowling: /bowling/i,
    };
    for (const s of SEED) {
        for (const f of s.facets) {
            if (!ord[f]) continue;
            assert.match(s.description, ord[f], `${s.externalId}: «${f}» mangler i beskrivelsen`);
        }
    }
});

test('aldersgrense på kveldstid sies med «sjekk med stedet»', () => {
    const medGrense = [
        'lucky-bowl-trondheim',
        'oslo-camping-minigolf',
        'lucky-duck-oslo',
        'underground-golf-oslo',
        'underground-golf-drammen',
        'underground-golf-stavanger',
    ];
    for (const id of medGrense) {
        const s = SEED.find((x) => x.externalId === id)!;
        assert.match(s.description, /aldersgrense/i, id);
        assert.match(s.description, /sjekk med stedet/i, id);
    }
});

test('ordlyden Frederik har bestemt for aldersgrense og drop-in', () => {
    const tekst = (id: string) => SEED.find((x) => x.externalId === id)!.description;
    assert.equal(
        tekst('lucky-duck-oslo'),
        'Digital minigolf og dart med bar i Oslo sentrum. Stedet har aldersgrense det meste av uka. Barn er velkomne i egne familietider – sjekk med stedet før dere drar.'
    );
    for (const [id, sted] of [
        ['underground-golf-oslo', 'på Majorstuen'],
        ['underground-golf-drammen', 'i Drammen'],
        ['underground-golf-stavanger', 'i Stavanger'],
    ]) {
        assert.equal(
            tekst(id),
            `Innendørs crazy minigolf med restaurant ${sted}. Stedet har aldersgrense det meste av uka. Barn er velkomne på familiegolf – sjekk med stedet før dere drar.`
        );
    }
    assert.equal(
        tekst('nmk-halsa-gokart'),
        'Motorklubbens gokartbane i Halsa, med utleie på faste drop-in-dager – sjekk med klubben før dere drar.'
    );
});

test('hver rad er synlig under Spill og moro, enten som kategori eller via fasett', () => {
    for (const s of SEED) {
        for (const f of s.facets) assert.ok((FACET_TOKENS as readonly string[]).includes(f), `${s.externalId}: ${f}`);
        if (s.category === SPILL_OG_MORO) continue;
        // Lykkeland: Innendørs lekeland med lasertag og bowling.
        assert.ok(
            s.facets.some((f) => FASETT_SOM_KATEGORI[f] === SPILL_OG_MORO),
            `${s.externalId} er ${s.category} uten fasett som peker på Spill og moro`
        );
    }
    assert.deepEqual(categoryFacetsFor([SPILL_OG_MORO])?.sort(), [...SPILL_FASETTER].sort());
});

test('Lykkeland har hovedkategori Innendørs lekeland', () => {
    const s = SEED.find((x) => x.externalId === 'lykkeland-steinkjer')!;
    assert.equal(s.category, 'Innendørs lekeland');
    assert.deepEqual(s.facets.sort(), ['bowling', 'lasertag']);
});

test('Bergen: Megazone og Fangene på Fortet har samme punkt, som to rader', () => {
    const m = SEED.find((x) => x.externalId === 'megazone-bergen')!;
    const f = SEED.find((x) => x.externalId === 'fangene-pa-fortet-bergen')!;
    assert.deepEqual(m.point, f.point);
    assert.equal(m.address, f.address);
});

test('punktene ligger i Norge, og alle har kilde', () => {
    for (const s of SEED) {
        assert.ok(s.point.lat > 57.9 && s.point.lat < 71.3, `${s.externalId}: lat`);
        assert.ok(s.point.lng > 4.5 && s.point.lng < 31.2, `${s.externalId}: lng`);
        assert.ok(s.punktKilde.length > 5, s.externalId);
        assert.match(s.url, /^https:\/\//, s.externalId);
        assert.match(s.kontrollert, /19\.09\.2026/, s.externalId);
    }
});

test('toRow: published, kategori og fasetter fra raden, ingen pris eller åpningstid', () => {
    const r = toRow(SEED.find((x) => x.externalId === 'harald-huysman-karting')!, 'kilde-id');
    assert.equal(r.status, 'published');
    assert.equal(r.category, 'Spill og moro');
    assert.deepEqual(r.facets, ['gokart']);
    assert.equal(r.kind, 'place');
    assert.equal(r.price_text, null);
    assert.equal(r.opening_hours, null);
    assert.equal(r.target_audience, 'For alle');
});

test('claimene mot denne kilden peker på rader som finnes', () => {
    assert.doesNotThrow(() => assertClaimsResolve(SOURCE.slug, SEED.map((s) => s.externalId)));
    const mine = OSM_CLAIMS.filter((c) => c.source === SOURCE.slug);
    assert.ok(mine.length >= 14, `bare ${mine.length} claims`);
    // Forebyggende, bortsett fra de fire som er leisure=sports_centre:
    // Idrettshall-selektoren henter dem, og claims legges på det som hentes.
    const hentesAvIdrettshall = ['node/4736654480', 'node/7197772245', 'way/1030656428', 'node/12873546691'];
    for (const c of mine) {
        assert.equal(Boolean(c.expectNoHit), !hentesAvIdrettshall.includes(c.osmId), c.osmId);
    }
});

test("Rush og Leo's er claimet mot radene vi alt har, og claimene treffer", () => {
    const par: [string, string][] = [
        ['node/13716750101', 'rush-trampolinepark-bergen'],
        ['node/5549490417', 'rush-trampolinepark-trondheim'],
        ['node/12181644169', 'leos-lekeland-oslo'],
        ['node/5793918551', 'leos-lekeland-bergen'],
        ['node/4394667412', 'leos-lekeland-trondheim'],
    ];
    const vinter = new Set(VINTER.map((s) => s.externalId));
    for (const [osm, ext] of par) {
        const c = OSM_CLAIMS.find((x) => x.osmId === osm);
        assert.ok(c, `${osm} er ikke claimet`);
        assert.equal(c!.source, 'kuratert-vintertilbud');
        assert.equal(c!.externalId, ext);
        assert.ok(!c!.expectNoHit, `${osm} treffer i dag og skal ikke være forebyggende`);
        assert.ok(vinter.has(ext), `${ext} finnes ikke i vinterseeden`);
    }
    // Forus har ingen kuratert rad, og skal ikke claimes.
    assert.equal(OSM_CLAIMS.find((x) => x.osmId === 'node/2984187381'), undefined);
});

test('nedtakslista: hver rad har en kuratert erstatning som finnes', () => {
    const vinter = new Set(VINTER.map((s) => s.externalId));
    const spill = new Set(SEED.map((s) => s.externalId));
    assert.equal(new Set(NEDTAK.map((n) => n.id)).size, NEDTAK.length);
    for (const n of NEDTAK) {
        assert.match(n.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, n.id);
        const finnes =
            n.erstattesAv.source === SOURCE.slug ? spill.has(n.erstattesAv.externalId) : vinter.has(n.erstattesAv.externalId);
        assert.ok(finnes, `${n.tittel}: erstatningen ${n.erstattesAv.externalId} finnes ikke`);
        // OSM-objektet til en nedtaksrad skal være claimet, ellers lager
        // importen raden på nytt.
        assert.ok(OSM_CLAIMS.some((c) => c.osmId === n.osmId), `${n.osmId} er ikke claimet`);
    }
});

test('ukjente flagg stopper kjøringen', () => {
    assert.deepEqual(ukjenteFlagg(['--dry-run', '--only=a,b', '--nedtak']), []);
    assert.deepEqual(ukjenteFlagg(['--onli=a']), ['--onli=a']);
    assert.deepEqual(ukjenteFlagg(['--no-geocode']), ['--no-geocode']);
});
