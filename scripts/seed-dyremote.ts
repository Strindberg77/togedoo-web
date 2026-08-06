// scripts/seed-dyremote.ts
//
// Kuratert seed for «Dyremøte»-kategorien: dyre-/gårdsbesøksmål i de fire
// dekkede byene (Oslo, Bergen, Trondheim, Stavanger). Ren OSM-tag-henting
// (tourism=zoo/aquarium) underrapporterer kraftig — de fleste er besøksgårder
// uten dyretagg, eller tagget sprikende — så de vedlikeholdes manuelt her som
// en egen kilde ved siden av 'osm-steder'.
//
//   npx tsx scripts/seed-dyremote.ts --dry-run     (geokod + rapport, ingen skriving)
//   npx tsx scripts/seed-dyremote.ts               (geokod + upsert)
//   npx tsx scripts/seed-dyremote.ts --no-geocode  (bruk kun estimerte fallbacks)
//
// Krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (unntatt --dry-run).
//
// KOORDINATER: adressene er web-verifiserte. Ved kjøring geokodes hver adresse
// mot KARTVERKET (samme ws.geonorge.no/adresser/v1-API som OSM-importens
// punktsok, her forover via /sok). Entydig treff (totaltAntallTreff=1) →
// koordinat brukes og status='published'. Tvetydig (>1 treff), ingen treff,
// eller geokoding utilgjengelig → den ESTIMERTE fallback-koordinaten beholdes
// og status='pending' (API-et serverer bare 'published'), med en advarsel i
// rapporten — bekreft manuelt og korriger fallbackLat/fallbackLng ved behov.
//
// Rader med locked=true (brukerrapport «finnes ikke») røres aldri, som i
// OSM-importen.
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';

const SOURCE = {
    slug: 'kuratert-dyremote',
    name: 'Kuratert: Dyremøte',
    kind: 'manual' as const,
};

const KARTVERKET_UA = 'Togedoo datahub (hello@togedoo.com)';

interface DyremoteSeed {
    externalId: string; // stabil upsert-nøkkel
    title: string;
    description: string; // kort, kuratert
    municipality: 'Oslo' | 'Bergen' | 'Trondheim' | 'Stavanger';
    address: string; // web-verifisert, geokodes mot Kartverket
    // Alternative adresser å prøve hvis primæradressen ikke gir entydig treff
    // (f.eks. der kilder er uenige om postnummer). Prøves i rekkefølge.
    addressAlternatives?: string[];
    // Manuelt verifisert koordinat: hopper over Kartverket-geokoding og
    // publiseres direkte (coordVerified). Bruk når geokoding ikke gir entydig
    // treff, men koordinaten er bekreftet for hånd.
    manualCoord?: { lat: number; lng: number };
    fallbackLat: number; // estimert — brukes hvis geokoding feiler/tvetydig
    fallbackLng: number;
    isFree: boolean | null; // true=gratis, false=betalt, null=ukjent
    priceText?: string | null;
    url: string;
    targetAudience?: string; // default 'Barn'
    openingHours?: string | null;
}

