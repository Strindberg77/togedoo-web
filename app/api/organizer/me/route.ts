// app/api/organizer/me/route.ts
// Arrangørens profil: GET henter (og oppretter ved første innlogging),
// PATCH oppdaterer navn og varslingsvalg. `verified` styres kun via
// admin-API-et.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { isEmailConfigured } from '../../../../lib/email';
import { getOrganizer } from '../auth';

export async function GET(request: NextRequest) {
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }
    const organizer = await getOrganizer(request);
    if (!organizer) {
        return NextResponse.json({ success: false, error: 'Ikke innlogget.' }, { status: 401 });
    }
    return NextResponse.json({ success: true, organizer, emailConfigured: isEmailConfigured() });
}

export async function PATCH(request: NextRequest) {
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }
    const organizer = await getOrganizer(request);
    if (!organizer) {
        return NextResponse.json({ success: false, error: 'Ikke innlogget.' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
        name?: unknown;
        notifyOnSubmission?: unknown;
    } | null;
    const updates: { name?: string; notify_on_submission?: boolean } = {};
    if (typeof body?.name === 'string' && body.name.trim().length <= 200) {
        updates.name = body.name.trim();
    }
    if (typeof body?.notifyOnSubmission === 'boolean') {
        updates.notify_on_submission = body.notifyOnSubmission;
    }
    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ success: false, error: 'Ingenting å oppdatere.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
        .from('organizers')
        .update(updates)
        .eq('id', organizer.id)
        .select('id, name, contact_email, verified, notify_on_submission, created_at')
        .single();
    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Hold kilde-navnet i synk med kontonavnet, så attribusjonen er lesbar.
    if (updates.name) {
        await supabaseAdmin()
            .from('sources')
            .update({ name: updates.name })
            .eq('organizer_id', organizer.id);
    }

    return NextResponse.json({ success: true, organizer: data });
}
