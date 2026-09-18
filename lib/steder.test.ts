// lib/steder.test.ts
//
// Stedsforslagene: hvilke typer som slipper gjennom, rangeringen, og at en
// treg eller nede Kartverket aldri blir brukerens problem. Ingen nett —
// Kartverket-svarene under er forkortede kopier av ekte svar fra 18. sep. 2026.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_STEDER,
    STEDSTYPER,
    clearStedCache,
    hentSteder,
    normalizeName,
    rankSteder,
    sanitizeStedQuery,
} from './steder';

beforeEach(() => clearStedCache());

const OSLO = { lat: 59.9139, lng: 10.7522 };

function kv(
    stedsnummer: number,
    type: string,
    navn: { s: string; status?: string; skrivestatus?: string }[],
    kommune: [string, string],
    fylke: string,
    punkt: [number, number]
) {
    return {
        stedsnummer,
        stedstatus: 'aktiv',
        navneobjekttype: type,
        stedsnavn: navn.map((n) => ({
            skrivemåte: n.s,
            navnestatus: n.status ?? 'hovednavn',
            skrivemåtestatus: n.skrivestatus ?? 'godkjent og prioritert',
        })),
        kommuner: [{ kommunenavn: kommune[0], kommunenummer: kommune[1] }],
        fylker: [{ fylkesnavn: fylke }],
        representasjonspunkt: { nord: punkt[0], øst: punkt[1] },
    };
}

// ── Typefilteret ───────────────────────────────────────────────────────────

test('gårder, bruk, bekker og adresser slipper aldri gjennom', () => {
    const svar = [
        kv(1, 'Gard', [{ s: 'Nes' }], ['Nes', '3228'], 'Akershus', [60.1, 11.4]),
        kv(2, 'Bruk', [{ s: 'Nes' }], ['Nes', '3228'], 'Akershus', [60.1, 11.4]),
        kv(3, 'Adressenavn', [{ s: 'Nes' }], ['Nes', '3228'], 'Akershus', [60.1, 11.4]),
        kv(4, 'Bekk', [{ s: 'Nes' }], ['Nes', '3228'], 'Akershus', [60.1, 11.4]),
        kv(5, 'Tettsted', [{ s: 'Nes' }], ['Ringerike', '3305'], 'Buskerud', [60.2, 10.2]),
    ];
    const ut = rankSteder(svar, 'Nes', null);
    assert.deepEqual(ut.map((s) => s.id), ['5']);
});

test('tidligere kommuner (annen administrativ inndeling) tilbys ikke', () => {
    // «Ski kommune» ble slått sammen til Nordre Follo i 2020.
    const svar = [
        kv(10, 'Annen administrativ inndeling', [{ s: 'Ski kommune' }], ['Nordre Follo', '3207'], 'Akershus', [59.72, 10.84]),
        kv(11, 'By', [{ s: 'Ski' }], ['Nordre Follo', '3207'], 'Akershus', [59.72, 10.84]),
    ];
    assert.deepEqual(rankSteder(svar, 'Ski', null).map((s) => s.navn), ['Ski']);
});

test('typelista er den som sendes til Kartverket', () => {
    assert.deepEqual(STEDSTYPER.map((t) => t.kode), [
        'by',
        'tettsted',
        'kommune',
        'bydel',
        'administrativBydel',
        'bygdelagBygd',
        'tettsteddel',
        'tettbebyggelse',
        'grend',
    ]);
});

// ── Feltene ────────────────────────────────────────────────────────────────

test('Geilo: navn, norsk typeetikett, kommune, fylke og punkt', () => {
    const [geilo] = rankSteder(
        [kv(20, 'Tettsted', [{ s: 'Geilo' }], ['Hol', '3324'], 'Buskerud', [60.5345, 8.2068])],
        'Geilo',
        OSLO
    );
    assert.equal(geilo.navn, 'Geilo');
    assert.equal(geilo.type, 'tettsted');
    assert.equal(geilo.kommune, 'Hol');
    assert.equal(geilo.fylke, 'Buskerud');
    assert.equal(geilo.lat, 60.5345);
    assert.equal(geilo.lng, 8.2068);
    assert.equal(geilo.eksakt, true);
    assert.ok(geilo.distanceM! > 150_000 && geilo.distanceM! < 165_000);
});

