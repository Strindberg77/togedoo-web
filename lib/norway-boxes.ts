// lib/norway-boxes.ts
//
// NORGE SOM ET FÅTALL BBOKSER, i stedet for én.
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR
//
// Den nasjonale hentingen bruker ÉN boks, `(57.5,4.0,71.5,31.5)`
// ([NATIONAL_BBOX]). Den dekker hele Sverige, Danmark, Finland, Baltikum og
// et stykke inn i Russland, og målingen etter første nasjonale tørrkjøring
// (work-report, sep. 2026) viste hva det koster i objekter:
//
//   aking       91 i Norge,   222 utenfor   (71 % utenfor)
//   skianlegg 4951 i Norge,  8280 utenfor   (63 % utenfor)
//
// Norge er langt og skjevt: Lindesnes ligger på 4,5°Ø og Vardø på 31,2°Ø,
// men de ligger 13 breddegrader fra hverandre. ÉN boks som rommer begge må
// også romme alt som ligger imellom dem i det rektangelet — og det er
// Stockholm, Helsingfors, Riga og St. Petersburg.
//
// Deler man i BREDDEGRADSBÅND forsvinner det meste: den sørligste boksen
// trenger ikke gå lenger øst enn ~12,9°Ø, og den østligste ikke lenger sør
// enn ~68°N.
//
// ─────────────────────────────────────────────────────────────────────────
// AREAL ER EN PROXY, IKKE MÅLINGEN
//
// Denne fila regner ut AREAL. Antall OSM-objekter er ikke proporsjonalt med
// areal — mye av dagens boks er hav, og en stor del av det som fjernes ved
// bånddeling er nettopp hav og tynt befolket Finnmark/Karelen. Arealtallet
// kan derfor hverken bekrefte eller avkrefte en gevinst i objekter.
//
// DEN EKTE MÅLINGEN er `out count;` mot Overpass, én gang per kandidat. Se
// scripts/bbox-candidates.ts, som skriver ut spørringene ferdig.
//
// ─────────────────────────────────────────────────────────────────────────
// MARGIN: HVORFOR BOKSENE IKKE KLIPPER PÅ GRENSA
//
// Bevisspørringen for Skianlegg henter heiser og nedfarter som skal testes
// mot polygonene med [SKI_EVIDENCE_TOLERANCE_M] (50 m) slingringsmonn. Et
// norsk anlegg som ligger INNTIL riksgrensa kan ha en nedfart som så vidt
// krysser over. Klipper boksen nøyaktig på Kartverkets kommunegrense, mister
// det anlegget beviset sitt og faller fra «alpint» til «ikke-alpint» — en
// stille nedgradering.
//
// Derfor legges [BOX_MARGIN_M] på hver boks. Marginen er valgt som en
// størrelsesorden over tolleransen, ikke målt: den koster et smalt bånd
// langs grensa, og prisen for å ta feil andre veien er tapte anlegg.
import { type GeoBounds, type GeoPoint } from './geo-polygon';

/** Meter per breddegrad. Samme konstant som lib/geo-polygon.ts. */
const METERS_PER_DEG_LAT = 111_320;

/**
 * Marginen hver boks utvides med. 2 km, altså 40 × den romlige tolleransen
 * på 50 m. VURDERING, ikke måling — se filhodet.
 */
export const BOX_MARGIN_M = 2_000;

/** Bboksen som Overpass-filter: `(minlat,minlon,maxlat,maxlon)`. */
export function bboxFilter(b: GeoBounds, decimals = 2): string {
    const n = (v: number) => v.toFixed(decimals);
    return `(${n(b.minlat)},${n(b.minlon)},${n(b.maxlat)},${n(b.maxlon)})`;
}

/**
 * Arealet av en boks i km², som et rektangel på midtbreddegraden.
 *
 * Grovt med vilje: dette er et SAMMENLIGNINGSTALL mellom kandidater, ikke en
 * geodetisk størrelse. Feilen er den samme for alle kandidater.
 */
export function boxAreaKm2(b: GeoBounds): number {
    const midLat = ((b.minlat + b.maxlat) / 2 / 180) * Math.PI;
    const km = METERS_PER_DEG_LAT / 1000;
    return (b.maxlat - b.minlat) * km * (b.maxlon - b.minlon) * km * Math.cos(midLat);
}

/** Utvider boksen med `meters` i alle fire retninger. */
export function padBox(b: GeoBounds, meters: number): GeoBounds {
    const dLat = meters / METERS_PER_DEG_LAT;
    const midLat = ((b.minlat + b.maxlat) / 2 / 180) * Math.PI;
    const dLon = meters / (METERS_PER_DEG_LAT * Math.max(0.05, Math.cos(midLat)));
    return {
        minlat: b.minlat - dLat,
        minlon: b.minlon - dLon,
        maxlat: b.maxlat + dLat,
        maxlon: b.maxlon + dLon,
    };
}

export function pointInBox(p: GeoPoint, b: GeoBounds): boolean {
    return p.lat >= b.minlat && p.lat <= b.maxlat && p.lon >= b.minlon && p.lon <= b.maxlon;
}

