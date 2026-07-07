// app/api/admin/organizers/route.ts
// Adminliste over arrangørkontoer, og verifisering:
// PATCH { "id": "<uuid>", "verified": true|false }
// Verifiserte arrangører auto-publiserer innsendingene sine.
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
        .from('organizers')
        .select('id, name, contact_email, verified, notify_on_submission, created_at')
        .order('created_at', { ascending: false });
    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, count: data.length, data });
}

export async function PATCH(request: NextRequest) {
    const denied = requireAdmin(request);
    if (denied) return denied;
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as { id?: unknown; verified?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : null;
    if (!id || typeof body?.verified !== 'boolean') {
        return NextResponse.json(
            { success: false, error: 'Krever id (uuid) og verified (boolean).' },
            { status: 400 }
        );
    }

    const { data, error } = await supabaseAdmin()
        .from('organizers')
        .update({ verified: body.verified })
        .eq('id', id)
        .select('id, name, contact_email, verified')
        .maybeSingle();
    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ success: false, error: 'Fant ingen arrangør med den id-en.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, organizer: data });
}
