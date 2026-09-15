// lib/dedup.test.ts
// REGELEN for dubletter — den ene funksjonen importen og oppryddingen deler.
// Vakten som låser at de to KALLERNE faktisk er enige, står i
// scripts/node-flate-dedup.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEDUP_RADIUS_M,
    dedupPairs,
    nedtakingsSql,
    osmType,
    uloste,
    type DedupKandidat,
} from './dedup';

const LAT_M = 111_320;
const BASE_LAT = 59.9556;
const BASE_LNG = 10.7684;
/** Kandidat `meter` nord for basispunktet. */
const k = (externalId: string, meter = 0, navn: string | null = null): DedupKandidat => ({
    externalId,
    lat: BASE_LAT + meter / LAT_M,
    lng: BASE_LNG,
    navn,
});
const tapere = (...kandidater: DedupKandidat[]) => [...dedupPairs(kandidater).tapere].sort();

test('osmType kjenner de tre typene og avviser alt annet', () => {
    assert.equal(osmType('node/1'), 'node');
    assert.equal(osmType('way/123'), 'way');
    assert.equal(osmType('relation/9'), 'relation');
    // Kuraterte seed-rader. De eies av lib/osm-claims.ts og skal aldri pares.
    assert.equal(osmType('tryvann'), null);
    assert.equal(osmType('way/abc'), null);
    assert.equal(osmType('way/'), null);
});

// ---------------------------------------------------------------------------
// NODE MOT FLATE
// ---------------------------------------------------------------------------

test('node mot way: flaten vinner', () => {
    assert.deepEqual(tapere(k('node/1', 4), k('way/2')), ['node/1']);
});

test('node mot relation: flaten vinner', () => {
    assert.deepEqual(tapere(k('node/1', 4), k('relation/2')), ['node/1']);
});

test('flaten vinner selv om noden har LAVERE id', () => {
    // Id-en avgjør bare mellom to av samme type. Areal slår id.
    assert.deepEqual(tapere(k('node/1', 4), k('way/99999')), ['node/1']);
});

// ---------------------------------------------------------------------------
// NODE MOT NODE — stabilitetsvalget
// ---------------------------------------------------------------------------

test('node mot node: LAVESTE osm-id vinner', () => {
    // Museums-paret i basen: node/2785549850 (~2014) mot node/14091419612
    // (~2025), 0 m fra hverandre.
    assert.deepEqual(
        tapere(k('node/14091419612', 0), k('node/2785549850', 0)),
        ['node/14091419612']
    );
});

test('id sammenlignes som TALL, ikke som streng', () => {
    // '9' > '10' som streng. Feilen ville gitt feil vinner for hvert par der
    // id-ene har ulikt antall siffer — altså nesten alle.
    assert.deepEqual(tapere(k('node/9', 0), k('node/10', 0)), ['node/10']);
});

test('to flater rører ikke hverandre — heller ikke på 0 m', () => {
    // Konsentriske flater er et ekte OSM-mønster (en bane inne i et
    // idrettsområde). Uten geometri kan de ikke skilles fra en dublett.
    const ut = dedupPairs([k('way/1', 0), k('way/2', 0)]);
    assert.deepEqual([...ut.tapere], []);
    assert.equal(ut.par.length, 1);
    assert.equal(ut.par[0].utfall, 'to-flater');
});

test('way mot relation er også to flater', () => {
    const ut = dedupPairs([k('way/1', 0), k('relation/2', 0)]);
    assert.deepEqual([...ut.tapere], []);
    assert.equal(ut.par[0].utfall, 'to-flater');
});

// ---------------------------------------------------------------------------
// NAVNEREGLENE
// ---------------------------------------------------------------------------

test('bare taperen har navn: begge beholdes', () => {
    const ut = dedupPairs([k('node/1', 4, 'Sagenehagen lekeplass'), k('way/2')]);
    assert.deepEqual([...ut.tapere], []);
    assert.equal(ut.par[0].utfall, 'navn-bare-pa-taper');
});

test('begge har navn, ULIKT: begge beholdes', () => {
    const ut = dedupPairs([k('node/1', 4, 'Sandkassen'), k('way/2', 0, 'Torshovparken')]);
    assert.deepEqual([...ut.tapere], []);
    assert.equal(ut.par[0].utfall, 'navn-uenighet');
});

test('begge har navn, LIKT (ulik skrivemåte): taperen fjernes', () => {
    const ut = dedupPairs([
        k('node/1', 4, 'Sagenehagen lekeplass'),
        k('way/2', 0, '  SAGENEHAGEN Lekeplass '),
    ]);
    assert.deepEqual([...ut.tapere], ['node/1']);
});

test('bare VINNEREN har navn: taperen fjernes', () => {
    assert.deepEqual(tapere(k('node/1', 4), k('way/2', 0, 'Sagenehagen')), ['node/1']);
});

test('navnereglene gjelder også node mot node', () => {
    const ut = dedupPairs([k('node/9', 0, 'Sandkassen'), k('node/1', 0)]);
    assert.deepEqual([...ut.tapere], [], 'node/9 taper på id, men bærer et navn node/1 mangler');
    assert.equal(ut.par[0].utfall, 'navn-bare-pa-taper');
});

