// app/api/places/submit/route.ts
// Brukertips om nye steder fra /tips. Geokodes server-side og lagres som
// kind='place', status='pending' på kilden bruker-tips — modereres med
// eksisterende admin-API før det blir synlig.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { validatePlaceTip } from '../../../../lib/places';
import { geocode } from '../../../../lib/geocode';
import { haversineMeters } from '../../../../lib/reports';

const TIP_SOURCE_SLUG = 'bruker-tips';

// To uavhengige pending-tips innen denne radiusen med samme kategori er et
// sterkt ekthetssignal: begge flagges high_trust og løftes øverst i
// admin-køen (/api/admin/pending). Bevisst ingen autopublisering i fase 1 —
// brukergenerert tekst/bilde skal fortsatt ses av et menneske før visning.
const TIP_DUPLICATE_RADIUS_M = 75;

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const recentByIp = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const timestamps = (recentByIp.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (timestamps.length >= RATE_LIMIT) {
        recentByIp.set(ip, timestamps);
        return true;
    }
    timestamps.push(now);
    recentByIp.set(ip, timestamps);
    return false;
}

export async function POST(request: NextRequest) {
    try {
        if (!isDatahubConfigured()) {
            return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
        }
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'ukjent';
        if (isRateLimited(ip)) {
            return NextResponse.json(
                { success: false, error: 'For mange innsendinger. Prøv igjen om en time.' },
                { status: 429 }
            );
        }

        const body = await request.json().catch(() => null);
        const { tip, errors } = validatePlaceTip(body);
        if (!tip) return NextResponse.json({ success: false, errors }, { status: 400 });

        const db = supabaseAdmin();
        const { data: source, error: sourceError } = await db
            .from('sources')
            .select('id, active')
            .eq('slug', TIP_SOURCE_SLUG)
            .maybeSingle();
        if (sourceError) throw new Error(`Oppslag mot sources feilet: ${sourceError.message}`);
        if (!source || !source.active) {
            throw new Error(`Kilden ${TIP_SOURCE_SLUG} mangler eller er deaktivert (kjør migrasjon 0006).`);
        }

        const geo = await geocode(tip.address || tip.title, tip.municipality);

        // Uavhengig bekreftelse: finnes det allerede et pending-tips med
        // samme kategori innen ~75 m? Grovsil med bounding-boks på lat/lng
        // (pending-rader nås ikke av activities_nearby-RPC-en, som kun ser
        // published), presis avstand med haversine.
        let highTrust = false;
        if (geo) {
            const latDelta = TIP_DUPLICATE_RADIUS_M / 111_320;
            const lngDelta =
                TIP_DUPLICATE_RADIUS_M / (111_320 * Math.max(0.1, Math.cos((geo.lat * Math.PI) / 180)));
            const { data: nearby, error: nearbyError } = await db
                .from('activities')
                .select('id, lat, lng')
                .eq('kind', 'place')
                .eq('status', 'pending')
                .eq('category', tip.category)
                .gte('lat', geo.lat - latDelta)
                .lte('lat', geo.lat + latDelta)
                .gte('lng', geo.lng - lngDelta)
                .lte('lng', geo.lng + lngDelta)
                .limit(20);
            if (nearbyError) throw new Error(nearbyError.message);
            const confirming = (nearby ?? []).filter(
                (p) =>
                    p.lat !== null &&
                    p.lng !== null &&
                    haversineMeters(geo.lat, geo.lng, p.lat, p.lng) <= TIP_DUPLICATE_RADIUS_M
            );
            if (confirming.length > 0) {
                highTrust = true;
                const { error: flagError } = await db
                    .from('activities')
                    .update({ high_trust: true })
                    .in('id', confirming.map((p) => p.id));
                if (flagError) throw new Error(flagError.message);
            }
        }

        const { error: insertError } = await db.from('activities').insert({
            source_id: source.id,
            external_id: `tips-${crypto.randomUUID()}`,
            kind: 'place',
            title: tip.title,
            description: tip.description,
            category: tip.category,
            target_audience: 'For alle',
            venue_name: tip.title,
            address: tip.address,
            municipality: tip.municipality,
            lat: geo?.lat ?? null,
            lng: geo?.lng ?? null,
            is_free: true,
            image_url: tip.imageUrl,
            contact_email: tip.contactEmail,
            status: 'pending',
            high_trust: highTrust,
        });
        if (insertError) throw new Error(insertError.message);

        return NextResponse.json({
            success: true,
            geocoded: !!geo,
            highTrust,
            message: 'Takk for tipset! Stedet blir synlig i Togedoo etter en rask gjennomgang.',
        });
    } catch (error) {
        console.error('[Place Tip Error]:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Innsendingen feilet.',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
