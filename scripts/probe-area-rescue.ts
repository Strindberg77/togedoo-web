// scripts/probe-area-rescue.ts
//
// READ-ONLY PROBE — måler potensialet for å berike navnløse steder med
// områdenavn (bydel/nabolag). Skriver INGENTING til databasen og endrer
// INGEN import-titler. Den henter data, gjør oppslag og skriver en rapport.
//
// Bakgrunn: import-pipelinen (lib/places.ts) titulerer et sted slik:
//   1. OSM-navn (hvis brukbart)                        → 'osm-navn'
//   2. Kartverket adresse-punktsøk r=200 → gate        → 'ved-gate'  «Lekeplass ved Storgata»
//   3. samme treff har poststed                        → 'i-poststed' «Badeplass i Vollen»
//   4. ingen adresse innen 200 m                        → 'kun-kategori' «Lekeplass»  ← problemet
//
// Denne proben tar et REPRESENTATIVT (tilfeldig) utvalg NAVNLØSE steder per by
// og kategori, reproduserer nøyaktig steg 2/3 (Kartverket adresse-punktsøk r=200)
// for å finne hvilke som i dag havner på 'kun-kategori', og kjører DERETTER et
// Nominatim revers-oppslag på nettopp de 'kun-kategori'-stedene for å måle hva
// et OMRÅDE-lag (foreslått «i-omraade»-tier) faktisk ville gitt dem:
//
//   fikk-bydel     → Nominatim ga suburb/bydel/nabolag → «<Kategori> i <bydel>»   (rescue)
//   fikk-gate      → ingen bydel, men Nominatim ga en gate → «<Kategori> ved <gate>» (rescue)
//   fikk-ingenting → verken bydel eller gate                                        (ikke rescue)
//
// «rescue rate» per by/kategori = (fikk-bydel + fikk-gate) / antall kun-kategori.
//
// Kjør LOKALT (Nominatim/Overpass/Kartverket må være nåbare):
//   npx tsx scripts/probe-area-rescue.ts
//   npx tsx scripts/probe-area-rescue.ts --city=Oslo --category=badeplass,park --sample=20
//   npx tsx scripts/probe-area-rescue.ts --city=Bergen --sample=10 --pause-ms=1200
//
// Flagg:
//   --city=<By>[,<By>]        default: Oslo, Bergen, Trondheim, Stavanger
//   --category=<key>[,<key>]  default: alle (museum,bibliotek,lekeplass,ballbane,idrettshall,badeplass,park)
//   --sample=<n>              tilfeldig utvalg navnløse steder per by/kategori (default 15; 0 = alle)
//   --radius=<m>              Kartverket adresse-radius, matcher prod (default 200)
//   --zoom=<n>               Nominatim revers-zoom (default 16)
//   --pause-ms=<ms>          pause mellom ALLE eksterne kall (default 1100; Nominatim krever ≥1 req/s)
//   --seed=<n>               deterministisk utvalg (valgfritt; utelatt = ekte tilfeldig)
//
// INGEN Supabase-env kreves — scriptet importerer kun rene hjelpere
// (PLACE_CATEGORIES, isUsablePlaceName) og gjør ingen DB-kall.
import { PLACE_CATEGORIES } from './import-places';
import { isUsablePlaceName } from '../lib/places';