/**
 * DE OPTIMALE k BÅNDENE over et punktsett, ved dynamisk programmering.
 *
 * Naiv bånddeling (k like høye bånd) er ikke optimal: Norge er bredest i
 * sør og i nord, og smalest på Helgeland. Ved k = 6 ga like høye bånd
 * FAKTISK STØRRE samlet areal enn k = 5, fordi et fast snitt kan legge
 * skillet midt i den brede delen.
 *
 * Her velges snittene i stedet slik at samlet areal blir minst mulig:
 *
 *   levels  — breddegradene et snitt kan legges på, med `step` mellomrom
 *   cost(i,j) — arealet av den stramme boksen rundt alle punkter i
 *               [levels[i], levels[j])
 *   best(j,m) — minste samlede areal for de m første båndene opp til
 *               levels[j]
 *
 * O(levels² · k), altså ~265² · 6 for hele Norge — millisekunder.
 *
 * GARANTIEN: hvert punkt i inndata ligger i minst én boks. Snittene er
 * lukket nedad og åpent oppad, og siste bånd tar med maxlat, så det finnes
 * ingen sprekk mellom to bånd.
 */
export function optimalBands(
    points: readonly GeoPoint[],
    k: number,
    step = 0.05
): GeoBounds[] {
    if (points.length === 0 || k < 1) return [];
    let minlat = Infinity;
    let maxlat = -Infinity;
    for (const p of points) {
        if (p.lat < minlat) minlat = p.lat;
        if (p.lat > maxlat) maxlat = p.lat;
    }
    // Snittkandidatene. Første og siste er alltid med, så boksene dekker
    // ytterpunktene eksakt.
    const levels: number[] = [];
    for (let v = minlat; v < maxlat; v += step) levels.push(v);
    levels.push(maxlat);
    const n = levels.length;
    if (k >= n) k = n - 1;

    // Punktene sortert på lat, så hvert bånd kan leses som et sammenhengende
    // utsnitt i stedet for et filter over hele settet per (i,j).
    const sorted = [...points].sort((a, b) => a.lat - b.lat);
    // startIdx[i] = første punkt med lat >= levels[i]
    const startIdx: number[] = [];
    let p = 0;
    for (let i = 0; i < n; i++) {
        while (p < sorted.length && sorted[p].lat < levels[i]) p++;
        startIdx.push(p);
    }
    startIdx.push(sorted.length);

    // boxOf(i,j): stram boks rundt punktene i [levels[i], levels[j]).
    // Bygges inkrementelt for hver i, så det er O(n · antall punkter) totalt
    // og ikke O(n² · punkter).
    const cost: Float64Array = new Float64Array(n * n).fill(Infinity);
    const lonLo: Float64Array = new Float64Array(n * n);
    const lonHi: Float64Array = new Float64Array(n * n);
    for (let i = 0; i < n - 1; i++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = i + 1; j < n; j++) {
            const from = startIdx[j - 1];
            // Siste bånd må ta med punktene PÅ maxlat.
            const to = j === n - 1 ? sorted.length : startIdx[j];
            for (let q = from; q < to; q++) {
                if (sorted[q].lon < lo) lo = sorted[q].lon;
                if (sorted[q].lon > hi) hi = sorted[q].lon;
            }
            if (lo === Infinity) continue; // tomt bånd: ingen kostnad, ingen boks
            const b = { minlat: levels[i], minlon: lo, maxlat: levels[j], maxlon: hi };
            cost[i * n + j] = boxAreaKm2(b);
            lonLo[i * n + j] = lo;
            lonHi[i * n + j] = hi;
        }
    }

    // best[m][j] = minste samlede areal med m bånd som ender på levels[j]
    const best: number[][] = Array.from({ length: k + 1 }, () => new Array(n).fill(Infinity));
    const from: number[][] = Array.from({ length: k + 1 }, () => new Array(n).fill(-1));
    best[0][0] = 0;
    for (let m = 1; m <= k; m++) {
        for (let j = 1; j < n; j++) {
            for (let i = m - 1; i < j; i++) {
                if (best[m - 1][i] === Infinity) continue;
                const c = cost[i * n + j];
                const tot = best[m - 1][i] + (c === Infinity ? 0 : c);
                if (tot < best[m][j]) {
                    best[m][j] = tot;
                    from[m][j] = i;
                }
            }
        }
    }

    const ut: GeoBounds[] = [];
    let j = n - 1;
    for (let m = k; m >= 1; m--) {
        const i = from[m][j];
        if (i < 0) break;
        if (cost[i * n + j] !== Infinity) {
            ut.push({
                minlat: levels[i],
                minlon: lonLo[i * n + j],
                maxlat: levels[j],
                maxlon: lonHi[i * n + j],
            });
        }
        j = i;
    }
    return ut.reverse();
}

/** Dekker bokssettet HVERT punkt? Returnerer punktene som faller utenfor. */
export function uncovered(
    points: readonly GeoPoint[],
    boxes: readonly GeoBounds[]
): GeoPoint[] {
    return points.filter((p) => !boxes.some((b) => pointInBox(p, b)));
}
