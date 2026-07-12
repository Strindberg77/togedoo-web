// app/api/admin/pending/route.ts
// Lister arrangør-innsendinger som venter på moderering. Beskyttet med
// ADMIN_SECRET (samme Bearer-mønster som CRON_SECRET for /api/sync).
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../auth';

export async function GET(request: NextRequest) {
    const denied = requireAdmin(request);
    if (denied) return denied;
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }

    // high_trust øverst: tips som er uavhengig bekreftet av et annet tips
    // innen ~75 m med samme kategori (satt i /api/places/submit). kind er
    // med så stedstips kan skilles fra arrangør-arrangementer i lista.
    const { data, error } = await supabaseAdmin()
        .from('activities')
        .select(
            'id, kind, high_trust, title, description, category, target_audience, venue_name, address, municipality, lat, lng, starts_at, ends_at, is_free, price_text, url, image_url, contact_email, created_at'
        )
        .eq('status', 'pending')
        .order('high_trust', { ascending: false })
        .order('created_at', { ascending: true });
    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: data.length, data });
}