const SEED: DyremoteSeed[] = [
    // --- Oslo ---
    {
        externalId: 'kampen-barnebondegard',
        title: 'Kampen økologiske barnebondegård',
        description: 'Bybondegård med hest, esel, minigris, sau, geit og høner — for barnefamilier.',
        municipality: 'Oslo', address: 'Skedsmogata 23, 0655 Oslo',
        fallbackLat: 59.9137, fallbackLng: 10.7828,
        isFree: true, url: 'https://kampenbarnebondegard.com',
    },
    {
        externalId: 'nordre-lindeberg-gard',
        title: 'Nordre Lindeberg gård',
        description: 'Oslo kommunes besøksgård i Groruddalen, med dyr og aktiviteter, åpen for alle.',
        municipality: 'Oslo', address: 'Sam Eydes vei 13, 1081 Oslo',
        fallbackLat: 59.9490, fallbackLng: 10.8760,
        isFree: true, url: 'https://www.nordrelindeberggard.com',
    },
    {
        externalId: 'ekt-rideskole-husdyrpark',
        title: 'EKT Rideskole og Husdyrpark',
        description: 'Rideskole og husdyrpark på Ekebergsletta med dyr å hilse på.',
        // Kilder uenige om postnummer (vilbli.no: 1181, Proff.no/1881: 1178) —
        // prøv 1181 først, fall tilbake til 1178 hvis 1181 ikke gir treff.
        municipality: 'Oslo', address: 'Ekebergveien 99, 1181 Oslo',
        addressAlternatives: ['Ekebergveien 99, 1178 Oslo'],
        fallbackLat: 59.8830, fallbackLng: 10.7830,
        isFree: false, priceText: 'Inngang 50 kr, under 2 år gratis',
        url: 'https://www.rideskole.no',
    },
    {
        externalId: 'oslo-reptilpark',
        title: 'Oslo Reptilpark',
        description: 'Innendørs dyrepark med slanger, øgler, skilpadder og andre reptiler — midt i sentrum.',
        municipality: 'Oslo', address: 'St. Olavs gate 2, 0165 Oslo',
        fallbackLat: 59.9167, fallbackLng: 10.7383,
        isFree: false, url: 'https://www.reptilpark.no', targetAudience: 'For alle',
    },
    {
        // Besøksfjøset (Bymiljøetaten) — atskilt fra Bogstad gård MUSEUM
        // (herskapshuset, Norsk Folkemuseum, forblir kategori Museum). Det er
        // besøksgården med husdyr som hører hjemme i Dyremøte.
        externalId: 'bogstad-besoksgard',
        title: 'Bogstad besøksgård',
        description: 'Økologisk besøksgård ved Bogstadvannet med storfe, hester, sauer, geiter, kaniner, kalkuner og høns — gratis besøksfjøs, drevet av Bymiljøetaten.',
        // Offisiell registrert adresse har bokstav-suffiks «A» (Brønnøysund/
        // Proff); prøv den først, fall til uten bokstav hvis den ikke treffer.
        municipality: 'Oslo', address: 'Sørkedalsveien 450 A, 0758 Oslo',
        addressAlternatives: ['Sørkedalsveien 450, 0758 Oslo'],
        // Manuelt verifiserte koordinater (Kartverket ga ingen entydig treff).
        manualCoord: { lat: 59.972153, lng: 10.626059 },
        fallbackLat: 59.9497, fallbackLng: 10.6284,
        isFree: true, url: 'https://bogstad.no/besoksgard',
    },
    // --- Bergen ---
    {
        externalId: 'akvariet-bergen',
        title: 'Akvariet i Bergen',
        description: 'Et av Nordens eldste akvarier, på Nordnes — fisk, pingviner, krypdyr og sjøpattedyr.',
        municipality: 'Bergen', address: 'Nordnesbakken 4, 5005 Bergen',
        fallbackLat: 60.399655, fallbackLng: 5.303323,
        isFree: false, url: 'https://akvariet.no', targetAudience: 'For alle',
    },
    {
        externalId: 'ovre-eide-gard',
        title: 'Øvre-Eide gård',
        description: 'Besøksgård ved Jordalsvannet i Åsane med gårdsbesøk, dyr og åpne gårdsdager.',
        municipality: 'Bergen', address: 'Øvre-Eide 36, 5105 Eidsvåg i Åsane',
        fallbackLat: 60.4790, fallbackLng: 5.3490,
        isFree: null, url: 'https://www.ovre-eide.no', targetAudience: 'For alle',
    },
    {
        externalId: 'bergen-strutsefarm',
        title: 'Bergen Strutsefarm',
        description: 'Strutsefarm i Fyllingsdalen med omvisning og dyr.',
        municipality: 'Bergen', address: 'Rosenlundveien 31, 5146 Fyllingsdalen',
        fallbackLat: 60.3470, fallbackLng: 5.2760,
        isFree: false, url: 'https://strutsefarmen.no', targetAudience: 'For alle',
    },
    // --- Trondheim ---
    {
        externalId: 'voll-gard-trondheim',
        title: 'Voll gård',
        description: 'Hele byens bondegård på Moholt — dyr, gårdskafé og aktiviteter året rundt.',
        municipality: 'Trondheim', address: 'Gamle Jonsvannsveien 1, 7049 Trondheim',
        fallbackLat: 63.4090, fallbackLng: 10.4500,
        isFree: true, url: 'https://www.vollgard.no',
    },
    // --- Stavanger ---
    {
        externalId: 'gausel-fritidsgard',
        title: 'Gausel fritidsgård',
        description: 'Stavanger kommunes besøksgård med geit, sau, høner, gris, ku og alpakka.',
        municipality: 'Stavanger', address: 'Keramikkveien 36, 4032 Stavanger',
        fallbackLat: 58.9010, fallbackLng: 5.7250,
        isFree: true, url: 'https://www.stavanger.kommune.no',
    },
    {
        externalId: 'ullandhaug-okologisk-gard',
        title: 'Ullandhaug økologiske gård',
        description: 'Økologisk gård med turstier, lekeplass og dyr — kaniner, ullgris, ender, hester og høner.',
        municipality: 'Stavanger', address: 'Ullandhaugveien 150, 4021 Stavanger',
        fallbackLat: 58.9330, fallbackLng: 5.7060,
        isFree: true, url: 'http://www.ullandhaug-gard.no',
    },
];

