// lib/cities.ts
// Bysentre for de fire støttede byene, og avstandsberegningen by-modus
// sorterer på.
//
// HVORFOR DETTE FINNES
// /api/activities har to moduser. Radius-modus (lat/lng sendt) går gjennom
// PostGIS-RPC-en activities_nearby og sorterer nærmest først. By-modus
// (municipality sendt) hadde INGEN avstandsdimensjon — den matchet
// `municipality ilike X OR near_city ilike X` og lot rekkefølgen være
// databasens. Appen sorterte så alfabetisk, slik at «Oppdal Skisenter»
// (120 km fra Trondheim) kom foran «Vassfjellet Skisenter» (20 km).
//
// By-modus brukes nettopp når vi IKKE har brukerens posisjon: den slås på
// når posisjonen feilet eller ble nektet, eller når brukeren velger en by
// eksplisitt. Avstand fra bysentrum er derfor ikke en dårligere erstatning
// for ekte posisjon — det er det eneste signalet som finnes.
//
// PRESISJON: koordinatene er sentrumsreferanser, ikke geometriske
// kommunesentroider. For sortering er det uten betydning — avstandene
// spenner fra 2 til 120 km, så en unøyaktighet på noen hundre meter kan
// ikke endre rekkefølgen mellom to steder som er reelt ulikt langt unna.

export interface LatLng {
    lat: number;
    lng: number;
}

/**
 * De fire byene appen støtter. Nøklene er de samme strengene appen sender
 * som `municipality` (by-chipene i Utforsk). Skal appen til Sverige eller
 * Danmark, er utvidelsen fire nye linjer her — samme kostnad som en ny
 * by-chip, ingen ny mekanisme.
 */
export const CITY_CENTRES: Readonly<Record<string, LatLng>> = {
    oslo: { lat: 59.9139, lng: 10.7522 },
    bergen: { lat: 60.3913, lng: 5.3221 },
    trondheim: { lat: 63.4305, lng: 10.3951 },
    stavanger: { lat: 58.97, lng: 5.7331 },
};

/** Sentrum for en by, eller null for et navn vi ikke kjenner. Ukjent by er
 *  ikke en feil: da beholdes databasens rekkefølge, som før. */
export function cityCentre(name: string | null | undefined): LatLng | null {
    const key = name?.trim().toLowerCase();
    if (!key) return null;
    return CITY_CENTRES[key] ?? null;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Storsirkelavstand i kilometer (haversine). Fugleflukt, ikke kjørerute —
 *  se kommentaren om presisjon øverst. */
export function distanceKm(a: LatLng, b: LatLng): number {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Avstand fra bysentrum til ett sted, avrundet til hele kilometer. Null når
 * byen er ukjent eller stedet mangler koordinater — begge deler betyr «vi vet
 * ikke», og klienten skal da ikke vise noe tall.
 *
 * Avrundingen er med vilje grov: tallet skal hjelpe en forelder å skille
 * 20 km fra 120 km, ikke å planlegge en kjørerute.
 */
export function distanceFromCityKm(
    centre: LatLng | null,
    lat: number | null,
    lng: number | null
): number | null {
    if (!centre || lat === null || lng === null) return null;
    return Math.round(distanceKm(centre, { lat, lng }));
}

/**
 * Sorterer stigende etter avstand fra [centre]. Steder uten koordinater
 * legges sist — de kan ikke plasseres, og skal ikke havne øverst ved et uhell.
 *
 * Sorteringen er STABIL (ES2019), så steder med lik avstand beholder
 * rekkefølgen de kom i fra databasen. Muterer ikke inndata.
 */
export function sortByDistanceFromCity<T extends { lat: number | null; lng: number | null }>(
    rows: readonly T[],
    centre: LatLng | null
): T[] {
    if (!centre) return [...rows];
    const avstand = (r: T) =>
        r.lat === null || r.lng === null
            ? Number.POSITIVE_INFINITY
            : distanceKm(centre, { lat: r.lat, lng: r.lng });
    return [...rows].sort((a, b) => avstand(a) - avstand(b));
}
