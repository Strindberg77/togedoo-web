// app/api/admin/reports/route.ts
// Behandling av stedsrapporter. GET lister åpne rapporter med stedsinfo.
// PATCH { id, action }:
//   'fjern_sted' -> aktiviteten settes rejected + locked (re-import rører
//                   den aldri), rapporten lukkes
//   'lukk'       -> rapporten lukkes uten endring på stedet
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../auth';

export async function GET(request: NextRequest) {
    const denied = requireAdmin(request);
    if (denied) return denied;
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }

    const { data, error } = await supabaseAdmin()
        .from('place_reports')
        .select('id, reason, comment, status, created_at, activity:activities(id, title, category, municipality, status, locked)')
        .eq('status', 'ny')
        .order('created_at', { ascending: true });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, count: data.length, data });
}

export async function PATCH(request: NextRequest) {
    const denied = requireAdmin(request);
    if (denied) return denied;
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : null;
    const action = body?.action === 'fjern_sted' || body?.action === 'lukk' ? body.action : null;
    if (!id || !action) {
        return NextResponse.json(
            { success: false, error: 'Krever id (uuid) og action (fjern_sted|lukk).' },
            { status: 400 }
        );
    }

    const db = supabaseAdmin();
    const { data: report, error: lookupError } = await db
        .from('place_reports')
        .select('id, activity_id, status')
        .eq('id', id)
        .maybeSingle();
    if (lookupError) return NextResponse.json({ success: false, error: lookupError.message }, { status: 500 });
    if (!report) return NextResponse.json({ success: false, error: 'Fant ikke rapporten.' }, { status: 404 });

    if (action === 'fjern_sted') {
        const { error: updateError } = await db
            .from('activities')
            .update({ status: 'rejected', locked: true })
            .eq('id', report.activity_id);
        if (updateError) return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    const { error: closeError } = await db
        .from('place_reports')
        .update({ status: 'behandlet' })
        .eq('id', id);
    if (closeError) return NextResponse.json({ success: false, error: closeError.message }, { status: 500 });

    return NextResponse.json({ success: true, action, activityId: report.activity_id });
}
