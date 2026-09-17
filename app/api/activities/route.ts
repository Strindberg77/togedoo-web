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
import { sanitizeWebsite } from '../../../lib/website';
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
} from '../../../lib/activities-query';

interface ActivityRow {
    id: string;
    kind: string;
    title: string;
    description: string;
    category: string;
    target_audience: string;
    venue_name: string | null;
    address: string | null;
    municipality: string | null;
    near_city: string | null;
    lat: number | null;
    lng: number | null;
    starts_at: string | null;
    ends_at: string | null;
    is_free: boolean | null;
    price_text: string | null;
    url: string | null;
    image_url: string | null;
    opening_hours: string | null;
    osm_tags: Record<string, string> | null;
    is_indoor: boolean | null;
    // Migrasjon 0016. Kolonnen er `not null default '{}'`, men typen er
    // nullbar her fordi raden kan komme fra en spørring gjort før
    // migrasjonen er kjørt — da mangler feltet, og `?? []` fanger det.
    facets: string[] | null;
    // Kun fra activities_search (migrasjon 0017): luftlinje i meter fra
    // posisjonen i forespørselen. Mangler i by-modus og uten posisjon.
    distance_m?: number | null;
}

/** OSM-ens sport-tag på Ballbane er ofte semikolon-/komma-separert
 *  («basketball;soccer») eller «multi». Normaliseres til en liten liste med
 *  små bokstaver-tokens (['basketball','soccer'] | ['multi'] | []). Klienten
 *  tolker tokenene til fotball/basket-fasetten — API-et påstår ingen semantikk. */
function splitSports(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw
        .toLowerCase()
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * [distanceFromCityKm] settes KUN i by-modus, der brukerens egen posisjon er
 * ukjent. I radius-modus har klienten posisjonen og regner sin egen avstand,
 * så feltet er null der — to ulike avstander med samme navn ville vært en
 * felle. Klienten viser tallet på «nær <by>»-merket for kuraterte utflukter.
 */
function toApiShape(row: ActivityRow, distanceFromCityKm: number | null = null) {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        category: row.category,
        targetAudience: row.target_audience,
        venueName: row.venue_name,
        address: row.address,
        municipality: row.municipality,
        // «Hjemby» for nærliggende utflukter (utenfor kommunegrensen). Lar
        // klienten merke kortet med at stedet ligger i en annen kommune.
        nearCity: row.near_city,
        distanceFromCityKm,
        // Luftlinje i meter fra posisjonen i forespørselen, avrundet til hele
        // meter FOR VISNING. Markøren for neste side bærer den urundede
        // verdien (se lib/activities-query.ts) — avrunder man den, kan to
        // rader innenfor samme meter bli hoppet over eller komme to ganger.
        // null når forespørselen ikke hadde posisjon.
        distanceM:
            row.distance_m === null || row.distance_m === undefined
                ? null
                : Math.round(row.distance_m),
        // Bydel/strøk (kort-redesign): finere enn kommune, skiller steder
        // innad i store byer. OSM legger dette i addr:suburb / addr:district
        // (city_district/neighbourhood som fallback). Egen kontekst-linje på
        // kortet — null når stedet ikke er merket med bydel.
        bydel:
            row.osm_tags?.['addr:suburb'] ??
            row.osm_tags?.['addr:district'] ??
            row.osm_tags?.['addr:city_district'] ??
            row.osm_tags?.['addr:neighbourhood'] ??
            null,
        lat: row.lat,
        lng: row.lng,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        isFree: row.is_free,
        // Inne/ute-egenskap (vinter-splitt): null = ukjent (utledes klient-side
        // fra kategori der den mangler).
        isIndoor: row.is_indoor,
        priceText: row.price_text,
        url: row.url,
        imageUrl: row.image_url,
        openingHours: row.opening_hours,
        // Utvalgte OSM-tagger med reell dekning (tag-proben jul. 2026:
        // surface 63,7 % / lit 27,2 % på Ballbane; website 64,4 % på
        // Museum). Rå osm_tags eksponeres bevisst aldri i sin helhet.
        surface: row.osm_tags?.surface ?? null,
        lit: row.osm_tags?.lit ?? null,
        // Ballsport-fasett (kun Ballbane har sport-tag). Normalisert token-liste;
        // klienten mapper soccer/basketball/multi → fotball/basket.
        sports: splitSports(row.osm_tags?.sport),
        // Fasett-tokens fra egen kolonne (migrasjon 0016). ADDITIVT til
        // [sports], ikke en erstatning: klienten tar unionen av de to, så
        // Ballbane og Rullesport virker uendret mens seed-rader — som har
        // osm_tags = null og dermed sports = [] — endelig kan bære fasetter.
        // De to mengdene er disjunkte i praksis: sports kommer fra
        // osm_tags.sport, facets fra piste:type/mtb:type/route og fra seed.
        facets: row.facets ?? [],
        website: sanitizeWebsite(
            row.osm_tags?.website ?? row.osm_tags?.['contact:website'] ?? null
        ),
    };
}

const ROW_COLUMNS =
    'id, kind, title, description, category, target_audience, venue_name, address, municipality, near_city, lat, lng, starts_at, ends_at, is_free, price_text, url, image_url, opening_hours, osm_tags, is_indoor, facets';

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
        if (categoryList) query = query.in('category', categoryList);
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
