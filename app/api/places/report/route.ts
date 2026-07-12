// app/api/places/report/route.ts
// «Meld feil» på et sted: POST { activityId, reason, comment?, deviceId?,
// lat?, lng? } der reason er 'finnes_ikke' | 'feil_lokasjon' | 'feil_info'.
//
// Rapporten registreres alltid. 'finnes_ikke' kan i tillegg autobekreftes
// (migrasjon 0007): når AUTO_REJECT_THRESHOLD unike rapportører (ulik
// reporter_hash) har meldt det samme innen AUTO_REJECT_WINDOW_DAYS, alle
// med posisjon innenfor AUTO_REJECT_MAX_DISTANCE_M fra stedet, settes
// aktiviteten rejected + locked uten admin, og rapportene lukkes med
// status 'auto_behandlet'. Øvrige årsaker krever fortsatt admin-handling.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import {
    AUTO_REJECT_MAX_DISTANCE_M,
    AUTO_REJECT_THRESHOLD,
    AUTO_REJECT_WINDOW_DAYS,
    REPORT_RATE_LIMIT,
    REPORT_RATE_WINDOW_MS,
    REPORT_REASONS,
    haversineMeters,
    ipHash,
    parseCoordinate,
    reporterHash,
} from '../../../../lib/reports';

export async function POST(request: NextRequest) {
    try {
        if (!isDatahubConfigured()) {
            return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
        }
        const db = supabaseAdmin();

        // Rate-limiting i databasen: teller faktiske inserts per ip_hash,
        // fungerer på tvers av serverless-instanser og cold starts.
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'ukjent';
        const requestIpHash = ipHash(ip);
        const windowStart = new Date(Date.now() - REPORT_RATE_WINDOW_MS).toISOString();
        const { count: recentCount, error: rateError } = await db
            .from('place_reports')
            .select('id', { count: 'exact', head: true })
            .eq('ip_hash', requestIpHash)
            .gte('created_at', windowStart);
        if (rateError) throw new Error(rateError.message);
        if ((recentCount ?? 0) >= REPORT_RATE_LIMIT) {
            return NextResponse.json({ success: false, error: 'For mange rapporter. Prøv igjen senere.' }, { status: 429 });
        }

        const body = (await request.json().catch(() => null)) as {
            activityId?: unknown;
            reason?: unknown;
            comment?: unknown;
            deviceId?: unknown;
            lat?: unknown;
            lng?: unknown;
        } | null;
        const activityId = typeof body?.activityId === 'string' ? body.activityId : null;
        const reason = REPORT_REASONS.includes(body?.reason as (typeof REPORT_REASONS)[number])
            ? (body!.reason as string)
            : null;
        const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : '';
        if (!activityId || !reason) {
            return NextResponse.json(
                { success: false, error: `Krever activityId (uuid) og reason (${REPORT_REASONS.join('|')}).` },
                { status: 400 }
            );
        }
        const reporter = reporterHash(body?.deviceId);
        const reportedLat = parseCoordinate(body?.lat, -90, 90);
        const reportedLng = parseCoordinate(body?.lng, -180, 180);

        const { data: activity, error: lookupError } = await db
            .from('activities')
            .select('id, lat, lng')
            .eq('id', activityId)
            .eq('kind', 'place')
            .maybeSingle();
        if (lookupError) throw new Error(lookupError.message);
        if (!activity) {
            return NextResponse.json({ success: false, error: 'Fant ikke stedet.' }, { status: 404 });
        }

        // Avstand rapportør→sted (geografisk plausibilitet). Null når
        // klienten ikke sendte posisjon eller stedet mangler koordinater —
        // rapporten teller da i admin-køen, men ikke mot auto-terskelen.
        const distanceM =
            reportedLat !== null && reportedLng !== null && activity.lat !== null && activity.lng !== null
                ? haversineMeters(reportedLat, reportedLng, activity.lat, activity.lng)
                : null;

        const { error: insertError } = await db.from('place_reports').insert({
            activity_id: activityId,
            reason,
            comment,
            reporter_hash: reporter,
            ip_hash: requestIpHash,
            reported_from_distance_m: distanceM,
        });
        if (insertError) {
            // Unik-constraint (activity_id, reason, reporter_hash): samme
            // person har allerede meldt dette — ikke en feil for brukeren.
            if (insertError.code === '23505') {
                return NextResponse.json({
                    success: true,
                    alreadyReported: true,
                    message: 'Du har allerede meldt dette. Takk!',
                });
            }
            throw new Error(insertError.message);
        }

        const autoConfirmed = reason === 'finnes_ikke' ? await maybeAutoReject(db, activityId) : false;

        return NextResponse.json({ success: true, autoConfirmed, message: 'Takk! Rapporten er mottatt.' });
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

/** Auto-terskelen for 'finnes_ikke'. Returnerer true hvis stedet ble
 *  autobekreftet fjernet i dette kallet. */
async function maybeAutoReject(
    db: ReturnType<typeof supabaseAdmin>,
    activityId: string
): Promise<boolean> {
    const windowStart = new Date(
        Date.now() - AUTO_REJECT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: openReports, error } = await db
        .from('place_reports')
        .select('reporter_hash, reported_from_distance_m')
        .eq('activity_id', activityId)
        .eq('reason', 'finnes_ikke')
        .eq('status', 'ny')
        .gte('created_at', windowStart)
        .not('reporter_hash', 'is', null);
    if (error) throw new Error(error.message);

    const qualifying = new Set(
        (openReports ?? [])
            .filter(
                (r) =>
                    r.reported_from_distance_m !== null &&
                    r.reported_from_distance_m <= AUTO_REJECT_MAX_DISTANCE_M
            )
            .map((r) => r.reporter_hash as string)
    );
    if (qualifying.size < AUTO_REJECT_THRESHOLD) return false;

    const { error: rejectError } = await db
        .from('activities')
        .update({ status: 'rejected', locked: true })
        .eq('id', activityId);
    if (rejectError) throw new Error(rejectError.message);

    // Lukk alle åpne finnes_ikke-rapporter på stedet med egen status, slik
    // at admin-loggen skiller auto fra manuell behandling.
    const { error: closeError } = await db
        .from('place_reports')
        .update({ status: 'auto_behandlet' })
        .eq('activity_id', activityId)
        .eq('reason', 'finnes_ikke')
        .eq('status', 'ny');
    if (closeError) throw new Error(closeError.message);

    return true;
}
