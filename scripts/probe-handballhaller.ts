// scripts/probe-handballhaller.ts
//
// READ-ONLY DIAGNOSE — skriver ingenting, verken til OSM eller til databasen.
// Svarer på de to empiriske spørsmålene i håndballhall-vurderingen:
//
//   1) OSM-DEKNING: hvor mange innendørs idrettsanlegg finnes i OSM for en by,
//      og hvor mange av dem har faktisk sport-taggen satt (og med håndball)?
//      Uten sport-tag kan vi IKKE fange håndballhaller automatisk.
//   2) ER DE ALLEREDE HOS OSS: hvor mange av hall-navnene fra en liste
//      (f.eks. NHFs hall-oversikt) ligger allerede i activities som
//      kategori «Idrettshall»? Da er svaret BERIKING, ikke re-import.
//
// Kjør (OSM-delen trenger ingen credentials):
//   npx --yes tsx scripts/probe-handballhaller.ts
//   npx --yes tsx scripts/probe-handballhaller.ts --city Oslo
//   npx --yes tsx scripts/probe-handballhaller.ts --city Oslo --names haller-oslo.txt
//   npx --yes tsx scripts/probe-handballhaller.ts --skip-db
//
// --names <fil>: ett hall-navn per linje (tomme linjer og #-kommentarer
// ignoreres). Navnene brukes KUN som søkenøkler mot OSM og mot vår egen
// database — ingenting fra fila lagres. Uten --names kjøres bare de fire
// eksempelnavnene under, og navnematchingen er da ikke representativ.
//
// DB-delen krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (kun lesing) og
// hoppes automatisk over hvis de mangler.
import { readFileSync } from 'node:fs';
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';

const HB_CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

// Fire navn nevnt i NHFs Oslo-liste, som minimums-stikkprøve når --names
// ikke er gitt. IKKE en fullstendig liste — bruk --names for ekte tall.
const HB_SEED_NAMES = [
    'Apalløkka',
    'Bentsebrua Flerbrukshall',
    'Bjølsenhallen',
    'Engebråtenhallen',
    'Årvoll Flerbrukshall',
];

const HB_ENDPOINTS = (
    process.env.PLACES_OVERPASS_ENDPOINTS ??
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const HB_UA = 'Togedoo datahub (hello@togedoo.com)'; // uten denne: HTTP 406
const HB_BACKOFF_MS = [5000, 15000, 45000];
const HB_PAUSE_MS = 1500;
const HB_RETRY_STATUS = new Set([429, 502, 504]);
const hbSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface HbEl {
    type?: string;
    id?: number;
    tags?: Record<string, string>;
}

async function hbOverpass(query: string, label: string): Promise<HbEl[]> {
    const attempts = [...HB_ENDPOINTS, ...HB_ENDPOINTS];
    for (let i = 0; i < attempts.length; i++) {
        const endpoint = attempts[i];
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': HB_UA },
                body: 'data=' + encodeURIComponent(query),
            });
            if (!res.ok) {
                if (!HB_RETRY_STATUS.has(res.status)) throw new Error(`HTTP ${res.status} (${label})`);
                console.log(`    ${label}: ${endpoint} svarte ${res.status} (forsøk ${i + 1}/${attempts.length})`);
            } else {
                const json = (await res.json()) as { elements?: HbEl[] };
                return json.elements ?? [];
            }
        } catch (err) {
            console.log(
                `    ${label}: ${endpoint} feilet (${err instanceof Error ? err.message : err}) (forsøk ${i + 1}/${attempts.length})`
            );
        }
        await hbSleep(HB_BACKOFF_MS[Math.min(i, HB_BACKOFF_MS.length - 1)]);
    }
    throw new Error(`Alle Overpass-forsøk feilet for ${label}`);
}

/** admin_level~"^(4|7)$": Oslo ligger på 4 (kommune+fylke), øvrige kommuner på 7. */
const hbArea = (city: string) =>
    `area["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"]->.a;`;

/** Bekrefter at grense-relasjonen finnes, så «0 treff» ikke forveksles med
 *  «speilet mangler area-datasettet» (falskt 0, jf. probe-parkour-klatre v2). */
async function hbBoundaryCount(city: string): Promise<number> {
    const els = await hbOverpass(
        `[out:json][timeout:60];\nrel["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="${city}"];\nout count;`,
        `${city}/grense`
    );
    return Number(els.find((e) => e.type === 'count')?.tags?.total ?? '0') || 0;
}

