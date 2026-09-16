// scripts/nasjonal.test.ts
// FORBEREDELSENE TIL EN NASJONAL KJØRING: kommune fra grensefil, stoppvilkår,
// godkjenningsport.
//
// Ingen nettverk, ingen database. Kjør:
//   node --import tsx --test scripts/nasjonal.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    batchFingerprint,
    duplicateCandidates,
    formatApproval,
    type GodkjenningsInput,
} from '../lib/import-approval';
import { chunkForCity, nationalCoverage, type ImportChunk } from '../lib/import-chunks';
import { ImportStop } from '../lib/import-guards';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_QUERY_PAUSE_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

const nasjonalChunk: ImportChunk = {
    id: 'norge',
    label: 'Norge',
    cityAnchor: null,
    overpassArea: '',
    overpassScopes: ['(57.5,4.0,71.5,31.5)'],
    overpassTimeout: 300,
};

// ---------------------------------------------------------------------------
// KOMMUNE PER RAD
// ---------------------------------------------------------------------------

test('en chunk uten cityAnchor gir hver rad sin egen kommune', async () => {
    const { buildRows, PLACE_CATEGORIES } = await load();
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const { municipalityIndex } = await import('./municipality-index');
    const rows = await buildRows(
        null,
        [
            { type: 'way', id: 1, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } },
            { type: 'way', id: 2, tags: { leisure: 'park', name: 'Nygaardsparken' }, center: { lat: 60.386, lon: 5.324 } },
        ],
        50,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.deepEqual(
        rows.map((r) => [r.title, r.municipality]),
        [
            ['Sofienbergparken', 'Oslo'],
            ['Nygaardsparken', 'Bergen'],
        ]
    );
});

test('rader utenfor Norge utelates, de velter ikke chunken', async () => {
    // En nasjonal henting med bbox tar med naboland. En svensk park skal ikke
    // faa rowsMissingCityAnchor til aa kaste og stanse hele kjoringen.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const { municipalityIndex } = await import('./municipality-index');
    const rows = await buildRows(
        null,
        [
            { type: 'way', id: 1, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } },
            { type: 'way', id: 2, tags: { leisure: 'park', name: 'Humlegarden' }, center: { lat: 59.3419, lon: 18.0784 } },
        ],
        50,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.deepEqual(rows.map((r) => r.title), ['Sofienbergparken']);
});

test('cityAnchor=null uten oppslagsfunksjon er en programmeringsfeil', async () => {
    const { buildRows, PLACE_CATEGORIES } = await load();
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    await assert.rejects(
        () =>
            buildRows(
                null,
                [{ type: 'way', id: 1, tags: { leisure: 'park', name: 'X-parken' }, center: { lat: 59.9, lon: 10.7 } }],
                50,
                [park]
            ),
        /resolveMunicipality/
    );
});

test('en per-kommune-chunk roerer aldri grensefila', async () => {
    // Alt vi har kjoert til naa. cityAnchor er satt, saa oppslaget kalles ikke.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const rows = await buildRows(
        'Oslo',
        [{ type: 'way', id: 1, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } }],
        50,
        [park],
        () => {
            throw new Error('oppslaget skal ikke kalles');
        }
    );
    assert.equal(rows[0].municipality, 'Oslo');
});

// ---------------------------------------------------------------------------
// NASJONAL DEKNING - rettingen av en ekte feil
// ---------------------------------------------------------------------------

test('fire byer er IKKE en kjent andel av Norge', () => {
    // Feilen som ble funnet i en toerrkjoering: utbyttesjekken brukte «andel av
    // standardplanen», som er 1 for en firebykjoering. Da ble forventningen
    // 3 070 parker for fire kommuner, og vakten slo ut paa en normal kjoering.
    assert.equal(nationalCoverage([chunkForCity('Oslo')]), null);
    assert.equal(
        nationalCoverage(['Oslo', 'Bergen', 'Trondheim', 'Stavanger'].map(chunkForCity)),
        null
    );
});

