// lib/supabase.ts
// Server-side Supabase-klient for datahubben. Brukes KUN fra API-ruter og
// ingestion — togedoo-web eksponerer aldri Supabase direkte til klienter,
// og Flutter-appen snakker kun med togedoo-web sitt API.
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function isDatahubConfigured(): boolean {
    return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
    if (!adminClient) {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
            throw new Error(
                'Datahub er ikke konfigurert: SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY mangler.'
            );
        }
        adminClient = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
    return adminClient;
}
