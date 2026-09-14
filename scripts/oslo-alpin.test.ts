// scripts/oslo-alpin.test.ts
// OSLO-ALPINT: fem kuraterte rader for to OSM-relasjoner.
//
// Importen ga to rader, hver med bbox-senteret til en relasjon som dekker
// flere anlegg:
//
//   relation/2259942  Skimore Oslo     59.9915, 10.6510
//   relation/1762278  Oslo Skisenter   59.9567, 10.8097
//
// OSM har én relasjon per DRIFTSSELSKAP. Anleggene har hvert sitt startpunkt:
// Tryvann og Wyller er 30 minutters kjøretur fra hverandre, Trollvannskleiva
// og Grefsenkleiva har parkering i hver sin ende av Grefsenåsen. Ett kartpunkt
// for to anlegg kan sende en forelder til feil parkeringsplass.
//
// Ingen nettverk, ingen database. Seed-modulen kan importeres uten å kjøre
// seeden (isDirectRun-vakten).
// Kjør: node --import tsx --test scripts/oslo-alpin.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    assertClaimsResolve,
    claimsByOsmId,
    claimNameMatches,
    OSM_CLAIMS,
} from '../lib/osm-claims';
import { SEED as VINTER_SEED, SOURCE as VINTER_SOURCE } from './seed-vintertilbud';
import { SEED as DYRE_SEED, SOURCE as DYRE_SOURCE } from './seed-dyremote';

const OSLO_ALPINT = ['tryvann', 'wyller', 'tommkleiva', 'trollvannskleiva', 'grefsenkleiva'];
const finn = (id: string) => VINTER_SEED.find((s) => s.externalId === id);

// ---------------------------------------------------------------------------
// ÉN-TIL-MANGE: fem claims, to objekter
// ---------------------------------------------------------------------------

test('en claim er ett PAR, ikke en nøkkel — derfor fem for to objekter', async () => {
    const index = claimsByOsmId();
    assert.deepEqual(
        index.get('relation/2259942')!.map((c) => c.externalId),
        ['tryvann', 'wyller', 'tommkleiva']
    );
    assert.deepEqual(
        index.get('relation/1762278')!.map((c) => c.externalId),
        ['trollvannskleiva', 'grefsenkleiva']
    );
});

test('begge relasjonene gir ÉN hoppet-over-linje, med alle eierne', async () => {
    // applyOsmClaims skal ikke gi tre linjer for Skimore Oslo. Objektet blir
    // ingen rad ÉN gang; eierne listes på den ene linja.
    const { applyOsmClaims } = await import('./import-places');
    const skimore = {
        type: 'relation' as const,
        id: 2259942,
        tags: { name: 'Skimore Oslo', landuse: 'winter_sports' },
        skiVerified: true,
    };
    const skisenter = {
        type: 'relation' as const,
        id: 1762278,
        tags: { name: 'Oslo Skisenter', landuse: 'winter_sports' },
        skiVerified: true,
    };
    const { kept, skipped } = applyOsmClaims([skimore, skisenter]);
    assert.deepEqual(kept, [], 'ingen av dem blir en rad');
    assert.equal(skipped.length, 2, 'én linje per objekt, ikke per eier');
    assert.equal(skipped[0].claims.length, 3);
    assert.equal(skipped[1].claims.length, 2);
    assert.equal(skipped[0].navnAvvik, false);
    assert.equal(skipped[1].navnAvvik, false);
});

test('expectName beskriver OSM-OBJEKTET, ikke raden', async () => {
    // Radene heter Tryvann, Wyller og Tommkleiva; relasjonen heter «Skimore
    // Oslo». «Skimore» er et heiskortsystem, ikke et stedsnavn — ingen sier
    // «Skimore Tryvann». Ville expectName vært radnavnet, ville alle tre
    // claimene slått ut som navneavvik ved hver import.
    for (const c of claimsByOsmId().get('relation/2259942')!) {
        assert.equal(c.expectName, 'Skimore Oslo');
        assert.equal(claimNameMatches(c, 'Skimore Oslo'), true);
        assert.notEqual(c.expectName, finn(c.externalId)!.title);
    }
});

test('feil relasjons-id fanges fortsatt av navnekontrollen', async () => {
    // Fem claims på to objekter svekker ikke vernet: byttes id-ene om, sier
    // ingen av eierne seg igjen i navnet.
    const { applyOsmClaims } = await import('./import-places');
    const byttetOm = {
        type: 'relation' as const,
        id: 2259942,
        tags: { name: 'Oslo Skisenter' },
    };
    const { skipped } = applyOsmClaims([byttetOm]);
    assert.equal(skipped[0].navnAvvik, true);
});