test('kommunen heter «Voss», ikke «Voss herad», og etiketten sier kommune', () => {
    const [voss] = rankSteder(
        [kv(30, 'Kommune', [{ s: 'Voss herad' }], ['Voss', '4621'], 'Vestland', [60.63, 6.42])],
        'Voss',
        null
    );
    assert.equal(voss.navn, 'Voss');
    assert.equal(voss.type, 'kommune');
    assert.equal(voss.eksakt, true, '«Voss herad» er et eksakt treff på «Voss»');
});

test('tospråklige kommuner får samme navn som i resten av datahubben', () => {
    const [s] = rankSteder(
        [kv(40, 'Tettsted', [{ s: 'Skibotn' }], ['Storfjord - Omasvuotna - Omasvuono', '5538'], 'Troms - Romsa - Tromssa', [69.39, 20.27])],
        'Skibotn',
        null
    );
    assert.equal(s.kommune, 'Storfjord');
    assert.equal(s.fylke, 'Troms');
});

test('et historisk navn matches ikke og vises ikke', () => {
    // Nesbyen kommune het «Nes kommune» før 2020. Et søk på «Nes» skal ikke
    // gi Nesbyen som eksakt treff.
    const svar = [
        kv(50, 'Kommune', [
            { s: 'Nes kommune', status: 'historisk', skrivestatus: 'historisk og prioritert' },
            { s: 'Nesbyen kommune', skrivestatus: 'vedtatt' },
        ], ['Nesbyen', '3322'], 'Buskerud', [60.57, 9.1]),
        kv(51, 'Kommune', [{ s: 'Nes kommune' }], ['Nes', '3228'], 'Akershus', [60.12, 11.47]),
    ];
    const ut = rankSteder(svar, 'Nes', null);
    assert.equal(ut[0].id, '51');
    assert.equal(ut[0].eksakt, true);
    const nesbyen = ut.find((s) => s.id === '50')!;
    assert.equal(nesbyen.navn, 'Nesbyen');
    assert.equal(nesbyen.eksakt, false);
});

// ── Rangeringen ────────────────────────────────────────────────────────────

test('eksakt navn foran delvis, selv når det delvise er en by', () => {
    // Kartverket selv setter Sandefjord (by) før tettstedet Sand.
    const svar = [
        kv(60, 'By', [{ s: 'Sandefjord' }], ['Sandefjord', '3907'], 'Vestfold', [59.13, 10.22]),
        kv(61, 'Tettsted', [{ s: 'Sand' }], ['Suldal', '1134'], 'Rogaland', [59.48, 6.25]),
    ];
    assert.deepEqual(rankSteder(svar, 'Sand', null).map((s) => s.navn), ['Sand', 'Sandefjord']);
});

test('innenfor samme treff: by, så tettsted, så kommune, så bygd', () => {
    const svar = [
        kv(70, 'Bygdelag (bygd)', [{ s: 'Nes' }], ['Ørland', '5057'], 'Trøndelag', [63.77, 9.59]),
        kv(71, 'Kommune', [{ s: 'Nes kommune' }], ['Nes', '3228'], 'Akershus', [60.12, 11.47]),
        kv(72, 'Tettsted', [{ s: 'Nes' }], ['Ringerike', '3305'], 'Buskerud', [60.56, 9.99]),
    ];
    assert.deepEqual(rankSteder(svar, 'Nes', null).map((s) => s.type), ['tettsted', 'kommune', 'bygd']);
});

