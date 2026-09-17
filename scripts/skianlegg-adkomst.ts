// scripts/skianlegg-adkomst.ts
//
// HVOR MØTER MAN OPP? Kandidater til adkomstpunkt for de store alpinanleggene.
//
//   set -a && source .env.local && set +a
//   npx --yes tsx scripts/skianlegg-adkomst.ts
//
// SKRIVER INGENTING TIL BASEN. Leser tre rader og Skianlegg-radene rundt dem,
// henter OSM og høyder, og skriver en markdown-rapport til `--ut`. Velger
// ingenting: rapporten er en kandidatliste for et menneske.
//
// ─────────────────────────────────────────────────────────────────────────
// PROBLEMET. Importen setter punktet til polygonets bbox-senter. For et
// anlegg som dekker en hel fjellside havner det oppe i bakken — Voss Resort
// sitt punkt ligger på 658 moh. (Kartverket), mens gondolen går fra sentrum
// på 58 moh. En veibeskrivelse dit er ubrukelig.
//
// ─────────────────────────────────────────────────────────────────────────
// TRE SPØRRINGER PER ANLEGG, alle små, mellomlagret som i
// scripts/skianlegg-flatemaal.ts (samme [hent], samme fingeravtrykknøkkel):
//
//   objekt   selve polygonet, out geom
//   heiser   aerialway-ways + aerialway=station-noder i paddet boks
//   adkomst  parkering, billettsalg, info, stasjoner i paddet boks
//
// Pluss ett kall for delflatene (child ski area, Alphapark) og høyder fra
// Kartverket (ws.geonorge.no/hoydedata), mellomlagret på samme måte.
//
// ─────────────────────────────────────────────────────────────────────────
// DALSTASJON ELLER TOPPSTASJON. OSM-konvensjonen er at en aerialway tegnes
// oppover, men den brytes. Høyden avgjør derfor, og tegneretningen brukes
// bare når høyden mangler. Rapporten sier hvilken av dem som ble brukt.
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    assembleRings,
    boundsOf,
    distanceMeters,
    padBounds,
    pointInRing,
    type GeoBounds,
    type GeoPoint,
} from '../lib/geo-polygon';
import { fingerprint } from '../lib/import-chunks';
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';
import { bboxFilter, hent, type OsmElement } from './skianlegg-flatemaal';

