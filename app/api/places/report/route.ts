// app/api/places/report/route.ts
// «Meld feil» på et sted: POST { activityId, reason, comment? } der reason
// er 'finnes_ikke' | 'feil_lokasjon' | 'feil_info'. Rapporten registreres
// alltid; effekt (skjuling/låsing) skjer først ved admin-behandling.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';

const REASONS = ['finnes_ikke', 'feil_lokasjon', 'feil_info'] as const;

const RATE_LIMIT = 10;
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
            return NextResponse.json({ success: false, error: 'For mange rapporter. Prøv igjen senere.' }, { status: 429 });
        }

        const body = (await request.json().catch(() => null)) as {
            activityId?: unknown;
            reason?: unknown;
            comment?: unknown;
        } | null;
        const activityId = typeof body?.activityId === 'string' ? body.activityId : null;
        const reason = REASONS.includes(body?.reason as (typeof REASONS)[number])
            ? (body!.reason as string)
            : null;
        const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : '';
        if (!activityId || !reason) {
            return NextResponse.json(
                { success: false, error: `Krever activityId (uuid) og reason (${REASONS.join('|')}).` },
                { status: 400 }
            );
        }

        const db = supabaseAdmin();
        const { data: activity, error: lookupError } = await db
            .from('activities')
            .select('id')
            .eq('id', activityId)
            .eq('kind', 'place')
            .maybeSingle();
        if (lookupError) throw new Error(lookupError.message);
        if (!activity) {
            return NextResponse.json({ success: false, error: 'Fant ikke stedet.' }, { status: 404 });
        }

        const { error: insertError } = await db
            .from('place_reports')
            .insert({ activity_id: activityId, reason, comment });
        if (insertError) throw new Error(insertError.message);

        return NextResponse.json({ success: true, message: 'Takk! Rapporten er mottatt.' });
    } catch (error) {
        console.error('[Place Report Error]:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Rapporten kunne ikke lagres.',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
