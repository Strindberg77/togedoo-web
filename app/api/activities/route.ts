// app/api/activities/route.ts
// Leser aktiviteter fra datahub-lagringen (Supabase/Postgres) med
// koordinater. Støtter radius-søk (lat/lng/radius) via PostGIS-RPC-en
// activities_nearby, og flate filtre ellers.
//
// Fallback: hvis datahubben ikke er konfigurert ennå (Supabase-miljøvariabler
// mangler), svarer ruten som før med live-scraping, merket mode: "legacy",
// så eksisterende konsumenter ikke knekker før oppsettet er gjort.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../lib/supabase';
import { scrapeDeichman } from '../../../lib/deichman';
import { scrapeBergen } from '../../../lib/bergen';

interface ActivityRow {
    id: string;
    kind: string;
    title: string;
    description: string;
    category: string;
    target_audience: string;
    venue_name: string | null;
    address: string | null;
    municipality: string | null;
    near_city: string | null;
    lat: number | null;
    lng: number | null;
    starts_at: string | null;
    ends_at: string | null;
    is_free: boolean | null;
    price_text: string | null;
    url: string | null;
    image_url: string | null;
    opening_hours: string | null;
    osm_tags: Record<string, string> | null;
    is_indoor: boolean | null;
}

/** Kun http/https-URL-er slipper gjennom til appens webview — OSM-tagger
 *  er fri tekst og kan i verste fall inneholde hva som helst. */
function sanitizeWebsite(raw: string | null): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw.trim());
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch {
        // Vanlig OSM-slurv: «www.museum.no» uten skjema.
        try {
            const url = new URL(`https://${raw.trim()}`);
            if (url.hostname.includes('.')) return url.href;
        } catch {
            /* ugyldig — dropp */
        }
    }
    return null;
}

/** OSM-ens sport-tag på Ballbane er ofte semikolon-/komma-separert
 *  («basketball;soccer») eller «multi». Normaliseres til en liten liste med
 *  små bokstaver-tokens (['basketball','soccer'] | ['multi'] | []). Klienten
 *  tolker tokenene til fotball/basket-fasetten — API-et påstår ingen semantikk. */
function splitSports(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw
        .toLowerCase()
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function toApiShape(row: ActivityRow) {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        category: row.category,
        targetAudience: row.target_audience,
        venueName: row.venue_name,
        address: row.address,
        municipality: row.municipality,
        // «Hjemby» for nærliggende utflukter (utenfor kommunegrensen). Lar
        // klienten merke kortet med at stedet ligger i en annen kommune.
        nearCity: row.near_city,
        // Bydel/strøk (kort-redesign): finere enn kommune, skiller steder
        // innad i store byer. OSM legger dette i addr:suburb / addr:district
        // (city_district/neighbourhood som fallback). Egen kontekst-linje på
        // kortet — null når stedet ikke er merket med bydel.
        bydel:
            row.osm_tags?.['addr:suburb'] ??
            row.osm_tags?.['addr:district'] ??
            row.osm_tags?.['addr:city_district'] ??
            row.osm_tags?.['addr:neighbourhood'] ??
            null,
        lat: row.lat,
        lng: row.lng,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        isFree: row.is_free,
        // Inne/ute-egenskap (vinter-splitt): null = ukjent (utledes klient-side
        // fra kategori der den mangler).
        isIndoor: row.is_indoor,
        priceText: row.price_text,
        url: row.url,
        imageUrl: row.image_url,
        openingHours: row.opening_hours,
        // Utvalgte OSM-tagger med reell dekning (tag-proben jul. 2026:
        // surface 63,7 % / lit 27,2 % på Ballbane; website 64,4 % på
        // Museum). Rå osm_tags eksponeres bevisst aldri i sin helhet.
        surface: row.osm_tags?.surface ?? null,
        lit: row.osm_tags?.lit ?? null,
        // Ballsport-fasett (kun Ballbane har sport-tag). Normalisert token-liste;
        // klienten mapper soccer/basketball/multi → fotball/basket.
        sports: splitSports(row.osm_tags?.sport),
        website: sanitizeWebsite(
            row.osm_tags?.website ?? row.osm_tags?.['contact:website'] ?? null
        ),
    };
}

const ROW_COLUMNS =
    'id, kind, title, description, category, target_audience, venue_name, address, municipality, near_city, lat, lng, starts_at, ends_at, is_free, price_text, url, image_url, opening_hours, osm_tags, is_indoor';

