// app/api/places/submit/route.ts
// Brukertips om nye steder fra /tips. Geokodes server-side og lagres som
// kind='place', status='pending' på kilden bruker-tips — modereres med
// eksisterende admin-API før det blir synlig.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { validatePlaceTip } from '../../../../lib/places';
import { geocode } from '../../../../lib/geocode';

const TIP_SOURCE_SLUG = 'bruker-tips';

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
        });
        if (insertError) throw new Error(insertError.message);

        return NextResponse.json({
            success: true,
            geocoded: !!geo,
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