const UA = 'Togedoo datahub area-rescue probe (hello@togedoo.com)';
const OVERPASS_ENDPOINTS = (
    process.env.PLACES_OVERPASS_ENDPOINTS ??
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const DEFAULT_CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OsmTags {
    [key: string]: string | undefined;
}
interface OsmElement {
    type: 'node' | 'way' | 'relation';
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: OsmTags;
}

// -- Args -------------------------------------------------------------------
function arg(name: string): string | undefined {
    return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}
const cityArg = arg('city');
const catArg = arg('category');
const SAMPLE = Number(arg('sample') ?? 15); // 0 = alle
const RADIUS = Number(arg('radius') ?? 200);
const ZOOM = Number(arg('zoom') ?? 16);
const PAUSE_MS = Number(arg('pause-ms') ?? 1100);
const SEED = arg('seed') !== undefined ? Number(arg('seed')) : undefined;

const cities = cityArg ? cityArg.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_CITIES;
let cats = PLACE_CATEGORIES;
if (catArg) {
    const wanted = catArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    cats = PLACE_CATEGORIES.filter((c) => wanted.includes(c.key));
    const missing = wanted.filter((w) => !PLACE_CATEGORIES.some((c) => c.key === w));
    if (missing.length) {
        console.error(`Ukjent kategori: ${missing.join(', ')}. Gyldige: ${PLACE_CATEGORIES.map((c) => c.key).join(', ')}`);
        process.exit(1);
    }
}

// Deterministisk PRNG (mulberry32) når --seed er gitt, ellers Math.random.
function makeRng(seed?: number): () => number {
    if (seed === undefined) return Math.random;
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffle<T>(arr: T[], rng: () => number): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// -- Overpass (les-only, samme områdespørring som import) -------------------
async function fetchOverpass(query: string, label: string): Promise<OsmElement[]> {
    const attempts = [...OVERPASS_ENDPOINTS, ...OVERPASS_ENDPOINTS];
    for (let i = 0; i < attempts.length; i++) {
        try {
            const res = await fetch(attempts[i], {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
                body: 'data=' + encodeURIComponent(query),
            });
            if (res.ok) {
                const json = await res.json();
                return (json.elements ?? []) as OsmElement[];
            }
            if (![429, 502, 504].includes(res.status)) throw new Error(`Overpass HTTP ${res.status} (${label})`);
            console.log(`    ${label}: ${attempts[i]} svarte ${res.status} (forsøk ${i + 1}/${attempts.length})`);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('Overpass HTTP')) throw err;
            console.log(`    ${label}: ${attempts[i]} feilet (${err instanceof Error ? err.message : err})`);
        }
        if (i < attempts.length - 1) await sleep(3000 * (i + 1));
    }
    throw new Error(`Alle Overpass-forsøk feilet for ${label}`);
}

function coords(el: OsmElement): { lat: number; lng: number } | null {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

// -- Kartverket adresse-punktsøk (reproduserer prod steg 2/3) ---------------
// Egen, inline implementasjon UTEN cache-skriving (lib/places.ts sin variant
// skriver til geocode_cache — den unngår vi her for å garantere read-only).
function stripHouseNumber(addressText: string): string {
    return addressText.replace(/\s+\d+\s*[A-ZÆØÅ]?$/, '').trim();
}
type KvOutcome =
    | { kind: 'ved-gate'; street: string }
    | { kind: 'i-poststed'; poststed: string }
    | { kind: 'kun-kategori' }
    | { kind: 'feil'; reason: string };

async function kartverketAddress(lat: number, lng: number): Promise<KvOutcome> {
    const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        radius: String(RADIUS),
        treffPerSide: '1',
    });
    try {
        const res = await fetch(`https://ws.geonorge.no/adresser/v1/punktsok?${params}`, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { kind: 'feil', reason: `HTTP ${res.status}` };
        const data = await res.json();
        const hit = data?.adresser?.[0];
        if (!hit?.adressetekst) return { kind: 'kun-kategori' };
        const street = stripHouseNumber(hit.adressetekst);
        if (street && !/^\d+\s*[A-ZÆØÅ]?$/.test(street)) return { kind: 'ved-gate', street };
        if (hit.poststed) return { kind: 'i-poststed', poststed: hit.poststed };
        return { kind: 'kun-kategori' };
    } catch (err) {
        return { kind: 'feil', reason: err instanceof Error ? err.name : String(err) };
    }
}

// -- Nominatim revers (det foreslåtte område-laget) -------------------------
interface NominatimAddress {
    road?: string;
    pedestrian?: string;
    footway?: string;
    suburb?: string;
    city_district?: string;
    borough?: string;
    quarter?: string;
    neighbourhood?: string;
    [key: string]: string | undefined;
}
interface NominatimResult {
    street: string | null; // gate fra OSM (road/pedestrian)
    bydel: string | null; // suburb/bydel/nabolag
    raw: NominatimAddress | null;
}
async function nominatimReverse(lat: number, lng: number): Promise<NominatimResult> {
    const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
        zoom: String(ZOOM),
        addressdetails: '1',
    });
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { street: null, bydel: null, raw: null };
        const data = await res.json();
        const a: NominatimAddress = data?.address ?? {};
        const street = a.road ?? a.pedestrian ?? a.footway ?? null;
        // Områdenavn i prioritert rekkefølge (bydel er mest presist i de fire
        // storbyene; nabolag/quarter er finere oppdeling).
        const bydel =
            a.suburb ?? a.city_district ?? a.borough ?? a.quarter ?? a.neighbourhood ?? null;
        return { street, bydel, raw: a };
    } catch {
        return { street: null, bydel: null, raw: null };
    }
}