const arg = (navn: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${navn}=`))?.slice(navn.length + 3);

export const ANLEGG = [
    { osmId: 'relation/4107373', kort: 'voss' },
    { osmId: 'way/1210019615', kort: 'trysil' },
    { osmId: 'relation/17004845', kort: 'geilo' },
] as const;

/** Delflatene spørsmål 5 og 6 gjelder, med anlegget de kanske hører til. */
export const DELFLATER = [
    { osmId: 'way/55606470', mor: 'way/1210019615' },
    { osmId: 'way/1348055350', mor: 'relation/4107373' },
] as const;

/** Heiser hentes vidt: Voss-gondolen starter ~3 km fra polygonet. */
const HEIS_MARGIN_M = 3000;
const ADKOMST_MARGIN_M = 1500;
/** En heis er «ved anlegget» når et punkt på den er inne i eller så nær kanten. */
const HEIS_VED_ANLEGG_M = 300;
/** Dalstasjoner nærmere enn dette er samme base. */
const BASE_RADIUS_M = 400;
/** Bunnen av en heis så nær toppen av en annen er en mellomstasjon … */
const MELLOMSTASJON_M = 150;
/** … men bare når den andre heisen faktisk løfter deg opp dit. */
const MELLOMSTASJON_LOFT_M = 100;
const PAUSE_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// SPØRRINGENE
// ---------------------------------------------------------------------------

/** `relation/1` → `relation(1);` */
export function idSetning(osmId: string): string {
    const [type, id] = osmId.split('/');
    if (!/^(way|relation|node)$/.test(type) || !/^\d+$/.test(id)) {
        throw new Error(`Ugyldig OSM-id: ${osmId}`);
    }
    return `${type}(${id});`;
}

export function qObjekt(osmIds: readonly string[]): string {
    return `[out:json][timeout:60];\n(\n  ${osmIds.map(idSetning).join('\n  ')}\n);\nout geom;`;
}

/**
 * `out geom` og IKKE `out geom tags`: ordet `tags` slår av medlemslista på
 * relasjoner (se OUT_GEOM_TAGS i import-places). Stasjonsnodene får lat/lon
 * av samme `out geom`.
 */
export function qHeiser(b: GeoBounds): string {
    const bb = bboxFilter(padBounds(b, HEIS_MARGIN_M));
    return (
        `[out:json][timeout:90];\n(\n` +
        `  way["aerialway"]["aerialway"!~"^(station|pylon|goods)$"]${bb};\n` +
        `  node["aerialway"="station"]${bb};\n` +
        `);\nout geom;`
    );
}

export function qAdkomst(b: GeoBounds): string {
    const bb = bboxFilter(padBounds(b, ADKOMST_MARGIN_M));
    const deler = [
        `nwr["amenity"="parking"]${bb};`,
        `nwr["shop"="ticket"]${bb};`,
        `nwr["vending"="admission_tickets"]${bb};`,
        `nwr["tourism"="information"]["information"="office"]${bb};`,
        `nwr["name"~"billett|heiskort|skipass|ticket|skiservice",i]${bb};`,
        `nwr["railway"="station"]${bb};`,
        `nwr["amenity"="bus_station"]${bb};`,
    ];
    return `[out:json][timeout:90];\n(\n  ${deler.join('\n  ')}\n);\nout center tags;`;
}

// ---------------------------------------------------------------------------
// GEOMETRI
// ---------------------------------------------------------------------------

/**
 * Ytterringene, SYDD SAMMEN. Voss-relasjonens ytterkant er to åpne ways;
 * uten [assembleRings] testes hver av dem som om den var lukket, og svaret
 * blir vilkårlig. (Samme feil finnes i ringerAv i skianlegg-flatemaal.ts —
 * se docs/skianlegg-adkomst.md.)
 */
export function ringer(el: OsmElement): GeoPoint[][] {
    if (el.type === 'way') return el.geometry && el.geometry.length >= 3 ? [el.geometry] : [];
    const ytre = (el.members ?? [])
        .filter((m) => m.type === 'way' && (m.role ?? 'outer') !== 'inner')
        .map((m) => (m.geometry ?? []).map((g) => ({ lat: g.lat, lon: g.lon })));
    return assembleRings(ytre);
}

/** Korteste avstand fra punktet til et linjestykke, i meter (lokal projeksjon). */
function tilStykke(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
    const m = 111_320;
    const cos = Math.cos((p.lat * Math.PI) / 180);
    const ax = (a.lon - p.lon) * m * cos;
    const ay = (a.lat - p.lat) * m;
    const bx = (b.lon - p.lon) * m * cos;
    const by = (b.lat - p.lat) * m;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    return Math.hypot(ax + t * dx, ay + t * dy);
}

/** 0 når punktet er inne i en av ringene, ellers avstand til nærmeste kant. */
export function avstandTilPolygon(p: GeoPoint, rs: readonly GeoPoint[][]): number {
    if (rs.some((r) => pointInRing(p, r))) return 0;
    let min = Infinity;
    for (const r of rs) {
        for (let i = 0; i < r.length; i++) {
            min = Math.min(min, tilStykke(p, r[i], r[(i + 1) % r.length]));
        }
    }
    return min;
}

export interface Heis {
    readonly id: string;
    readonly navn: string | null;
    readonly type: string;
    readonly bunn: GeoPoint;
    readonly topp: GeoPoint;
    readonly bunnMoh: number | null;
    readonly toppMoh: number | null;
    /** 'høyde' når Kartverket avgjorde, 'tegneretning' når høyden manglet. */
    readonly avgjortAv: 'høyde' | 'tegneretning';
    readonly tags: Record<string, string>;
}

/**
 * Hvilken ende er bunnen? Den laveste, når begge høyder finnes. Ellers
 * tegneretningen (første node), som er OSM-konvensjonen for aerialway.
 */
export function orienter(
    forste: GeoPoint,
    siste: GeoPoint,
    moh: (p: GeoPoint) => number | null
): Pick<Heis, 'bunn' | 'topp' | 'bunnMoh' | 'toppMoh' | 'avgjortAv'> {
    const a = moh(forste);
    const b = moh(siste);
    if (a !== null && b !== null) {
        return a <= b
            ? { bunn: forste, topp: siste, bunnMoh: a, toppMoh: b, avgjortAv: 'høyde' }
            : { bunn: siste, topp: forste, bunnMoh: b, toppMoh: a, avgjortAv: 'høyde' };
    }
    return { bunn: forste, topp: siste, bunnMoh: a, toppMoh: b, avgjortAv: 'tegneretning' };
}

/**
 * DALSTASJONER: bunnen av en heis som IKKE ligger ved toppen av en annen.
 * En heis som starter der en annen slutter er en mellomstasjon — dit kommer
 * man på ski, ikke med bil.
 *
 * LØFTET MÅ VÆRE EKTE. Første versjon krevde bare nærhet, og merket hele
 * Turistsenteret i Trysil (gondolen, 415 moh.) som mellomstasjon: rullebånd
 * og barnetrekk på 2–65 høydemeter har toppen sin ved bunnen av de store
 * heisene. Et barnetrekk bringer ingen opp til en ny base.
 *
 * «Dal» betyr ikke «bilvei». Horgaletten på Voss er dal etter denne regelen
 * og ligger på 791 moh. uten parkering; parkeringskolonnen skiller dem.
 */
export function erDalstasjon(h: Heis, alle: readonly Heis[]): boolean {
    return !alle.some(
        (a) =>
            a.id !== h.id &&
            a.bunnMoh !== null &&
            a.toppMoh !== null &&
            a.toppMoh - a.bunnMoh >= MELLOMSTASJON_LOFT_M &&
            distanceMeters(h.bunn, a.topp) <= MELLOMSTASJON_M
    );
}

/**
 * Enkeltlenke-klynging av punkter innenfor [radius]. Samme form som
 * akingClusters: henger A med B og B med C, er alle tre samme base.
 */
export function klynger<T>(ting: readonly T[], punkt: (t: T) => GeoPoint, radius: number): T[][] {
    const forelder = ting.map((_, i) => i);
    const rot = (i: number): number => (forelder[i] === i ? i : (forelder[i] = rot(forelder[i])));
    for (let i = 0; i < ting.length; i++) {
        for (let j = i + 1; j < ting.length; j++) {
            if (distanceMeters(punkt(ting[i]), punkt(ting[j])) <= radius) forelder[rot(i)] = rot(j);
        }
    }
    const grupper = new Map<number, T[]>();
    ting.forEach((t, i) => {
        const r = rot(i);
        grupper.set(r, [...(grupper.get(r) ?? []), t]);
    });
    return [...grupper.values()];
}

// ---------------------------------------------------------------------------
// HØYDER — Kartverket, mellomlagret som Overpass-svarene
// ---------------------------------------------------------------------------

const nokkel = (p: GeoPoint) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

async function hoyder(cacheDir: string, punkter: readonly GeoPoint[]): Promise<Map<string, number | null>> {
    const unike = [...new Map(punkter.map((p) => [nokkel(p), p])).values()];
    const ut = new Map<string, number | null>();
    for (let i = 0; i < unike.length; i += 50) {
        const bit = unike.slice(i, i + 50);
        const url =
            'https://ws.geonorge.no/hoydedata/v1/punkt?koordsys=4258&punkter=' +
            encodeURIComponent(JSON.stringify(bit.map((p) => [+p.lon.toFixed(5), +p.lat.toFixed(5)])));
        const fil = path.join(cacheDir, `hoyde-${fingerprint(url)}.json`);
        let svar: { punkter: { x: number; y: number; z: number | null }[] };
        if (fs.existsSync(fil)) {
            svar = JSON.parse(fs.readFileSync(fil, 'utf8'));
        } else {
            const res = await fetch(url, { headers: { 'User-Agent': 'Togedoo datahub (hello@togedoo.com)' } });
            if (!res.ok) throw new Error(`Kartverket høydedata ${res.status}`);
            svar = await res.json();
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(`${fil}.tmp`, JSON.stringify(svar));
            fs.renameSync(`${fil}.tmp`, fil);
            console.log(`  [hentet] høyder: ${bit.length} punkter`);
            await sleep(500);
        }
        svar.punkter.forEach((p, k) => ut.set(nokkel(bit[k]), p.z ?? null));
    }
    return ut;
}

// ---------------------------------------------------------------------------
// KJØRINGEN
// ---------------------------------------------------------------------------

interface DbRad {
    id: string;
    external_id: string;
    title: string;
    lat: number;
    lng: number;
    status: string;
    url: string | null;
    municipality: string | null;
}

const m = (n: number) => (n === 0 ? 'inne' : `${Math.round(n)} m`);
const km = (n: number) => (n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(1)} km`);
const k = (p: GeoPoint) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
const osmLenke = (id: string) => `[${id}](https://www.openstreetmap.org/${id})`;
const punktAv = (el: OsmElement): GeoPoint | null =>
    el.center
        ? { lat: el.center.lat, lon: el.center.lon }
        : typeof el.lat === 'number' && typeof el.lon === 'number'
          ? { lat: el.lat, lon: el.lon }
          : null;

