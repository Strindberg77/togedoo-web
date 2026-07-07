// lib/supabaseBrowser.ts
// Nettleser-klient KUN for autentisering (magic link). Publishable-nøkkelen
// er laget for å være offentlig — all datatilgang går fortsatt via API-rutene
// med service-klienten, og RLS holder resten stengt.
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

/** Returnerer null når auth ikke er konfigurert (miljøvariabler mangler),
 *  så kontofunksjonene kan skjules uten at resten av siden knekker. */
export function supabaseBrowser(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    if (!browserClient) {
        browserClient = createClient(url, key);
    }
    return browserClient;
}
