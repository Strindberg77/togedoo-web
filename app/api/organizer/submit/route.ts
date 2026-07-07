// app/api/organizer/submit/route.ts
// Tar imot arrangør-innsendinger fra skjemaet på /arranger. Geokoder
// server-side og lagrer som status='pending' — synlig først etter at
// admin-API-et publiserer.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { validateSubmission } from '../../../../lib/organizer';
import { geocode } from '../../../../lib/geocode';

const ORGANIZER_SOURCE_SLUG = 'arrangor-innsending';

// Best-effort rate-limiting per serverless-instans; nok til å stoppe
// naive skript, ikke en distribuert angriper.
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
            return NextResponse.json(
                { success: false, error: 'Datahub er ikke konfigurert.' },
                { status: 503 }
            );
        }

        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'ukjent';
        if (isRateLimited(ip)) {
            return NextResponse.json(
                { success: false, error: 'For mange innsendinger. Prøv igjen om en time.' },
                { status: 429 }
            );
        }

        const body = await request.json().catch(() => null);
        const { submission, errors } = validateSubmission(body);
        if (!submission) {
            return NextResponse.json({ success: false, errors }, { status: 400 });
        }

        const db = supabaseAdmin();
        const { data: source, error: sourceError } = await db
            .from('sources')
            .select('id, active')
            .eq('slug', ORGANIZER_SOURCE_SLUG)
            .maybeSingle();
        if (sourceError) {
            throw new Error(`Oppslag mot sources feilet: ${sourceError.message}`);
        }
        if (!source || !source.active) {
            throw new Error(
                `Kilden ${ORGANIZER_SOURCE_SLUG} mangler eller er deaktivert (kjør migrasjon 0003).`
            );
        }

        const geoQuery = submission.address || submission.venueName;
        const geo = geoQuery ? await geocode(geoQuery, submission.municipality) : null;

        const externalId = `innsending-${crypto.randomUUID()}`;
        const { error: insertError } = await db.from('activities').insert({
            source_id: source.id,
            external_id: externalId,
            kind: 'event',
            title: submission.title,
            description: submission.description,
            category: submission.category,
            target_audience: submission.targetAudience,
            venue_name: submission.venueName,
            address: submission.address,
            municipality: submission.municipality,
            lat: geo?.lat ?? null,
            lng: geo?.lng ?? null,
            starts_at: submission.startsAt,
            ends_at: submission.endsAt,
            is_free: submission.isFree,
            price_text: submission.priceText,
            url: submission.url,
            image_url: submission.imageUrl,
            contact_email: submission.contactEmail,
            status: 'pending',
        });
        if (insertError) throw new Error(insertError.message);

        return NextResponse.json({
            success: true,
            externalId,
            geocoded: !!geo,
            message: 'Takk! Aktiviteten er mottatt og publiseres etter en rask gjennomgang.',
        });
    } catch (error) {
        console.error('[Organizer Submit Error]:', error);
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