async function main(cacheDir: string, utDir: string): Promise<void> {
    if (!isDatahubConfigured()) throw new Error('Mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (kun lesing).');
    const db = supabaseAdmin();
    const linjer: string[] = [];
    const skriv = (s = '') => linjer.push(s);

    // ── delflatene først: ett kall ─────────────────────────────────────────
    const delRaa = await hent(cacheDir, 'delflater', qObjekt(DELFLATER.map((d) => d.osmId)));

    for (const [ai, a] of ANLEGG.entries()) {
        if (ai > 0) await sleep(PAUSE_MS);
        const [obj] = await hent(cacheDir, `objekt-${a.kort}`, qObjekt([a.osmId]));
        if (!obj) throw new Error(`${a.osmId} kom ikke tilbake fra Overpass`);
        const rs = ringer(obj);
        if (!rs.length) throw new Error(`${a.osmId}: ingen lukket ring etter sammensying`);
        const boks = boundsOf(rs.flat())!;
        await sleep(PAUSE_MS);
        const heisRaa = await hent(cacheDir, `heiser-${a.kort}`, qHeiser(boks));
        await sleep(PAUSE_MS);
        const adkRaa = await hent(cacheDir, `adkomst-${a.kort}`, qAdkomst(boks));

        const { data: rad, error } = await db
            .from('activities')
            .select('id, external_id, title, lat, lng, status, url, municipality')
            .eq('external_id', a.osmId)
            .maybeSingle<DbRad>();
        if (error) throw error;
        if (!rad) throw new Error(`${a.osmId} finnes ikke i basen`);
        const dagens: GeoPoint = { lat: rad.lat, lon: rad.lng };

        // Andre Skianlegg-rader med punkt i polygonet.
        const pb = padBounds(boks, 200);
        const { data: naboer, error: e2 } = await db
            .from('activities')
            .select('id, external_id, title, lat, lng, status, url, municipality')
            .eq('category', 'Skianlegg')
            .gte('lat', pb.minlat)
            .lte('lat', pb.maxlat)
            .gte('lng', pb.minlon)
            .lte('lng', pb.maxlon)
            .returns<DbRad[]>();
        if (e2) throw e2;

        // ── heiser ────────────────────────────────────────────────────────
        const stasjoner = heisRaa.filter((el) => el.type === 'node');
        const heisWays = heisRaa.filter((el) => el.type === 'way' && (el.geometry?.length ?? 0) >= 2);
        const endepunkter = heisWays.flatMap((w) => [w.geometry![0], w.geometry![w.geometry!.length - 1]]);
        const adkPunkter = adkRaa.map(punktAv).filter((p): p is GeoPoint => Boolean(p));
        const moh = await hoyder(cacheDir, [dagens, ...endepunkter, ...adkPunkter]);
        const mohAv = (p: GeoPoint) => moh.get(nokkel(p)) ?? null;

        const alleHeiser: Heis[] = heisWays.map((w) => {
            const g = w.geometry!;
            return {
                id: `way/${w.id}`,
                navn: w.tags?.name ?? null,
                type: w.tags?.aerialway ?? '?',
                tags: (w.tags ?? {}) as Record<string, string>,
                ...orienter(g[0], g[g.length - 1], mohAv),
            };
        });
        const heiser = alleHeiser.filter((h) =>
            heisWays
                .find((w) => `way/${w.id}` === h.id)!
                .geometry!.some((p) => avstandTilPolygon(p, rs) <= HEIS_VED_ANLEGG_M)
        );
        const stasjonNavn = (p: GeoPoint): string | null => {
            const s = stasjoner
                .map((st) => ({ st, d: distanceMeters(p, { lat: st.lat!, lon: st.lon! }) }))
                .filter((x) => x.d <= 60 && x.st.tags?.name)
                .sort((x, y) => x.d - y.d)[0];
            return s ? s.st.tags!.name! : null;
        };
        const daler = heiser.filter((h) => erDalstasjon(h, heiser));

        // ── adkomst ───────────────────────────────────────────────────────
        const adkomst = adkRaa
            .map((el) => ({ el, p: punktAv(el) }))
            .filter((x): x is { el: OsmElement; p: GeoPoint } => Boolean(x.p))
            .map((x) => ({
                ...x,
                id: `${x.el.type}/${x.el.id}`,
                tilKant: avstandTilPolygon(x.p, rs),
                tilDal: Math.min(Infinity, ...daler.map((d) => distanceMeters(x.p, d.bunn))),
            }));
        const erParkering = (el: OsmElement) => el.tags?.amenity === 'parking';
        const parkering = adkomst.filter(
            (x) => erParkering(x.el) && (x.tilKant <= 400 || x.tilDal <= BASE_RADIUS_M)
        );
        const ovrig = adkomst.filter(
            (x) => !erParkering(x.el) && (x.tilKant <= 1000 || x.tilDal <= 500)
        );

        // ── rapport ───────────────────────────────────────────────────────
        const t = (obj.tags ?? {}) as Record<string, string>;
        skriv(`## ${rad.title} — ${osmLenke(a.osmId)}`);
        skriv();
        skriv(`Dagens punkt: \`${k(dagens)}\`, ${mohAv(dagens) ?? '?'} moh., ${avstandTilPolygon(dagens, rs) === 0 ? "inne i polygonet" : `${m(avstandTilPolygon(dagens, rs))} utenfor polygonet`}. Rad-id \`${rad.id}\`, status ${rad.status}.`);
        skriv(`Ringer etter sammensying: ${rs.length}. Boks: ${k({ lat: boks.minlat, lon: boks.minlon })} → ${k({ lat: boks.maxlat, lon: boks.maxlon })}.`);
        skriv();
        skriv('### OSM-tagger på polygonet');
        skriv();
        skriv('| tagg | verdi |');
        skriv('|---|---|');
        for (const [kk, v] of Object.entries(t).sort()) skriv(`| \`${kk}\` | ${v} |`);
        skriv();
        const operatorer = new Map<string, number>();
        for (const h of heiser) for (const kk of ['operator', 'website']) {
            if (h.tags[kk]) operatorer.set(`${kk}=${h.tags[kk]}`, (operatorer.get(`${kk}=${h.tags[kk]}`) ?? 0) + 1);
        }
        if (operatorer.size) {
            skriv('Tagger på heisene i anlegget (antall heiser):');
            skriv();
            for (const [kk, n] of [...operatorer].sort((x, y) => y[1] - x[1])) skriv(`- \`${kk}\` × ${n}`);
            skriv();
        }

        skriv(`### Heiser ved anlegget (${heiser.length}), dalstasjoner først`);
        skriv();
        skriv('| | heis | type | bunn (koordinat) | moh bunn→topp | bunnstasjon i OSM | til polygon | til dagens punkt | avgjort av |');
        skriv('|---|---|---|---|---|---|---|---|---|');
        const sortert = [...heiser].sort(
            (x, y) => Number(erDalstasjon(y, heiser)) - Number(erDalstasjon(x, heiser)) || (x.bunnMoh ?? 0) - (y.bunnMoh ?? 0)
        );
        for (const h of sortert) {
            skriv(
                `| ${erDalstasjon(h, heiser) ? '**dal**' : 'mellom'} | ${h.navn ?? '_uten navn_'} ${osmLenke(h.id)} | ${h.type} | \`${k(h.bunn)}\` | ${h.bunnMoh?.toFixed(0) ?? '?'}→${h.toppMoh?.toFixed(0) ?? '?'} | ${stasjonNavn(h.bunn) ?? '—'} | ${m(avstandTilPolygon(h.bunn, rs))} | ${km(distanceMeters(h.bunn, dagens))} | ${h.avgjortAv} |`
            );
        }
        skriv();

        skriv(`### Parkering (${parkering.length}) — inne i, ≤ 400 m fra kanten, eller ≤ ${BASE_RADIUS_M} m fra en dalstasjon`);
        skriv();
        skriv('| parkering | koordinat | moh | kapasitet | avgift | adgang | til polygon | nærmeste dalstasjon | til dagens punkt |');
        skriv('|---|---|---|---|---|---|---|---|---|');
        for (const x of [...parkering].sort((p, q) => p.tilDal - q.tilDal)) {
            const tg = x.el.tags ?? {};
            const nd = daler
                .map((d) => ({ d, avst: distanceMeters(x.p, d.bunn) }))
                .sort((p, q) => p.avst - q.avst)[0];
            skriv(
                `| ${tg.name ?? '_uten navn_'} ${osmLenke(x.id)} | \`${k(x.p)}\` | ${mohAv(x.p)?.toFixed(0) ?? '?'} | ${tg.capacity ?? '—'} | ${tg.fee ?? '—'} | ${tg.access ?? '—'} | ${m(x.tilKant)} | ${nd ? `${nd.d.navn ?? nd.d.id} (${km(nd.avst)})` : '—'} | ${km(distanceMeters(x.p, dagens))} |`
            );
        }
        skriv();

        skriv(`### Billettsalg, info, stasjoner (${ovrig.length})`);
        skriv();
        skriv('| navn | tagger | koordinat | moh | til polygon | til dagens punkt |');
        skriv('|---|---|---|---|---|---|');
        for (const x of [...ovrig].sort((p, q) => p.tilDal - q.tilDal)) {
            const tg = x.el.tags ?? {};
            const typ = ['amenity', 'shop', 'tourism', 'information', 'railway', 'vending', 'public_transport']
                .filter((kk) => tg[kk])
                .map((kk) => `${kk}=${tg[kk]}`)
                .join(' ');
            skriv(
                `| ${tg.name ?? '_uten navn_'} ${osmLenke(x.id)} | ${typ} | \`${k(x.p)}\` | ${mohAv(x.p)?.toFixed(0) ?? '?'} | ${m(x.tilKant)} | ${km(distanceMeters(x.p, dagens))} |`
            );
        }
        skriv();

        // ── baser: dalstasjoner klynget, med parkering rundt ────────────────
        const baser = klynger(daler, (d) => d.bunn, BASE_RADIUS_M);
        skriv(`### Baser (dalstasjoner innenfor ${BASE_RADIUS_M} m av hverandre)`);
        skriv();
        skriv('| base | heiser | laveste heis | parkering ≤ 400 m (antall / sum kapasitet) | billett/info ≤ 400 m |');
        skriv('|---|---|---|---|---|');
        for (const b of baser.sort((x, y) => Math.min(...x.map((h) => h.bunnMoh ?? 9e9)) - Math.min(...y.map((h) => h.bunnMoh ?? 9e9)))) {
            const lav = [...b].sort((x, y) => (x.bunnMoh ?? 9e9) - (y.bunnMoh ?? 9e9))[0];
            const nesteP = adkomst.filter((x) => erParkering(x.el) && b.some((h) => distanceMeters(x.p, h.bunn) <= 400));
            const kap = nesteP.reduce((s, x) => s + (Number(x.el.tags?.capacity) || 0), 0);
            const nesteO = ovrig.filter((x) => b.some((h) => distanceMeters(x.p, h.bunn) <= 400));
            skriv(
                `| \`${k(lav.bunn)}\` (${lav.bunnMoh?.toFixed(0) ?? '?'} moh) | ${b.map((h) => h.navn ?? h.id).join(', ')} | ${lav.navn ?? lav.id} (${lav.type}) | ${nesteP.length} / ${kap || '?'} | ${nesteO.map((x) => x.el.tags?.name ?? x.id).join(', ') || '—'} |`
            );
        }
        skriv();

        skriv('### Andre Skianlegg-rader i basen med punkt i polygonet');
        skriv();
        const inni = (naboer ?? []).filter(
            (r) => r.external_id !== a.osmId && avstandTilPolygon({ lat: r.lat, lon: r.lng }, rs) === 0
        );
        if (!inni.length) skriv('Ingen.');
        for (const r of inni) skriv(`- ${r.title} \`${r.external_id}\` (${r.status}) \`${r.lat}, ${r.lng}\``);
        skriv();

        // ── delflater som hører til dette anlegget ──────────────────────────
        for (const d of DELFLATER.filter((x) => x.mor === a.osmId)) {
            const el = delRaa.find((x) => `${x.type}/${x.id}` === d.osmId);
            skriv(`### Delflate ${osmLenke(d.osmId)}`);
            skriv();
            if (!el?.geometry?.length) {
                skriv('Kom ikke tilbake fra Overpass.');
                skriv();
                continue;
            }
            const b = boundsOf(el.geometry)!;
            const senter = { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 };
            const noderInne = el.geometry.filter((p) => avstandTilPolygon(p, rs) === 0).length;
            skriv(`Tagger: ${Object.entries(el.tags ?? {}).map(([kk, v]) => `\`${kk}=${v}\``).join(', ')}`);
            skriv();
            skriv(`- bbox-senter \`${k(senter)}\`: **${avstandTilPolygon(senter, rs) === 0 ? 'inne i' : `${m(avstandTilPolygon(senter, rs))} utenfor`}** ${a.osmId}`);
            skriv(`- noder inne i ${a.osmId}: ${noderInne} av ${el.geometry.length}`);
            skriv(`- størrelse ${Math.round(distanceMeters({ lat: b.minlat, lon: b.minlon }, { lat: b.minlat, lon: b.maxlon }))} × ${Math.round(distanceMeters({ lat: b.minlat, lon: b.minlon }, { lat: b.maxlat, lon: b.minlon }))} m`);
            skriv();
        }
    }

    fs.mkdirSync(utDir, { recursive: true });
    const fil = path.join(utDir, 'adkomst.md');
    fs.writeFileSync(fil, linjer.join('\n') + '\n');
    console.log(`\nTØRRKJØRING — INGENTING ER SKREVET TIL BASEN.\nRapport: ${fil}`);
}

const isDirectRun = process.argv[1]?.endsWith('skianlegg-adkomst.ts');
if (isDirectRun) {
    main(arg('cache') ?? '.flatemaal-cache', arg('ut') ?? '.flatemaal-ut').catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