// -- Aggregering ------------------------------------------------------------
interface Bucket {
    namelessTotal: number; // navnløse i utvalget (etter isUsablePlaceName-filter)
    vedGate: number; // nåværende utfall (Kartverket)
    iPoststed: number;
    kunKategori: number;
    kvFeil: number;
    // Nominatim-utfall PÅ kun-kategori-delmengden:
    fikkBydel: number;
    fikkGate: number;
    fikkIngenting: number;
    examples: string[];
}
function newBucket(): Bucket {
    return {
        namelessTotal: 0,
        vedGate: 0,
        iPoststed: 0,
        kunKategori: 0,
        kvFeil: 0,
        fikkBydel: 0,
        fikkGate: 0,
        fikkIngenting: 0,
        examples: [],
    };
}
function pct(n: number, d: number): string {
    return d === 0 ? '—' : `${Math.round((100 * n) / d)}%`;
}

async function main() {
    const rng = makeRng(SEED);
    console.log(
        `AREA-RESCUE PROBE (read-only, ingen DB-skriving)\n` +
            `byer: ${cities.join(', ')}\n` +
            `kategorier: ${cats.map((c) => c.key).join(', ')}\n` +
            `utvalg/kategori: ${SAMPLE === 0 ? 'alle' : SAMPLE} (tilfeldig${SEED !== undefined ? `, seed=${SEED}` : ''}), ` +
            `Kartverket-radius: ${RADIUS} m, Nominatim-zoom: ${ZOOM}, pause: ${PAUSE_MS} ms\n`
    );

    const perCity = new Map<string, Bucket>();
    const perCityCat = new Map<string, Bucket>();
    const grand = newBucket();

    for (const city of cities) {
        console.log(`\n=== ${city} ===`);
        const cityBucket = newBucket();
        perCity.set(city, cityBucket);

        for (const cat of cats) {
            const query = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;
(
  ${cat.selector}
);
out center tags;`;
            let elements: OsmElement[];
            try {
                elements = await fetchOverpass(query, `${city}/${cat.key}`);
            } catch (err) {
                console.log(`  ${city}/${cat.key}: Overpass FEILET (${err instanceof Error ? err.message : err}) — hoppes over`);
                continue;
            }
            await sleep(PAUSE_MS);

            // Kun navnløse steder (de som ville trengt geokodet tittel) med koordinater.
            const nameless = elements
                .filter((el) => coords(el) && !isUsablePlaceName(el.tags?.name))
                .map((el) => ({ el, pos: coords(el)! }));
            const sample = SAMPLE === 0 ? shuffle(nameless, rng) : shuffle(nameless, rng).slice(0, SAMPLE);

            const b = newBucket();
            perCityCat.set(`${city}/${cat.category}`, b);
            b.namelessTotal = sample.length;

            for (const { el, pos } of sample) {
                const kv = await kartverketAddress(pos.lat, pos.lng);
                await sleep(PAUSE_MS);
                if (kv.kind === 'ved-gate') b.vedGate++;
                else if (kv.kind === 'i-poststed') b.iPoststed++;
                else if (kv.kind === 'feil') b.kvFeil++;
                else {
                    // kun-kategori → mål hva område-laget (Nominatim) ville gitt.
                    b.kunKategori++;
                    const n = await nominatimReverse(pos.lat, pos.lng);
                    await sleep(PAUSE_MS);
                    if (n.bydel) {
                        b.fikkBydel++;
                        if (b.examples.length < 3) b.examples.push(`${el.type}/${el.id} → "${cat.label} i ${n.bydel}" [bydel]`);
                    } else if (n.street) {
                        b.fikkGate++;
                        if (b.examples.length < 3) b.examples.push(`${el.type}/${el.id} → "${cat.label} ved ${n.street}" [gate]`);
                    } else {
                        b.fikkIngenting++;
                        if (b.examples.length < 3) b.examples.push(`${el.type}/${el.id} → (ingenting) coords=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`);
                    }
                }
            }

            // Rull opp i by- og totalsummer.
            for (const agg of [cityBucket, grand]) {
                agg.namelessTotal += b.namelessTotal;
                agg.vedGate += b.vedGate;
                agg.iPoststed += b.iPoststed;
                agg.kunKategori += b.kunKategori;
                agg.kvFeil += b.kvFeil;
                agg.fikkBydel += b.fikkBydel;
                agg.fikkGate += b.fikkGate;
                agg.fikkIngenting += b.fikkIngenting;
            }

            const rescued = b.fikkBydel + b.fikkGate;
            console.log(
                `  ${cat.category.padEnd(12)} utvalg=${String(b.namelessTotal).padStart(3)} navnløse` +
                    ` → nå: ${b.vedGate} ved-gate, ${b.iPoststed} i-poststed, ${b.kunKategori} kun-kategori` +
                    (b.kvFeil ? `, ${b.kvFeil} kv-feil` : '')
            );
            if (b.kunKategori > 0) {
                console.log(
                    `    kun-kategori (${b.kunKategori}) via Nominatim: ` +
                        `${b.fikkBydel} fikk-bydel, ${b.fikkGate} fikk-gate, ${b.fikkIngenting} fikk-ingenting` +
                        ` → RESCUE ${pct(rescued, b.kunKategori)} (bydel ${pct(b.fikkBydel, b.kunKategori)})`
                );
                for (const ex of b.examples) console.log(`      ${ex}`);
            }
        }

        const cr = cityBucket.fikkBydel + cityBucket.fikkGate;
        console.log(
            `  — ${city} totalt: ${cityBucket.kunKategori} kun-kategori av ${cityBucket.namelessTotal} navnløse` +
                ` → rescue ${pct(cr, cityBucket.kunKategori)} (bydel ${pct(cityBucket.fikkBydel, cityBucket.kunKategori)})`
        );
    }

    const gr = grand.fikkBydel + grand.fikkGate;
    console.log(`\n================ SAMLET ================`);
    console.log(`Navnløse i utvalget:      ${grand.namelessTotal}`);
    console.log(`  ved-gate (Kartverket):  ${grand.vedGate}`);
    console.log(`  i-poststed:             ${grand.iPoststed}`);
    console.log(`  kun-kategori:           ${grand.kunKategori}` + (grand.kvFeil ? `  (+${grand.kvFeil} kv-feil)` : ''));
    console.log(`kun-kategori via Nominatim (område-laget):`);
    console.log(`  fikk-bydel:             ${grand.fikkBydel}  (${pct(grand.fikkBydel, grand.kunKategori)})`);
    console.log(`  fikk-gate:              ${grand.fikkGate}  (${pct(grand.fikkGate, grand.kunKategori)})`);
    console.log(`  fikk-ingenting:         ${grand.fikkIngenting}  (${pct(grand.fikkIngenting, grand.kunKategori)})`);
    console.log(`  >>> RESCUE RATE:        ${pct(gr, grand.kunKategori)} av kun-kategori-stedene ville fått områdekontekst`);
    console.log(`\nTolkning: høy «fikk-bydel» = et «i-omraade»-tier (Nominatim suburb/bydel) er verdt å bygge.`);
    console.log(`Mange «fikk-gate» = OSM har gater Kartverket-adresseregisteret mangler (alternativ vei til «ved-gate»).`);
    console.log(`Mange «fikk-ingenting» = ekte kanttilfeller (vann/øyer) uten områdedata — forblir bare kategori.`);
    console.log(`\nINGEN databaseskriving utført. INGEN import-titler endret.`);
}

main().catch((e) => {
    console.error('Probe feilet:', e);
    process.exit(1);
});
