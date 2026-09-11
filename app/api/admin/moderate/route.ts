// app/api/admin/moderate/route.ts
// Publiserer, avviser eller tar ned en aktivitet.
// POST { "id": "<uuid>", "action": "publish" | "reject" | "unpublish" }
//
// 'unpublish' er ny (hull 2 i docs/arrangementer-og-betalende-aktorer.md):
// update-en hadde .eq('status','pending') hardkodet og traff derfor aldri en
// publisert rad. Eneste vei til nedtaking gikk via en brukerrapport, så en
// avlyst forestilling meldt kl. 20 måtte ordnes i SQL-editoren.
//
// Overgangene selv ligger i lib/moderation.ts fordi en route-fil ikke kan
// eksportere annet enn HTTP-metodene sine — og dermed ikke kan enhetstestes.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../../lib/supabase';
import { requireAdmin } from '../auth';
import {
    MODERATION_ACTIONS,
    MODERATION_TRANSITIONS,
    noMatchMessage,
    parseModerationAction,
} from '../../../../lib/moderation';

export async function POST(request: NextRequest) {
    const denied = requireAdmin(request);
    if (denied) return denied;
    if (!isDatahubConfigured()) {
        return NextResponse.json({ success: false, error: 'Datahub er ikke konfigurert.' }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : null;
    const action = parseModerationAction(body?.action);
    if (!id || !action) {
        return NextResponse.json(
            { success: false, error: `Krever id (uuid) og action (${MODERATION_ACTIONS.join('|')}).` },
            { status: 400 }
        );
    }

    const transition = MODERATION_TRANSITIONS[action];
    const { data, error } = await supabaseAdmin()
        .from('activities')
        .update({ status: transition.to, locked: transition.lock })
        .eq('id', id)
        // .in() i stedet for .eq(): hvilke statuser handlingen får gå fra er
        // en egenskap ved handlingen, ikke en konstant i denne ruten.
        .in('status', [...transition.from])
        .select('id, title, status, locked')
        .maybeSingle();
    if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ success: false, error: noMatchMessage(action) }, { status: 404 });
    }

    return NextResponse.json({ success: true, activity: data });
}
