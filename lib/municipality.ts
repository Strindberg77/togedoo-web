// lib/municipality.ts
//
// KOMMUNE FRA ET KOORDINAT, offline.
//
// Fase 2 i skalaplanen. Importen kjører i dag per kommune, så `municipality`
// er chunkens eget navn ([ImportChunk.cityAnchor]). Blir enheten større enn én
// kommune — en flis, et fylke, hele landet — finnes det ikke ett svar for
// chunken, og [rowsMissingCityAnchor] kaster før upsert. Denne modulen er det
// som gjør en slik chunk mulig.
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR PUNKT-I-POLYGON OG IKKE ET OPPSLAG
//
// Kartverkets punktsøk returnerer kommunenavn i samme svar som adressen, og
// er derfor gratis for rader som uansett geokodes. Men det er BARE radene
// UTEN brukbart OSM-navn som geokodes — for ski er ~80 % navngitt (osmium mot
// Geofabrik-fila, sep. 2026), og de ville aldri fått en kommune.
//
// Grensefila dekker begge: null nettverkskall, deterministisk, og den virker
// like godt for en navngitt alpinbakke som for en navnløs lekeplass.
// Normaliseringen av punktsøkets svar («OSLO») hører hjemme HER, sammen med
// utledningen, så de to aldri kan komme i utakt om hva en kommune heter.
//
// ─────────────────────────────────────────────────────────────────────────
// FILA ligger i data/kommuner.geojson (Kartverket, CC BY 4.0). Se
// data/README.md for hvorfor L-kvalitet, og hvordan den oppdateres.
import {
    boundsOf,
    pointInBounds,
    pointInRing,
    type GeoBounds,
    type GeoPoint,
} from './geo-polygon';

/**
 * TOSPRÅKLIGE KOMMUNENAVN, med det navnet appen bruker.
 *
 * Kartverket fører 22 kommuner med to eller tre offisielle navn i én streng,
 * og REKKEFØLGEN VARIERER: «Trondheim - Tråante» har norsk først, «Rosse -
 * Røros» og «Guovdageaidnu - Kautokeino» har samisk først. Å ta «det første
 * leddet» ville derfor gitt «Rosse» og «Guovdageaidnu» — navn ingen søker på
 * i denne appen.
 *
 * DETTE ER ET REDAKSJONELT VALG OM SØKETREFF, ikke en påstand om hvilket navn
 * som er riktigere. By-modus i /api/activities matcher `municipality.ilike.X`
 * UTEN jokertegn, og de 7800 radene som allerede finnes sier «Trondheim».
 * Skrev importen «Trondheim - Tråante», ville samme kolonne inneholdt to
 * former for samme kommune, og Trondheim-chipen ville sluttet å finne de nye
 * radene. Det er den konkrete skaden valget verner mot.
 *
 * NØKKELEN ER KOMMUNENUMMERET, ikke navnet: nummeret er stabilt, navnet er
 * det som kan endres i fila.
 *
 * Kommer en ny tospråklig kommune til i en senere utgave av fila, feiler
 * testen i lib/municipality.test.ts til noen har tatt stilling til navnet.
 */
export const BILINGUAL_MUNICIPALITIES: Readonly<Record<string, string>> = {
    '1826': 'Hattfjelldal', // Aarborte - Hattfjelldal
    '1841': 'Fauske', //       Fauske - Fuossko
    '1853': 'Evenes', //       Evenes - Evenášši
    '1870': 'Sortland', //     Sortland - Suortá
    '1875': 'Hamarøy', //      Hábmer - Hamarøy
    '5001': 'Trondheim', //    Trondheim - Tråante
    '5007': 'Namsos', //       Namsos - Nåavmesjenjaelmie
    '5025': 'Røros', //        Rosse - Røros
    '5041': 'Snåsa', //        Snåase - Snåsa
    '5043': 'Røyrvik', //      Raarvihke - Røyrvik
    '5503': 'Harstad', //      Harstad - Hárstták
    '5512': 'Tjeldsund', //    Dielddanuorri - Tjeldsund
    '5518': 'Lavangen', //     Loabák - Lavangen
    '5538': 'Storfjord', //    Storfjord - Omasvuotna - Omasvuono
    '5540': 'Kåfjord', //      Gáivuotna - Kåfjord - Kaivuono
    '5544': 'Nordreisa', //    Nordreisa - Ráisa - Raisi
    '5603': 'Hammerfest', //   Hammerfest - Hámmerfeasta
    '5610': 'Karasjok', //     Kárášjohka - Karasjok
    '5612': 'Kautokeino', //   Guovdageaidnu - Kautokeino
    '5622': 'Porsanger', //    Porsanger - Porsáŋgu - Porsanki
    '5628': 'Tana', //         Deatnu - Tana
    '5636': 'Nesseby', //      Unjárga - Nesseby
};