test('samme navn i samme kommune er ETT forslag — det best rangerte', () => {
    // Registeret fører Ski både som by og som bygd, og Hemsedal både som
    // kommune og bygd. To like linjer i en liste på fem ser ut som en feil.
    const ski = [
        kv(73, 'Bygdelag (bygd)', [{ s: 'Ski' }], ['Nordre Follo', '3207'], 'Akershus', [59.7195, 10.8314]),
        kv(74, 'By', [{ s: 'Ski' }], ['Nordre Follo', '3207'], 'Akershus', [59.7195, 10.8358]),
    ];
    const hemsedal = [
        kv(75, 'Bygdelag (bygd)', [{ s: 'Hemsedal' }], ['Hemsedal', '3326'], 'Buskerud', [60.85, 8.62]),
        kv(76, 'Kommune', [{ s: 'Hemsedal kommune' }], ['Hemsedal', '3326'], 'Buskerud', [60.86, 8.57]),
    ];
    assert.deepEqual(
        rankSteder(ski, 'Ski', null).map((s) => `${s.navn} ${s.type}`),
        ['Ski by']
    );
    assert.deepEqual(
        rankSteder(hemsedal, 'Hemsedal', null).map((s) => `${s.navn} ${s.type}`),
        ['Hemsedal kommune']
    );
});

test('samme navn i ULIKE kommuner er ulike steder', () => {
    const svar = [
        kv(77, 'Tettsted', [{ s: 'Sand' }], ['Suldal', '1134'], 'Rogaland', [59.48, 6.25]),
        kv(78, 'Tettsted', [{ s: 'Sand' }], ['Ullensaker', '3209'], 'Akershus', [60.15, 11.13]),
    ];
    assert.equal(rankSteder(svar, 'Sand', null).length, 2);
});

test('like gode treff av samme type: nærmest brukeren først', () => {
    // Tre tettsteder som alle heter Sand.
    const svar = [
        kv(80, 'Tettsted', [{ s: 'Sand' }], ['Suldal', '1134'], 'Rogaland', [59.48, 6.25]),
        kv(81, 'Tettsted', [{ s: 'Sand' }], ['Nord-Odal', '3414'], 'Innlandet', [60.39, 11.56]),
        kv(82, 'Tettsted', [{ s: 'Sand' }], ['Ullensaker', '3209'], 'Akershus', [60.18, 11.12]),
    ];
    assert.deepEqual(
        rankSteder(svar, 'Sand', OSLO).map((s) => s.kommune),
        ['Ullensaker', 'Nord-Odal', 'Suldal']
    );
});

test('et eksakt undernavn slår et delvis hovednavn', () => {
    // Tingnes heter også «Nes».
    const svar = [
        kv(90, 'Tettsted', [{ s: 'Nesna' }], ['Nesna', '1828'], 'Nordland', [66.2, 13.0]),
        kv(91, 'Tettsted', [{ s: 'Tingnes' }, { s: 'Nes', status: 'undernavn' }], ['Ringsaker', '3411'], 'Innlandet', [60.76, 10.94]),
    ];
    assert.deepEqual(rankSteder(svar, 'Nes', null).map((s) => s.navn), ['Tingnes', 'Nesna']);
});

test('aldri mer enn fem, og ingen dubletter når begge kallene gir samme sted', () => {
    const svar = Array.from({ length: 9 }, (_, i) =>
        kv(100 + i, 'Tettsted', [{ s: `Sand${i}` }], ['Suldal', '1134'], 'Rogaland', [59.4, 6.2])
    );
    const medDublett = [...svar, svar[0]];
    const ut = rankSteder(medDublett, 'Sand', null);
    assert.equal(ut.length, MAX_STEDER);
    assert.equal(new Set(ut.map((s) => s.id)).size, ut.length);
});

// ── Søketekst ──────────────────────────────────────────────────────────────

test('under tre tegn: null, altså ingen kall', () => {
    assert.equal(sanitizeStedQuery('Sk'), null);
    assert.equal(sanitizeStedQuery('  a '), null);
    assert.equal(sanitizeStedQuery(null), null);
    assert.equal(sanitizeStedQuery('Ski'), 'Ski');
});

