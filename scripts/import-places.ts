// scripts/import-places.ts
//
// Månedlig batch-import av faste steder (kind='place') fra OpenStreetMap
// via Overpass API, for de fem kategoriene bekreftet i dekningsundersøkelsen
// (jul. 2026): lekeplasser, ballbinger/baner, parker, idrettshaller,
// strender/badeplasser. Kjøres manuelt/periodisk — IKKE del av daglig cron.
//
//   npx tsx scripts/import-places.ts --dry-run          (rapport, ingen skriving)
//   npx tsx scripts/import-places.ts                    (full import, alle byer)
//   npx tsx scripts/import-places.ts --city=Oslo --limit=25
//
// Krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY i miljøet (unntatt
// --dry-run uten cache, som fungerer uten). Titler: OSM-navn når brukbart,
// ellers revers-geokodet "Lekeplass ved <gate>" (lib/places.ts).
// Rader med locked=true røres aldri (brukerrapport/manuell korrigering).
//
// ODbL-KRAV: der disse dataene vises, skal "© OpenStreetMap contributors"
// være synlig med lenke til openstreetmap.org/copyright.
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';
import { makePlaceTitleDetailed, isUsablePlaceName, TitleSource } from '../lib/places';

// Speilene kan overstyres via env (komma-separert) — nyttig for selvhostet
// Overpass og for å verifisere feilhåndteringen mot et test-endepunkt.
const OVERPASS_ENDPOINTS = (
    process.env.PLACES_OVERPASS_ENDPOINTS ??
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const UA = 'Togedoo datahub (hello@togedoo.com)';
const CITY_PAUSE_MS = 5000;
// 2b: ekte eksponentiell backoff mellom Overpass-forsøk (5s→15s→45s), brukt
// over TO runder på speilene (opptil ENDPOINTS.length × 2 forsøk per spørring).
// Overstyrbar via env (komma-separert ms) for testing/tuning.
const OVERPASS_BACKOFF_MS = (() => {
    const parsed = (process.env.PLACES_OVERPASS_BACKOFF_MS ?? '5000,15000,45000')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0);
    return parsed.length ? parsed : [5000, 15000, 45000];
})();
// 2a: kort høflighetspause mellom de per-kategori-spørringene innen én by.
const OVERPASS_QUERY_PAUSE_MS = 1000;
// Kartverket punktsøk svarte 502 under 100 ms-kadens og var treg (timeouts)
// ved 400 ms (jul. 2026). 900 ms default; overstyr med PLACES_PAUSE_MS for
// å eksperimentere uten kodeendring. Egen pause, uavhengig av Overpass.
const TITLE_PAUSE_MS = Number(process.env.PLACES_PAUSE_MS ?? 900);
const SOURCE_SLUG = 'osm-steder';
const DEFAULT_CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

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

