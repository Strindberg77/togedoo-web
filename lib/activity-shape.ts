// lib/activity-shape.ts
//
// Formen én aktivitetsrad har ut av datahubben — delt av /api/activities og
// /api/kart, så et sted ser likt ut i lista og på kartet.
//
// Flyttet hit fra app/api/activities/route.ts uendret (sep. 2026). Next.js
// tillater bare HTTP-handlere som eksport fra en route-fil, så en form to
// ruter skal dele, må bo her.
import { sanitizeWebsite } from './website';

export interface ActivityRow {
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
export function toApiShape(row: ActivityRow, distanceFromCityKm: number | null = null) {
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

export const ROW_COLUMNS =
    'id, kind, title, description, category, target_audience, venue_name, address, municipality, near_city, lat, lng, starts_at, ends_at, is_free, price_text, url, image_url, opening_hours, osm_tags, is_indoor, facets';