test('en plan uten cityAnchor er den nasjonale planen', () => {
    assert.equal(nationalCoverage([nasjonalChunk]), 1);
    assert.equal(nationalCoverage([]), null, 'tom plan dekker ingenting');
});

// ---------------------------------------------------------------------------
// STOPPVILKAAR 1 GJENNOM BERIKELSEN
// ---------------------------------------------------------------------------

/** Et ski-polygon som BESTAAR den romlige testen, med et utforloype-bevis
 *  inne i seg. Uten det naar objektet aldri claim-sjekken: claims brukes paa
 *  de BERIKEDE elementene, og et polygon som ikke er verifisert alpint blir
 *  forkastet foer det. */
function skiMedBevis(navn: string) {
    return [
        {
            c: 'skianlegg',
            s: 'omrade',
            e: {
                type: 'relation' as const,
                id: 2259942,
                tags: { name: navn, landuse: 'winter_sports' },
                members: [
                    {
                        type: 'way' as const,
                        ref: 1,
                        geometry: [
                            { lat: 59.98, lon: 10.62 },
                            { lat: 60.0, lon: 10.62 },
                            { lat: 60.0, lon: 10.68 },
                            { lat: 59.98, lon: 10.68 },
                            { lat: 59.98, lon: 10.62 },
                        ],
                    },
                ],
            },
        },
        {
            c: 'skianlegg',
            s: 'bevis',
            e: {
                type: 'way' as const,
                id: 77,
                tags: { 'piste:type': 'downhill' },
                geometry: [{ lat: 59.99, lon: 10.65 }],
            },
        },
    ];
}

test('et claim-navneavvik avbryter kjoeringen, ikke bare chunken', async () => {
    // Ende til ende gjennom det ekte berikelsessteget, mot den ekte
    // claim-lista. relation/2259942 er claimet med expectName «Skimore Oslo».
    const { enrichChunk } = await load();
    await assert.rejects(
        () => enrichChunk(chunkForCity('Oslo'), skiMedBevis('Et helt annet anlegg'), 50),
        (err: unknown) => {
            assert.ok(err instanceof ImportStop);
            assert.equal((err as ImportStop).vilkaar, 'claim-navneavvik');
            return true;
        }
    );
});

test('en claim som stemmer stopper ingenting, og objektet blir ingen rad', async () => {
    const { enrichChunk } = await load();
    const ut = await enrichChunk(chunkForCity('Oslo'), skiMedBevis('Skimore Oslo'), 50);
    assert.deepEqual(ut.rows, [], 'objektet er claimet - ingen rad');
    assert.deepEqual(ut.seenClaims, ['relation/2259942']);
});

test('claims sjekkes PAA de berikede elementene, ikke paa de raa', async () => {
    // Rekkefoelgen er verdt aa feste: et ski-polygon som ikke bestaar den
    // romlige testen forkastes FOER claim-sjekken, og naar derfor aldri
    // navnekontrollen. Det er riktig - et objekt som ikke ville blitt en rad,
    // trenger ingen claim - men det betyr at en claim paa et slikt objekt
    // staar som «traff ingenting» i rapporten.
    const { enrichChunk } = await load();
    const utenBevis = skiMedBevis('Et helt annet anlegg').filter((r) => r.s === 'omrade');
    const ut = await enrichChunk(chunkForCity('Oslo'), utenBevis, 50);
    assert.deepEqual(ut.rows, []);
    assert.deepEqual(ut.seenClaims, [], 'claimen ble aldri proevd');
});

// ---------------------------------------------------------------------------
// BOLK-FINGERAVTRYKKET
// ---------------------------------------------------------------------------

const fpFor = (m: Record<string, string>) => (id: string) => m[id];

test('samme berikelser gir samme fingeravtrykk', () => {
    const a = batchFingerprint(['by-oslo', 'by-bergen'], fpFor({ 'by-oslo': 'a1', 'by-bergen': 'b2' }));
    const b = batchFingerprint(['by-bergen', 'by-oslo'], fpFor({ 'by-oslo': 'a1', 'by-bergen': 'b2' }));
    assert.ok(a);
    assert.equal(a, b, 'rekkefoelgen paa --city skal ikke gi et annet avtrykk');
});