async function fromDatabase(searchParams: URLSearchParams) {
    const db = supabaseAdmin();

    const lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : null;
    const lng = searchParams.get('lng') ? Number(searchParams.get('lng')) : null;
    const radius = Math.min(Number(searchParams.get('radius') ?? 10000) || 10000, 100000);
    const kind = searchParams.get('kind');
    // Kategori kan være komma-separert (flervalg) → liste. Verdiene
    // parameteriseres av .in()/p_categories, så ingen sanering nødvendig
    // (kategorinavn inneholder ikke komma). Én verdi ≡ tidligere .eq/p_category
    // → bakoverkompatibelt. Tom → null (intet kategorifilter).
    const categories = (searchParams.get('category') ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    const categoryList = categories.length > 0 ? categories : null;
    // By-modus matcher også near_city (kuraterte «nærliggende utflukter» som
    // ligger utenfor kommunegrensen, men hører til byens nærområde). Saneres
    // som q (kun bokstaver/tall/mellomrom/bindestrek) så den trygt kan
    // embeddes i .or().
    const municipality = (searchParams.get('municipality') ?? '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .slice(0, 50);
    const targetAudience = searchParams.get('targetAudience');
    const limit = Math.min(Number(searchParams.get('limit') ?? 200) || 200, 500);
    // Fritekstsøk: saner til kun bokstaver (inkl. æøå via \p{L}), tall,
    // mellomrom og bindestrek, maks 50 tegn. Det fjerner både ilike-wildcards
    // (%/_) og PostgREST .or()-metategn (,/()/*), så q kan embeddes trygt.
    const q = (searchParams.get('q') ?? '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .slice(0, 50);

    let rows: ActivityRow[];

    if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
        // Radius-søk i PostGIS, nærmest først.
        const { data, error } = await db.rpc('activities_nearby', {
            p_lat: lat,
            p_lng: lng,
            p_radius_m: radius,
            p_kind: kind,
            p_categories: categoryList,
            p_q: q || null,
            p_limit: limit,
        });
        if (error) throw new Error(error.message);
        rows = (data ?? []) as ActivityRow[];
        if (targetAudience) {
            rows = rows.filter(
                (r) => r.target_audience.toLowerCase() === targetAudience.toLowerCase()
            );
        }
    } else {
        let query = db
            .from('activities')
            .select(ROW_COLUMNS)
            .eq('status', 'published')
            .order('starts_at', { ascending: true, nullsFirst: false })
            .limit(limit);
        if (kind) query = query.eq('kind', kind);
        if (categoryList) query = query.in('category', categoryList);
        if (municipality) {
            // Ekte kommune ELLER hjemby-tilknytning (near_city). To .or()-kall
            // ANDes med q-blokken under, så (by ELLER near_city) OG (søk).
            query = query.or(
                `municipality.ilike.${municipality},near_city.ilike.${municipality}`
            );
        }
        if (targetAudience) query = query.ilike('target_audience', targetAudience);
        if (q) {
            // q er sanert over → trygt å embedde i .or(). PostgREST bruker *
            // som ilike-wildcard. category er med fordi kategorinavnet
            // («Ballbane», «Museum» …) er nettopp det brukeren skriver i
            // fritekst — uten den bommer «BALL» på navngitte baner.
            query = query.or(
                `title.ilike.*${q}*,description.ilike.*${q}*,` +
                    `venue_name.ilike.*${q}*,address.ilike.*${q}*,` +
                    `category.ilike.*${q}*`
            );
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        rows = (data ?? []) as unknown as ActivityRow[];
    }

    return NextResponse.json({
        success: true,
        mode: 'datahub',
        data: rows.map(toApiShape),
        count: rows.length,
        // ODbL-krav: steder (kind='place') kommer fra OpenStreetMap.
        attribution: 'Stedsdata © OpenStreetMap contributors (ODbL) — openstreetmap.org/copyright',
        timestamp: new Date().toISOString(),
    });
}

// Gammel oppførsel: live-scrape per request, uten koordinater. Fjernes når
// datahubben er i drift.
async function fromLegacyScrape(searchParams: URLSearchParams) {
    const municipality = searchParams.get('municipality') || undefined;
    const targetAudience = searchParams.get('targetAudience') || undefined;

    const [deichmanResult, bergenResult] = await Promise.all([
        scrapeDeichman({ targetAudience }),
        scrapeBergen(),
    ]);

    let allActivities = [
        ...(deichmanResult.data || []).map((event) => ({ ...event, source: 'deichman.no' })),
        ...(bergenResult.data || []).map((event) => ({ ...event, source: 'bergenbibliotek.no' })),
    ];

    if (municipality) {
        allActivities = allActivities.filter(
            (act) => act.municipality.toLowerCase() === municipality.toLowerCase()
        );
    }
    if (targetAudience) {
        allActivities = allActivities.filter(
            (act) => act.targetAudience.toLowerCase() === targetAudience.toLowerCase()
        );
    }

    return NextResponse.json({
        success: true,
        mode: 'legacy',
        data: allActivities,
        count: allActivities.length,
        timestamp: new Date().toISOString(),
    });
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        if (isDatahubConfigured()) {
            return await fromDatabase(searchParams);
        }
        return await fromLegacyScrape(searchParams);
    } catch (error) {
        console.error('[Activities API Error]:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch activities',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
