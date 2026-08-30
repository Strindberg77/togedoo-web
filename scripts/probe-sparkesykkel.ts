// scripts/probe-sparkesykkel.ts
//
// READ-ONLY DIAGNOSE — kun Overpass, skriver ingenting. Teller OSM-fasiliteter
// som er relevante for sparkesykkel / rullebrett-adjacent aktivitet i
// Oslo/Bergen/Trondheim/Stavanger, så vi kan avgjøre om «Sparkesykkel»
// fortjener egen kategori eller heller bør slås sammen med Skateboard.
//
// Sparkesykkel har ingen egen etablert OSM-tag. De DELTE anleggene er:
//   leisure=pump_track  — pumptrack (sparkesykkel, løpehjul, skateboard, BMX, balansesykkel)
//   leisure=skatepark   — skatepark (også mye brukt av sparkesykler) — OVERLAPPER Skateboard-kategorien
//   sport=bmx           — BMX-baner (rulle-adjacent)
//   sport=skateboard    — skateboard-flater (til sammenligning / overlapp)
//
// Samme robuste oppsett som de andre probene (User-Agent mot 406,
// admin_level~4|7, grense-forhåndssjekk, speil-fallback/backoff).
// Kjør (bruk speil MED area-støtte — default):
//   npx --yes tsx scripts/probe-sparkesykkel.ts

const CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

const OVERPASS_ENDPOINTS = (
    process.env.PLACES_OVERPASS_ENDPOINTS ??
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const UA = 'Togedoo datahub (hello@togedoo.com)'; // uten denne: HTTP 406
const BACKOFF_MS = [5000, 15000, 45000];
const PAUSE_MS = 1400;
const RETRY_STATUS = new Set([429, 502, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpassCounts(query: string, label: string): Promise<number[]> {
    const attempts = [...OVERPASS_ENDPOINTS, ...OVERPASS_ENDPOINTS];
    for (let i = 0; i < attempts.length; i++) {
        const endpoint = attempts[i];
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
                body: 'data=' + encodeURIComponent(query),
            });
            if (!res.ok) {
                if (!RETRY_STATUS.has(res.status)) throw new Error(`HTTP ${res.status} (${label})`);
                console.log(`    ${label}: ${endpoint} svarte ${res.status} (forsøk ${i + 1}/${attempts.length})`);
            } else {
                const json = (await res.json()) as { elements?: Array<{ type?: string; tags?: Record<string, string> }> };
                const counts = (json.elements ?? [])
                    .filter((e) => e.type === 'count')
                    .map((e) => Number(e.tags?.total ?? 'NaN'));
                if (counts.length && counts.every(Number.isFinite)) return counts;
                throw new Error(`uventet svar uten count (${label})`);
            }
        } catch (err) {
            console.log(`    ${label}: ${endpoint} feilet (${err instanceof Error ? err.message : err}) (forsøk ${i + 1}/${attempts.length})`);
        }
        await sleep(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]);
    }
    throw new Error(`Alle Overpass-forsøk feilet for ${label}`);
}

async function boundaryRelCount(city: string): Promise<number> {
    const q = `[out:json][timeout:60];
rel["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"];
out count;`;
    return (await overpassCounts(q, `${city}/rel`))[0] ?? 0;
}

// pump_track / skatepark / bmx / skateboard i kommunen (positional out count).
async function cityCounts(city: string) {
    const q = `[out:json][timeout:120];
area["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"]->.a;
nwr["leisure"="pump_track"](area.a); out count;
nwr["leisure"="skatepark"](area.a); out count;
nwr["sport"="bmx"](area.a); out count;
nwr["sport"="skateboard"](area.a); out count;`;
    const [pump = 0, skate = 0, bmx = 0, board = 0] = await overpassCounts(q, `${city}/counts`);
    return { pump, skate, bmx, board };
}

// KONTROLL: skatepark i Oslo-bbox (uten area). Skal være > 0.
async function control(): Promise<number> {
    const q = `[out:json][timeout:120];
( nwr["leisure"="skatepark"](59.80,10.49,60.14,10.95); );
out count;`;
    return (await overpassCounts(q, 'kontroll/oslo-bbox-skatepark'))[0] ?? 0;
}

async function main() {
    console.log('Speil:', OVERPASS_ENDPOINTS.join(', '), '\n');
    const ctrl = await control();
    await sleep(PAUSE_MS);
    console.log(`Kontroll (skatepark i Oslo-bbox, uten area): ${ctrl}${ctrl === 0 ? '  ⚠ speilet svarer ikke / mangler data' : '  ✓'}\n`);

    const rows: Array<{ city: string; rel: number; pump: number; skate: number; bmx: number; board: number }> = [];
    for (const city of CITIES) {
        const rel = await boundaryRelCount(city);
        await sleep(PAUSE_MS);
        const c = await cityCounts(city);
        await sleep(PAUSE_MS);
        rows.push({ city, rel, ...c });
        const warn = rel > 0 && c.pump + c.skate + c.bmx + c.board === 0 ? '  ⚠ grense funnet men 0 → speilet mangler area-støtte' : rel === 0 ? '  ⚠ ingen grense-relasjon' : '';
        console.log(`  ${city.padEnd(12)} pump_track ${String(c.pump).padStart(3)}  skatepark ${String(c.skate).padStart(3)}  bmx ${String(c.bmx).padStart(3)}  skateboard ${String(c.board).padStart(3)}${warn}`);
    }

    const sum = (k: 'pump' | 'skate' | 'bmx' | 'board') => rows.reduce((a, r) => a + r[k], 0);
    console.log(`\n=== sparkesykkel-relevante anlegg (4 byer) ===`);
    const line = (label: string, vals: number[]) =>
        `${label.padEnd(12)} | ${vals.map((v) => String(v).padStart(5)).join(' ')} | SUM ${String(vals.reduce((a, b) => a + b, 0)).padStart(4)}`;
    console.log(`Modell       | ${CITIES.map((c) => c.slice(0, 4).padStart(5)).join(' ')} |`);
    console.log(line('pump_track', rows.map((r) => r.pump)));
    console.log(line('skatepark', rows.map((r) => r.skate)));
    console.log(line('bmx', rows.map((r) => r.bmx)));
    console.log(line('skateboard', rows.map((r) => r.board)));
    console.log(`\nTolkning: pump_track er den mest sparkesykkel-spesifikke (delt med løpehjul/skateboard/BMX).`);
    console.log('skatepark OVERLAPPER Skateboard-kategorien — samme fysiske anlegg brukes av begge.');
    console.log('Lavt pump_track-tall ⇒ slå sparkesykkel sammen med Skateboard; høyt ⇒ vurder egen kategori.\n');
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