test('ETT endret berikelsessteg endrer hele bolkens avtrykk', () => {
    // Det er dette som gjoer at «ja» betyr ja til DISSE radene.
    const a = batchFingerprint(['by-oslo'], fpFor({ 'by-oslo': 'a1' }));
    const b = batchFingerprint(['by-oslo'], fpFor({ 'by-oslo': 'a2' }));
    assert.notEqual(a, b);
});

test('et hull i planen kan ikke godkjennes', () => {
    assert.equal(batchFingerprint(['by-oslo', 'by-bergen'], fpFor({ 'by-oslo': 'a1' })), null);
    assert.equal(batchFingerprint([], fpFor({})), null);
});

test('--approve leses som en verdi, ikke som et flagg', async () => {
    const { parseArgs } = await load();
    assert.equal(parseArgs(['--approve=c46cedd8']).approve, 'c46cedd8');
    assert.equal(parseArgs([]).approve, null);
    assert.throws(() => parseArgs(['--approve']), /Ukjent argument/);
});

// ---------------------------------------------------------------------------
// DUPLIKATKANDIDATER
// ---------------------------------------------------------------------------

const dup = (id: string, title: string, lat: number, lng: number, osmNavn = true) => ({
    external_id: id,
    category: 'Skianlegg',
    title,
    lat,
    lng,
    osmNavn,
});

test('samme navn, ulik external_id, naer hverandre er en kandidat', () => {
    // Klyngen delt av en omraadegrense: ulikt anker paa hver side.
    const ut = duplicateCandidates([
        dup('way/1', 'Solbakken', 59.95, 10.75),
        dup('way/2', 'Solbakken', 59.96, 10.75),
    ]);
    assert.equal(ut.length, 1);
    assert.match(ut[0], /way\/1 og way\/2/);
});

test('samme navn langt fra hverandre er to steder', () => {
    assert.deepEqual(
        duplicateCandidates([
            dup('way/1', 'Solbakken', 59.95, 10.75),
            dup('way/2', 'Solbakken', 63.43, 10.39),
        ]),
        []
    );
});

test('genererte titler sammenlignes ikke', () => {
    // «Lekeplass ved Storgata» x 2 er to lekeplasser, ikke et duplikat.
    assert.deepEqual(
        duplicateCandidates([
            dup('way/1', 'Lekeplass ved Storgata', 59.95, 10.75, false),
            dup('way/2', 'Lekeplass ved Storgata', 59.951, 10.751, false),
        ]),
        []
    );
});

test('ulik kategori er aldri duplikat', () => {
    const a = { ...dup('way/1', 'Solbakken', 59.95, 10.75), category: 'Aking' };
    const b = { ...dup('way/2', 'Solbakken', 59.951, 10.751), category: 'Skianlegg' };
    assert.deepEqual(duplicateCandidates([a, b]), []);
});

// ---------------------------------------------------------------------------
// OPPSUMMERINGEN
// ---------------------------------------------------------------------------

const input = (over: Partial<GodkjenningsInput> = {}): GodkjenningsInput => ({
    fingerprint: 'c46cedd8',
    chunks: 1,
    raderTotalt: 347,
    diff: { nye: 341, oppdaterer: 6 },
    kategorier: [
        { key: 'skianlegg', rader: 261, forventet: 254, utenNavn: 4 },
        { key: 'aking', rader: 86, forventet: 89, utenNavn: 1 },
    ],
    geokoding: { forsok: 5, feil: 0 },
    overpass: { sporringer: 6, medOmkamp: 3 },
    tommeSett: [],
    claims: { undertrykt: 5, navneavvik: 0 },
    duplikatkandidater: [],
    delteGenererteTitler: [],
    dom: 'GO',
    skrivKommando: 'npx tsx scripts/import-places.ts --work --resume --approve=c46cedd8',
    naa: '2026-09-14 21:40',
    ...over,
});

