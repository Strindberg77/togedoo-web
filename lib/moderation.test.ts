// lib/moderation.test.ts
// Tilstandsovergangene bak POST /api/admin/moderate (hull 2, steg 0). Ingen
// nettverk, ingen database — rene funksjoner.
// Kjør: node --import tsx --test lib/moderation.test.ts
//
// MERK om rekkevidden: repoet har ingen testoppsett for API-ruter (ingen
// Next-testrunner, ingen Supabase-mock), så SELVE ruten er ikke dekket. Det
// som er dekket er tabellen ruten leser overgangene sine fra — og det er der
// defekten satt: .eq('status','pending') var hardkodet i update-en.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    MODERATION_ACTIONS,
    MODERATION_TRANSITIONS,
    noMatchMessage,
    parseModerationAction,
} from './moderation';

// Låst av check-constrainten i migrasjon 0001. Tar noen i bruk en ny
// statusverdi uten migrasjon, feiler denne testen før databasen gjør det.
const LOVLIGE_STATUSER = ['pending', 'published', 'rejected', 'expired'];

test('en publisert rad kan tas ned — hele poenget med endringen', () => {
    assert.deepEqual(MODERATION_TRANSITIONS.unpublish.from, ['published']);
    assert.equal(MODERATION_TRANSITIONS.unpublish.to, 'rejected');
});

test('nedtaking låser raden, så synken ikke publiserer den igjen i natt', () => {
    // Uten locked=true ville lib/ingest.ts upsertet status:'published' tilbake
    // ved neste kjøring kl. 07. Samme vakt som action='fjern_sted' bruker.
    assert.equal(MODERATION_TRANSITIONS.unpublish.lock, true);
});

test('publisering frigir låsen, så en feilaktig nedtaking kan angres', () => {
    // Uten 'rejected' som kilde ville angring krevd SQL-editoren — nøyaktig
    // det problemet endringen skal fjerne.
    assert.ok(MODERATION_TRANSITIONS.publish.from.includes('rejected'));
    assert.equal(MODERATION_TRANSITIONS.publish.lock, false);
});

test('pending-veien er uendret', () => {
    // Eksisterende oppførsel: begge handlinger går fra pending, ingen av dem
    // låser. Nye innsendinger har locked=false, så lock:false er en
    // nulloperasjon der.
    assert.ok(MODERATION_TRANSITIONS.publish.from.includes('pending'));
    assert.deepEqual(MODERATION_TRANSITIONS.reject.from, ['pending']);
    assert.equal(MODERATION_TRANSITIONS.reject.to, 'rejected');
    assert.equal(MODERATION_TRANSITIONS.reject.lock, false);
});

test('ingen overgang kan gå fra eller til en status databasen ikke har', () => {
    for (const action of MODERATION_ACTIONS) {
        const { from, to } = MODERATION_TRANSITIONS[action];
        assert.ok(from.length > 0, `${action} mangler kildestatus`);
        for (const status of from) {
            assert.ok(LOVLIGE_STATUSER.includes(status), `${action}: ukjent kildestatus ${status}`);
        }
        assert.ok(LOVLIGE_STATUSER.includes(to), `${action}: ukjent målstatus ${to}`);
    }
});

test('ingen handling kan gå fra sin egen målstatus', () => {
    // Ville gjort handlingen til en nulloperasjon som likevel svarer 200, og
    // skjult at ingenting skjedde.
    for (const action of MODERATION_ACTIONS) {
        const { from, to } = MODERATION_TRANSITIONS[action];
        assert.ok(!from.includes(to), `${action} går fra ${to} til ${to}`);
    }
});

test('action valideres mot tabellen, ikke mot en egen liste i ruten', () => {
    assert.equal(parseModerationAction('publish'), 'publish');
    assert.equal(parseModerationAction('unpublish'), 'unpublish');
    assert.equal(parseModerationAction('reject'), 'reject');
    // Alt annet er null -> 400 fra ruten.
    for (const ugyldig of ['', 'slett', 'PUBLISH', 'expired', null, undefined, 1, {}, ['publish']]) {
        assert.equal(parseModerationAction(ugyldig), null, `${JSON.stringify(ugyldig)} skal avvises`);
    }
});

test('404-teksten navngir statusene handlingen faktisk godtar', () => {
    // Den gamle teksten sa «pending» uansett. Med tre handlinger er det
    // villedende i to av tre tilfeller.
    assert.match(noMatchMessage('unpublish'), /published/);
    assert.match(noMatchMessage('reject'), /pending/);
    assert.match(noMatchMessage('publish'), /pending eller rejected/);
});
