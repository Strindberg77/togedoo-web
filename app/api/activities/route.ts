// app/api/activities/route.ts
// Leser aktiviteter fra datahub-lagringen (Supabase/Postgres) med
// koordinater. Støtter radius-søk (lat/lng/radius) via PostGIS-RPC-en
// activities_nearby, og flate filtre ellers.
//
// Fallback: hvis datahubben ikke er konfigurert ennå (Supabase-miljøvariabler
// mangler), svarer ruten som før med live-scraping, merket mode: "legacy",
// så eksisterende konsumenter ikke knekker før oppsettet er gjort.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured, supabaseAdmin } from '../../../lib/supabase';
import { scrapeDeichman } from '../../../lib/deichman';
import { scrapeBergen } from '../../../lib/bergen';
import {
    cityCentre,
    distanceFromCityKm,
    sortByDistanceFromCity,
    type LatLng,
} from '../../../lib/cities';
import { ROW_COLUMNS, toApiShape, type ActivityRow } from '../../../lib/activity-shape';
import {
    cityModeEventWindowFilter,
    cityModeSortIsLoadBearing,
    listingCutoff,
} from '../../../lib/event-window';
import {
    QueryParamError,
    assertCursorMatchesSort,
    decodeCursor,
    encodeCursor,
    parseBbox,
    parseLimit,
    parsePoint,
    parseRadius,
    sanitizeQueryForOr,
    sanitizeQueryForRpc,
    splitPage,
    usesSearchFunction,
    categoryOrFacetFilter,
} from '../../../lib/activities-query';
import { categoryFacetsFor } from '../../../lib/facets';

