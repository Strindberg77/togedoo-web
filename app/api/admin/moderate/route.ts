// app/api/admin/moderate/route.ts
// Publiserer eller avviser en pending arrangør-innsending.
// POST { "id": "<uuid>", "action": "publish" | "reject" }
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../auth';

export async function POST(request: NextRequest) {
    const denied = requireAdmin(request);
    if (denied) return denied;
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : null;
    const action = body?.action === 'publish' || body?.action === 'reject' ? body.action : null;
    if (!id || !action) {
        return NextResponse.json(
            { success: false, error: 'Krever id (uuid) og action (publish|reject).' },
            { status: 400 }
        );
    }

    const { data, error } = await supabaseAdmin()
        .from('activities')
        .update({ status: action === 'publish' ? 'published' : 'rejected' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id, title, status')
        .maybeSingle();
    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json(
            { success: false, error: 'Fant ingen pending aktivitet med den id-en.' },
            { status: 404 }
        );
    }

    return NextResponse.json({ success: true, activity: data });
}