function hbSportTokens(raw?: string): string[] {
    if (!raw) return [];
    return raw
        .toLowerCase()
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** «Bjølsenhallen» → «bjolsenhallen»: småbokstaver, æøå→aoa, bort med
 *  ikke-alfanumerisk. Gjør navnematching robust mot skrivemåte-forskjeller
 *  mellom NHF-lista, OSM og vår egen database. */
function hbNorm(s: string): string {
    return s
        .toLowerCase()
        .replace(/æ/g, 'ae')
        .replace(/ø/g, 'o')
        .replace(/å/g, 'a')
        .replace(/[^a-z0-9]/g, '');
}

function hbEscapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface HbTagStats {
    total: number;
    withSport: number;
    handball: number;
    tokens: Map<string, number>;
}

function hbStats(els: HbEl[]): HbTagStats {
    const tokens = new Map<string, number>();
    let withSport = 0;
    let handball = 0;
    for (const el of els) {
        const t = hbSportTokens(el.tags?.sport);
        if (t.length === 0) continue;
        withSport += 1;
        if (t.includes('handball')) handball += 1;
        for (const tok of t) tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
    }
    return { total: els.length, withSport, handball, tokens };
}

function hbPrintTokens(label: string, st: HbTagStats, top = 12) {
    const pct = (n: number) => (st.total ? ((n / st.total) * 100).toFixed(1) : '0.0');
    console.log(
        `  ${label.padEnd(26)} ${String(st.total).padStart(4)} objekter — ` +
            `${st.withSport} med sport-tag (${pct(st.withSport)} %), ` +
            `${st.handball} med sport=handball (${pct(st.handball)} %)`
    );
    const sorted = [...st.tokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
    if (sorted.length) {
        console.log(`      sport-tokens: ${sorted.map(([t, n]) => `${t} ${n}`).join(', ')}`);
    }
}

/** Hvordan er «hall-navnede» objekter tagget? Svarer på om vi i det hele tatt
 *  KAN finne dem via en tag-selektor, eller om de bare finnes som bygninger. */
function hbTaggingBreakdown(els: HbEl[]): Map<string, number> {
    const by = new Map<string, number>();
    for (const el of els) {
        const t = el.tags ?? {};
        const key = t.leisure
            ? `leisure=${t.leisure}`
            : t.building
              ? `building=${t.building}`
              : t.amenity
                ? `amenity=${t.amenity}`
                : '(ingen leisure/building/amenity)';
        by.set(key, (by.get(key) ?? 0) + 1);
    }
    return by;
}

interface HbCityResult {
    city: string;
    sportsCentre: HbEl[];
    sportsHall: HbEl[];
    handballTagged: HbEl[];
    hallNamed: HbEl[];
    byName: HbEl[];
}

async function hbProbeCity(city: string, names: string[]): Promise<HbCityResult | null> {
    console.log(`\n=== ${city} — OSM ===`);
    const rel = await hbBoundaryCount(city);
    await hbSleep(HB_PAUSE_MS);
    if (rel === 0) {
        console.log(`  ⚠ ingen grense-relasjon matchet «${city}» — hopper over byen.`);
        return null;
    }

    const A = hbArea(city);
    // 1) leisure=sports_centre — det import-places.ts henter som «Idrettshall».
    const sportsCentre = await hbOverpass(
        `[out:json][timeout:180];\n${A}nwr["leisure"="sports_centre"](area.a);\nout tags;`,
        `${city}/sports_centre`
    );
    await hbSleep(HB_PAUSE_MS);

    // 2) building=sports_hall / sports_centre — hallbygninger vi IKKE henter i dag.
    const sportsHall = await hbOverpass(
        `[out:json][timeout:180];\n${A}nwr["building"~"^(sports_hall|sports_centre)$"](area.a);\nout tags;`,
        `${city}/building_sports_hall`
    );
    await hbSleep(HB_PAUSE_MS);

    // 3) ALT med sport=handball, uansett leisure/building — øvre grense for hva
    //    en ren tag-basert håndball-selektor kan finne i dag.
    const handballTagged = await hbOverpass(
        `[out:json][timeout:180];\n${A}nwr["sport"~"handball"](area.a);\nout tags;`,
        `${city}/sport_handball`
    );
    await hbSleep(HB_PAUSE_MS);

    // 4) Navne-heuristikk: alt som heter «…hall»/«…hallen». Viser hvor mange
    //    hall-objekter som finnes uavhengig av om sport-taggen er satt.
    const hallNamed = await hbOverpass(
        `[out:json][timeout:180];\n${A}nwr["name"~"hall(en)?$",i](area.a);\nout tags;`,
        `${city}/navn_hall`
    );
    await hbSleep(HB_PAUSE_MS);

    // 5) Eksakt oppslag på navnene fra lista (chunket, så spørringen holder seg lett).
    const byName: HbEl[] = [];
    const seenByName = new Set<string>();
    const CHUNK = 30;
    for (let i = 0; i < names.length; i += CHUNK) {
        const chunk = names.slice(i, i + CHUNK);
        const re = chunk.map(hbEscapeRe).join('|');
        const els = await hbOverpass(
            `[out:json][timeout:180];\n${A}nwr["name"~"(${re})",i](area.a);\nout tags;`,
            `${city}/navneliste ${i / CHUNK + 1}`
        );
        for (const el of els) {
            const id = `${el.type}/${el.id}`;
            if (seenByName.has(id)) continue;
            seenByName.add(id);
            byName.push(el);
        }
        await hbSleep(HB_PAUSE_MS);
    }

    hbPrintTokens('leisure=sports_centre', hbStats(sportsCentre));
    hbPrintTokens('building=sports_hall*', hbStats(sportsHall));
    hbPrintTokens('sport~handball (alt)', hbStats(handballTagged));
    hbPrintTokens('navn «…hall(en)»', hbStats(hallNamed));

    console.log(`  Slik er «…hall(en)»-objektene tagget:`);
    for (const [k, n] of [...hbTaggingBreakdown(hallNamed).entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`      ${String(n).padStart(4)} × ${k}`);
    }

    console.log(`  Alle objekter med sport~handball (${handballTagged.length}):`);
    for (const el of handballTagged.slice(0, 40)) {
        const t = el.tags ?? {};
        const kind = t.leisure ? `leisure=${t.leisure}` : t.building ? `building=${t.building}` : '(annet)';
        console.log(`      ${el.type}/${el.id}  ${(t.name ?? '(uten navn)').padEnd(34)} ${kind}  sport=${t.sport}`);
    }
    if (handballTagged.length > 40) console.log(`      … +${handballTagged.length - 40} til`);

    return { city, sportsCentre, sportsHall, handballTagged, hallNamed, byName };
}

/** Fant vi hall-navnene i OSM, og HAR treffet sport-taggen? */
function hbReportNameMatchOsm(res: HbCityResult, names: string[]) {
    const index = new Map<string, HbEl>();
    for (const el of [...res.sportsCentre, ...res.sportsHall, ...res.hallNamed, ...res.byName]) {
        const n = el.tags?.name;
        if (n) index.set(hbNorm(n), el);
    }
    let found = 0;
    let foundWithHandball = 0;
    const missing: string[] = [];
    console.log(`\n  --- Navneliste (${names.length} haller) mot OSM ---`);
    for (const name of names) {
        const key = hbNorm(name);
        // Eksakt normalisert treff, ellers delstreng begge veier
        // («Apalløkka» ↔ «Apalløkka idrettshall»).
        let hit = index.get(key);
        if (!hit) {
            for (const [k, el] of index) {
                if (k.includes(key) || key.includes(k)) {
                    hit = el;
                    break;
                }
            }
        }
        if (!hit) {
            missing.push(name);
            continue;
        }
        found += 1;
        const t = hit.tags ?? {};
        const hasHb = hbSportTokens(t.sport).includes('handball');
        if (hasHb) foundWithHandball += 1;
        const kind = t.leisure ? `leisure=${t.leisure}` : t.building ? `building=${t.building}` : '(annet)';
        console.log(
            `      ✔ ${name.padEnd(32)} ${hit.type}/${hit.id}  ${kind}  sport=${t.sport ?? '(mangler)'}${hasHb ? '  [handball]' : ''}`
        );
    }
    for (const m of missing) console.log(`      ✘ ${m.padEnd(32)} ikke funnet i OSM-utvalget`);
    const pct = (n: number) => (names.length ? ((n / names.length) * 100).toFixed(1) : '0.0');
    console.log(
        `  OSM-dekning for lista: ${found}/${names.length} funnet (${pct(found)} %), ` +
            `herav ${foundWithHandball} med sport=handball (${pct(foundWithHandball)} % av lista)`
    );
}

/** Ligger hallene allerede hos oss som «Idrettshall»? */
async function hbReportDb(city: string, names: string[]) {
    console.log(`\n=== ${city} — vår database ===`);
    if (!isDatahubConfigured()) {
        console.log('  SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler — DB-delen hoppes over.');
        return;
    }
    const db = supabaseAdmin();
    interface Row {
        title: string | null;
        venue_name: string | null;
        category: string | null;
        osm_tags: Record<string, unknown> | null;
    }
    const rows: Row[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await db
            .from('activities')
            .select('title, venue_name, category, osm_tags')
            .eq('kind', 'place')
            .eq('category', 'Idrettshall')
            .eq('municipality', city)
            .range(from, from + pageSize - 1);
        if (error) throw new Error(`DB-feil: ${error.message}`);
        if (!data || data.length === 0) break;
        rows.push(...(data as Row[]));
        if (data.length < pageSize) break;
    }

    const tokens = new Map<string, number>();
    let withSport = 0;
    let handball = 0;
    for (const r of rows) {
        const raw = r.osm_tags?.sport;
        const t = hbSportTokens(typeof raw === 'string' ? raw : undefined);
        if (t.length === 0) continue;
        withSport += 1;
        if (t.includes('handball')) handball += 1;
        for (const tok of t) tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
    }
    const pct = (n: number) => (rows.length ? ((n / rows.length) * 100).toFixed(1) : '0.0');
    console.log(
        `  ${rows.length} rader med kategori «Idrettshall» — ${withSport} har osm_tags.sport ` +
            `(${pct(withSport)} %), ${handball} med handball (${pct(handball)} %)`
    );
    if (tokens.size) {
        console.log(
            `      sport-tokens: ${[...tokens.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ')}`
        );
    }

    const index = new Map<string, Row>();
    for (const r of rows) {
        for (const n of [r.venue_name, r.title]) {
            if (n) index.set(hbNorm(n), r);
        }
    }
    let found = 0;
    console.log(`  --- Navneliste (${names.length} haller) mot activities ---`);
    for (const name of names) {
        const key = hbNorm(name);
        let hit = index.get(key);
        if (!hit) {
            for (const [k, r] of index) {
                if (k.includes(key) || key.includes(k)) {
                    hit = r;
                    break;
                }
            }
        }
        if (hit) {
            found += 1;
            const sport = typeof hit.osm_tags?.sport === 'string' ? hit.osm_tags.sport : '(mangler)';
            console.log(`      ✔ ${name.padEnd(32)} → «${hit.venue_name ?? hit.title}»  sport=${sport}`);
        } else {
            console.log(`      ✘ ${name.padEnd(32)} ikke i activities`);
        }
    }
    const p = names.length ? ((found / names.length) * 100).toFixed(1) : '0.0';
    console.log(`  ALLEREDE HOS OSS: ${found}/${names.length} (${p} %) → så mange kan BERIKES i stedet for å importeres.`);
}

async function hbMain() {
    const argv = process.argv.slice(2);
    const argOf = (flag: string) => {
        const i = argv.indexOf(flag);
        return i !== -1 ? argv[i + 1] : null;
    };
    const cityArg = argOf('--city');
    const namesFile = argOf('--names');
    const skipDb = argv.includes('--skip-db');
    const cities = cityArg ? [cityArg] : HB_CITIES;

    let names = HB_SEED_NAMES;
    if (namesFile) {
        names = readFileSync(namesFile, 'utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
        console.log(`Navneliste: ${names.length} haller fra ${namesFile}`);
    } else {
        console.log(
            `Navneliste: ${names.length} eksempelnavn (INGEN --names oppgitt — ` +
                `navnematchingen er en stikkprøve, ikke et representativt tall).`
        );
    }
    console.log(`Speil: ${HB_ENDPOINTS.join(', ')}`);

    for (const city of cities) {
        const res = await hbProbeCity(city, names);
        if (res) hbReportNameMatchOsm(res, names);
        if (!skipDb) await hbReportDb(city, names);
    }

    console.log(
        `\nTolkning: lav «med sport-tag»-andel på leisure=sports_centre betyr at en ren ` +
            `tag-selektor (sport~handball) IKKE kan fange håndballhallene — da er valget ` +
            `beriking fra en annen kilde, ikke en ny OSM-selektor.`
    );
    console.log('OSM-data er ODbL: «© OpenStreetMap contributors» der de vises.');
}

hbMain().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
