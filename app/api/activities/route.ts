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
    lat: number | null;
    lng: number | null;
    starts_at: string | null;
    ends_at: string | null;
    is_free: boolean | null;
    price_text: string | null;
    url: string | null;
    image_url: string | null;
    opening_hours: string | null;
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
        lat: row.lat,
        lng: row.lng,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        isFree: row.is_free,
        priceText: row.price_text,
        url: row.url,
        imageUrl: row.image_url,
        openingHours: row.opening_hours,
    };
}

const ROW_COLUMNS =
    'id, kind, title, description, category, target_audience, venue_name, address, municipality, lat, lng, starts_at, ends_at, is_free, price_text, url, image_url, opening_hours';

async function fromDatabase(searchParams: URLSearchParams) {
    const db = supabaseAdmin();

    const lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : null;
    const lng = searchParams.get('lng') ? Number(searchParams.get('lng')) : null;
    const radius = Math.min(Number(searchParams.get('radius') ?? 10000) || 10000, 100000);
    const kind = searchParams.get('kind');
    const category = searchParams.get('category');
    const municipality = searchParams.get('municipality');
    const targetAudience = searchParams.get('targetAudience');
    const limit = Math.min(Number(searchParams.get('limit') ?? 200) || 200, 500);

    let rows: ActivityRow[];

    if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
        // Radius-søk i PostGIS, nærmest først.
        const { data, error } = await db.rpc('activities_nearby', {
            p_lat: lat,
            p_lng: lng,
            p_radius_m: radius,
            p_kind: kind,
            p_category: category,
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
        if (category) query = query.eq('category', category);
        if (municipality) query = query.ilike('municipality', municipality);
        if (targetAudience) query = query.ilike('target_audience', targetAudience);
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
