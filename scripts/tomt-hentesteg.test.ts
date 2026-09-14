// scripts/tomt-hentesteg.test.ts
// ET TOMT HENTESTEG ER IKKE DET SAMME SOM ET FERDIG HENTESTEG.
//
// OBSERVERT (sep. 2026, to kjøringer av samme spørring): Oslo/park fikk 504 på
// første forsøk og et helt ordinært 200 med `elements: []` og ingen remark på
// det andre. fetchOverpass hadde ingen grunn til å mistenke noe. Sømmen skrev
// da 0 linjer i begge steg og markerte begge ferdig, og neste kjøring med
// --resume gjenopptok 0 rader uten å røre nettet — ADVARSEL-linja kom ikke,
// fordi berikelsen ble hoppet over. Samme spørring ga 34 objekter både før og
// etter.
//
// Testene under dekker BEGGE retninger: at et forbigående tomt svar ikke
// godtas, og at et ekte tomt område godtas ÉN gang for alle og ikke blir en
// evig retry.
//
// Ingen ekte nettverk. Kjør: node --import tsx --test scripts/tomt-hentesteg.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { chunkForCity } from '../lib/import-chunks';
import { FileStore } from './work-store';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_QUERY_PAUSE_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';
process.env.PLACES_OVERPASS_ROUNDS = '2';

const load = () => import('./import-places');
const oslo = chunkForCity('Oslo');

const park = (id: number) => ({
    type: 'way' as const,
    id,
    tags: { leisure: 'park', name: `Park ${id}` },
    center: { lat: 59.92, lon: 10.76 },
});

/** Svarer med ett svar per kall, og teller kallene. */
function mockSvar(svar: unknown[]) {
    const kall: string[] = [];
    let i = 0;
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
        kall.push(decodeURIComponent(String(init?.body ?? '')));
        const body = svar[Math.min(i++, svar.length - 1)];
        return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;
    return kall;
}

const parkCat = async () => {
    const { PLACE_CATEGORIES } = await load();
    return [PLACE_CATEGORIES.find((c) => c.key === 'park')!];
};

// ---------------------------------------------------------------------------
// RETNING 1: et FORBIGÅENDE tomt svar skal ikke godtas
// ---------------------------------------------------------------------------

test('tomt første svar, data i det andre → dataene brukes', async (t) => {
    // Nøyaktig det observerte tilfellet. Uten bekreftelsen ville chunken blitt
    // lagret tom og markert ferdig.
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    const kall = mockSvar([{ elements: [] }, { elements: [park(1), park(2)] }]);

    const { fetchChunk } = await load();
    const ut = await fetchChunk(oslo, await parkCat());
    assert.equal(ut.records.length, 2, 'det andre svaret skal vinne');
    assert.deepEqual(ut.emptySets, [], 'ingenting er bekreftet tomt');
    assert.equal(kall.length, 2, 'én spørring til, ikke flere');
});

test('bekreftelsen koster ÉN ekstra spørring, ikke en runde til', async (t) => {
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    const kall = mockSvar([{ elements: [] }]);
    const { fetchChunk } = await load();
    await fetchChunk(oslo, await parkCat());
    assert.equal(kall.length, 2);
});

test('en kategori med data bekreftes ikke — ingen ekstra kostnad', async (t) => {
    // Bekreftelsen skal bare treffe kategorier som faktisk kom tomme tilbake.
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    const kall = mockSvar([{ elements: [park(1)] }]);
    const { fetchChunk } = await load();
    const ut = await fetchChunk(oslo, await parkCat());
    assert.equal(kall.length, 1);
    assert.deepEqual(ut.emptySets, []);
});

// ---------------------------------------------------------------------------
// RETNING 2: et EKTE tomt område skal godtas, én gang for alle
// ---------------------------------------------------------------------------

test('tomt to ganger → bekreftet tom, og det står i manifestet', async (t) => {
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    mockSvar([{ elements: [] }]);
    const { fetchChunk } = await load();
    const ut = await fetchChunk(oslo, await parkCat());
    assert.deepEqual(ut.records, []);
    assert.deepEqual(ut.emptySets, ['park/main']);
});