test('de tre linjene som betyr mest staar der', () => {
    const t = formatApproval(input());
    assert.match(t, /nye 341, oppdaterer 6/, 'nye vs. oppdaterer');
    assert.match(t, /103 %/, 'andel mot forventet');
    assert.match(t, /--approve=c46cedd8/, 'fingeravtrykket i skrivekommandoen');
});

test('uten databasetilgang staar det UKJENT, ikke null', () => {
    const t = formatApproval(input({ diff: null }));
    assert.match(t, /UKJENT/);
    assert.ok(!t.includes('nye 0'));
});

test('en kategori uten maalt nasjonalt tall viser tankestrek', () => {
    const t = formatApproval(input({ kategorier: [{ key: 'rullesport', rader: 12, forventet: null, utenNavn: 0 }] }));
    assert.match(t, /rullesport/);
});

test('STOPP gir INGEN skrivekommando', () => {
    const t = formatApproval(input({ dom: 'STOPP', stoppGrunn: 'utbyttekollaps' }));
    assert.match(t, /DOM: STOPP/);
    assert.match(t, /utbyttekollaps/);
    assert.ok(!t.includes('--approve=c46cedd8'), 'ingen kommando aa klippe og lime');
    assert.match(t, /INGEN SKRIVEKOMMANDO/);
});

test('omkamper og navneavvik merkes, null merkes ikke', () => {
    assert.match(formatApproval(input()), /3 av 6 spørringer {2}ADVARSEL/);
    assert.ok(
        !formatApproval(input({ overpass: { sporringer: 6, medOmkamp: 0 } })).includes(
            'ADVARSEL'
        )
    );
    assert.match(formatApproval(input({ claims: { undertrykt: 5, navneavvik: 1 } })), /navneavvik {2}ADVARSEL/);
});

// ---------------------------------------------------------------------------
// DELT GENERERT TITTEL — blindsonen fra den første nasjonale tørrkjøringen
// ---------------------------------------------------------------------------

test('tre navnløse polygoner med samme OMRÅDENAVN fanges nå', async () => {
    // way/55097596, 55097597 og 55097598 het alle «Skianlegg i Fageråsen».
    // Det er ikke et OSM-navn — det er tre navnløse polygoner som fikk samme
    // områdenavn fra Nominatim. duplicateCandidates så dem ikke.
    const { generatedTitleCollisions, duplicateCandidates } = await import('../lib/import-approval');
    const rader = [55097596, 55097597, 55097598].map((id, i) => ({
        external_id: `way/${id}`,
        category: 'Skianlegg',
        title: 'Skianlegg i Fageråsen',
        lat: 61.0 + i * 0.0012,
        lng: 9.0 + i * 0.002,
        osmNavn: false,
    }));
    assert.deepEqual(duplicateCandidates(rader), [], 'blindsonen, som før');
    const kollisjoner = generatedTitleCollisions(rader);
    assert.equal(kollisjoner.length, 3, 'tre par blant tre rader');
    assert.match(kollisjoner[0], /way\/55097596 og way\/55097597/);
});

test('et ekte OSM-navn telles ikke som generert kollisjon', async () => {
    // De to tellerne skal ikke overlappe — ellers står samme sak to ganger i
    // oppsummeringen.
    const { generatedTitleCollisions } = await import('../lib/import-approval');
    const rader = [1, 2].map((id, i) => ({
        external_id: `way/${id}`,
        category: 'Skianlegg',
        title: 'Hafjell',
        lat: 61.24 + i * 0.001,
        lng: 10.44,
        osmNavn: true,
    }));
    assert.deepEqual(generatedTitleCollisions(rader), []);
});