// Rekkefølgen er match-prioritet (et element kategoriseres av første treff).
export const PLACE_CATEGORIES = [
    {
        // Først i match-prioritet: institusjonen vinner over evt. park-/
        // leisure-tagger på samme objekt. Tag-proben (jul. 2026, Oslo/
        // Bergen/Stavanger): 132 steder, 97 % navn, fee 62,1 %,
        // opening_hours 51,5 %, charge med kronebeløp 12,9 %.
        key: 'museum',
        label: 'Museum',
        category: 'Museum',
        audience: 'For alle',
        selector: 'nwr["tourism"="museum"](area.a);',
        matches: (t: OsmTags) => t.tourism === 'museum',
        isFree: false as boolean | null,
    },
    {
        // Rik OSM-dekning i de fire byene (Deichman, Bergen off. bibliotek,
        // Trondheim folkebibliotek, Sølvberget m/filialer). Nesten alle har
        // name-tag → få trenger geokodet tittel. access!=private siler bort
        // institusjons-/skolebibliotek. Gratis inngang.
        key: 'bibliotek',
        label: 'Bibliotek',
        category: 'Bibliotek',
        audience: 'For alle',
        selector: 'nwr["amenity"="library"]["access"!="private"](area.a);',
        matches: (t: OsmTags) => t.amenity === 'library',
        isFree: true,
    },
    {
        key: 'lekeplass',
        label: 'Lekeplass',
        category: 'Lekeplass',
        audience: 'Barn',
        selector: 'nwr["leisure"="playground"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'playground',
        isFree: true,
    },
    {
        key: 'ballbane',
        label: 'Ballbane',
        category: 'Ballbane',
        audience: 'For alle',
        selector: 'nwr["leisure"="pitch"]["sport"~"soccer|basketball|multi",i]["access"!="private"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'pitch',
        isFree: true,
    },
    {
        key: 'idrettshall',
        label: 'Idrettshall',
        category: 'Idrettshall',
        audience: 'For alle',
        selector: 'nwr["leisure"="sports_centre"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'sports_centre',
        isFree: null as boolean | null,
    },
    {
        key: 'badeplass',
        label: 'Badeplass',
        category: 'Badeplass',
        audience: 'For alle',
        selector: 'nwr["natural"="beach"](area.a);',
        matches: (t: OsmTags) => t.natural === 'beach',
        isFree: true,
    },
    {
        key: 'park',
        label: 'Park',
        category: 'Park',
        audience: 'For alle',
        selector: 'nwr["leisure"="park"](area.a);',
        matches: (t: OsmTags) => t.leisure === 'park',
        isFree: true,
    },
];

type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

// Forbigående server-/gateway-statuser verdt å prøve på nytt: 429 (rate limit),
// 502 (bad gateway — Overpass kan svare dette mellom forsøk under last) og
// 504 (gateway timeout). Andre statuser er faste feil retry ikke løser.
const OVERPASS_RETRY_STATUS = new Set([429, 502, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// Kjør ÉN Overpass-spørring med retry. 2b: to runder over speilene med ekte
/// eksponentiell backoff (5s→15s→45s) mellom forsøkene. 429/502/504 og
/// nettverks-/parse-feil er retrybare; annen HTTP-status (4xx/5xx) kastes
/// umiddelbart — det er en spørringsfeil retry ikke løser.
async function fetchOverpass(query: string, label: string): Promise<OsmElement[]> {
    const attempts = [...OVERPASS_ENDPOINTS, ...OVERPASS_ENDPOINTS];
    for (let i = 0; i < attempts.length; i++) {
        const endpoint = attempts[i];
        const isLast = i === attempts.length - 1;
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
                body: 'data=' + encodeURIComponent(query),
            });
            if (res.ok) {
                const json = await res.json();
                return (json.elements ?? []) as OsmElement[];
            }
            // Kun forbigående statuser (429/502/504) er verdt å prøve på nytt;
            // andre er faste feil.
            if (!OVERPASS_RETRY_STATUS.has(res.status)) {
                throw new Error(`Overpass HTTP ${res.status} (${label})`);
            }
            console.log(`    ${label}: ${endpoint} svarte ${res.status} (forsøk ${i + 1}/${attempts.length})`);
        } catch (err) {
            // Ikke-retrybar HTTP-feil kastes videre; nettverks-/parse-feil retryes.
            if (err instanceof Error && err.message.startsWith('Overpass HTTP')) throw err;
            console.log(`    ${label}: ${endpoint} feilet (${err instanceof Error ? err.message : err}) (forsøk ${i + 1}/${attempts.length})`);
        }
        if (!isLast) {
            await sleep(OVERPASS_BACKOFF_MS[Math.min(i, OVERPASS_BACKOFF_MS.length - 1)]);
        }
    }
    throw new Error(`Alle Overpass-forsøk feilet for ${label}`);
}

