// lib/radius.test.ts
//
// VAKTENE rundt søkeradiusen. To ting testes, og begge var ekte feil:
//
//   1. Taket var 100 km og lå som en naken Math.min i route.ts. Oppdal ligger
//      ~103 km fra Trondheim (målt mot Kartverkets kommunegrenser), så
//      anlegget var usynlig uansett hva appen ba om.
//   2. Math.min har ingen NEDRE grense, så `?radius=-1` gikk rett gjennom til
//      st_dwithin og ga null rader uten en advarsel.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    parseRadius,
    RADIUS_DEFAULT_M,
    RADIUS_MAX_M,
    RADIUS_MIN_M,
} from './radius';

test('manglende eller ugyldig radius gir standarden, og teller ikke som avkortet', () => {
    // «Ikke et tall» er ikke det samme som «fikk mindre enn den ba om».
    for (const raw of [null, undefined, '', '   ', 'abc', 'NaN']) {
        assert.deepEqual(parseRadius(raw), { meters: RADIUS_DEFAULT_M, clamped: false });
    }
});

test('en gyldig radius under taket slipper gjennom uendret', () => {
    for (const m of [RADIUS_MIN_M, 5_000, 10_000, 50_000, 100_000, 200_000, RADIUS_MAX_M]) {
        assert.deepEqual(parseRadius(String(m)), { meters: m, clamped: false });
    }
});

test('taket er hevet over Oppdal — 103 km fra Trondheim', () => {
    // Det gamle taket var 100 000. Denne testen er hele grunnen til
    // endringen, og den skal feile hvis noen setter det tilbake.
    assert.ok(RADIUS_MAX_M > 103_000, `taket er ${RADIUS_MAX_M} m`);
    assert.deepEqual(parseRadius('120000'), { meters: 120_000, clamped: false });
    // Og over det appen kan tilby, slik at appens chip-liste er det ENESTE
    // produktvalget. Er de to like, feiler neste heving i stillhet.
    assert.ok(RADIUS_MAX_M > 200_000, 'serverens tak må ligge over appens største valg');
});

test('over taket avkortes, og avkortingen RAPPORTERES', () => {
    // Uten `clamped` viser appen «Steder innen 900 km» over en liste som
    // dekker 500. Feltet er det som lar klienten oppdage det.
    assert.deepEqual(parseRadius('900000'), { meters: RADIUS_MAX_M, clamped: true });
    assert.deepEqual(parseRadius('1e12'), { meters: RADIUS_MAX_M, clamped: true });
});

test('negativ og null radius avkortes OPP, ikke gjennom', () => {
    // FEILEN SOM BLE RETTET. `Math.min(-1, 100000)` er -1, og st_dwithin med
    // negativ radius gir null rader — som ikke er til å skille fra «det
    // finnes ingenting her».
    assert.deepEqual(parseRadius('-1'), { meters: RADIUS_MIN_M, clamped: true });
    assert.deepEqual(parseRadius('-500000'), { meters: RADIUS_MIN_M, clamped: true });
    // `0` er også fanget, men merk at den gamle koden traff standarden her
    // ved et uhell: `Number('0') || 10000` er 10000, fordi 0 er falsy.
    assert.deepEqual(parseRadius('0'), { meters: RADIUS_MIN_M, clamped: true });
});

test('desimaler rundes til hele meter', () => {
    assert.equal(parseRadius('12345.6').meters, 12_346);
});

// ---------------------------------------------------------------------------
// MONOTONITETEN — hvorfor en større radius aldri gjør utvalget verre
// ---------------------------------------------------------------------------

test('en større radius gir et SUPERSETT som starter likt (modell av RPC-en)', () => {
    // DETTE ER EN MODELL av `activities_nearby` (migrasjon 0015), ikke en
    // test av SQL-en. Den koder én egenskap ved spørringen:
    //
    //   where st_dwithin(..., R) order by <avstand> limit N
    //
    // Sorteringen skjer FØR kappingen. Utvidet R kan derfor bare legge til
    // rader som ligger LENGER unna enn alle som allerede var med — de sorterer
    // strengt etter dem, og de N første er uendret så lenge det fantes N
    // innenfor den lille radien.
    //
    // Konsekvensen, som er svaret på «blir limit-problemet verre med større
    // radius»: nei. Det blir ikke bedre heller. Utvalget ved 200 km er
    // identisk med utvalget ved 50 km i enhver by der 100 rader ligger innen
    // 50 km.
    const rader = Array.from({ length: 500 }, (_, i) => ({ id: i, meter: i * 400 }));
    const rpc = (radius: number, limit: number) =>
        rader
            .filter((r) => r.meter <= radius)
            .sort((a, b) => a.meter - b.meter)
            .slice(0, limit)
            .map((r) => r.id);

    const liten = rpc(50_000, 100);
    const stor = rpc(200_000, 100);
    assert.deepEqual(stor, liten, 'tette data: identisk utvalg, radiusen er uten virkning');

    // Og der det er glissent legges det bare til bakerst.
    const glissent = [0, 1_000, 60_000, 150_000].map((m, i) => ({ id: i, meter: m }));
    const rpc2 = (radius: number) =>
        glissent.filter((r) => r.meter <= radius).map((r) => r.id);
    assert.deepEqual(rpc2(50_000), [0, 1]);
    assert.deepEqual(rpc2(200_000), [0, 1, 2, 3]);
    assert.deepEqual(rpc2(200_000).slice(0, 2), rpc2(50_000), 'prefikset er uendret');
});
