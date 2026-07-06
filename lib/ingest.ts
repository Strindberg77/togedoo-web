// lib/ingest.ts
// Ingestion-pipeline for datahubben: normaliser -> geokod -> upsert.
// Alle kilder (crawlere, feeds og etter hvert arrangør-innsendinger) ender
// i samme normaliserte form og samme activities-tabell.
import { supabaseAdmin } from './supabase';
import { geocode } from './geocode';
import { scrapeDeichman } from './deichman';
import { scrapeBergen } from './bergen';

export interface NormalizedActivity {
    externalId: string;
    kind: 'event' | 'place';
    title: string;
    description: string;
    category: string;
    targetAudience: string;
    venueName?: string | null;
    address?: string | null;
    municipality?: string | null;
    startsAt?: string | null; // ISO 8601
    endsAt?: string | null;
    isFree?: boolean | null;
    priceText?: string | null;
    url?: string | null;
    imageUrl?: string | null;
}

export interface IngestResult {
    slug: string;
    fetched: number;
    upserted: number;
    geocoded: number;
    withoutCoordinates: number;
    error?: string;
}

// Deichman leverer date/startTime/endTime som fulle ISO-tidsstempler
// (verifisert mot live-data), men feltene er typet som løse strenger, så vi
// tåler også 'HH:mm'-klokkeslett kombinert med en datostreng.
function toIso(dateStr?: string | null, timeStr?: string | null): string | null {
    if (timeStr && !isNaN(Date.parse(timeStr))) return new Date(timeStr).toISOString();
    if (!dateStr || isNaN(Date.parse(dateStr))) return null;
    if (timeStr && /^\d{2}:\d{2}/.test(timeStr)) {
        // Klokkeslett i norsk lokaltid; fast CEST-offset er en kjent forenkling.
        const iso = `${dateStr.slice(0, 10)}T${timeStr.slice(0, 5)}:00+02:00`;
        if (!isNaN(Date.parse(iso))) return new Date(iso).toISOString();
    }
    return new Date(dateStr).toISOString();
}

async function fetchDeichman(): Promise<NormalizedActivity[]> {
    const result = await scrapeDeichman();
    if (!result.success) throw new Error(result.error ?? 'Deichman-scrape feilet');
    return result.data.map((e) => ({
        externalId: String(e.id),
        kind: 'event' as const,
        title: e.title,
        description: e.description,
        category: e.appCategory,
        targetAudience: e.targetAudience,
        venueName: e.location,
        municipality: e.municipality,
        startsAt: toIso(e.date, e.startTime),
        endsAt: e.endTime ? toIso(e.date, e.endTime) : null,
        isFree: true, // Deichman-arrangementer er gratis
        url: e.url,
        imageUrl: e.imageUrl ?? null,
    }));
}

async function fetchBergen(): Promise<NormalizedActivity[]> {
    const result = await scrapeBergen();
    if (!result.success) throw new Error(result.error ?? 'Bergen-scrape feilet');
    return result.data.map((e) => ({
        externalId: String(e.id),
        kind: 'event' as const,
        title: e.title,
        description: e.description,
        category: e.appCategory,
        targetAudience: e.targetAudience,
        venueName: e.library,
        municipality: e.municipality,
        startsAt: isNaN(Date.parse(e.date)) ? null : new Date(e.date).toISOString(),
        isFree: true,
        url: e.url,
    }));
}

const ADAPTERS: Record<string, () => Promise<NormalizedActivity[]>> = {
    deichman: fetchDeichman,
    'bergen-bibliotek': fetchBergen,
};

export async function ingestSource(slug: string): Promise<IngestResult> {
    const db = supabaseAdmin();
    const adapter = ADAPTERS[slug];
    if (!adapter) {
        return { slug, fetched: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: `Ukjent kilde: ${slug}` };
    }

    const { data: source, error: sourceError } = await db
        .from('sources')
        .select('id, active')
        .eq('slug', slug)
        .maybeSingle();
    if (sourceError) {
        return { slug, fetched: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: `Oppslag mot sources feilet: ${sourceError.message}` };
    }
    if (!source) {
        // 0 rader synlige. sources har RLS uten policies, så dette betyr enten
        // at raden mangler, eller at nøkkelen ikke har service-nivå-tilgang.
        return { slug, fetched: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: `Kilden ${slug} er ikke synlig i sources-tabellen (mangler raden, eller har nøkkelen ikke service-tilgang forbi RLS?)` };
    }
    if (!source.active) {
        return { slug, fetched: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: 'Kilden er deaktivert' };
    }

    try {
        const items = await adapter();
        let upserted = 0;
        let geocoded = 0;
        let withoutCoordinates = 0;

        for (const item of items) {
            // Adressen er mest presis; stedsnavn (f.eks. bibliotekfilial) er fallback.
            const geoQuery = item.address || item.venueName || null;
            const geo = geoQuery ? await geocode(geoQuery, item.municipality ?? undefined) : null;
            if (geo) geocoded += 1;
            else withoutCoordinates += 1;

            const { error } = await db.from('activities').upsert(
                {
                    source_id: source.id,
                    external_id: item.externalId,
                    kind: item.kind,
                    title: item.title,
                    description: item.description,
                    category: item.category,
                    target_audience: item.targetAudience,
                    venue_name: item.venueName ?? null,
                    address: item.address ?? null,
                    municipality: item.municipality ?? null,
                    lat: geo?.lat ?? null,
                    lng: geo?.lng ?? null,
                    starts_at: item.startsAt ?? null,
                    ends_at: item.endsAt ?? null,
                    is_free: item.isFree ?? null,
                    price_text: item.priceText ?? null,
                    url: item.url ?? null,
                    image_url: item.imageUrl ?? null,
                    status: 'published',
                },
                { onConflict: 'source_id,external_id' }
            );
            if (!error) upserted += 1;
        }

        await db
            .from('sources')
            .update({ last_synced_at: new Date().toISOString(), last_sync_status: 'ok' })
            .eq('id', source.id);

        return { slug, fetched: items.length, upserted, geocoded, withoutCoordinates };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
            .from('sources')
            .update({ last_synced_at: new Date().toISOString(), last_sync_status: `feilet: ${message}` })
            .eq('id', source.id);
        return { slug, fetched: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: message };
    }
}

/** Merker gamle events som utløpt så de forsvinner fra kart og feed. */
export async function expireOldEvents(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin()
        .from('activities')
        .update({ status: 'expired' })
        .eq('kind', 'event')
        .eq('status', 'published')
        .lt('starts_at', cutoff)
        .select('id');
    return data?.length ?? 0;
}

export async function runFullSync(): Promise<{ results: IngestResult[]; expired: number }> {
    const results: IngestResult[] = [];
    for (const slug of Object.keys(ADAPTERS)) {
        results.push(await ingestSource(slug));
    }
    const expired = await expireOldEvents();
    return { results, expired };
}
