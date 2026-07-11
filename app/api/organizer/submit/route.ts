// app/api/organizer/submit/route.ts
// Tar imot arrangør-innsendinger fra skjemaet på /arranger. Geokoder
// server-side og lagrer som status='pending' — synlig først etter at
// admin-API-et publiserer. Innloggede arrangører får innsendingen på sin
// egen kilde; verifiserte kontoer publiserer direkte.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { validateSubmission, expandOccurrences } from '../../../../lib/organizer';
import { geocode } from '../../../../lib/geocode';
import { sendSubmissionConfirmation } from '../../../../lib/email';
import { getOrganizer, ensureOrganizerSource } from '../auth';

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

        // Innlogget arrangør? Ugyldig/utløpt token behandles som anonym.
        const organizer = await getOrganizer(request);

        if (!organizer) {
            const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'ukjent';
            if (isRateLimited(ip)) {
                return NextResponse.json(
                    { success: false, error: 'For mange innsendinger. Prøv igjen om en time.' },
                    { status: 429 }
                );
            }
        }

        const body = await request.json().catch(() => null);
        const { submission, errors } = validateSubmission(body);
        if (!submission) {
            return NextResponse.json({ success: false, errors }, { status: 400 });
        }

        const db = supabaseAdmin();
        let sourceId: string;
        if (organizer) {
            sourceId = (await ensureOrganizerSource(db, organizer)).id;
        } else {
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
            sourceId = source.id;
        }
        const published = !!organizer?.verified;

        // Gjentakelse ekspanderes til én rad per forekomst (maks 25).
        const expanded = expandOccurrences(
            submission.startsAt,
            submission.endsAt,
            submission.recurrence
        );
        if ('error' in expanded) {
            return NextResponse.json({ success: false, errors: [expanded.error] }, { status: 400 });
        }
        const { occurrences } = expanded;

        const geoQuery = submission.address || submission.venueName;
        const geo = geoQuery ? await geocode(geoQuery, submission.municipality) : null;

        const seriesId = crypto.randomUUID();
        const rows = occurrences.map((occ, index) => ({
            source_id: sourceId,
            external_id:
                occurrences.length === 1
                    ? `innsending-${seriesId}`
                    : `innsending-${seriesId}-${index + 1}`,
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
            starts_at: occ.startsAt,
            ends_at: occ.endsAt,
            is_free: submission.isFree,
            price_text: submission.priceText,
            url: submission.url,
            image_url: submission.imageUrl,
            contact_email: organizer?.contact_email ?? submission.contactEmail,
            status: published ? 'published' : 'pending',
        }));
        const { error: insertError } = await db.from('activities').insert(rows);
        if (insertError) throw new Error(insertError.message);

        // Opt-in bekreftelse; e-postfeil skal aldri velte innsendingen.
        if (organizer?.notify_on_submission) {
            sendSubmissionConfirmation(organizer.contact_email, submission.title, published).catch(
                (err) => console.error('[Organizer Submit] E-postbekreftelse feilet:', err)
            );
        }

        const n = occurrences.length;
        return NextResponse.json({
            success: true,
            created: n,
            geocoded: !!geo,
            status: published ? 'published' : 'pending',
            message: published
                ? n === 1
                    ? 'Aktiviteten er publisert og synlig i Togedoo.'
                    : `${n} aktiviteter er publisert og synlige i Togedoo.`
                : n === 1
                  ? 'Takk! Aktiviteten er mottatt og publiseres etter en rask gjennomgang.'
                  : `Takk! ${n} aktiviteter er mottatt og publiseres etter en rask gjennomgang.`,
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
