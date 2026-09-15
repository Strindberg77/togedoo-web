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
 * Avstand mellom to punkter i meter, ekvirektangulær tilnærming.
 *
 * IKKE haversine, og det er et bevisst valg: alle avstandene denne kodebasen
 * måler er under noen få kilometer, innenfor én norsk kommune. På den skalaen
 * er feilen mot haversine under en promille, og formelen har ingen
 * trigonometri utover den ene cosinusen — samme cos-korreksjon som
 * [padBounds], så de to kan aldri komme i utakt om hva «50 meter østover»
 * betyr.
 *
 * Skal noe en dag måle på tvers av landet, må denne byttes ut. Da er dette
 * kommentaren som sier hvorfor den kunne stå så lenge.
 */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
    const midLat = (a.lat + b.lat) / 2;
    const cos = Math.cos((midLat * Math.PI) / 180);
    const dLat = (a.lat - b.lat) * METERS_PER_DEG_LAT;
    const dLon = (a.lon - b.lon) * METERS_PER_DEG_LAT * Math.max(cos, 0.01);
    return Math.hypot(dLat, dLon);
}

/**
 * Korteste avstand mellom to bounding-bokser, i meter. 0 når de overlapper
 * eller tangerer.
 *
 * SYMMETRISK ved konstruksjon, og det er hele grunnen til at den ikke er
 * skrevet som «padBounds(a, m) overlapper b». Den formen gir cos-korreksjonen
 * fra A SIN midtbreddegrad, og `nær(a, b)` kunne da svart noe annet enn
 * `nær(b, a)`. Her regnes gapet med midtbreddegraden til de to boksene sett
 * under ett, så rekkefølgen ikke kan påvirke svaret — en gruppering som
 * bygger på denne må kunne stole på det.
 */
