// lib/places.test.ts
// Enhetstester for titteltilordningen i makePlaceTitleDetailed (område-tieret).
// Kjør: node --import tsx --test lib/places.test.ts
//
// Ingen Supabase-env → isDatahubConfigured() = false → geocode-cachen forbigås
// (ingen DB-kall). Vi mocker global.fetch og skiller Kartverket adresse-
// punktsøk fra Nominatim revers på URL, og teller kall per tjeneste for å
// bevise at bydel-oppslaget (Nominatim) prøves FØR poststed men ETTER gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Må stå før import av ./places slik at et evt. arvet miljø ikke slår på cachen.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import { makePlaceTitleDetailed } from './places';

interface Calls {
    kartverket: number;
    nominatim: number;
}

/** JSON-respons som matcher det lib/places leser (res.ok/status/json/text). */
function jsonRes(body: unknown) {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

/**
 * Stubber global.fetch. `kartverket` er responskroppen fra adresser/v1/punktsok
 * ({ adresser: [...] }; default tomt = «ingen adresse innen 200 m»); `nominatim`
 * er responskroppen fra Nominatim revers ({ address: {...} }; default {}).
 * Returnerer en teller som testene kan asserte mot.
 */
function stubFetch(opts: { kartverket?: unknown; nominatim?: unknown } = {}): Calls {
    const calls: Calls = { kartverket: 0, nominatim: 0 };
    global.fetch = (async (url: unknown) => {
        const u = String(url);
        if (u.includes('adresser/v1/punktsok')) {
            calls.kartverket++;
            return jsonRes(opts.kartverket ?? { adresser: [] });
        }
        if (u.includes('nominatim.openstreetmap.org/reverse')) {
            calls.nominatim++;
            return jsonRes(opts.nominatim ?? {});
        }
        throw new Error(`uventet fetch: ${u}`);
    }) as typeof fetch;
    return calls;
}

const O = { lat: 59.9042, lng: 10.7579 }; // et Oslo-punkt (verdiene er irrelevante — fetch er mocket)

test('1. brukbart OSM-navn → osm-navn, ingen geokoding', async () => {
    const calls = stubFetch();
    const r = await makePlaceTitleDetailed('Badeplass', 'Sørenga sjøbad', O.lat, O.lng);
    assert.equal(r.source, 'osm-navn');
    assert.equal(r.title, 'Sørenga sjøbad');
    assert.equal(calls.kartverket, 0, 'ingen adresse-oppslag når navnet holder');
    assert.equal(calls.nominatim, 0, 'ingen bydel-oppslag når navnet holder');
});

test('2. gate fra Kartverket → ved-gate, Nominatim ALDRI kalt', async () => {
    const calls = stubFetch({
        kartverket: { adresser: [{ adressetekst: 'Storgata 5', poststed: 'Oslo' }] },
    });
    const r = await makePlaceTitleDetailed('Lekeplass', null, O.lat, O.lng);
    assert.equal(r.source, 'ved-gate');
    assert.equal(r.title, 'Lekeplass ved Storgata');
    assert.equal(calls.nominatim, 0, 'bydel-tier skal ikke røres når gate finnes');
});

test('3. ingen gate, Nominatim gir ingen bydel, men Kartverket ga poststed → i-poststed (bydel prøvd FØRST)', async () => {
    // adressetekst uten gatenavn (bare husnummer) → street = null, poststed satt.
    const calls = stubFetch({
        kartverket: { adresser: [{ adressetekst: '5', poststed: 'Oslo' }] },
        nominatim: { address: {} }, // ingen suburb/bydel
    });
    const r = await makePlaceTitleDetailed('Badeplass', null, O.lat, O.lng);
    assert.equal(r.source, 'i-poststed');
    assert.equal(r.title, 'Badeplass i Oslo');
    assert.equal(calls.nominatim, 1, 'bydel-oppslaget skal ha vært forsøkt før poststed');
});

test('4. bydel slår poststed: Kartverket ga poststed OG Nominatim ga bydel → i-omraade', async () => {
    const calls = stubFetch({
        kartverket: { adresser: [{ adressetekst: '5', poststed: 'Oslo' }] },
        nominatim: { address: { suburb: 'Sørenga' } },
    });
    const r = await makePlaceTitleDetailed('Badeplass', null, O.lat, O.lng);
    assert.equal(r.source, 'i-omraade');
    assert.equal(r.title, 'Badeplass i Sørenga', 'bydel skal vinne over poststed');
    assert.equal(calls.nominatim, 1);
});

test('5. felt-prioritet i Nominatim-svaret (suburb > city_district > ... > neighbourhood)', async () => {
    // 5a: suburb vinner over neighbourhood.
    stubFetch({ nominatim: { address: { suburb: 'Sørenga', neighbourhood: 'Bjørvika' } } });
    let r = await makePlaceTitleDetailed('Badeplass', null, O.lat, O.lng);
    assert.equal(r.title, 'Badeplass i Sørenga');

    // 5b: uten suburb faller vi til city_district.
    stubFetch({ nominatim: { address: { city_district: 'Gamle Oslo', neighbourhood: 'Bjørvika' } } });
    r = await makePlaceTitleDetailed('Badeplass', null, O.lat, O.lng);
    assert.equal(r.title, 'Badeplass i Gamle Oslo');

    // 5c: kun neighbourhood (siste i prioriteten) brukes når intet annet finnes.
    stubFetch({ nominatim: { address: { neighbourhood: 'Grønland' } } });
    r = await makePlaceTitleDetailed('Badeplass', null, O.lat, O.lng);
    assert.equal(r.title, 'Badeplass i Grønland');
});

test('6. verken gate, bydel eller poststed → kun-kategori', async () => {
    const calls = stubFetch({ kartverket: { adresser: [] }, nominatim: { address: {} } });
    const r = await makePlaceTitleDetailed('Lekeplass', null, O.lat, O.lng);
    assert.equal(r.source, 'kun-kategori');
    assert.equal(r.title, 'Lekeplass');
    assert.equal(calls.kartverket, 1);
    assert.equal(calls.nominatim, 1, 'bydel-oppslaget skal ha vært forsøkt før vi ga opp');
});
