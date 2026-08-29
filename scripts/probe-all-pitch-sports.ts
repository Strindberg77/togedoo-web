// scripts/probe-all-pitch-sports.ts
//
// READ-ONLY DIAGNOSE — kun Overpass, skriver ingenting. Teller ALLE sport-
// verdier på leisure=pitch i Oslo/Bergen/Trondheim/Stavanger, så vi ser hvor
// mange håndball-/volleyball-/tennis-baner osv. som FINNES i OSM.
//
// Hvorfor OSM og ikke DB: import-selektoren er
//   ["leisure"="pitch"]["sport"~"soccer|basketball|multi",i]
// så baner med annen sport (handball/volleyball/tennis/…) filtreres BORT ved
// import og finnes ikke i databasen. Denne proben måler hele OSM-potensialet.
//
// Bruker samme robuste Overpass-oppsett som probe-parkour-klatre v2:
//   - User-Agent (ellers 406 fra overpass-api.de),
//   - admin_level~"^(4|7)$" (Oslo=4 + kommuner=7),
//   - grense-forhåndssjekk + speil-fallback + backoff.
//
// Kjør (bruk speil MED area-støtte — default):
//   npx --yes tsx scripts/probe-all-pitch-sports.ts

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
const PAUSE_MS = 1500;
const RETRY_STATUS = new Set([429, 502, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OsmEl { type?: string; tags?: Record<string, string> }

async function overpass(query: string, label: string): Promise<OsmEl[]> {
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
                const json = (await res.json()) as { elements?: OsmEl[] };
                return json.elements ?? [];
            }
        } catch (err) {
            console.log(`    ${label}: ${endpoint} feilet (${err instanceof Error ? err.message : err}) (forsøk ${i + 1}/${attempts.length})`);
        }
        await sleep(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]);
    }
    throw new Error(`Alle Overpass-forsøk feilet for ${label}`);
}

function splitSports(raw?: string): string[] {
    if (!raw) return [];
    return raw.toLowerCase().split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

async function boundaryRelCount(city: string): Promise<number> {
    const q = `[out:json][timeout:60];
rel["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"];
out count;`;
    const els = await overpass(q, `${city}/rel`);
    const c = els.find((e) => e.type === 'count');
    return Number(c?.tags?.total ?? '0') || 0;
}

// Alle leisure=pitch i kommunen, kun tagger (lett). Teller sport-tokens.
async function pitchSports(city: string): Promise<{ total: number; noSport: number; byToken: Map<string, number> }> {
    const q = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"]->.a;
nwr["leisure"="pitch"](area.a);
out tags;`;
    const els = await overpass(q, `${city}/pitch`);
    const byToken = new Map<string, number>();
    let noSport = 0;
    for (const el of els) {
        const tokens = splitSports(el.tags?.sport);
        if (tokens.length === 0) {
            noSport += 1;
            continue;
        }
        for (const t of tokens) byToken.set(t, (byToken.get(t) ?? 0) + 1);
    }
    return { total: els.length, noSport, byToken };
}

async function main() {
    console.log('Speil:', OVERPASS_ENDPOINTS.join(', '), '\n');

    // Aggreger på tvers av byer + per by.
    const perCity: Record<string, Map<string, number>> = {};
    const totalTokens = new Map<string, number>();
    let grandTotal = 0;
    let grandNoSport = 0;

    for (const city of CITIES) {
        const rel = await boundaryRelCount(city);
        await sleep(PAUSE_MS);
        const { total, noSport, byToken } = await pitchSports(city);
        await sleep(PAUSE_MS);
        perCity[city] = byToken;
        grandTotal += total;
        grandNoSport += noSport;
        for (const [t, n] of byToken) totalTokens.set(t, (totalTokens.get(t) ?? 0) + n);
        const warn = rel > 0 && total === 0 ? '  ⚠ grense funnet men 0 pitch → speilet mangler area-støtte (bruk overpass-api.de)' : rel === 0 ? '  ⚠ ingen grense-relasjon matchet' : '';
        const top = [...byToken.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} ${n}`).join(', ');
        console.log(`  ${city.padEnd(12)} pitch ${String(total).padStart(4)} (uten sport ${noSport})  topp: ${top}${warn}`);
    }

    // Samlet tabell, sortert etter total.
    const sorted = [...totalTokens.entries()].sort((a, b) => b[1] - a[1]);
    const cols = CITIES.map((c) => c.slice(0, 4).padStart(6)).join(' ');
    console.log(`\n=== sport-verdier på leisure=pitch (4 byer) ===`);
    console.log(`${'sport'.padEnd(16)} | ${cols} |   SUM`);
    console.log('-'.repeat(16 + 3 + CITIES.length * 7 + 8));
    for (const [token, sum] of sorted) {
        const perCol = CITIES.map((c) => String(perCity[c].get(token) ?? 0).padStart(6)).join(' ');
        console.log(`${token.padEnd(16)} | ${perCol} | ${String(sum).padStart(5)}`);
    }
    console.log('-'.repeat(16 + 3 + CITIES.length * 7 + 8));
    console.log(`${'(pitch totalt)'.padEnd(16)} |${''.padStart(CITIES.length * 7)}  | ${String(grandTotal).padStart(5)}`);
    console.log(`${'(uten sport-tag)'.padEnd(16)} |${''.padStart(CITIES.length * 7)}  | ${String(grandNoSport).padStart(5)}`);

    // Fremhev dagens import-dekning vs. potensialet.
    const imported = ['soccer', 'basketball', 'multi'].reduce((a, t) => a + (totalTokens.get(t) ?? 0), 0);
    console.log(`\nDagens import fanger sport ∈ {soccer, basketball, multi}: ~${imported} token-treff.`);
    console.log('Alt annet (handball, volleyball, tennis, …) filtreres BORT ved import i dag.');
    console.log('Merk: token-treff teller per-sport; flerbruksbaner (semikolon) teller i hver sport.\n');
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
