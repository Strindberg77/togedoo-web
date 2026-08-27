// scripts/probe-parkour-klatre.ts
//
// READ-ONLY DIAGNOSE — skriver ingenting, kun Overpass-tellinger. Gir grovt
// antall parkour- og klatre-steder i OSM for Oslo, Bergen, Trondheim,
// Stavanger, så vi kan beslutte om parkour/klatre fortjener egne kategorier.
//
// Tagger (etablert OSM-bruk):
//   parkour       → sport=parkour
//   klatring      → sport=climbing  (paraply: ute-vegg, buldring OG haller)
//   klatrehall*   → sport=climbing + leisure=sports_centre  (indoor-indikator,
//                   grov — noen haller mangler leisure-taggen)
//
// Ingen secrets nødvendig (offentlig Overpass). Kjør:
//   npx --yes tsx scripts/probe-parkour-klatre.ts
//   PLACES_OVERPASS_ENDPOINTS=https://overpass.kumi.systems/api/interpreter npx --yes tsx scripts/probe-parkour-klatre.ts

const CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

const OVERPASS_ENDPOINTS = (
    process.env.PLACES_OVERPASS_ENDPOINTS ??
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const BACKOFF_MS = [5000, 15000, 45000];
const PAUSE_MS = 1200;
const RETRY_STATUS = new Set([429, 502, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Én Overpass-«out count»-spørring → antallet i settet. To runder over speilene
// med eksponentiell backoff; 429/502/504 + nettverksfeil er retrybare.
async function overpassCount(selector: string, city: string, label: string): Promise<number> {
    const query = `[out:json][timeout:90];
area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;
(
  ${selector}
);
out count;`;
    const attempts = [...OVERPASS_ENDPOINTS, ...OVERPASS_ENDPOINTS];
    for (let i = 0; i < attempts.length; i++) {
        const endpoint = attempts[i];
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
            });
            if (!res.ok) {
                if (!RETRY_STATUS.has(res.status)) {
                    throw new Error(`HTTP ${res.status} (${label}/${city})`);
                }
                console.log(`    ${city}/${label}: ${endpoint} svarte ${res.status} (forsøk ${i + 1}/${attempts.length})`);
            } else {
                const json = (await res.json()) as {
                    elements?: Array<{ type?: string; tags?: Record<string, string> }>;
                };
                const countEl = json.elements?.find((e) => e.type === 'count');
                const total = Number(countEl?.tags?.total ?? 'NaN');
                if (Number.isFinite(total)) return total;
                throw new Error(`uventet svar uten count (${label}/${city})`);
            }
        } catch (err) {
            console.log(`    ${city}/${label}: ${endpoint} feilet (${err instanceof Error ? err.message : err}) (forsøk ${i + 1}/${attempts.length})`);
        }
        await sleep(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]);
    }
    throw new Error(`Alle Overpass-forsøk feilet for ${city}/${label}`);
}

async function main() {
    const rows: Array<{ city: string; parkour: number; climbing: number; climbHall: number }> = [];
    for (const city of CITIES) {
        const parkour = await overpassCount('nwr["sport"="parkour"](area.a);', city, 'parkour');
        await sleep(PAUSE_MS);
        const climbing = await overpassCount('nwr["sport"="climbing"](area.a);', city, 'climbing');
        await sleep(PAUSE_MS);
        const climbHall = await overpassCount('nwr["sport"="climbing"]["leisure"="sports_centre"](area.a);', city, 'climb-hall');
        await sleep(PAUSE_MS);
        rows.push({ city, parkour, climbing, climbHall });
        console.log(`  ${city.padEnd(12)} parkour ${String(parkour).padStart(3)}  |  climbing ${String(climbing).padStart(3)}  (hvorav klatrehall-indikator ${climbHall})`);
    }

    const sum = (k: 'parkour' | 'climbing' | 'climbHall') => rows.reduce((a, r) => a + r[k], 0);
    console.log(`\n=== OSM-antall (Oslo/Bergen/Trondheim/Stavanger) ===`);
    console.log(`Modell    | ${CITIES.map((c) => c.slice(0, 4).padStart(5)).join(' ')} |  SUM`);
    const line = (label: string, vals: number[]) =>
        `${label.padEnd(9)} | ${vals.map((v) => String(v).padStart(5)).join(' ')} | ${String(vals.reduce((a, b) => a + b, 0)).padStart(4)}`;
    console.log(line('parkour', rows.map((r) => r.parkour)));
    console.log(line('climbing', rows.map((r) => r.climbing)));
    console.log(line('klatrehall', rows.map((r) => r.climbHall)));
    console.log(`\nTotalt: sport=parkour ${sum('parkour')}, sport=climbing ${sum('climbing')} (klatrehall-indikator ${sum('climbHall')}).`);
    console.log('Merk: «climbing» inkluderer ute-vegg/buldring; «klatrehall» er en grov indoor-indikator (leisure=sports_centre).\n');
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
