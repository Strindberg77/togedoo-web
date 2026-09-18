// lib/skraper-identitet.test.ts
// Skraperne sier hvem de er. Togedoo skal ikke utgi seg for å være en
// nettleser mot deichman.no eller bergenbibliotek.no — heller ikke i
// nattjobben, som kaller de samme funksjonene.
//
// Ingen nettverk: fetch byttes ut med en stubb som fanger forespørselen.
// Kjør: npx tsx --test lib/skraper-identitet.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { scrapeDeichman } from './deichman';
import { scrapeBergen } from './bergen';

const IDENTITET = 'Togedoo datahub (hello@togedoo.com)';

async function fangForesporsel(kjor: () => Promise<unknown>) {
    const ekte = globalThis.fetch;
    const fanget: { url: string; ua: string | null }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        fanget.push({ url: String(url), ua: h.get('user-agent') });
        return new Response('', { status: 503 });
    }) as typeof fetch;
    try {
        await kjor();
    } finally {
        globalThis.fetch = ekte;
    }
    return fanget;
}

test('Deichman-skraperen sier at den er Togedoo', async () => {
    const f = await fangForesporsel(() => scrapeDeichman());
    assert.equal(f.length, 1);
    assert.equal(f[0].url, 'https://deichman.no/hva-skjer');
    assert.equal(f[0].ua, IDENTITET);
});

test('Bergen-skraperen sier at den er Togedoo', async () => {
    const f = await fangForesporsel(() => scrapeBergen());
    assert.equal(f.length, 1);
    assert.equal(f[0].url, 'https://bergenbibliotek.no/arrangement/rss.xml');
    assert.equal(f[0].ua, IDENTITET);
});

test('ingen av dem utgir seg for å være en nettleser', async () => {
    const f = await fangForesporsel(async () => {
        await scrapeDeichman();
        await scrapeBergen();
    });
    for (const { ua } of f) assert.doesNotMatch(ua ?? '', /Mozilla|AppleWebKit|Chrome|Safari/);
});

test('/api/deichman finnes ikke lenger i appen', () => {
    // Den åpne ruta som skrapet deichman.no direkte er arkivert
    // (scripts/arkiv/api-deichman-route.ts). Nattjobben bruker skraperen.
    assert.equal(existsSync('app/api/deichman/route.ts'), false);
});