test('Kartverkets jokertegn fjernes fra brukerens tekst', () => {
    assert.equal(sanitizeStedQuery('Ge*ilo'), 'Geilo');
    assert.equal(sanitizeStedQuery('***'), null);
});

test('punktum og apostrof beholdes — «St. Hanshaugen»', () => {
    assert.equal(sanitizeStedQuery('St. Hanshaugen'), 'St. Hanshaugen');
});

test('normalisering: «kommune» og «herad» på slutten teller ikke', () => {
    assert.equal(normalizeName('Voss herad'), 'voss');
    assert.equal(normalizeName('Trysil  kommune'), 'trysil');
    assert.equal(normalizeName('Kommunehuset'), 'kommunehuset');
});

// ── Robusthet ──────────────────────────────────────────────────────────────

function okSvar(navn: unknown[]) {
    return new Response(JSON.stringify({ navn }), { status: 200 });
}

test('Kartverket nede: tom liste, ok=false — aldri et kast', async () => {
    const fetcher = async () => {
        throw new Error('ECONNREFUSED');
    };
    const r = await hentSteder('Geilo', { fetcher });
    assert.deepEqual(r.steder, []);
    assert.equal(r.ok, false);
});

test('Kartverket tregt: timeouten slår inn, og svaret er tomt', async () => {
    const fetcher = (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('timeout')));
        });
    const start = Date.now();
    const r = await hentSteder('Geilo', { fetcher, timeoutMs: 50 });
    assert.ok(Date.now() - start < 1000, 'venter ikke på et tregt svar');
    assert.equal(r.ok, false);
    assert.deepEqual(r.steder, []);
});

test('HTTP 500 fra Kartverket teller som nede', async () => {
    const r = await hentSteder('Geilo', {
        fetcher: async () => new Response('feil', { status: 500 }),
    });
    assert.equal(r.ok, false);
});

test('to kall: eksakt og prefiks, begge med typefilteret', async () => {
    const urls: string[] = [];
    await hentSteder('Geilo', {
        fetcher: async (url) => {
            urls.push(url);
            return okSvar([]);
        },
    });
    const sok = urls.map((u) => new URL(u).searchParams.get('sok')).sort();
    assert.deepEqual(sok, ['Geilo', 'Geilo*']);
    for (const u of urls) {
        const typer = new URL(u).searchParams.getAll('navneobjekttype');
        assert.equal(typer.length, STEDSTYPER.length);
        assert.ok(u.startsWith('https://api.kartverket.no/stedsnavn/v1/sted?'));
    }
});

test('vellykket svar caches på søketeksten; nytt kall først etter et døgn', async () => {
    let kall = 0;
    const fetcher = async () => {
        kall++;
        return okSvar([]);
    };
    await hentSteder('Geilo', { fetcher, now: 0 });
    const r2 = await hentSteder('geilo', { fetcher, now: 60_000 });
    assert.equal(kall, 2, 'to kall for første søk (eksakt + prefiks), ingen for andre');
    assert.equal(r2.fraCache, true);
    await hentSteder('Geilo', { fetcher, now: 25 * 60 * 60 * 1000 });
    assert.equal(kall, 4);
});

test('et halvt svar vises, men caches ikke', async () => {
    let kall = 0;
    const fetcher = async (url: string) => {
        kall++;
        if (new URL(url).searchParams.get('sok')!.endsWith('*')) throw new Error('timeout');
        return okSvar([kv(20, 'Tettsted', [{ s: 'Geilo' }], ['Hol', '3324'], 'Buskerud', [60.53, 8.2])]);
    };
    const r1 = await hentSteder('Geilo', { fetcher, now: 0 });
    assert.equal(r1.ok, false);
    assert.equal(r1.steder.length, 1, 'det eksakte treffet vises likevel');
    await hentSteder('Geilo', { fetcher, now: 1000 });
    assert.equal(kall, 4, 'prøver på nytt i stedet for å låse et halvt svar i et døgn');
});
