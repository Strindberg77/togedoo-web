// lib/event-window.test.ts
// Tidsvinduet for arrangementer (steg 0, defekt 1–3). Ingen nettverk, ingen
// database — rene funksjoner.
// Kjør: node --import tsx --test lib/event-window.test.ts
//
// MERK om rekkevidden: testene under låser hva koden PÅSTÅR. De kan ikke
// bekrefte at PostgREST tolker filterstrengen som forventet, og de kan ikke
// bekrefte at SQL-en i migrasjon 0015 gjør det samme — begge deler krever en
// database. Det som ER låst er at de tre stedene sier det samme, og at ingen
// av dem kan endres i det stille.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    EXPIRY_GRACE_HOURS,
    LISTING_GRACE_HOURS,
    cityModeEventWindowFilter,
    cityModeSortIsLoadBearing,
    expiryCutoff,
    listingCutoff,
} from './event-window';

const NAA = new Date('2026-09-11T20:00:00.000Z');

test('utløpsgrensen ligger 24 timer bak, visningsgrensen 2', () => {
    assert.equal(expiryCutoff(NAA), '2026-09-10T20:00:00.000Z');
    assert.equal(listingCutoff(NAA), '2026-09-11T18:00:00.000Z');
});

test('de to grensene er ulike med vilje, og utløp er den slakkeste', () => {
    // Cron kjører én gang i døgnet. Var utløpsgrensen like stram som
    // visningsgrensen, kunne sveipet ta et arrangement som fortsatt pågår.
    assert.ok(EXPIRY_GRACE_HOURS > LISTING_GRACE_HOURS);
});

test('grensene er ISO-strenger med Z — samme form som kolonnene', () => {
    for (const iso of [expiryCutoff(NAA), listingCutoff(NAA)]) {
        assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
});

test('grensene følger klokka, ikke modullastingen', () => {
    // Default-argumentet er `new Date()`, ikke en konstant fanget ved import.
    // En langtkjørende Vercel-instans ville ellers utløpt mot gårsdagens
    // grense på ubestemt tid.
    const foerst = expiryCutoff();
    const senere = expiryCutoff(new Date(Date.now() + 60_000));
    assert.ok(Date.parse(senere) > Date.parse(foerst));
});

test('by-modus-filteret har alle fire grenene RPC-en trenger', () => {
    const filter = cityModeEventWindowFilter('2026-09-11T18:00:00.000Z');
    const grener = filter.split(/,(?![^(]*\))/);
    assert.deepEqual(grener, [
        // Steder har ingen tid og slipper alltid gjennom.
        'kind.eq.place',
        // greatest(starts_at, ends_at) is null -> begge tomme
        'and(ends_at.is.null,starts_at.is.null)',
        // greatest(starts_at, ends_at) > cutoff, brutt opp: den seneste av to
        // er større enn X nøyaktig når minst én av dem er det.
        'ends_at.gt."2026-09-11T18:00:00.000Z"',
        'starts_at.gt."2026-09-11T18:00:00.000Z"',
    ]);
});

test('tidsstempelet er dobbeltfnuttet overalt det forekommer', () => {
    // Et ISO-tidsstempel inneholder «:» og «.», som begge er reserverte tegn
    // inne i et PostgREST-logikktre. Uten fnutter er strengen i beste fall
    // avvist og i verste fall tolket som noe annet enn den ser ut som.
    const cutoff = '2026-09-11T18:00:00.000Z';
    const filter = cityModeEventWindowFilter(cutoff);
    const forekomster = filter.split(cutoff).length - 1;
    assert.equal(forekomster, 2, 'grensen skal brukes i nøyaktig to grener');
    assert.equal(filter.split(`"${cutoff}"`).length - 1, 2, 'begge skal være fnuttet');
});

test('begge tidskolonnene har sin egen gren — ellers forsvinner en hel klasse', () => {
    // `ends_at.gt.X` treffer ikke rader der ends_at er null (NULL > X er NULL).
    // Faller starts_at-grenen ut, forsvinner hele Deichman-sporet fra by-modus
    // uten at noe feiler — de radene har ingen sluttid. Faller ends_at-grenen
    // ut, er det spilleperiodene som ryker, altså hele defekt 1.
    const filter = cityModeEventWindowFilter('2026-01-01T00:00:00.000Z');
    assert.ok(filter.includes('starts_at.gt."2026-01-01T00:00:00.000Z"'));
    assert.ok(filter.includes('ends_at.gt."2026-01-01T00:00:00.000Z"'));
});

test('greatest-semantikken: en feilført sluttid kan ikke alene utløpe raden', () => {
    // Forskjellen fra coalesce. En rad med starts_at i framtiden og ends_at i
    // fortiden skal BLI STÅENDE: starts_at-grenen fanger den. Med coalesce
    // ville ends_at avgjort alene, og arrangementet forsvunnet før det begynte.
    const cutoff = '2026-09-11T18:00:00.000Z';
    const grener = cityModeEventWindowFilter(cutoff).split(/,(?![^(]*\))/);
    const startsGren = grener.find((g) => g.startsWith('starts_at.'));
    assert.equal(startsGren, `starts_at.gt."${cutoff}"`);
    // Den må stå ubetinget — ikke inne i en and() som krever at ends_at er tom.
    assert.ok(!startsGren!.startsWith('and('));
});

test('sorteringen er bærende så snart kind ikke er place', () => {
    // Defekt 3: låsen er på BETINGELSEN, ikke på sorteringen. Dagen noen
    // slutter å sende kind=place, skal denne testen være stedet de havner.
    assert.equal(cityModeSortIsLoadBearing('place'), false);
    assert.equal(cityModeSortIsLoadBearing('event'), true);
    assert.equal(cityModeSortIsLoadBearing(null), true, 'ingen kind = begge slags rader');
    assert.equal(cityModeSortIsLoadBearing(undefined), true);
    // 'Place' med stor P matcher ingenting i databasen (kolonnen er små
    // bokstaver), så svaret skal være det forsiktige.
    assert.equal(cityModeSortIsLoadBearing('Place'), true);
});