/// 2a: én spørring PER kategori i stedet for én kombinert. Hver delspørring
/// (område + én selektor) er langt lettere enn område + syv selektorer, så den
/// holder seg godt under gateway-timeouten — særlig for Trondheims tunge
/// sammensatte kommunegrense. Resultatene slås sammen og dedupes på
/// type/id; første kategori som treffer et element vinner (samme match-
/// prioritet som før, siden PLACE_CATEGORIES itereres i rekkefølge).
async function overpassCity(
    city: string,
    cats: PlaceCategory[] = PLACE_CATEGORIES
): Promise<OsmElement[]> {
    const seen = new Set<string>();
    const all: OsmElement[] = [];
    for (const cat of cats) {
        const query = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;
(
  ${cat.selector}
);
out center tags;`;
        const elements = await fetchOverpass(query, `${city}/${cat.key}`);
        let added = 0;
        for (const el of elements) {
            const id = `${el.type}/${el.id}`;
            if (seen.has(id)) continue;
            seen.add(id);
            all.push(el);
            added += 1;
        }
        console.log(`  ${city}/${cat.key.padEnd(11)} ${String(elements.length).padStart(4)} elementer (${added} nye)`);
        await sleep(OVERPASS_QUERY_PAUSE_MS);
    }
    return all;
}

function coords(el: OsmElement): { lat: number; lng: number } | null {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

export interface ImportRow {
    external_id: string;
    kind: 'place';
    title: string;
    description: string;
    category: string;
    target_audience: string;
    venue_name: string | null;
    address: string | null;
    municipality: string;
    lat: number;
    lng: number;
    opening_hours: string | null;
    is_free: boolean | null;
    price_text: string | null;
    url: string;
    // Alle rå OSM-tagger (migrasjon 0008). API-et plukker visningsfelter
    // herfra (surface/lit i første omgang, jf. tag-proben jul. 2026) —
    // nye visningsfelter senere krever da ingen ny import-runde.
    osm_tags: OsmTags;
    status: 'published';
    // Kun rapportering, fjernes før upsert:
    titleSource: TitleSource;
    geocodeError?: string;
    osmName: string | null;
}

export async function buildRows(
    city: string,
    elements: OsmElement[],
    limit: number,
    cats: PlaceCategory[] = PLACE_CATEGORIES
): Promise<ImportRow[]> {
    // Første pass: velg elementer (kategori + koordinater + limit), så vi
    // vet totalt geokodingsbehov før vi starter — gir ekte fremdriftslinje.
    const selected: { el: OsmElement; cat: (typeof PLACE_CATEGORIES)[number]; pos: { lat: number; lng: number } }[] = [];
    const perCategory = new Map<string, number>();
    for (const el of elements) {
        const tags = el.tags ?? {};
        const cat = cats.find((c) => c.matches(tags));
        const pos = coords(el);
        if (!cat || !pos) continue;
        if ((perCategory.get(cat.key) ?? 0) >= limit) continue;
        perCategory.set(cat.key, (perCategory.get(cat.key) ?? 0) + 1);
        selected.push({ el, cat, pos });
    }
    const needGeocoding = selected.filter(({ el }) => !isUsablePlaceName(el.tags?.name)).length;
    console.log(`  ${selected.length} steder valgt, ${needGeocoding} trenger geokodet tittel`);

    const rows: ImportRow[] = [];
    let geocoded = 0;
    for (const { el, cat, pos } of selected) {
        const tags = el.tags ?? {};
        const usableName = isUsablePlaceName(tags.name);
        if (!usableName) {
            geocoded += 1;
            console.log(`  geokoder ${el.type}/${el.id} (${geocoded}/${needGeocoding})...`);
        }
        const titled = await makePlaceTitleDetailed(cat.label, tags.name ?? null, pos.lat, pos.lng);
        if (!usableName) await sleep(TITLE_PAUSE_MS); // punktsøk-høflighet ved cache-miss

        const addrStreet = tags['addr:street']
            ? `${tags['addr:street']}${tags['addr:housenumber'] ? ' ' + tags['addr:housenumber'] : ''}`
            : null;

        rows.push({
            external_id: `${el.type}/${el.id}`,
            kind: 'place',
            title: titled.title,
            description: tags.description ?? '',
            category: cat.category,
            target_audience: cat.audience,
            venue_name: usableName ? tags.name!.trim() : null,
            address: addrStreet,
            municipality: city,
            lat: pos.lat,
            lng: pos.lng,
            opening_hours: tags.opening_hours ?? null,
            is_free: tags.fee === 'yes' ? false : tags.fee === 'no' ? true : cat.isFree,
            price_text: tags.charge
                ? tags.charge.replace(/\bNOK\b/g, 'kr').trim().slice(0, 100) || null
                : null,
            url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
            osm_tags: tags,
            status: 'published',
            titleSource: titled.source,
            geocodeError: titled.geocodeError,
            osmName: tags.name ?? null,
        });
    }
    return rows;
}

async function importCity(
    city: string,
    dryRun: boolean,
    limit: number,
    cats: PlaceCategory[] = PLACE_CATEGORIES
) {
    console.log(`\n=== ${city} ===`);
    const elements = await overpassCity(city, cats);
    console.log(`  Overpass ga ${elements.length} elementer`);
    const rows = await buildRows(city, elements, limit, cats);

    // Vaktbikkje + tittelkilde-fordeling per kategori. 'kun-kategori' med
    // geocodeError betyr at revers-geokodingen FEILET — ikke at adressen mangler.
    for (const cat of cats) {
        const catRows = rows.filter((r) => r.category === cat.category);
        const bySource = (s: TitleSource) => catRows.filter((r) => r.titleSource === s).length;
        const failed = catRows.filter((r) => r.geocodeError).length;
        console.log(
            `  ${cat.category.padEnd(12)} ${String(catRows.length).padStart(5)} steder — titler: ` +
                `${bySource('osm-navn')} OSM-navn, ${bySource('ved-gate')} «ved gate», ` +
                `${bySource('i-poststed')} «i poststed», ${bySource('kun-kategori')} kun kategori` +
                (failed ? ` (HERAV ${failed} GEOKODINGSFEIL)` : '')
        );
        if (catRows.length === 0) console.log(`    ADVARSEL: 0 treff for ${cat.category} i ${city} — sjekk tag-endring i OSM.`);
        // Konkrete eksempler der name-taggen manglet/ble silt:
        for (const r of catRows.filter((x) => x.titleSource !== 'osm-navn').slice(0, 3)) {
            console.log(`    ${r.external_id}: name=${JSON.stringify(r.osmName)} -> "${r.title}" [${r.titleSource}]`);
        }
    }
    const errors = rows.filter((r) => r.geocodeError);
    if (errors.length) {
        const reasons = new Map<string, number>();
        errors.forEach((r) => reasons.set(r.geocodeError!, (reasons.get(r.geocodeError!) ?? 0) + 1));
        console.log(`  GEOKODINGSFEIL (${errors.length} steder):`);
        for (const [reason, n] of reasons) console.log(`    ${n} × ${reason}`);
    }

    if (dryRun) {
        console.log(`  [dry-run] Ingen databaseskriving. Revers-geokoding KJØRES (uten cache hvis Supabase-env mangler).`);
        console.log(`  [dry-run] ${rows.length} rader klare.`);
        return rows.length;
    }

    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');
    const db = supabaseAdmin();
    const { data: source, error: sourceError } = await db
        .from('sources')
        .select('id')
        .eq('slug', SOURCE_SLUG)
        .maybeSingle();
    if (sourceError || !source) throw new Error(`Kilden ${SOURCE_SLUG} mangler (kjør migrasjon 0005).`);

    // Rader låst av brukerrapporter/manuell korrigering skal aldri røres.
    const { data: lockedRows, error: lockedError } = await db
        .from('activities')
        .select('external_id')
        .eq('source_id', source.id)
        .eq('locked', true);
    if (lockedError) throw new Error(`Oppslag av låste rader feilet: ${lockedError.message}`);
    const locked = new Set((lockedRows ?? []).map((r) => r.external_id));

    const writable = rows.filter((r) => !locked.has(r.external_id));
    if (locked.size) console.log(`  Hopper over ${rows.length - writable.length} låste rader.`);

    for (let i = 0; i < writable.length; i += 500) {
        const chunk = writable
            .slice(i, i + 500)
            .map(({ titleSource: _ts, geocodeError: _ge, osmName: _on, ...row }) => ({
                ...row,
                source_id: source.id,
            }));
        const { error } = await db.from('activities').upsert(chunk, { onConflict: 'source_id,external_id' });
        if (error) throw new Error(`Upsert feilet (${city}, chunk ${i / 500}): ${error.message}`);
    }
    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${writable.length} steder (${city})` })
        .eq('id', source.id);
    console.log(`  Skrev ${writable.length} rader.`);
    return writable.length;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const cityArg = args.find((a) => a.startsWith('--city='))?.split('=')[1];
    const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity) || Infinity;
    const cities = cityArg ? [cityArg] : DEFAULT_CITIES;

    // --category=<key>[,<key>] kjører kun de valgte kategoriene, så et enkelt
    // feilende punkt (f.eks. den tunge «lekeplass»-selektoren) kan fylles inn
    // uten å hente hele byen på nytt. Sammen med --city=<by> gir det ett
    // presist by+kategori-kall.
    const catArg = args.find((a) => a.startsWith('--category='))?.split('=')[1];
    let cats: PlaceCategory[] = PLACE_CATEGORIES;
    if (catArg) {
        const wanted = catArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        cats = PLACE_CATEGORIES.filter((c) => wanted.includes(c.key));
        const found = new Set(cats.map((c) => c.key));
        const missing = wanted.filter((w) => !found.has(w));
        if (missing.length) {
            console.error(
                `Ukjent kategori: ${missing.join(', ')}. Gyldige: ${PLACE_CATEGORIES.map((c) => c.key).join(', ')}`
            );
            process.exit(1);
        }
    }

    console.log(`Import av faste steder: ${cities.join(', ')}${dryRun ? ' [DRY-RUN]' : ''}${limit !== Infinity ? ` [limit=${limit}/kategori]` : ''}${catArg ? ` [kategori=${cats.map((c) => c.key).join(',')}]` : ''}`);
    let total = 0;
    // Feiltoleranse per by: én bys feil (f.eks. konsekvent Overpass-504 for
    // Trondheim) skal IKKE avbryte hele kjøringen — de øvrige byene fullføres
    // og skrives, og de feilede oppsummeres til slutt med exit-kode 1.
    const failed: { city: string; error: string }[] = [];
    for (const city of cities) {
        try {
            total += await importCity(city, dryRun, limit, cats);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ✗ ${city} FEILET — hoppes over, fortsetter til neste by: ${msg}`);
            failed.push({ city, error: msg });
        }
        if (city !== cities[cities.length - 1]) await sleep(CITY_PAUSE_MS);
    }
    const okCount = cities.length - failed.length;
    console.log(`\nFerdig: ${total} steder ${dryRun ? 'klare (ingenting skrevet)' : 'importert'} — ${okCount}/${cities.length} byer gikk gjennom.`);
    if (failed.length) {
        console.log(`\nFEILEDE BYER (${failed.length}):`);
        for (const f of failed) console.log(`  ✗ ${f.city}: ${f.error}`);
        // Delvis feil: de vellykkede byene er skrevet, men signaliser til
        // operatør/CI at minst én by mangler ved å avslutte med kode 1.
        process.exitCode = 1;
    }
    console.log('Husk ODbL-attribusjon der dataene vises: «© OpenStreetMap contributors».');
}

const isDirectRun = process.argv[1]?.endsWith('import-places.ts');
if (isDirectRun) {
    main().catch((e) => {
        console.error('Import feilet:', e);
        process.exit(1);
    });
}
