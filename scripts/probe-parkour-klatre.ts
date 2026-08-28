// scripts/probe-parkour-klatre.ts  (v2 — robust + selvdiagnostiserende)
//
// READ-ONLY DIAGNOSE — kun Overpass-tellinger. Grovt antall parkour- og
// klatre-steder i OSM for Oslo, Bergen, Trondheim, Stavanger.
//
// HVORFOR v1 GA 0 FOR ALT (falskt):
//   1. admin_level="7" (eksakt) BOMMER på Oslo. Oslo er både kommune og fylke
//      og ligger på admin_level=4 i OSM — det finnes ingen level-7-Oslo. Andre
//      kommuner (Bergen/Trondheim/Stavanger) er level 7. → Oslo ble alltid 0.
//   2. area[...] krever at Overpass-instansen har AREA-datasettet. Speil uten
//      area-støtte (eller transiente feil) gir et TOMT område → alle nwr(area.a)
//      blir 0. v1 skilte ikke «tomt område» fra «ekte 0» → stille falskt 0.
//
// v2 fikser begge:
//   - admin_level~"^(4|7)$" (Oslo=4 OG kommuner=7), navn matches.
//   - REL-forhåndssjekk (out count på selve grense-relasjonen) — trenger IKKE
//     area-datasettet — bekrefter at grensen finnes i OSM.
//   - KONTROLL-spørring uten area (bbox rundt Oslo) — bekrefter at speilet
//     returnerer data og at sport=climbing faktisk gir treff.
//   - Bredere tagger (sport=climbing + climbing=* + leisure=climbing; parkour
//     tilsvarende) — union dedupliseres av Overpass, så ingen dobbelttelling.
//   - Hvis grensen finnes (rel>0) men area-tallene er 0 → speilet mangler
//     area-støtte; scriptet SIER det eksplisitt (bytt til overpass-api.de).
//
// Bruk speil MED area-støtte (default). Kjør:
//   npx --yes tsx scripts/probe-parkour-klatre.ts
//   PLACES_OVERPASS_ENDPOINTS=https://overpass-api.de/api/interpreter npx --yes tsx scripts/probe-parkour-klatre.ts

const CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

// Standard: speil som HAR area-datasettet. (osm.ch kan mangle det → v1s 0-feil.)
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

// Kjør en Overpass-spørring, returner ALLE «count»-elementenes total i rekkefølge.
async function overpassCounts(query: string, label: string): Promise<number[]> {
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
                if (!RETRY_STATUS.has(res.status)) throw new Error(`HTTP ${res.status} (${label})`);
                console.log(`    ${label}: ${endpoint} svarte ${res.status} (forsøk ${i + 1}/${attempts.length})`);
            } else {
                const json = (await res.json()) as {
                    elements?: Array<{ type?: string; tags?: Record<string, string> }>;
                };
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

// Finnes grense-relasjonen i OSM? (Trenger IKKE area-datasettet.)
async function boundaryRelCount(city: string): Promise<number> {
    const q = `[out:json][timeout:60];
rel["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"];
out count;`;
    return (await overpassCounts(q, `${city}/rel`))[0] ?? 0;
}

// Parkour / climbing / klatrehall i kommunen, via area (bred admin_level + bredere tagger).
async function cityCounts(city: string): Promise<{ parkour: number; climbing: number; hall: number }> {
    const q = `[out:json][timeout:120];
area["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"]->.a;
( nwr["sport"="parkour"](area.a); nwr["leisure"="parkour"](area.a); ); out count;
( nwr["sport"="climbing"](area.a); nwr["climbing"](area.a); nwr["leisure"="climbing"](area.a); ); out count;
( nwr["sport"="climbing"]["leisure"="sports_centre"](area.a); nwr["sport"="climbing"]["indoor"="yes"](area.a); ); out count;`;
    const [parkour = 0, climbing = 0, hall = 0] = await overpassCounts(q, `${city}/counts`);
    return { parkour, climbing, hall };
}

// KONTROLL: sport=climbing i en bbox rundt Oslo (uten area). Bekrefter at
// speilet svarer OG at taggen gir treff. Skal være > 0.
async function controlOsloBboxClimbing(): Promise<number> {
    const q = `[out:json][timeout:120];
( nwr["sport"="climbing"](59.80,10.49,60.14,10.95); );
out count;`;
    return (await overpassCounts(q, 'kontroll/oslo-bbox-climbing'))[0] ?? 0;
}

async function main() {
    console.log('Speil:', OVERPASS_ENDPOINTS.join(', '), '\n');

    const control = await controlOsloBboxClimbing();
    await sleep(PAUSE_MS);
    console.log(`Kontroll (sport=climbing i Oslo-bbox, uten area): ${control}`);
    if (control === 0) {
        console.log('  ⚠  Kontrollen er 0 — speilet returnerer ikke data, eller taggen gir ingen treff. Alt annet blir upålitelig.');
    } else {
        console.log('  ✓  Speilet svarer og sport=climbing gir treff — area-oppslaget testes per by under.');
    }
    console.log('');

    const rows: Array<{ city: string; rel: number; parkour: number; climbing: number; hall: number }> = [];
    for (const city of CITIES) {
        const rel = await boundaryRelCount(city);
        await sleep(PAUSE_MS);
        const c = await cityCounts(city);
        await sleep(PAUSE_MS);
        rows.push({ city, rel, ...c });
        const warn = rel > 0 && c.parkour + c.climbing + c.hall === 0 ? '  ⚠ grense funnet, men area-tall = 0 → speilet mangler AREA-støtte (bruk overpass-api.de)' : rel === 0 ? '  ⚠ ingen grense-relasjon matchet (navn/admin_level?)' : '';
        console.log(`  ${city.padEnd(12)} grense-rel ${rel}  |  parkour ${String(c.parkour).padStart(3)}  climbing ${String(c.climbing).padStart(3)}  (klatrehall ${c.hall})${warn}`);
    }

    console.log(`\n=== OSM-antall (Oslo/Bergen/Trondheim/Stavanger) ===`);
    const line = (label: string, vals: number[]) =>
        `${label.padEnd(10)} | ${vals.map((v) => String(v).padStart(5)).join(' ')} | SUM ${String(vals.reduce((a, b) => a + b, 0)).padStart(4)}`;
    console.log(`Modell     | ${CITIES.map((c) => c.slice(0, 4).padStart(5)).join(' ')} |`);
    console.log(line('parkour', rows.map((r) => r.parkour)));
    console.log(line('climbing', rows.map((r) => r.climbing)));
    console.log(line('klatrehall', rows.map((r) => r.hall)));
    console.log('\nMerk: «climbing» = sport=climbing ∪ climbing=* ∪ leisure=climbing (ute-vegg/buldring/haller).');
    console.log('«klatrehall» er en grov indoor-indikator (sport=climbing + leisure=sports_centre / indoor=yes).\n');
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