// ---------------------------------------------------------------------------
// VAKTEN: fem claims vokter fem rader, to ville voktet to
// ---------------------------------------------------------------------------

test('hver claim peker på en seed-rad som faktisk finnes', async () => {
    // Den ekte koblingen, kjørt i CI. Før sep. 2026 kunne dette bare oppdages
    // ved å kjøre seeden med --dry-run.
    assert.doesNotThrow(() =>
        assertClaimsResolve(VINTER_SOURCE.slug, VINTER_SEED.map((s) => s.externalId))
    );
    assert.doesNotThrow(() =>
        assertClaimsResolve(DYRE_SOURCE.slug, DYRE_SEED.map((s) => s.externalId))
    );
});

test('fjernes ÉN av de fem radene, sier vakten fra', async () => {
    // Dette er gevinsten ved fem claims framfor to: med to ville bare
    // `tryvann` og `trollvannskleiva` vært voktet, og de tre andre kunne
    // blitt slettet i stillhet mens importen fortsatt undertrykte
    // relasjonene deres.
    for (const utelatt of OSLO_ALPINT) {
        const uten = VINTER_SEED.map((s) => s.externalId).filter((id) => id !== utelatt);
        assert.throws(
            () => assertClaimsResolve(VINTER_SOURCE.slug, uten),
            new RegExp(utelatt),
            `${utelatt} skal være voktet`
        );
    }
});

// ---------------------------------------------------------------------------
// RADENE
// ---------------------------------------------------------------------------

test('alle fem finnes, med manuelt verifisert koordinat', async () => {
    for (const id of OSLO_ALPINT) {
        const s = finn(id);
        assert.ok(s, `${id} mangler i SEED`);
        assert.ok(s!.manualCoord, `${id} skal hoppe over geokoding`);
        assert.equal(s!.municipality, 'Oslo');
        assert.equal(s!.isFree, false, 'alle krever heiskort');
        assert.notEqual(s!.coordVerified, false, 'koordinatene er verifisert i kart');
    }
});

test('koordinatene er de verifiserte, ikke relasjonenes bbox-senter', async () => {
    // Selve grunnen til at radene finnes. Ingen av dem skal ligge på
    // 59.9915, 10.6510 eller 59.9567, 10.8097.
    const forventet: Record<string, [number, number]> = {
        tryvann: [59.98870, 10.66812],
        wyller: [59.9909, 10.6304],
        tommkleiva: [59.983264, 10.669012],
        trollvannskleiva: [59.96172, 10.80608],
        grefsenkleiva: [59.951768, 10.814618],
    };
    for (const [id, [lat, lng]] of Object.entries(forventet)) {
        const c = finn(id)!.manualCoord!;
        assert.equal(c.lat, lat, id);
        assert.equal(c.lng, lng, id);
    }
});

test('navnene bærer ikke «Skimore» — det er et heiskortsystem', async () => {
    for (const id of OSLO_ALPINT) {
        assert.ok(!finn(id)!.title.toLowerCase().includes('skimore'), id);
    }
});

test('én URL per DRIFT, ikke per anlegg', async () => {
    for (const id of ['tryvann', 'wyller', 'tommkleiva']) {
        assert.equal(finn(id)!.url, 'https://oslo.skimore.no', id);
    }
    for (const id of ['trollvannskleiva', 'grefsenkleiva']) {
        assert.equal(finn(id)!.url, 'http://www.oslo-skisenter.no/', id);
    }
});

test('alle fem er Skianlegg med fasetten alpint, utendørs', async () => {
    const { splitFor } = await import('./seed-vintertilbud');
    for (const id of OSLO_ALPINT) {
        const s = splitFor(id);
        assert.equal(s.category, 'Skianlegg', id);
        assert.deepEqual(s.facets, ['alpint'], id);
        assert.equal(s.isIndoor, false, id);
    }
});

test('ingen av de fem setter nearCity — de ligger I Oslo', async () => {
    // Seedens regel: nearCity knytter et UTENBYS sted til en hjemby.
    // Punkt-i-polygon mot Kartverkets kommunegrenser (2024) bekreftet at alle
    // fem ligger i Oslo (0301); Wyller, den eneste som var i tvil, med ~1,9 km
    // margin til grensen mot Bærum.
    for (const id of OSLO_ALPINT) {
        assert.equal(finn(id)!.nearCity, undefined, id);
    }
});
