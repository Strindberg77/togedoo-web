// app/api/organizer/auth.ts
// Delt sesjonssjekk for arrangør-endepunktene. Klienten sender brukerens
// access token som `Authorization: Bearer <token>`; vi validerer det via
// Supabase Auth og henter (eller oppretter ved første innlogging)
// organizers-raden. Returnerer null uten gyldig innlogging.
import { NextRequest } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export interface OrganizerRow {
    id: string;
    name: string;
    contact_email: string;
    verified: boolean;
    notify_on_submission: boolean;
    created_at: string;
}

export async function getOrganizer(request: NextRequest): Promise<OrganizerRow | null> {
    const auth = request.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length);

    const db = supabaseAdmin();
    const { data, error } = await db.auth.getUser(token);
    const user = data?.user;
    if (error || !user?.email) return null;

    const { data: existing } = await db
        .from('organizers')
        .select('id, name, contact_email, verified, notify_on_submission, created_at')
        .eq('id', user.id)
        .maybeSingle();
    if (existing) return existing as OrganizerRow;

    const { data: created, error: insertError } = await db
        .from('organizers')
        .insert({ id: user.id, contact_email: user.email })
        .select('id, name, contact_email, verified, notify_on_submission, created_at')
        .single();
    if (insertError) {
        console.error('[Organizer Auth] Klarte ikke å opprette organizers-rad:', insertError.message);
        return null;
    }
    return created as OrganizerRow;
}

/** Henter arrangørens egen kilde-rad, eller oppretter den ved første bruk. */
export async function ensureOrganizerSource(
    db: SupabaseClient,
    organizer: OrganizerRow
): Promise<{ id: string }> {
    const { data: existing, error: lookupError } = await db
        .from('sources')
        .select('id')
        .eq('organizer_id', organizer.id)
        .maybeSingle();
    if (lookupError) throw new Error(`Oppslag mot sources feilet: ${lookupError.message}`);
    if (existing) return existing;

    const { data: created, error: insertError } = await db
        .from('sources')
        .insert({
            slug: `arrangor-${organizer.id.slice(0, 8)}`,
            name: organizer.name || organizer.contact_email,
            kind: 'organizer',
            organizer_id: organizer.id,
        })
        .select('id')
        .single();
    if (insertError) throw new Error(`Klarte ikke å opprette arrangørkilde: ${insertError.message}`);
    return created;
}