// ---------------------------------------------------------------------------
// TERSKELEN
// ---------------------------------------------------------------------------

test('nøyaktig på radiusen er innenfor, litt over er utenfor', () => {
    assert.equal(DEDUP_RADIUS_M, 10, 'terskelen er MÅLT — 263 par i basen');
    assert.deepEqual(tapere(k('node/1', DEDUP_RADIUS_M), k('way/2')), ['node/1']);
    assert.deepEqual(tapere(k('node/1', DEDUP_RADIUS_M + 0.5), k('way/2')), []);
});

// ---------------------------------------------------------------------------
// DETERMINISME
// ---------------------------------------------------------------------------

test('utfallet er uavhengig av rekkefølgen kandidatene kommer i', () => {
    // external_id er upsert-nøkkelen. Bytter vinneren mellom to kjøringer,
    // får brukeren én ny rad OG beholder den gamle — ingenting sletter.
    //
    // Scenarioet er med vilje ubehagelig: en kjede node–node–node der
    // ytterpunktene ligger lenger fra hverandre enn radiusen, et par på
    // nøyaktig terskelen, to flater på 0 m, og et navn som blokkerer.
    const scenario = [
        k('node/50', 0),
        k('node/10', 6),
        k('node/30', 12),
        k('way/7', 0),
        k('way/8', 0),
        k('node/99', 40, 'Sagenehagen lekeplass'),
        k('way/9', 40 + DEDUP_RADIUS_M),
        k('node/2', 200),
    ];
    const fasit = dedupPairs(scenario);
    const fasitTapere = [...fasit.tapere].sort();
    const fasitPar = JSON.stringify(fasit.par);

    let frø = 987654321;
    const neste = () => (frø = (frø * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let runde = 0; runde < 300; runde++) {
        const stokket = [...scenario];
        for (let i = stokket.length - 1; i > 0; i--) {
            const j = Math.floor(neste() * (i + 1));
            [stokket[i], stokket[j]] = [stokket[j], stokket[i]];
        }
        const ut = dedupPairs(stokket);
        assert.deepEqual([...ut.tapere].sort(), fasitTapere, `runde ${runde}`);
        assert.equal(JSON.stringify(ut.par), fasitPar, `runde ${runde}: rapporten`);
    }
});

test('«taper mot» er asyklisk — ingen to objekter kan ta hverandre', () => {
    // Det er egenskapen determinismen hviler på: flater taper aldri mot
    // noder, og noder taper bare oppover i id. Altså én global ordning.
    const alle = [k('node/5', 0), k('node/3', 0), k('way/1', 0), k('relation/2', 0)];
    const { par, tapere: t } = dedupPairs(alle);
    for (const p of par) {
        assert.ok(
            !(t.has(p.vinner) && par.some((q) => q.vinner === p.taper && q.taper === p.vinner)),
            `${p.vinner} og ${p.taper} tar hverandre`
        );
    }
    // Begge nodene taper mot en flate; flatene taper ikke mot noe.
    assert.deepEqual([...t].sort(), ['node/3', 'node/5']);
});

test('en kjede tas ut selv om ytterpunktene ikke ble sammenlignet', () => {
    // Dokumentert følge av «tas ut hvis og bare hvis den taper minst ett
    // par». node/30 og node/50 ligger 12 m fra hverandre, altså utenfor
    // radiusen — men begge taper mot node/10 i midten.
    const ut = dedupPairs([k('node/50', 0), k('node/10', 6), k('node/30', 12)]);
    assert.deepEqual([...ut.tapere].sort(), ['node/30', 'node/50']);
});

// ---------------------------------------------------------------------------
// RESTBEHOLDNINGEN OG SQL-EN
// ---------------------------------------------------------------------------

test('uloste teller hver årsak for seg', () => {
    const { par } = dedupPairs([
        k('way/1', 0),
        k('way/2', 0),
        k('node/3', 300, 'Sandkassen'),
        k('way/4', 300),
        k('node/5', 600, 'A'),
        k('way/6', 600, 'B'),
    ]);
    assert.deepEqual(uloste(par), {
        'to-flater': 1,
        'navn-bare-pa-taper': 1,
        'navn-uenighet': 1,
    });
});

test('SQL-en bruker overgangen unpublish, og bare den', () => {
    const ut = nedtakingsSql(['node/1347155489', 'node/1095094457']);
    assert.match(ut, /node\/1347155489/);
    assert.match(ut, /set status = 'rejected', locked = true/);
    assert.match(ut, /and a\.status = 'published'/);
    assert.match(ut, /s\.slug = 'osm-steder'/);
    assert.ok(!ut.includes('delete'), 'ingen sletting');
});

test('tom liste gir ingen SQL', () => {
    assert.equal(nedtakingsSql([]), '');
});

test('en id med uventet form stopper SQL-en, den pyntes ikke på', () => {
    const ut = nedtakingsSql(["node/1'; drop table activities; --"]);
    assert.match(ut, /uventet form/);
    assert.ok(!ut.includes('update public.activities'));
});