test('generert tittel langt unna er ikke en kollisjon', async () => {
    // «Skianlegg i Fageråsen» kan gjenta seg i to bygder. Taket er 2 km,
    // strammere enn for ekte navn, fordi et områdenavn dekker mer areal.
    const { generatedTitleCollisions } = await import('../lib/import-approval');
    const rader = [1, 2].map((id, i) => ({
        external_id: `way/${id}`,
        category: 'Skianlegg',
        title: 'Skianlegg i Fageråsen',
        lat: 61.0 + i * 0.5,
        lng: 9.0,
        osmNavn: false,
    }));
    assert.deepEqual(generatedTitleCollisions(rader), []);
});

test('oppsummeringen viser delte genererte titler som en ADVARSEL', async () => {
    const { formatApproval } = await import('../lib/import-approval');
    const t = formatApproval({
        ...input(),
        delteGenererteTitler: [
            {
                kategori: 'Skianlegg',
                title: 'Skianlegg i Fageråsen',
                a: 'way/1',
                b: 'way/2',
                meters: 343,
            },
        ],
    });
    assert.match(t, /delt GENERERT tittel/);
    assert.match(t, /ADVARSEL/);
    assert.match(t, /way\/1 og way\/2/);
});

// ---------------------------------------------------------------------------
// PAR ELLER RADER — avviket «13 ≠ 151» fra tørrkjøringen i sep. 2026
// ---------------------------------------------------------------------------

test('en gruppe paa n rader gir C(n,2) par, ikke n', async () => {
    // Slik oppsto «151»: tittelkilde-linja teller RADER, denne linja teller PAR.
    // En gruppe paa 17 rader med samme genererte tittel gir 136 par alene.
    const { generatedTitlePairs, beroerteRader } = await import('../lib/import-approval');
    for (const n of [2, 3, 13, 17]) {
        const rader = Array.from({ length: n }, (_, i) => ({
            external_id: `node/${i + 1}`,
            category: 'lekeplass',
            title: 'Lekeplass ved Kapellveien',
            lat: 59.96 + i * 1e-5,
            lng: 10.79,
            osmNavn: false,
        }));
        const par = generatedTitlePairs(rader);
        assert.equal(par.length, (n * (n - 1)) / 2, `${n} rader`);
        assert.equal(beroerteRader(par), n, `beroerte rader for ${n}`);
    }
});

test('populasjonen er alle genererte titler, ikke bare «kun kategori»', async () => {
    // Den andre halvdelen av avviket: «8 kun kategori» er ikke populasjonen.
    // To «ved gate»-rader med samme tittel er ogsaa en kollisjon.
    const { generatedTitlePairs } = await import('../lib/import-approval');
    const vedGate = [0, 1].map((i) => ({
        external_id: `node/${i + 1}`,
        category: 'lekeplass',
        title: 'Lekeplass ved Kapellveien',
        lat: 59.96 + i * 1e-4,
        lng: 10.79,
        osmNavn: false,
    }));
    assert.equal(generatedTitlePairs(vedGate).length, 1, '«ved gate» teller med');
});

test('oppsummeringen sier PAR og RADER, ikke bare et tall', async () => {
    // Uten begge tallene leses «151» som 151 steder. Det er det ikke.
    const { formatApproval } = await import('../lib/import-approval');
    const par = [
        { kategori: 'lekeplass', title: 'Lekeplass ved Kapellveien', a: 'node/1', b: 'node/2', meters: 40 },
        { kategori: 'lekeplass', title: 'Lekeplass ved Kapellveien', a: 'node/1', b: 'node/3', meters: 60 },
        { kategori: 'lekeplass', title: 'Lekeplass ved Kapellveien', a: 'node/2', b: 'node/3', meters: 30 },
    ];
    const t = formatApproval(input({ delteGenererteTitler: par }));
    assert.match(t, /3 par mellom 3 rader med delt GENERERT tittel/);
    assert.match(t, /node\/1 og node\/2, 40 m fra hverandre/, 'linjeformatet er uendret');
    assert.match(formatApproval(input()), /Duplikatkandidater \.+ 0/, 'null skal fortsatt staa som 0');
});