interface GeoResult {
    lat?: number;
    lng?: number;
    total: number;
    verified: boolean; // entydig treff (totaltAntallTreff === 1)
    note: string;
}

// Forover-geokoding mot Kartverket (samme API/UA/retry-filosofi som
// OSM-importens punktsok i lib/places.ts; her /sok, fuzzy=false for presisjon).
// representasjonspunkt returneres i EPSG:4258 ≈ WGS84 — rett for appen.
async function geocode(address: string): Promise<GeoResult> {
    const params = new URLSearchParams({ sok: address, fuzzy: 'false', treffPerSide: '5' });
    const url = `https://ws.geonorge.no/adresser/v1/sok?${params}`;
    const TIMEOUT_MS = Number(process.env.KARTVERKET_TIMEOUT_MS ?? 8000);
    const BACKOFFS_MS = [2000, 4000];

    let res: Response | null = null;
    let transient = '';
    for (let attempt = 0; ; attempt++) {
        try {
            res = await fetch(url, { headers: { 'User-Agent': KARTVERKET_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (err) {
            res = null;
            transient =
                err instanceof Error && err.name === 'TimeoutError'
                    ? `timeout etter ${TIMEOUT_MS / 1000} s`
                    : `nettverksfeil: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (res) {
            if (res.ok) break;
            if (![429, 500, 502, 503].includes(res.status)) {
                return { total: 0, verified: false, note: `geokoding feilet: HTTP ${res.status}` };
            }
            transient = `HTTP ${res.status}`;
        }
        if (attempt >= BACKOFFS_MS.length) {
            return { total: 0, verified: false, note: `geokoding utilgjengelig: ${transient}` };
        }
        await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt]));
    }

    const data = await res!.json();
    const total: number = data?.metadata?.totaltAntallTreff ?? (data?.adresser?.length ?? 0);
    const hit = data?.adresser?.[0];
    const p = hit?.representasjonspunkt;
    if (!hit || typeof p?.lat !== 'number' || typeof p?.lon !== 'number') {
        return { total, verified: false, note: total > 1 ? `tvetydig (${total} treff)` : 'ingen treff' };
    }
    if (total === 1) {
        return { lat: p.lat, lng: p.lon, total, verified: true, note: `entydig: ${hit.adressetekst}` };
    }
    return { lat: p.lat, lng: p.lon, total, verified: false, note: `tvetydig (${total} treff), topp: ${hit.adressetekst}` };
}

function toRow(seed: DyremoteSeed, sourceId: string, lat: number, lng: number, verified: boolean) {
    return {
        source_id: sourceId,
        external_id: seed.externalId,
        kind: 'place',
        title: seed.title,
        description: seed.description,
        category: 'Dyremøte',
        target_audience: seed.targetAudience ?? 'Barn',
        address: seed.address,
        municipality: seed.municipality,
        lat,
        lng,
        is_free: seed.isFree,
        price_text: seed.priceText ?? null,
        url: seed.url,
        opening_hours: seed.openingHours ?? null,
        status: verified ? 'published' : 'pending',
    };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const noGeocode = process.argv.includes('--no-geocode');

    // Løs koordinater per sted: Kartverket-geokoding, ellers fallback.
    const resolved: { seed: DyremoteSeed; lat: number; lng: number; verified: boolean; note: string }[] = [];
    const warnings: string[] = [];
    for (const seed of SEED) {
        let lat = seed.fallbackLat;
        let lng = seed.fallbackLng;
        let verified = false;
        let note = 'estimert (–no-geocode)';
        let usedAddress = seed.address;
        if (seed.manualCoord) {
            // Manuelt verifisert — hopp over geokoding, publiser direkte.
            lat = seed.manualCoord.lat;
            lng = seed.manualCoord.lng;
            verified = true;
            note = 'manuelt verifisert';
        } else if (!noGeocode) {
            const candidates = [seed.address, ...(seed.addressAlternatives ?? [])];
            let best: { geo: GeoResult; addr: string } | null = null;
            for (const addr of candidates) {
                const geo = await geocode(addr);
                await new Promise((r) => setTimeout(r, 300)); // høflig mot Kartverket
                // Behold beste kandidat: entydig treff vinner, ellers første
                // med koordinat, ellers første forsøk (for rapportnoten).
                if (
                    !best ||
                    (geo.verified && !best.geo.verified) ||
                    (typeof geo.lat === 'number' && best.geo.lat == null)
                ) {
                    best = { geo, addr };
                }
                if (geo.verified) break; // entydig — ikke prøv flere postnumre
            }
            const geo = best!.geo;
            usedAddress = best!.addr;
            note = candidates.length > 1 ? `${geo.note} [${usedAddress}]` : geo.note;
            if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
                lat = geo.lat;
                lng = geo.lng;
            }
            verified = geo.verified;
            if (!verified) warnings.push(`  ⚠ ${seed.title} — ${usedAddress}: ${note}`);
        }
        resolved.push({ seed, lat, lng, verified, note });
    }

    const verifiedCount = resolved.filter((r) => r.verified).length;
    console.log(`Dyremøte-seed: ${SEED.length} steder — ${verifiedCount} entydig geokodet (published), ${SEED.length - verifiedCount} pending.\n`);
    for (const r of resolved) {
        console.log(
            `  [${r.verified ? 'PUBLISHED' : 'pending  '}] ${r.seed.municipality.padEnd(10)} ` +
                `${r.seed.title.padEnd(34)} ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}  (${r.note})`
        );
    }
    if (warnings.length) {
        console.log(`\nTrenger bekreftelse (${warnings.length}):`);
        warnings.forEach((w) => console.log(w));
    }

    if (dryRun) {
        console.log('\n[dry-run] Ingen skriving.');
        return;
    }
    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');

    const db = supabaseAdmin();

    const { data: source, error: sourceError } = await db
        .from('sources')
        .upsert({ slug: SOURCE.slug, name: SOURCE.name, kind: SOURCE.kind, active: true }, { onConflict: 'slug' })
        .select('id')
        .single();
    if (sourceError || !source) throw new Error(`Kunne ikke sikre kilden: ${sourceError?.message}`);

    const { data: lockedRows, error: lockedError } = await db
        .from('activities')
        .select('external_id')
        .eq('source_id', source.id)
        .eq('locked', true);
    if (lockedError) throw new Error(`Oppslag av låste rader feilet: ${lockedError.message}`);
    const locked = new Set((lockedRows ?? []).map((r) => r.external_id));

    const rows = resolved
        .filter((r) => !locked.has(r.seed.externalId))
        .map((r) => toRow(r.seed, source.id, r.lat, r.lng, r.verified));
    if (locked.size) console.log(`\nHopper over ${resolved.length - rows.length} låste rader.`);

    const { error } = await db.from('activities').upsert(rows, { onConflict: 'source_id,external_id' });
    if (error) throw new Error(`Upsert feilet: ${error.message}`);

    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${rows.length} dyremøte-steder (${verifiedCount} geokodet)` })
        .eq('id', source.id);

    console.log(`\nFerdig: upsertet ${rows.length} steder i kategorien Dyremøte.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