export function boundsGapMeters(a: GeoBounds, b: GeoBounds): number {
    const gapLat = Math.max(0, a.minlat - b.maxlat, b.minlat - a.maxlat);
    const gapLon = Math.max(0, a.minlon - b.maxlon, b.minlon - a.maxlon);
    const midLat = (a.minlat + a.maxlat + b.minlat + b.maxlat) / 4;
    const cos = Math.cos((midLat * Math.PI) / 180);
    return Math.hypot(
        gapLat * METERS_PER_DEG_LAT,
        gapLon * METERS_PER_DEG_LAT * Math.max(cos, 0.01)
    );
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

/** Som [anyInsideOrNear], men mot FLERE ringer — et multipolygon. */
/** Boksen som rommer alle boksene. null når lista er tom. */
export function boundsUnion(boxes: readonly (GeoBounds | null)[]): GeoBounds | null {
    let ut: GeoBounds | null = null;
    for (const b of boxes) {
        if (!b) continue;
        if (!ut) {
            ut = { ...b };
            continue;
        }
        ut = {
            minlat: Math.min(ut.minlat, b.minlat),
            minlon: Math.min(ut.minlon, b.minlon),
            maxlat: Math.max(ut.maxlat, b.maxlat),
            maxlon: Math.max(ut.maxlon, b.maxlon),
        };
    }
    return ut;
}

/** Overlapper de to boksene, eller tangerer de? */
export function boundsOverlap(a: GeoBounds, b: GeoBounds): boolean {
    return (
        a.minlat <= b.maxlat &&
        b.minlat <= a.maxlat &&
        a.minlon <= b.maxlon &&
        b.minlon <= a.maxlon
    );
}

/**
 * BOKSEN ET OBJEKT MÅ RØRE for at [anyInsideOrNearAny] kan være sann.
 *
 * FORKASTNINGSFILTERET for den romlige testen, og grunnen til at den skalerer
 * nasjonalt. [insideOrNear] er sann hvis punktet ligger i ringen ELLER i
 * ringens boks utvidet med toleransen — og et punkt inne i ringen ligger per
 * definisjon også inne i ringens boks. Begge grenene innebærer derfor at
 * punktet ligger i den UTVIDEDE boksen, og et objekt som ikke rører den kan
 * umulig treffe.
 *
 * UNIONEN AV HVER RINGS EGEN UTVIDEDE BOKS, ikke den utvidede unionen.
 * Forskjellen er ikke kosmetisk: [padBounds] regner om meter til lengdegrader
 * med boksens EGEN midtbreddegrad, og en union fra Lindesnes til Nordkapp har
 * en annen midtbreddegrad enn en ring i Finnmark. Utvidet etter unionen ville
 * padding i øst/vest blitt smalere enn den ringen faktisk krever, og filteret
 * kunne forkastet et ekte treff. Slik det står er boksen et OVERSETT av det
 * [anyInsideOrNearAny] tester, og filteret kan bare forkaste sanne negativer.
 */
export function rejectBoundsFor(
    rings: readonly (readonly GeoPoint[])[],
    toleranceMeters: number
): GeoBounds | null {
    return boundsUnion(
        rings.map((r) => {
            const b = boundsOf(r);
            return b ? padBounds(b, toleranceMeters) : null;
        })
    );
}

export function anyInsideOrNearAny(
    points: readonly GeoPoint[],
    rings: readonly (readonly GeoPoint[])[],
    toleranceMeters: number
): boolean {
    return rings.some((ring) => anyInsideOrNear(points, ring, toleranceMeters));
}

/** To punkter er samme node når de er under ~1 cm fra hverandre.
 *  Overpass skriver ut samme node med identiske desimaler i begge ways den
 *  deles av, så eksakt likhet ville holdt — epsilon er billig forsikring. */
const JOIN_EPS = 1e-7;

function same(a: GeoPoint, b: GeoPoint): boolean {
    return Math.abs(a.lat - b.lat) < JOIN_EPS && Math.abs(a.lon - b.lon) < JOIN_EPS;
}

function isClosed(ring: readonly GeoPoint[]): boolean {
    return ring.length >= 4 && same(ring[0], ring[ring.length - 1]);
}

/**
 * Setter sammen ringer fra løse linjestykker — et multipolygons ytre kant.
 *
 * HVORFOR DEN TRENGS: en OSM-relation lagrer ikke en ferdig ring. Den ytre
 * kanten er ofte delt på flere member-ways, hver med sin egen retning, og
 * Overpass leverer dem som de er. Ray casting på en usortert punktmengde gir
 * tilfeldige svar — derfor må stykkene syes sammen FØR de testes.
 *
 * Algoritmen er grådig: start på et stykke, forleng i enden med et stykke som
 * deler endepunkt (snu det om nødvendig), til ringen lukker seg. Finnes ingen
 * fortsettelse, er ringen ufullstendig og FORKASTES — en åpen ring er ikke et
 * polygon, og å teste mot den ville gitt vilkårlige treff.
 *
 * Kallstedet må derfor ha en fallback for relations der sammensyingen ikke
 * lykkes (ødelagt multipolygon i OSM, eller medlemmer utenfor spørringens
 * område). Der brukes Overpass sin egen `bounds`.
 */
export function assembleRings(
    segments: readonly (readonly GeoPoint[])[]
): GeoPoint[][] {
    const pool = segments.filter((s) => s.length >= 2).map((s) => [...s]);
    const rings: GeoPoint[][] = [];

    while (pool.length > 0) {
        let ring = pool.shift()!;
        // Et medlem kan alt være en lukket ring (øy eller enkel ytterkant).
        let extended = true;
        while (!isClosed(ring) && extended) {
            extended = false;
            const end = ring[ring.length - 1];
            for (let i = 0; i < pool.length; i++) {
                const seg = pool[i];
                if (same(seg[0], end)) {
                    ring = ring.concat(seg.slice(1));
                } else if (same(seg[seg.length - 1], end)) {
                    ring = ring.concat([...seg].reverse().slice(1));
                } else {
                    continue;
                }
                pool.splice(i, 1);
                extended = true;
                break;
            }
        }
        // Kun lukkede ringer er polygoner. Resten kastes bevisst.
        if (isClosed(ring)) rings.push(ring);
    }
    return rings;
}