async function fromDatabase(searchParams: URLSearchParams) {
    const db = supabaseAdmin();

    const point = parsePoint(searchParams.get('lat'), searchParams.get('lng'));
    const bbox = parseBbox(searchParams.get('bbox'));
    const cursor = decodeCursor(searchParams.get('cursor'));
    // null = ingen avstandsgrense. Se parseRadius for hvorfor det ikke lenger
    // er 10 km, og hvorfor taket på 100 km er borte.
    const radius = parseRadius(searchParams.get('radius'));
    const kind = searchParams.get('kind');
    // Kategori kan være komma-separert (flervalg) → liste. Verdiene
    // parameteriseres av .in()/p_categories, så ingen sanering nødvendig
    // (kategorinavn inneholder ikke komma). Én verdi ≡ tidligere .eq/p_category
    // → bakoverkompatibelt. Tom → null (intet kategorifilter).
    const categories = (searchParams.get('category') ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    const categoryList = categories.length > 0 ? categories : null;
    // Fasettene som også teller som treff i de valgte kategoriene —
    // Dyreparken under Fornøyelsespark, Trysil under Aking. null når ingen
    // valgt kategori har en fasett: da er spørringen nøyaktig som før.
    // Regelen: lib/facets.ts (FASETT_SOM_KATEGORI).
    const categoryFacets = categoryFacetsFor(categoryList);
    // By-modus matcher også near_city (kuraterte «nærliggende utflukter» som
    // ligger utenfor kommunegrensen, men hører til byens nærområde). Saneres
    // som q (kun bokstaver/tall/mellomrom/bindestrek) så den trygt kan
    // embeddes i .or().
    const municipality = (searchParams.get('municipality') ?? '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .slice(0, 50);
    const targetAudience = searchParams.get('targetAudience');
    const limit = parseLimit(searchParams.get('limit'));
    // To saneringer, fordi de to veiene har ulike farer: RPC-en tar q som
    // bunden parameter og trenger bare wildcards escapet, mens den flate
    // veien limer q inn i .or() og må ha PostgREST-metategnene bort.
    const qRpc = sanitizeQueryForRpc(searchParams.get('q'));
    const q = sanitizeQueryForOr(searchParams.get('q'));

    let rows: ActivityRow[];
    // Settes kun i by-modus (se sorteringen under).
    let centre: LatLng | null = null;

    if (
        usesSearchFunction({
            hasPoint: point !== null,
            hasBbox: bbox !== null,
            hasCursor: cursor !== null,
            hasQuery: qRpc !== null,
            hasMunicipality: municipality !== '',
        })
    ) {
        // Nærmest først (eller tittel uten posisjon), valgfri radius, valgfritt
        // kartutsnitt, og keyset-paginering. Migrasjon 0017.
        if (cursor) assertCursorMatchesSort(cursor, point !== null);
        // Én rad mer enn siden: er den der, finnes det mer å hente.
        const { data, error } = await db.rpc('activities_search', {
            p_lat: point?.lat ?? null,
            p_lng: point?.lng ?? null,
            p_radius_m: radius,
            p_west: bbox?.west ?? null,
            p_south: bbox?.south ?? null,
            p_east: bbox?.east ?? null,
            p_north: bbox?.north ?? null,
            p_kind: kind,
            p_categories: categoryList,
            p_category_facets: categoryFacets,
            // Filtreres nå INNE i spørringen, ikke på det ferdige utvalget.
            // Før falt målgruppefilteret på de 100 nærmeste; nå gjelder det
            // alle treff, slik paginering krever.
            p_target_audience: targetAudience,
            p_q: qRpc,
            p_after_distance_m: cursor?.distanceM ?? null,
            p_after_title: cursor?.title ?? null,
            p_after_id: cursor?.id ?? null,
            p_limit: limit + 1,
        });
        if (error) throw new Error(error.message);
        const { page, hasMore } = splitPage((data ?? []) as ActivityRow[], limit);
        const last = page[page.length - 1];
        return NextResponse.json({
            success: true,
            mode: 'datahub',
            data: page.map((row) => toApiShape(row)),
            count: page.length,
            hasMore,
            nextCursor:
                hasMore && last
                    ? encodeCursor({
                          distanceM: last.distance_m ?? null,
                          title: last.title,
                          id: last.id,
                      })
                    : null,
            attribution:
                'Stedsdata © OpenStreetMap contributors (ODbL) — openstreetmap.org/copyright',
            timestamp: new Date().toISOString(),
        });
    } else {
        // MERK (defekt 3, docs/arrangementer-og-betalende-aktorer.md):
        // sorteringen under er virkningsløs så lenge utvalget bare er steder —
        // de har starts_at = null, og nullsFirst:false legger dem sist, altså
        // alle sammen. Slipper arrangementsrader inn i SAMME utvalg, blir den
        // styrende: de legger seg øverst med eldste først og kan fylle hele
        // `limit`, og stedene forsvinner helt ut av svaret. Rettes ikke her —
        // arrangementer skal ha sitt eget kall og sitt eget tak (steg 2) —
        // men overgangen skal ikke skje ubemerket.
        if (cityModeSortIsLoadBearing(kind)) {
            console.warn(
                `[activities] By-modus uten kind=place (kind=${kind ?? 'null'}): sorteringen på ` +
                    'starts_at er nå styrende, og arrangementer kan fortrenge steder innenfor ' +
                    'limit. Se defekt 3 i docs/arrangementer-og-betalende-aktorer.md.'
            );
        }
        let query = db
            .from('activities')
            .select(ROW_COLUMNS)
            .eq('status', 'published')
            // Samme tidsvindu som RPC-en har (migrasjon 0015). Uten det var
            // status='published' eneste vern i by-modus, og et arrangement som
            // gikk i går kl. 10 ble liggende i inntil ~21 timer til cron kjørte
            // 05:00 UTC. Uttrykket gjelder også når kind=place sendes: da er
            // første gren alltid sann, så filteret koster ingenting — men det
            // er i drift, ikke sovende kode som først prøves den dagen
            // arrangementsaksen åpnes.
            .or(cityModeEventWindowFilter(listingCutoff()))
            .order('starts_at', { ascending: true, nullsFirst: false })
            .limit(limit);
        if (kind) query = query.eq('kind', kind);
        if (categoryList) {
            // Med fasett: kategori ELLER fasett (samme regel som RPC-ene).
            // Uten: .in() som før, parameterisert.
            query = categoryFacets
                ? query.or(categoryOrFacetFilter(categoryList, categoryFacets))
                : query.in('category', categoryList);
        }
        if (municipality) {
            // Ekte kommune ELLER hjemby-tilknytning (near_city). To .or()-kall
            // ANDes med q-blokken under, så (by ELLER near_city) OG (søk).
            query = query.or(
                `municipality.ilike.${municipality},near_city.ilike.${municipality}`
            );
        }
        if (targetAudience) query = query.ilike('target_audience', targetAudience);
        if (q) {
            // q er sanert over → trygt å embedde i .or(). PostgREST bruker *
            // som ilike-wildcard. category er med fordi kategorinavnet
            // («Ballbane», «Museum» …) er nettopp det brukeren skriver i
            // fritekst — uten den bommer «BALL» på navngitte baner.
            query = query.or(
                `title.ilike.*${q}*,description.ilike.*${q}*,` +
                    `venue_name.ilike.*${q}*,address.ilike.*${q}*,` +
                    `category.ilike.*${q}*`
            );
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        rows = (data ?? []) as unknown as ActivityRow[];
        // By-modus hadde ingen avstandsdimensjon: radene kom i databasens
        // rekkefølge, og appen sorterte dem alfabetisk. «Oppdal Skisenter»
        // (120 km fra Trondheim) havnet dermed foran «Vassfjellet Skisenter»
        // (20 km). Radius-modus over er allerede riktig via PostGIS.
        //
        // Sorteringen skjer her og ikke i databasen fordi radene alt er hentet
        // inn (maks 500) og en RPC-endring ville krevd migrasjon. MERK at det
        // sorterer UTVALGET, ikke hva som velges ut — se «Kjent gjeld» i
        // docs/seed-backlog.md for grensen det setter.
        centre = cityCentre(municipality);
        rows = sortByDistanceFromCity(rows, centre);
    }

    return NextResponse.json({
        success: true,
        mode: 'datahub',
        data: rows.map((row) => toApiShape(row, distanceFromCityKm(centre, row.lat, row.lng))),
        count: rows.length,
        // By-modus har ingen paginering. Feltene er med for at svarformen skal
        // være den samme uansett vei — en klient som blar skal slippe å vite
        // hvilken gren den traff. `false`/`null` er sant her: det finnes ingen
        // neste side å be om.
        hasMore: false,
        nextCursor: null,
        // ODbL-krav: steder (kind='place') kommer fra OpenStreetMap.
        attribution: 'Stedsdata © OpenStreetMap contributors (ODbL) — openstreetmap.org/copyright',
        timestamp: new Date().toISOString(),
    });
}

// Gammel oppførsel: live-scrape per request, uten koordinater. Fjernes når
// datahubben er i drift.
async function fromLegacyScrape(searchParams: URLSearchParams) {
    const municipality = searchParams.get('municipality') || undefined;
    const targetAudience = searchParams.get('targetAudience') || undefined;

    const [deichmanResult, bergenResult] = await Promise.all([
        scrapeDeichman({ targetAudience }),
        scrapeBergen(),
    ]);

    let allActivities = [
        ...(deichmanResult.data || []).map((event) => ({ ...event, source: 'deichman.no' })),
        ...(bergenResult.data || []).map((event) => ({ ...event, source: 'bergenbibliotek.no' })),
    ];

    if (municipality) {
        allActivities = allActivities.filter(
            (act) => act.municipality.toLowerCase() === municipality.toLowerCase()
        );
    }
    if (targetAudience) {
        allActivities = allActivities.filter(
            (act) => act.targetAudience.toLowerCase() === targetAudience.toLowerCase()
        );
    }

    return NextResponse.json({
        success: true,
        mode: 'legacy',
        data: allActivities,
        count: allActivities.length,
        timestamp: new Date().toISOString(),
    });
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        if (isDatahubConfigured()) {
            return await fromDatabase(searchParams);
        }
        return await fromLegacyScrape(searchParams);
    } catch (error) {
        // Ugyldig parameter er klientens feil, ikke serverens: 400 med en
        // melding som sier hva som må rettes. En halv bbox eller en markør fra
        // en annen sortering ville ellers blitt et stille, feil svar.
        if (error instanceof QueryParamError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        console.error('[Activities API Error]:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch activities',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