test('bekreftet tom blir IKKE en evig retry — steget er ferdig', async (t) => {
    // Kravet: en akebakke finnes ikke i hver kommune, og en slik chunk skal
    // ikke hentes på nytt hver eneste kjøring.
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    mockSvar([{ elements: [] }]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomt-'));
    const store = new FileStore(dir);
    const { fetchChunk } = await load();
    const ut = await fetchChunk(oslo, await parkCat());
    store.write(oslo, 'fetch', 'fp1', ut.records, { emptySets: ut.emptySets });

    assert.equal(store.isDone(oslo, 'fetch', 'fp1'), true, 'tom, men ferdig');
    assert.deepEqual(new FileStore(dir).entries().get('by-oslo/fetch')!.emptySets, ['park/main']);
});

test('opplysningen overlever --resume — ellers er den usynlig', async () => {
    // Gjenopptagelsen hopper over berikelsen, og dermed over ADVARSEL-linja.
    // Manifestet er det eneste stedet opplysningen kan ligge.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomt-'));
    new FileStore(dir).write(oslo, 'fetch', 'fp1', [], { emptySets: ['aking/main'] });
    assert.deepEqual(new FileStore(dir).entries().get('by-oslo/fetch')!.emptySets, ['aking/main']);
});

// ---------------------------------------------------------------------------
// TERSKELEN: hele kategorien, ikke det enkelte settet
// ---------------------------------------------------------------------------

test('ett tomt sett av to bekreftes IKKE, men rapporteres', async (t) => {
    // Skianlegg i en kommune uten alpinanlegg: `omrade` er tom, `bevis` har
    // langrennsløyper. Området HAR løst seg og Overpass HAR svart — det var
    // det som skulle verifiseres. Å kjøre den dyre bevisspørringen på nytt
    // ville vært å betale mest der signalet er svakest.
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    let i = 0;
    const kall: string[] = [];
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
        kall.push(decodeURIComponent(String(init?.body ?? '')));
        // Første spørring er omrade (tom), andre er bevis (data).
        const body = i++ === 0 ? { elements: [] } : { elements: [{ type: 'way', id: 9, tags: { 'piste:type': 'nordic' } }] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const { fetchChunk, PLACE_CATEGORIES } = await load();
    const ski = [PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!];
    const ut = await fetchChunk(oslo, ski);
    assert.equal(kall.length, 2, 'to spørringer — ingen bekreftelsesrunde');
    assert.deepEqual(ut.emptySets, ['skianlegg/omrade'], 'rapporteres likevel');
});

test('begge sett tomme bekreftes som hele kategorien', async (t) => {
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    const kall = mockSvar([{ elements: [] }]);
    const { fetchChunk, PLACE_CATEGORIES } = await load();
    const ski = [PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!];
    const ut = await fetchChunk(oslo, ski);
    assert.equal(kall.length, 4, 'to sett × to runder');
    assert.deepEqual(ut.emptySets.sort(), ['skianlegg/bevis', 'skianlegg/omrade']);
});

// ---------------------------------------------------------------------------
// PUNKT 3: 0 etter oppbrukte forsøk finnes ikke — det kastes
// ---------------------------------------------------------------------------

test('alle forsøk oppbrukt gir en FEIL, aldri 0 objekter', async (t) => {
    // Svaret på «er det forskjell på 0 etter retry-suksess og 0 etter at alle
    // forsøk er brukt opp»: ja, og koden skiller dem allerede. Det siste
    // kaster, så et tomt resultat kan BARE komme fra et vellykket 200.
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    globalThis.fetch = (async () => new Response('', { status: 504 })) as typeof fetch;
    const { fetchOverpass } = await load();
    await assert.rejects(
        () => fetchOverpass('[out:json];out;', 'test/park'),
        /Alle Overpass-forsøk feilet/
    );
});

test('200 UTEN elements-liste er ikke et tomt område', async (t) => {
    // Hullet som ble funnet da punkt 3 ble undersøkt: `json.elements ?? []`
    // gjorde en proxy-feilside i JSON umulig å skille fra et tomt område.
    // Samme feilklasse som remark-sjekken. Retryes nå.
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    let i = 0;
    globalThis.fetch = (async () => {
        const body = i++ === 0 ? { error: 'bad gateway' } : { elements: [park(1)] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    // OVERPASS_ROUNDS leses på modulnivå, så den settes i filhodet — ikke her.
    const { fetchOverpass } = await load();
    const ut = await fetchOverpass('[out:json];out;', 'test/park');
    assert.equal(ut.length, 1, 'svaret uten elements ble forkastet, ikke lest som tomt');
});

test('et ekte tomt 200 returneres fortsatt som tomt', async (t) => {
    // Bekreftelsen ligger i fetchChunk, ikke her. fetchOverpass skal fortsatt
    // svare ærlig på det ene kallet den fikk.
    const real = globalThis.fetch;
    t.after(() => { globalThis.fetch = real; });
    globalThis.fetch = (async () =>
        new Response(JSON.stringify({ elements: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })) as typeof fetch;
    const { fetchOverpass } = await load();
    assert.deepEqual(await fetchOverpass('[out:json];out;', 'test/park'), []);
});
