// lib/ingest-pause.test.ts
// En kilde på pause (sources.active = false) hoppes over, og det er ikke en
// feil. Før returnerte ingestSource `error: 'Kilden er deaktivert'`, og
// /api/sync meldte success:false hver natt så lenge en kilde sto på pause.
//
// Ingen nettverk, ingen database.
// Kjør: npx tsx --test lib/ingest-pause.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pauseResultat, type IngestResult } from './ingest';

test('en kilde på pause er hoppet over, ikke feilet', () => {
    const r = pauseResultat('bergen-bibliotek');
    assert.equal(r.slug, 'bergen-bibliotek');
    assert.equal(r.error, undefined);
    assert.match(r.skipped ?? '', /pause/);
    assert.equal(r.upserted, 0);
});

test('/api/sync-regelen: bare error gjør kjøringen mislykket', () => {
    // Samme uttrykk som i app/api/sync/route.ts.
    const results: IngestResult[] = [
        { slug: 'deichman', fetched: 16, skippedLocked: 0, upserted: 16, geocoded: 0, withoutCoordinates: 0 },
        pauseResultat('bergen-bibliotek'),
    ];
    const failed = results.filter((r) => r.error);
    assert.equal(failed.length === 0, true);
});