/** Formen fila har. Bare feltene vi leser. */
export interface KommuneFeature {
    properties: { kommunenummer?: string; name?: string; kommunenavn?: string };
    geometry: {
        type: 'Polygon' | 'MultiPolygon';
        coordinates: number[][][] | number[][][][];
    };
}

/** Navnet appen bruker for én kommune i fila. */
export function municipalityName(f: KommuneFeature): string {
    const nr = f.properties.kommunenummer ?? '';
    return BILINGUAL_MUNICIPALITIES[nr] ?? f.properties.name ?? f.properties.kommunenavn ?? '';
}

interface Indexed {
    readonly name: string;
    readonly number: string;
    /** Bounding box over ALLE ringene. Forfilteret. */
    readonly bounds: GeoBounds;
    /** Én liste per polygon: [ytre ring, ...hull]. */
    readonly polygons: GeoPoint[][][];
}

export interface MunicipalityIndex {
    /** Kommunen punktet ligger i, eller null om det er utenfor Norge. */
    lookup(lat: number, lng: number): string | null;
    /** Alle kommunenavn appen kjenner, i appens form. */
    readonly names: ReadonlySet<string>;
    readonly count: number;
}

const ring = (coords: number[][]): GeoPoint[] =>
    coords.map(([lon, lat]) => ({ lat, lon }));

/**
 * Bygger oppslaget.
 *
 * BOUNDING BOX FØRST. 357 kommuner med til sammen hundretusenvis av punkter,
 * og ray casting mot alle for hvert sted, ville vært titalls milliarder
 * operasjoner på en nasjonal kjøring. Boksforfilteret kutter det til én eller
 * to kandidater per punkt, og [pointInBounds] er fire sammenligninger.
 */
export function buildMunicipalityIndex(features: readonly KommuneFeature[]): MunicipalityIndex {
    const indexed: Indexed[] = [];
    for (const f of features) {
        const raw =
            f.geometry.type === 'Polygon'
                ? [f.geometry.coordinates as number[][][]]
                : (f.geometry.coordinates as number[][][][]);
        const polygons = raw.map((poly) => poly.map(ring));
        const bounds = boundsOf(polygons.flat(2));
        if (!bounds) continue;
        indexed.push({
            name: municipalityName(f),
            number: f.properties.kommunenummer ?? '',
            bounds,
            polygons,
        });
    }
    const names = new Set(indexed.map((k) => k.name));
    return {
        count: indexed.length,
        names,
        lookup(lat: number, lng: number): string | null {
            const p: GeoPoint = { lat, lon: lng };
            for (const k of indexed) {
                if (!pointInBounds(p, k.bounds)) continue;
                for (const poly of k.polygons) {
                    if (!poly.length || !pointInRing(p, poly[0])) continue;
                    // Hull: et vann eller en enklave inne i kommunen.
                    let iHull = false;
                    for (let i = 1; i < poly.length; i++) {
                        if (pointInRing(p, poly[i])) iHull = true;
                    }
                    if (!iHull) return k.name;
                }
            }
            return null;
        },
    };
}

/**
 * Kommunenavnet i appens form, fra en vilkårlig skrivemåte.
 *
 * Kartverkets punktsøk svarer «OSLO», ikke «Oslo» (målt sep. 2026). Denne
 * funksjonen slår opp mot navnene fila faktisk inneholder, i stedet for å
 * gjette på store og små bokstaver — «SØR-VARANGER» ville blitt feil av enhver
 * naiv tittelkasse, og «Nord-Fron» av en annen.
 *
 * Returnerer null for et navn ingen kommune har. Det er meningen: da skal
 * kallstedet la være å sette feltet framfor å skrive noe det ikke kan stå inne
 * for.
 */
export function canonicalMunicipality(
    raw: string | null | undefined,
    index: Pick<MunicipalityIndex, 'names'>
): string | null {
    const trimmed = raw?.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    for (const n of index.names) if (n.toLowerCase() === lower) return n;
    return null;
}
