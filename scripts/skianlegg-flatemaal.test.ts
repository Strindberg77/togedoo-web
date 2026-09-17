// scripts/skianlegg-flatemaal.test.ts
//
// Spørringene bygges som ren funksjon av id-lista, og testes her. En feil i
// dem koster en spørring mot et speil som allerede har gitt 504 på dagtid —
// og to av feilene ville vært TAUSE: `way(id:);` er en syntaksfeil som
// avbryter alt, og en glemt gren utelater flater uten å melde fra.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { byggSporringer, lesIder } from './skianlegg-flatemaal';

test('tomme grener utelates — way(id:) er en syntaksfeil', () => {
    const q = byggSporringer(['way/1', 'way/2']);
    assert.match(q.flater, /way\(id:1,2\);/);
    assert.ok(!q.flater.includes('relation(id:)'), 'ingen tom relasjonsgren');
    assert.ok(!q.flater.includes('node(id:)'));
});

test('flatene kan vaere BÅDE ways og relasjoner', () => {
    const q = byggSporringer(['way/1', 'relation/9', 'way/2']);
    assert.match(q.flater, /way\(id:1,2\);/);
    assert.match(q.flater, /relation\(id:9\);/);
});

test('bw OG br — ellers mistes foreldrene til flatene som selv er relasjoner', () => {
    // `rel(bw)` finner bare relasjoner som har en WAY som medlem. Er flata
    // selv en relasjon, er det `rel(br)` som finner forelderen. Bare bw
    // ville utelatt dem i stillhet.
    const q = byggSporringer(['way/1', 'relation/9']);
    assert.match(q.relasjoner, /rel\(bw\.f\);/);
    assert.match(q.relasjoner, /rel\(br\.f\);/);
});

test('relasjonsspoerringen bruker out body, ikke out tags', () => {
    // Med `out tags` kommer relasjonen UTEN medlemsliste, og da kan ingen
    // flate knyttes til den. Samme felle som OUT_GEOM_TAGS i import-places:
    // spørringen svarer 200 og ser riktig ut, men svaret er ubrukelig.
    const q = byggSporringer(['way/1']);
    assert.match(q.relasjoner, /out body;$/);
    assert.ok(!/out tags;/.test(q.relasjoner));
});

test('bare boks og tagger paa flatene — ingen geometri', () => {
    // `out geom` på 115 flater ville vært den dyre spørringen. `out tags bb`
    // gir boksen uten en eneste node.
    const q = byggSporringer(['way/1']);
    assert.match(q.flater, /out tags bb;$/);
    assert.ok(!q.flater.includes('geom'));
});

test('loypespoerringen er avgrenset til flatene, ikke til et omraade', () => {
    // DET SOM GJØR DEN TRYGG PÅ DAGTID: around.f, ikke area eller bbox.
    const q = byggSporringer(['way/1']);
    assert.match(q.loyper, /way\(around\.f:100\)\["piste:type"~"downhill"\];/);
    assert.ok(!q.loyper.includes('area.a'), 'ingen områdeavgrensning');
    assert.ok(!/\(\d+\.\d+,/.test(q.loyper), 'ingen bboks');
});

test('alle tre spoerringer bygger paa SAMME sett', () => {
    const q = byggSporringer(['way/1', 'way/2']);
    for (const [navn, s] of Object.entries(q)) {
        assert.match(s, /\)->\.f;/, `${navn} mangler settet`);
        assert.match(s, /^\[out:json\]\[timeout:\d+\];/, `${navn} mangler hodet`);
    }
});

test('id-lista leses med kommentarer og tomme linjer, og ugyldig stopper', () => {
    assert.deepEqual(lesIder('# fra SQL\nway/1\n\n  relation/2  \n'), ['way/1', 'relation/2']);
    assert.throws(() => lesIder('way/1\n12345\n'), /Ugyldige id-er: 12345/);
    assert.throws(() => lesIder('way/1\nnode-7\n'), /Ugyldige/);
    // En tom liste ville gitt en spørring uten en eneste gren.
    assert.throws(() => lesIder('# bare kommentar\n'), /tom/);
});
