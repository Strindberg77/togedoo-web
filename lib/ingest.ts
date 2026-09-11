// lib/ingest.ts
// Ingestion-pipeline for datahubben: normaliser -> geokod -> upsert.
// Alle kilder (crawlere, feeds og etter hvert arrangør-innsendinger) ender
// i samme normaliserte form og samme activities-tabell.
import { supabaseAdmin } from './supabase';
import { geocode } from './geocode';
import { expiryCutoff } from './event-window';
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
    /** Rader hoppet over fordi de er låst av moderasjon (locked=true). */
    skippedLocked: number;
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
        return { slug, fetched: 0, skippedLocked: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: `Ukjent kilde: ${slug}` };
    }

    const { data: source, error: sourceError } = await db
        .from('sources')
        .select('id, active')
        .eq('slug', slug)
        .maybeSingle();
    if (sourceError) {
        return { slug, fetched: 0, skippedLocked: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: `Oppslag mot sources feilet: ${sourceError.message}` };
    }
    if (!source) {
        // 0 rader synlige. sources har RLS uten policies, så dette betyr enten
        // at raden mangler, eller at nøkkelen ikke har service-nivå-tilgang.
        return { slug, fetched: 0, skippedLocked: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: `Kilden ${slug} er ikke synlig i sources-tabellen (mangler raden, eller har nøkkelen ikke service-tilgang forbi RLS?)` };
    }
    if (!source.active) {
        return { slug, fetched: 0, skippedLocked: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: 'Kilden er deaktivert' };
    }

    try {
        const items = await adapter();
        let upserted = 0;
        let geocoded = 0;
        let withoutCoordinates = 0;

        // Rader låst av moderasjon skal aldri røres — samme vakt som
        // scripts/import-places.ts har hatt hele tiden, og som manglet her.
        // Uten den var en manuelt nedtatt rad publisert igjen neste morgen kl.
        // 07, fordi upserten under setter status:'published' ubetinget.
        // Filtreres FØR løkka, så vi heller ikke geokoder rader vi skal la være.
        const { data: lockedRows, error: lockedError } = await db
            .from('activities')
            .select('external_id')
            .eq('source_id', source.id)
            .eq('locked', true);
        if (lockedError) throw new Error(`Oppslag av låste rader feilet: ${lockedError.message}`);
        const locked = new Set((lockedRows ?? []).map((r) => r.external_id));
        const writable = items.filter((item) => !locked.has(item.externalId));
        const skippedLocked = items.length - writable.length;

        for (const item of writable) {
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

        return { slug, fetched: items.length, skippedLocked, upserted, geocoded, withoutCoordinates };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
            .from('sources')
            .update({ last_synced_at: new Date().toISOString(), last_sync_status: `feilet: ${message}` })
            .eq('id', source.id);
        return { slug, fetched: 0, skippedLocked: 0, upserted: 0, geocoded: 0, withoutCoordinates: 0, error: message };
    }
}

/**
 * Merker gamle events som utløpt så de forsvinner fra kart og feed.
 *
 * Grensen er greatest(starts_at, ends_at), ikke starts_at alene: en utstilling
 * over tre uker eller en teateroppsetning med spilleperiode skal leve ut
 * perioden. Med starts_at alene forsvant den ett døgn etter åpningsdagen,
 * midt i perioden — den eneste defekten i steg 0 som gjør noe usant overfor en
 * arrangør som allerede har betalt. Se lib/event-window.ts for hvorfor det ble
 * greatest og ikke coalesce, som dokumentet spesifiserer.
 *
 * PostgREST kan ikke uttrykke greatest() i et filter. I stedet for å bygge et
 * .or()-uttrykk med tidsstempler inne i en streng, deles jobben i tre
 * spørringer etter hvilke av de to kolonnene som er satt. Mengdene er
 * gjensidig utelukkende, så ingen rad telles to ganger, og alle tre bruker kun
 * typede filtre — ingen strengtolkning å ta feil av.
 *
 * Rader der BEGGE er tomme utløper aldri, som før: `.lt()` treffer ikke en
 * NULL-kolonne, så de faller ut av alle tre av seg selv.
 */
export async function expireOldEvents(): Promise<number> {
    const cutoff = expiryCutoff();
    const db = supabaseAdmin();
    const expire = () =>
        db.from('activities').update({ status: 'expired' }).eq('kind', 'event').eq('status', 'published');

    // Begge satt: den seneste av dem må være passert. Uten kravet til
    // starts_at ville et arrangement med feilført sluttid (ends_at før
    // starts_at) blitt utløpt før det har begynt — vakten dette handler om.
    const begge = await expire().lt('ends_at', cutoff).lt('starts_at', cutoff).select('id');
    // Kun sluttid: den avgjør alene.
    const kunSlutt = await expire().is('starts_at', null).lt('ends_at', cutoff).select('id');
    // Kun starttid: som før endringen.
    const kunStart = await expire().is('ends_at', null).lt('starts_at', cutoff).select('id');

    // Feil ble slukt før også, men med tre spørringer kan deler av sveipet nå
    // feile uten at tallet avslører det. Jobben er ubemannet, så den må i det
    // minste si fra i loggen.
    const deler = [begge, kunSlutt, kunStart];
    for (const { error } of deler) {
        if (error) console.error(`[expireOldEvents] Utløpssveipet feilet delvis: ${error.message}`);
    }

    return deler.reduce((sum, d) => sum + (d.data?.length ?? 0), 0);
}

export async function runFullSync(): Promise<{ results: IngestResult[]; expired: number }> {
    const results: IngestResult[] = [];
    for (const slug of Object.keys(ADAPTERS)) {
        results.push(await ingestSource(slug));
    }
    const expired = await expireOldEvents();
    return { results, expired };
}
