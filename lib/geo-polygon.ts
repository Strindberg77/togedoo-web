// lib/geo-polygon.ts
// Romlige hjelpefunksjoner for importen: punkt-i-polygon og nærhet.
//
// HVORFOR DEN FINNES
// Importen har ellers ingen romlig logikk — hvert OSM-element blir én rad, og
// kategorien avgjøres av taggene alene. Skianlegg bryter med det: et
// alpinanlegg og et langrennsstadion er tagget likt
// (landuse=recreation_ground), og det ENESTE skillet vi har funnet er om det
// ligger en heis eller en utforløype i eller inntil polygonet.
//
// Testen gjøres her, i TypeScript, og ikke som en Overpass-konstruksjon med
// map_to_area. Grunnen er etterprøvbarhet: denne filen kan testes uten nett,
// mot koordinater vi skriver selv. En Overpass-spørring som svarer tomt kan
// ikke feilsøkes — og vi har allerede brent oss på nettopp det (se
// remark-håndteringen i fetchOverpass).
//
// PLANT KOORDINATSYSTEM. Funksjonene behandler lat/lon som et plan. Det er
// galt på lange avstander, men vi tester bare INNENFOR ett anlegg — noen få
// kilometer. På norske breddegrader er feilen der langt under tolleransen vi
// uansett legger på, og alternativet (ekte geodetiske beregninger) ville gjort
// funksjonene vanskeligere å lese uten å endre et eneste utfall.

export interface GeoPoint {
    lat: number;
    lon: number;
}

/** Samme form som Overpass sin `bounds` på ways og relations. */
export interface GeoBounds {
    minlat: number;
    minlon: number;
    maxlat: number;
    maxlon: number;
}

/** Meter per breddegrad. Konstant nok for vårt formål. */
const METERS_PER_DEG_LAT = 111_320;

export function boundsOf(points: readonly GeoPoint[]): GeoBounds | null {
    if (points.length === 0) return null;
    let minlat = Infinity;
    let minlon = Infinity;
    let maxlat = -Infinity;
    let maxlon = -Infinity;
    for (const p of points) {
        if (p.lat < minlat) minlat = p.lat;
        if (p.lat > maxlat) maxlat = p.lat;
        if (p.lon < minlon) minlon = p.lon;
        if (p.lon > maxlon) maxlon = p.lon;
    }
    return { minlat, minlon, maxlat, maxlon };
}

/**
 * Midtpunktet i en bounding box — nøyaktig det `out center` gir for ways og
 * relations i Overpass.
 *
 * KJENT FEIL, og den er tilsiktet i v1: for et stort alpinanlegg havner dette
 * punktet MIDT I BAKKEN, ikke ved bunnstasjonen der parkering, billettluke og
 * barnebakke er. Bunnstasjonen kan ikke utledes fra OSM-geometri alene:
 * node-rekkefølgen på en aerialway-way er konvensjonelt nedenfra og opp, men
 * det er ingen regel, og uten høydedata kan vi ikke avgjøre hvilken ende som
 * er bunn. Å forbedre punktet krever en høydekilde og er en egen oppgave.
 */
export function centerOfBounds(b: GeoBounds): GeoPoint {
    return { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 };
}

/**
 * Utvider en bounding box med [meters] i alle retninger.
 *
 * Lengdegrader krymper mot polene, så omregningen bruker boksens egen
 * midtbreddegrad. På 60°N er én lengdegrad omtrent halvparten så lang som én
 * breddegrad — uten cos-leddet ville tolleransen vært dobbelt så stor
 * øst/vest som nord/sør.
 */
export function padBounds(b: GeoBounds, meters: number): GeoBounds {
    const dLat = meters / METERS_PER_DEG_LAT;
    const midLat = (b.minlat + b.maxlat) / 2;
    const cos = Math.cos((midLat * Math.PI) / 180);
    // Verner mot divisjon på ~0 ved polene. Norge kommer aldri i nærheten,
    // men en NaN her ville forplantet seg som «ingen treff» uten feilmelding.
    const dLon = meters / (METERS_PER_DEG_LAT * Math.max(cos, 0.01));
    return {
        minlat: b.minlat - dLat,
        maxlat: b.maxlat + dLat,
        minlon: b.minlon - dLon,
        maxlon: b.maxlon + dLon,
    };
}

export function pointInBounds(p: GeoPoint, b: GeoBounds): boolean {
    return p.lat >= b.minlat && p.lat <= b.maxlat && p.lon >= b.minlon && p.lon <= b.maxlon;
}

/**
 * Punkt-i-polygon med ray casting (partall/oddetall).
 *
 * Skyter en stråle østover fra punktet og teller kryssinger med kantene.
 * Oddetall = innenfor. Håndterer konkave polygoner, som er vanlig for
 * alpinanlegg som følger terrenget.
 *
 * Kanttilfeller: et punkt nøyaktig PÅ kanten kan falle begge veier. Det er
 * akseptabelt her — [insideOrNear] legger uansett en tolleranse rundt, så et
 * grensetilfelle blir tatt av nærhetstesten.
 *
 * Ringen trenger ikke å være lukket; første og siste punkt knyttes sammen.
 */
export function pointInRing(p: GeoPoint, ring: readonly GeoPoint[]): boolean {
    if (ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        // Kanten må spenne over punktets breddegrad: nøyaktig ett av
        // endepunktene ligger over. Formen (a > p) !== (b > p) er halvåpen —
        // den ene enden regnes med, den andre ikke — slik at en node som
        // deles av to kanter telles ÉN gang og ikke to.
        const spans = a.lat > p.lat !== b.lat > p.lat;
        if (!spans) continue;
        const t = (p.lat - a.lat) / (b.lat - a.lat);
        const lonAtLat = a.lon + t * (b.lon - a.lon);
        if (p.lon < lonAtLat) inside = !inside;
    }
    return inside;
}

/**
 * Er punktet i polygonet, eller innenfor [toleranceMeters] av dets
 * bounding box?
 *
 * Nærheten måles mot BOKSEN, ikke mot kanten. Det er med vilje: avstand til
 * en polygonkant er dyrere å regne og vanskeligere å teste, og for formålet
 * her — «ligger heisen ved dette anlegget?» — er boksen presis nok. Prisen er
 * at et punkt utenfor en konkav bukt kan telle som nær; det gjør den mer
 * sjenerøs, aldri mer restriktiv.
 */
export function insideOrNear(
    p: GeoPoint,
    ring: readonly GeoPoint[],
    toleranceMeters: number
): boolean {
    if (pointInRing(p, ring)) return true;
    const b = boundsOf(ring);
    if (!b) return false;
    return pointInBounds(p, padBounds(b, toleranceMeters));
}

/** Sant hvis MINST ETT av punktene er i eller inntil ringen. */
export function anyInsideOrNear(
    points: readonly GeoPoint[],
    ring: readonly GeoPoint[],
    toleranceMeters: number
): boolean {
    return points.some((p) => insideOrNear(p, ring, toleranceMeters));
}
