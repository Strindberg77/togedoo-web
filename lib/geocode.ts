// lib/geocode.ts
// Server-side geokoding for datahubben. Rekkefølge:
//   1. geocode_cache (Supabase) — også negative treff caches, så vi ikke
//      hamrer eksterne API-er med uoppløselige stedsnavn
//   2. Kartverket adresse-API (gratis, uten nøkkel, best på norske adresser)
//   3. Kartverket stedsnavn-API (parker, badeplasser, bygg)
//   4. Nominatim (siste utvei, lav frekvens, med identifiserende User-Agent)
//
// Kommune sendes som egen parameter, ikke limt inn i søkestrengen:
// adresse-API-et gir 0 treff for "Karl Johans gate 1, Oslo" men riktig
// treff for sok="Karl Johans gate 1" + kommunenavn="Oslo" (verifisert).
// Uten kommune-avgrensning treffer tvetydige gatenavn feil by.
import { supabaseAdmin } from './supabase';

export interface GeocodeResult {
    lat: number;
    lng: number;
    formattedAddress: string | null;
    provider: string;
}

const USER_AGENT = 'Togedoo datahub (hello@togedoo.com)';

function cacheKey(query: string, municipality?: string): string {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const m = municipality?.trim().toLowerCase() ?? '';
    return m ? `${q} | ${m}` : q;
}

async function fromCache(key: string): Promise<GeocodeResult | null | undefined> {
    const { data } = await supabaseAdmin()
        .from('geocode_cache')
        .select('lat, lng, formatted_address, provider')
        .eq('query', key)
        .maybeSingle();
    if (!data) return undefined; // ikke i cache
    if (data.lat === null || data.lng === null) return null; // cachet negativt treff
    return {
        lat: data.lat,
        lng: data.lng,
        formattedAddress: data.formatted_address,
        provider: data.provider,
    };
}

async function saveCache(key: string, result: GeocodeResult | null): Promise<void> {
    await supabaseAdmin()
        .from('geocode_cache')
        .upsert(
            {
                query: key,
                lat: result?.lat ?? null,
                lng: result?.lng ?? null,
                formatted_address: result?.formattedAddress ?? null,
                provider: result?.provider ?? 'none',
            },
            { onConflict: 'query' }
        );
}

async function kartverketAdresse(
    query: string,
    municipality?: string
): Promise<GeocodeResult | null> {
    try {
        const params = new URLSearchParams({ sok: query, treffPerSide: '1' });
        if (municipality) params.set('kommunenavn', municipality);
        const res = await fetch(`https://ws.geonorge.no/adresser/v1/sok?${params}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const hit = data?.adresser?.[0];
        const point = hit?.representasjonspunkt;
        if (typeof point?.lat !== 'number' || typeof point?.lon !== 'number') return null;
        return {
            lat: point.lat,
            lng: point.lon,
            formattedAddress: hit?.adressetekst
                ? `${hit.adressetekst}, ${hit.postnummer ?? ''} ${hit.poststed ?? ''}`.trim()
                : null,
            provider: 'kartverket-adresse',
        };
    } catch {
        return null;
    }
}

interface StedsnavnHit {
    representasjonspunkt?: { nord?: number; øst?: number };
    skrivemåte?: string;
    kommuner?: { kommunenavn?: string }[];
}

async function kartverketStedsnavn(
    query: string,
    municipality?: string
): Promise<GeocodeResult | null> {
    try {
        const params = new URLSearchParams({
            sok: query,
            treffPerSide: '10',
            utkoordsys: '4258', // grader: øst = lng, nord = lat
        });
        const res = await fetch(`https://api.kartverket.no/stedsnavn/v1/navn?${params}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const hits: StedsnavnHit[] = data?.navn ?? [];
        if (!hits.length) return null;

        // Foretrekk treff i riktig kommune; ellers første treff.
        const wanted = municipality?.toLowerCase();
        const hit =
            (wanted &&
                hits.find((h) =>
                    h.kommuner?.some((k) => k.kommunenavn?.toLowerCase() === wanted)
                )) ||
            hits[0];

        const point = hit?.representasjonspunkt;
        if (typeof point?.nord !== 'number' || typeof point?.øst !== 'number') return null;
        return {
            lat: point.nord,
            lng: point.øst,
            formattedAddress: hit?.skrivemåte ?? null,
            provider: 'kartverket-stedsnavn',
        };
    } catch {
        return null;
    }
}

async function nominatim(query: string, municipality?: string): Promise<GeocodeResult | null> {
    try {
        const q = municipality ? `${query}, ${municipality}` : query;
        const params = new URLSearchParams({
            q,
            format: 'json',
            limit: '1',
            countrycodes: 'no',
        });
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const hit = Array.isArray(data) ? data[0] : null;
        if (!hit?.lat || !hit?.lon) return null;
        return {
            lat: parseFloat(hit.lat),
            lng: parseFloat(hit.lon),
            formattedAddress: hit.display_name ?? null,
            provider: 'nominatim',
        };
    } catch {
        return null;
    }
}

/**
 * Geokoder en adresse eller et stedsnavn, avgrenset til kommune når kjent.
 * Returnerer null hvis ingen leverandør fant stedet (det negative
 * resultatet caches også).
 */
export async function geocode(
    rawQuery: string,
    municipality?: string
): Promise<GeocodeResult | null> {
    const query = rawQuery.trim();
    if (!query) return null;
    const key = cacheKey(query, municipality);

    const cached = await fromCache(key);
    if (cached !== undefined) return cached;

    const result =
        (await kartverketAdresse(query, municipality)) ??
        (await kartverketStedsnavn(query, municipality)) ??
        (await nominatim(query, municipality));

    await saveCache(key, result);
    return result;
}
