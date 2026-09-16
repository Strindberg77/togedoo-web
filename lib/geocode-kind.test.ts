// lib/geocode-kind.test.ts
// SKILLET MELLOM «tjenesten svarte ikke» OG «tjenesten svarte ingenting».
//
// GANGEN: den første nasjonale tørrkjøringen (sep. 2026) stanset på
// stoppvilkåret for geokodingsfeil — «51 av 157 revers-oppslag feilet (32 %),
// Kartverket er trolig nede». Alle 51 var samme melding, «ingen adresse innen
// 200 m», og det er Kartverket som svarer KORREKT at det ikke finnes en
// adresse der. Et alpinanlegg i fjellet har ingen adresse innen 200 m.
//
// Terskelen er kalibrert for bykategorier. For ski nasjonalt er adresseløshet
// normalen. Rettingen var å telle riktig ting, ikke å heve terskelen.
//
// Ingen ekte nettverk. Kjør: node --import tsx --test lib/geocode-kind.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Punktsøket leser disse INNE i funksjonen, så de kan settes her. Uten dem
// sover retry-logikken 2 + 4 sekunder per feilende oppslag.
process.env.PUNKTSOK_TIMEOUT_MS = '50';
process.env.PUNKTSOK_BUDGET_MS = '1';
process.env.PLACES_AREA_TIMEOUT_MS = '50';

import { makePlaceTitleDetailed, reverseGeocodeDetailed } from './places';
import { geocodeFailureStop } from './import-guards';

const realFetch = globalThis.fetch;
const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });

/** Ruter på vertsnavn: Kartverket punktsøk vs. Nominatim områdeoppslag. */
function mock(kartverket: () => Response | Promise<Response>, nominatim?: () => Response) {
    globalThis.fetch = (async (u: string | URL) => {
        const url = String(u);
        if (url.includes('geonorge')) return kartverket();
        return nominatim ? nominatim() : json({});
    }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// RETNING 1: et TOMT, GYLDIG svar er ikke en feil
// ---------------------------------------------------------------------------

test('«ingen adresse innen 200 m» er kind tomt, ikke feil', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    mock(() => json({ adresser: [] }));
    const ut = await reverseGeocodeDetailed(61.0, 9.0);
    assert.equal(ut.ok, false);
    assert.equal(ut.ok === false && ut.kind, 'tomt');
    assert.equal(ut.ok === false && ut.reason, 'ingen adresse innen 200 m');
});

test('et adresseløst sted får IKKE geocodeError', async (t) => {
    // Selve regresjonen: 51 av 51 ble talt som feil.
    t.after(() => { globalThis.fetch = realFetch; });
    mock(() => json({ adresser: [] }), () => json({ address: {} }));
    const ut = await makePlaceTitleDetailed('Skianlegg', null, 61.0, 9.0);
    assert.equal(ut.source, 'kun-kategori');
    assert.equal(ut.title, 'Skianlegg');
    assert.equal(ut.geocodeError, undefined, 'ingen feil — tjenesten svarte');
    assert.equal(ut.addressMissing, true, 'men adresseløsheten rapporteres');
});

test('adresseløsheten rapporteres OGSÅ når områdenavnet redder tittelen', async (t) => {
    // «Skianlegg i Fageråsen» er like adresseløst som «Skianlegg». Rapporten
    // skal si hvor mange steder som mangler adresse, ikke hvor mange som
    // mistet tittelen sin.
    t.after(() => { globalThis.fetch = realFetch; });
    mock(
        () => json({ adresser: [] }),
        () => json({ address: { suburb: 'Fageråsen' } })
    );
    const ut = await makePlaceTitleDetailed('Skianlegg', null, 61.0, 9.0);
    assert.equal(ut.source, 'i-omraade');
    assert.equal(ut.title, 'Skianlegg i Fageråsen');
    assert.equal(ut.geocodeError, undefined);
    assert.equal(ut.addressMissing, true);
});

// ---------------------------------------------------------------------------
// RETNING 2: en ekte feil teller fortsatt
// ---------------------------------------------------------------------------

test('5xx er kind feil og gir geocodeError', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    mock(() => new Response('', { status: 503 }));
    const ut = await reverseGeocodeDetailed(61.0, 9.0);
    assert.equal(ut.ok, false);
    assert.equal(ut.ok === false && ut.kind, 'feil');
    assert.match(ut.ok === false ? ut.reason : '', /HTTP 503/);
});

test('nettverksfeil er kind feil', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    globalThis.fetch = (async () => {
        throw new Error('ECONNRESET');
    }) as typeof fetch;
    const ut = await reverseGeocodeDetailed(61.0, 9.0);
    assert.equal(ut.ok === false && ut.kind, 'feil');
});

test('en ikke-retrybar HTTP-feil er kind feil', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    mock(() => new Response('nope', { status: 400 }));
    const ut = await reverseGeocodeDetailed(61.0, 9.0);
    assert.equal(ut.ok === false && ut.kind, 'feil');
    assert.match(ut.ok === false ? ut.reason : '', /HTTP 400/);
});

test('et sted som mister tittelen på en EKTE feil får geocodeError', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    mock(
        () => new Response('', { status: 503 }),
        () => new Response('', { status: 500 })
    );
    const ut = await makePlaceTitleDetailed('Lekeplass', null, 59.9, 10.7);
    assert.equal(ut.source, 'kun-kategori');
    assert.ok(ut.geocodeError, 'dette ER et symptom');
    assert.match(ut.geocodeError!, /HTTP 503/);
    assert.equal(ut.addressMissing, undefined, 'vi vet ikke om det finnes en adresse');
});

test('en ekte adresse gir hverken feil eller adresseløshet', async (t) => {
    t.after(() => { globalThis.fetch = realFetch; });
    mock(() => json({ adresser: [{ adressetekst: 'Storgata 5', poststed: 'Oslo' }] }));
    const ut = await makePlaceTitleDetailed('Lekeplass', null, 59.9, 10.7);
    assert.equal(ut.source, 'ved-gate');
    assert.equal(ut.title, 'Lekeplass ved Storgata 5', 'husnummeret er med fra sep. 2026');
    assert.equal(ut.geocodeError, undefined);
    assert.equal(ut.addressMissing, undefined);
});

// ---------------------------------------------------------------------------
// STOPPVILKÅRET, med tallene fra den ekte kjøringen
// ---------------------------------------------------------------------------

test('51 adresseløse av 157 stopper IKKE kjøringen lenger', async () => {
    // De faktiske tallene fra den nasjonale tørrkjøringen. Etter rettingen er
    // telleren null, fordi ingen av de 51 var en feil.
    assert.equal(geocodeFailureStop('Norge', { forsok: 157, feil: 0 }), null);
});

test('51 EKTE feil av 157 stopper fortsatt', async () => {
    // Den andre retningen: vilkåret skal ikke være avskaffet, bare presisert.
    const stopp = geocodeFailureStop('Norge', { forsok: 157, feil: 51 });
    assert.ok(stopp);
    assert.equal(stopp!.vilkaar, 'geokodingsfeil');
    assert.match(stopp!.message, /51 av 157/);
});
