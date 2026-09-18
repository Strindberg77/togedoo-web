// lib/activities-uten-lagring.test.ts
// Uten Supabase-miljøvariablene svarer /api/activities med en tydelig feil —
// og skraper ingenting. Før lå det en reservesti her som hentet Deichman og
// Bergen live ved hvert kall (arkivert i scripts/arkiv/).
//
// Ingen nettverk: fetch byttes ut med en stubb som feiler testen hvis den
// kalles.
// Kjør: npx tsx --test lib/activities-uten-lagring.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

test('uten SUPABASE_URL/SERVICE_ROLE_KEY: 503, tydelig feil, ingen forespørsler ut', async () => {
    const lagret = {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const ekteFetch = globalThis.fetch;
    const utgaende: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
        utgaende.push(String(url));
        throw new Error('ingen nettverk i denne testen');
    }) as typeof fetch;
    try {
        const { GET } = await import('../app/api/activities/route');
        for (const sti of ['/api/activities', '/api/activities?municipality=Oslo&targetAudience=Barn']) {
            const svar = await GET(new NextRequest(`http://localhost${sti}`));
            assert.equal(svar.status, 503, sti);
            const body = await svar.json();
            assert.equal(body.success, false);
            assert.match(body.error, /ikke konfigurert/);
            assert.equal(body.mode, undefined, 'ingen «legacy»-modus lenger');
        }
        assert.deepEqual(utgaende, [], 'ruta skal ikke kontakte deichman.no eller bergenbibliotek.no');
    } finally {
        globalThis.fetch = ekteFetch;
        if (lagret.url !== undefined) process.env.SUPABASE_URL = lagret.url;
        if (lagret.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = lagret.key;
    }
});
