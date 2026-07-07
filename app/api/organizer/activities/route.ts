// app/api/organizer/activities/route.ts
// "Mine aktiviteter": alle innsendinger på arrangørens egen kilde,
// uavhengig av status, nyeste først.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { getOrganizer } from '../auth';

export async function GET(request: NextRequest) {
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }
    const organizer = await getOrganizer(request);
    if (!organizer) {
        return NextResponse.json({ success: false, error: 'Ikke innlogget.' }, { status: 401 });
    }

    const db = supabaseAdmin();
    const { data: source, error: sourceError } = await db
        .from('sources')
        .select('id')
        .eq('organizer_id', organizer.id)
        .maybeSingle();
    if (sourceError) {
        return NextResponse.json({ success: false, error: sourceError.message }, { status: 500 });
    }
    if (!source) {
        // Ingen innsendinger ennå; kilden opprettes ved første innsending.
        return NextResponse.json({ success: true, count: 0, data: [] });
    }

    const { data, error } = await db
        .from('activities')
        .select(
            'id, title, description, category, target_audience, venue_name, address, municipality, starts_at, ends_at, is_free, price_text, url, image_url, status, created_at'
        )
        .eq('source_id', source.id)
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: data.length, data });
}
