// scripts/skianlegg-flatemaal.test.ts
//
// Spørringene og bitdelingen bygges som rene funksjoner, og testes her. En
// feil i dem koster et kall mot et speil som allerede har gitt 504 på dagtid
// — og flere av feilene ville vært TAUSE: `way(id:);` avbryter alt,
// `out tags` på en relasjon gir 200 uten medlemsliste, og en `around` i
// stedet for en boks mister nettopp de flatene som har flest løyper.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BIT_STORRELSE,
    bboxFilter,
    deleIBiter,
    lesIder,
    qBokser,
    qLoyper,
    qModre,
    qRelasjoner,
    settet,
} from './skianlegg-flatemaal';

const boks = (minlat: number, minlon: number, maxlat: number, maxlon: number) => ({
    minlat,
    minlon,
    maxlat,
    maxlon,
});

// ---------------------------------------------------------------------------
// BITENE — 115 i ett kall ga 504 på dagtid
// ---------------------------------------------------------------------------

test('115 flater deles i biter paa maks 25', () => {
    assert.equal(BIT_STORRELSE, 25);
    const biter = deleIBiter(Array.from({ length: 115 }, (_, i) => i), 25);
    assert.deepEqual(biter.map((b) => b.length), [25, 25, 25, 25, 15]);
    assert.equal(biter.flat().length, 115, 'ingen mistes i delingen');
});

test('bitdelingen taaler tomt og akkurat-passe', () => {
    assert.deepEqual(deleIBiter([], 25), []);
    assert.deepEqual(deleIBiter([1, 2], 25), [[1, 2]]);
    assert.equal(deleIBiter(Array.from({ length: 50 }, (_, i) => i), 25).length, 2);
});

// ---------------------------------------------------------------------------
// SPØRRINGENE
// ---------------------------------------------------------------------------

test('tomme grener utelates — way(id:) er en syntaksfeil', () => {
    const s = settet(['way/1', 'way/2']);
    assert.match(s, /way\(id:1,2\);/);
    assert.ok(!s.includes('relation(id:)'), 'ingen tom relasjonsgren');
    assert.ok(!s.includes('node(id:)'));
});

test('flatene kan vaere BÅDE ways og relasjoner', () => {
    const s = settet(['way/1', 'relation/9', 'way/2']);
    assert.match(s, /way\(id:1,2\);/);
    assert.match(s, /relation\(id:9\);/);
});

test('bw OG br — ellers mistes foreldrene til flatene som selv er relasjoner', () => {
    const q = qRelasjoner(['way/1', 'relation/9']);
    assert.match(q, /rel\(bw\.f\);/);
    assert.match(q, /rel\(br\.f\);/);
});

test('relasjonsspoerringen bruker out body, ikke out tags', () => {
    // Med `out tags` kommer relasjonen UTEN medlemsliste, svaret er 200 og ser
    // riktig ut, og ingen flate kan knyttes til den. Samme felle som
    // OUT_GEOM_TAGS i import-places.
    const q = qRelasjoner(['way/1']);
    assert.match(q, /out body;$/);
    assert.ok(!/out tags;/.test(q));
});

test('bare boks og tagger paa flatene — ingen geometri', () => {
    const q = qBokser(['way/1']);
    assert.match(q, /out tags bb;$/);
    assert.ok(!q.includes('geom'));
});

test('loypespoerringen bruker BOKS, ikke around', () => {
    // DET AVGJØRENDE: `around.f:100` måler avstand til flatas RING. En nedfart
    // midt inne i en stor flate kan ligge mer enn 100 m fra enhver kant, og
    // ville ikke blitt hentet — altså ville nettopp de flatene med flest
    // løyper mistet flest. Boksen har ikke det hullet.
    const q = qLoyper([boks(61.28, 12.26, 61.29, 12.27)]);
    assert.ok(!q.includes('around'), 'ingen around');
    assert.match(q, /way\["piste:type"~"downhill"\]\(61\.\d+,12\.\d+,61\.\d+,12\.\d+\);/);
    assert.match(q, /out geom;$/);
});

test('loypeboksen er PADDET — bevis inntil flata skal med', () => {
    const b = boks(61.28, 12.26, 61.29, 12.27);
    const q = qLoyper([b]);
    const tall = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(q)!;
    assert.ok(Number(tall[1]) < b.minlat, 'sørkanten er flyttet ut');
    assert.ok(Number(tall[3]) > b.maxlat, 'nordkanten er flyttet ut');
});

test('én boks per flate, ikke én samleboks', () => {
    // En samleboks over 25 spredte flater ville hentet alle løyper i hele
    // dalen mellom dem.
    const q = qLoyper([boks(61.28, 12.26, 61.29, 12.27), boks(60.5, 8.1, 60.6, 8.2)]);
    assert.equal(q.split('piste:type').length - 1, 2);
});

test('moerspoerringen gjenbruker SKI_AREA_SELECTOR og krever navn', () => {
    // Endres selektoren i importen, endres denne. Ellers ville «navngitt
    // Skianlegg-polygon» betydd to ulike ting to steder.
    const q = qModre(boks(60.5, 8.1, 61.3, 12.3));
    assert.match(q, /\["landuse"="winter_sports"\]/);
    assert.match(q, /\["landuse"="recreation_ground"\]\["piste:type"\]/);
    assert.match(q, /\["leisure"="sports_centre"\]\["sport"~"ski",i\]/);
    assert.ok(!q.includes('(area.a)'), 'ingen rest av den kanoniske formen');
    // ["name"] på HVER linje, ikke bare den første.
    assert.equal(q.split('["name"]').length - 1, 6, 'alle seks mønstrene krever navn');
    assert.match(q, /out geom;$/, 'mødrene trenger ringen — punkt-i-ring');
});

test('moerboksen er unionen med MARGIN, ikke flatas egen boks', () => {
    // Et moranlegg som omslutter en delflate kan ha kanten kilometer unna.
    const union = boks(60.5, 8.1, 61.3, 12.3);
    const q = qModre(union);
    const tall = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(q)!;
    assert.ok(Number(tall[1]) < union.minlat - 0.03, '5 km margin i sør');
    assert.ok(Number(tall[3]) > union.maxlat + 0.03, '5 km margin i nord');
});

test('bboxFilter runder til fem desimaler — ~1 m', () => {
    assert.equal(bboxFilter(boks(61.123456789, 12.2, 61.3, 12.4)), '(61.12346,12.20000,61.30000,12.40000)');
});

// ---------------------------------------------------------------------------
// INNDATA
// ---------------------------------------------------------------------------

test('id-lista leser kommune, kommentarer og tomme linjer', () => {
    assert.deepEqual(lesIder('# fra SQL\nway/1,Trysil\n\n  relation/2  \nway/3, Hol \n'), [
        { id: 'way/1', kommune: 'Trysil' },
        { id: 'relation/2', kommune: null },
        { id: 'way/3', kommune: 'Hol' },
    ]);
});

test('ugyldige og dupliserte id-er stopper foer noe hentes', () => {
    assert.throws(() => lesIder('way/1\n12345\n'), /Ugyldige id-er: 12345/);
    assert.throws(() => lesIder('way/1\nnode-7\n'), /Ugyldige/);
    assert.throws(() => lesIder('# bare kommentar\n'), /tom/);
    // DUPLIKATER: samme flate to ganger ville gitt to rader i nedtakslista og
    // et fingeravtrykk som ikke stemmer med antallet.
    assert.throws(() => lesIder('way/1\nway/2\nway/1\n'), /duplikater: 3 rader, 2 unike/);
});
