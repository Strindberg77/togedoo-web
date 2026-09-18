// lib/kart.ts
//
// /api/kart: hele kartutsnittet, ærlig. Kontrakten står i docs/api-kart.md.
//
// Kartet i appen brukte /api/activities med bbox, som sorterer på avstand fra
// BRUKEREN og kutter på 100. Over Oslo sentrum ga det 100 av 1250 steder —
// en klatt innen 950 m fra posisjonen — og samme 100 igjen når kartet ble
// flyttet 2 km. Her får kartet totalen, og enten alle stedene eller klynger
// som dekker hele utsnittet. Selve tellingen og klyngingen skjer i
// activities_map (migrasjon 0018); denne modulen velger rutenett og former
// svaret, og er ren så den kan testes uten base.
import { toApiShape, type ActivityRow } from './activity-shape';
import { QueryParamError, parseBbox, type Bbox } from './activities-query';

/**
 * Så mange steder viser kartet som enkeltmarkører; flere gir klynger.
 *
 * 150, fordi et kart på telefon er rundt 400 × 700 pt og en markør 32 pt:
 * ved 150 dekker markørene omtrent halve flaten og overlapper alt, og hver
 * er en egen widget i flutter_map. Over det er en markør per sted verken
 * lesbart eller raskt. Terskelen sendes i svaret, så appen aldri må vite den.
 */
export const KART_TERSKEL = 150;

/** Kolonner i klyngerutenettet. Radene følger utsnittets form. */
export const KART_KOLONNER = 6;
const MIN_RADER = 4;
const MAX_RADER = 12;

export interface Rutenett {
    kolonner: number;
    rader: number;
}

/**
 * Rutenettet for et utsnitt: 6 kolonner, og så mange rader at rutene blir
 * omtrent kvadratiske i KILOMETER — ikke i grader. Én lengdegrad er 56 km
 * på Oslos breddegrad og 37 km i Tromsø; uten korrigering ville rutene blitt
 * høye og smale, og klyngene stablet i søyler.
 *
 * Aldri mer enn 6 × 12 = 72 ruter, og tomme ruter gir ingen boble. Et
 * stående telefonkart (høyere enn bredt) får 10–12 rader.
 */
export function rutenettFor(bbox: Bbox): Rutenett {
    const midtLat = ((bbox.south + bbox.north) / 2) * (Math.PI / 180);
    const breddeKm = (bbox.east - bbox.west) * 111.32 * Math.cos(midtLat);
    const hoydeKm = (bbox.north - bbox.south) * 110.57;
    const rader =
        breddeKm > 0
            ? Math.round((KART_KOLONNER * hoydeKm) / breddeKm)
            : MAX_RADER;
    return {
        kolonner: KART_KOLONNER,
        rader: Math.min(MAX_RADER, Math.max(MIN_RADER, rader)),
    };
}

/**
 * Utsnittet /api/kart krever. I motsetning til /api/activities er bbox her
 * PÅKREVD, og det må ha utstrekning: et utsnitt med null bredde har ingen
 * ruter å dele inn i.
 */
export function parseKartBbox(raw: string | null | undefined): Bbox {
    const bbox = parseBbox(raw);
    if (!bbox) throw new QueryParamError('bbox mangler: vest,sør,øst,nord.');
    if (bbox.west === bbox.east || bbox.south === bbox.north) {
        throw new QueryParamError('bbox må ha utstrekning i begge retninger.');
    }
    return bbox;
}

/**
 * Rutas eget utsnitt, så appen kan zoome inn på en klynge ved trykk og få
 * nøyaktig stedene som ligger i den.
 */
export function ruteBbox(cx: number, cy: number, bbox: Bbox, grid: Rutenett): Bbox {
    const dx = (bbox.east - bbox.west) / grid.kolonner;
    const dy = (bbox.north - bbox.south) / grid.rader;
    return {
        west: bbox.west + cx * dx,
        south: bbox.south + cy * dy,
        east: bbox.west + (cx + 1) * dx,
        north: bbox.south + (cy + 1) * dy,
    };
}

/** Svaret fra activities_map (migrasjon 0018). */
export interface KartRpcSvar {
    total: number;
    modus: 'steder' | 'klynger';
    steder?: ActivityRow[];
    klynger?: {
        cx: number;
        cy: number;
        antall: number;
        lat: number;
        lng: number;
        kategorier: Record<string, number> | null;
    }[];
}

export interface Klynge {
    antall: number;
    /** Tyngdepunktet: snittet av stedene i ruta, ikke rutas midte. */
    lat: number;
    lng: number;
    /** Antall per kategori, størst først. */
    kategorier: Record<string, number>;
    /** Rutas utsnitt, vest,sør,øst,nord — til å zoome inn på klyngen. */
    bbox: [number, number, number, number];
}

/**
 * activities_map-svaret → det /api/kart sender. Stedene får samme form som i
 * /api/activities (toApiShape), så appen kan åpne detaljarket rett fra en
 * markør.
 */
export function formKartSvar(rpc: KartRpcSvar, bbox: Bbox, grid: Rutenett) {
    const klynger: Klynge[] =
        rpc.modus === 'klynger'
            ? (rpc.klynger ?? []).map((k) => {
                  const b = ruteBbox(k.cx, k.cy, bbox, grid);
                  const kategorier = Object.fromEntries(
                      Object.entries(k.kategorier ?? {}).sort((a, z) => z[1] - a[1])
                  );
                  return {
                      antall: k.antall,
                      lat: k.lat,
                      lng: k.lng,
                      kategorier,
                      bbox: [b.west, b.south, b.east, b.north],
                  };
              })
            : [];
    return {
        success: true,
        modus: rpc.modus,
        total: rpc.total,
        terskel: KART_TERSKEL,
        rutenett: grid,
        data: rpc.modus === 'steder' ? (rpc.steder ?? []).map((r) => toApiShape(r)) : [],
        klynger,
        attribution:
            'Stedsdata © OpenStreetMap contributors (ODbL) — openstreetmap.org/copyright',
        timestamp: new Date().toISOString(),
    };
}
