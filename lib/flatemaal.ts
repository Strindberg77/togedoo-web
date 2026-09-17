// lib/flatemaal.ts
//
// HVOR STORE ER DE NAVNLØSE SKIANLEGG-FLATENE, OG ER DE EGENTLIG LØYPER?
//
// 115 publiserte rader i kategorien Skianlegg har ingen OSM-navn og nøyaktig
// taggkombinasjonen `landuse=recreation_ground` + `sport=skiing`. 110 av dem
// ligger i Trysil, Hol og Voss. Spørsmålet er hva de ER: selvstendige anlegg,
// delområder av et større anlegg, eller enkeltnedfarter som noen har tegnet
// som flate i tillegg til linja.
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR EN EGEN MODUL, OG HVORFOR REN
//
// Målingen krever Overpass, og Overpass er utilgjengelig fra
// utviklingsmiljøet. Analysen er derfor skilt fra hentingen: alt som TOLKER
// data ligger her og kan testes uten nett, mens scripts/skianlegg-flatemaal.ts
// bare henter og skriver ut. Samme søm som mellom [skianleggFetch] og
// [skianleggVerify], og av samme grunn.
//
// ─────────────────────────────────────────────────────────────────────────
// DET MÅLINGEN IKKE TRENGER Å FINNE UT
//
// At det finnes en utforløype i nærheten er ALLEREDE kjent, og det følger av
// koden framfor å måtte måles: [skiVerdict] gjør bare polygoner med
// `piste:type=downhill` i eller inntil ringen til rader, og en flate med
// nøyaktig `landuse=recreation_ground` + `sport=skiing` bærer ingen
// `piste:type` selv. Beviset må altså ha kommet fra et NABOOBJEKT innenfor
// [SKI_EVIDENCE_TOLERANCE_M].
//
// Det interessante er derfor ikke OM det finnes en løype, men HVOR MYE av
// flata én enkelt løype dekker. Dekker én linje nesten hele boksen, er flata
// den linjas areal — og da er raden en dublett av noe som allerede finnes.
import {
    boundsOf,
    boundsOverlap,
    distanceMeters,
    pointInRing,
    type GeoBounds,
    type GeoPoint,
} from './geo-polygon';

/** Et objekt slik `out tags bb` gir det: tagger og boks, ingen geometri. */
export interface FlateInn {
    readonly id: string;
    readonly tags: Readonly<Record<string, string | undefined>>;
    readonly bounds: GeoBounds | null;
}

/** Et bevisobjekt slik `out geom` gir det. */
export interface LinjeInn {
    readonly id: string;
    readonly tags: Readonly<Record<string, string | undefined>>;
    readonly points: readonly GeoPoint[];
    /**
     * Hvor mange RÅ OSM-segmenter linja er satt sammen av. Utelatt = 1.
     *
     * Feltet finnes for at rapporten skal kunne vise begge tall: hvor mange
     * løyper som krysser flata, og hvor mange objekter de er tegnet som. Uten
     * det ville «tre eller flere løyper» vært et tall ingen kunne etterprøve.
     */
    readonly segmenter?: number;
}

/** En relasjon slik `out body` gir den: tagger og medlemsliste. */
export interface RelasjonInn {
    readonly id: string;
    readonly tags: Readonly<Record<string, string | undefined>>;
    readonly medlemmer: readonly string[];
}

export interface FlateMaal {
    readonly id: string;
    /** null når Overpass ikke ga boks — et punktobjekt har ingen. */
    readonly breddeM: number | null;
    readonly hoydeM: number | null;
    readonly arealKm2: number | null;
    /** Relasjonen flata er medlem av, om noen. */
    readonly relasjon: string | null;
    readonly relasjonNavn: string | null;
    /**
     * LØYPER med minst ett punkt inne i boksen — etter at segmenter er slått
     * sammen. Se [slaaSammenSegmenter]: før okt. 2026 telte dette ELEMENTER,
     * og en nedfart splittet i fem ways ga fem.
     */
    readonly kryssende: number;
    /** De rå segmentene bak [kryssende]. Differansen er oppdelingen. */
    readonly kryssendeSegmenter: number;
    /**
     * Hvor stor del av flatas LENGDE den mest dekkende enkeltlinja strekker
     * seg over, 0–1. Se [langsdekning].
     *
     * Nær 1 SAMMEN MED kryssende === 1 betyr at flata er én løypes korridor —
     * altså at raden er en dublett av noe som allerede finnes som linje.
     */
    readonly stersteDekning: number;
    readonly stersteLinje: string | null;
}

/** Bredde og høyde i meter for en boks. */
export function boksMeter(b: GeoBounds): { breddeM: number; hoydeM: number } {
    const midt = (b.minlat + b.maxlat) / 2;
    return {
        breddeM: distanceMeters({ lat: midt, lon: b.minlon }, { lat: midt, lon: b.maxlon }),
        hoydeM: distanceMeters({ lat: b.minlat, lon: b.minlon }, { lat: b.maxlat, lon: b.minlon }),
    };
}

/** Snittboksen, eller null når de ikke overlapper. */
export function snitt(a: GeoBounds, b: GeoBounds): GeoBounds | null {
    if (!boundsOverlap(a, b)) return null;
    return {
        minlat: Math.max(a.minlat, b.minlat),
        minlon: Math.max(a.minlon, b.minlon),
        maxlat: Math.min(a.maxlat, b.maxlat),
        maxlon: Math.min(a.maxlon, b.maxlon),
    };
}

function arealM2(b: GeoBounds): number {
    const { breddeM, hoydeM } = boksMeter(b);
    return breddeM * hoydeM;
}

/**
 * HVOR STOR DEL AV FLATAS LENGDE ÉN LINJE STREKKER SEG OVER, 0–1.
 *
 * MÅLES LANGS FLATAS LENGSTE AKSE, og det er en bevisst avgjørelse framfor to
 * åpenbare alternativer som begge er gale:
 *
 *   AREALFORHOLD gir 0 for en rett løype. En nedfart tegnet rett nord–sør har
 *   en boks med NULL bredde, så snittarealet er null — «dekker ingenting» om
 *   en linje som går tvers gjennom hele flata.
 *
 *   SVAKESTE AKSE har samme feil av samme grunn: bredden er 0 av 538 m.
 *
 * Den fysiske saken er at en flate rundt ÉN nedfart er en korridor: like lang
 * som løypa og bare noen titalls meter bred. Spørsmålet er derfor om en
 * enkeltlinje går HELE LENGDEN av flata. Bredden svarer [FlateMaal.breddeM]
 * og [FlateMaal.hoydeM] på for seg.
 *
 * ANTALLET LINJER ER DEN ANDRE HALVDELEN. Én linje som går hele lengden er en
 * korridor; fem linjer som hver går hele lengden er et anlegg med fem
 * parallelle nedfarter. Derfor [FlateMaal.kryssende] ved siden av.
 */
export function langsdekning(flate: GeoBounds, linje: GeoBounds): number {
    const s = snitt(flate, linje);
    if (!s) return 0;
    const f = boksMeter(flate);
    const o = boksMeter(s);
    const langsErHoyde = f.hoydeM >= f.breddeM;
    const hel = langsErHoyde ? f.hoydeM : f.breddeM;
    const del = langsErHoyde ? o.hoydeM : o.breddeM;
    // En flate uten utstrekning i det hele tatt (Overpass ga et punkt som
    // boks) kan ikke dekkes delvis.
    return hel <= 0 ? 1 : del / hel;
}

export function maalFlater(
    flater: readonly FlateInn[],
    linjer: readonly LinjeInn[],
    relasjoner: readonly RelasjonInn[]
): FlateMaal[] {
    // Medlemskap slås opp én gang. En flate kan i prinsippet være medlem av
    // flere relasjoner; den FØRSTE med navn vinner, ellers den første — det
    // er navnet spørsmålet handler om.
    const relFor = new Map<string, RelasjonInn>();
    for (const r of relasjoner) {
        for (const m of r.medlemmer) {
            const har = relFor.get(m);
            if (!har || (!har.tags.name && r.tags.name)) relFor.set(m, r);
        }
    }

    const linjeBokser = linjer.map((l) => ({
        l,
        b: boundsOf(l.points),
        segmenter: l.segmenter ?? 1,
    }));

    return flater.map((f): FlateMaal => {
        const rel = relFor.get(f.id) ?? null;
        if (!f.bounds) {
            return {
                id: f.id,
                breddeM: null,
                hoydeM: null,
                arealKm2: null,
                relasjon: rel?.id ?? null,
                relasjonNavn: rel?.tags.name ?? null,
                kryssende: 0,
                kryssendeSegmenter: 0,
                stersteDekning: 0,
                stersteLinje: null,
            };
        }
        const { breddeM, hoydeM } = boksMeter(f.bounds);
        let kryssende = 0;
        let kryssendeSegmenter = 0;
        let beste = 0;
        let besteId: string | null = null;
        for (const { l, b, segmenter } of linjeBokser) {
            // KRYSSENDE måles på PUNKTENE, ikke på linjas boks. To bokser kan
            // overlappe uten at linja er innom flata i det hele tatt — en
            // løype som går i en bue rundt den.
            if (l.points.some((p) => punktIBoks(p, f.bounds!))) {
                kryssende += 1;
                kryssendeSegmenter += segmenter;
            }
            if (!b) continue;
            const d = langsdekning(f.bounds, b);
            if (d > beste) {
                beste = d;
                besteId = l.id;
            }
        }
        return {
            id: f.id,
            breddeM,
            hoydeM,
            arealKm2: arealM2(f.bounds) / 1e6,
            relasjon: rel?.id ?? null,
            relasjonNavn: rel?.tags.name ?? null,
            kryssende,
            kryssendeSegmenter,
            stersteDekning: beste,
            stersteLinje: besteId,
        };
    });
}

function punktIBoks(p: GeoPoint, b: GeoBounds): boolean {
    return p.lat >= b.minlat && p.lat <= b.maxlat && p.lon >= b.minlon && p.lon <= b.maxlon;
}

/** Faste bøtter, så to kjøringer kan legges ved siden av hverandre. */
export const STORRELSE_BOTTER = [50, 100, 200, 500, 1000, 2000] as const;

export function fordeling(
    verdier: readonly number[],
    botter: readonly number[]
): { merke: string; antall: number }[] {
    const ut = botter.map((b, i) => ({
        merke: i === 0 ? `< ${b}` : `${botter[i - 1]}–${b}`,
        antall: 0,
    }));
    ut.push({ merke: `> ${botter[botter.length - 1]}`, antall: 0 });
    for (const v of verdier) {
        const i = botter.findIndex((b) => v < b);
        ut[i === -1 ? botter.length : i].antall += 1;
    }
    return ut;
}

/** Medianen, uten å sortere kallerens liste. */
export function median(verdier: readonly number[]): number | null {
    if (!verdier.length) return null;
    const s = [...verdier].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------
// SEGMENTER ER IKKE LØYPER
// ---------------------------------------------------------------------------

/**
 * SLÅR SAMMEN OPPDELTE LØYPER. Uten dette er «tre eller flere løyper» feil.
 *
 * FEILEN SOM BLE FUNNET (okt. 2026): [maalFlater] telte ELEMENTER, ikke
 * løyper. En nedfart som er splittet i fem ways — fordi den krysser en vei,
 * skifter `piste:difficulty` halvveis, eller bare er redigert i biter — ble
 * talt som fem løyper, og flata havnet i «tre eller flere» på et grunnlag som
 * ikke finnes i terrenget. Det er nøyaktig samme feil som Korketrekkeren:
 * 14 objekter, 1 bakke.
 *
 * TO REGLER, og begge må til:
 *
 *   ENDEPUNKT MOT ENDEPUNKT. En way som splittes i OSM etterlater seg to
 *   deler som deler nøyaktig én node. Mellompunkter brukes IKKE som lim: to
 *   ulike nedfarter som KRYSSER hverandre deler også en node, og de skal
 *   forbli to.
 *
 *   SAMME NAVN. Segmenter som ikke henger fysisk sammen — et hull i
 *   taggingen, en flat seksjon uten `piste:type` — bindes av navnet. Tomt
 *   navn binder ingenting; ellers ville alle navnløse segmenter i Norge
 *   blitt én løype.
 *
 * ENKELTLENKE, som [akingClusters]: henger A sammen med B og B med C, er alle
 * tre samme løype selv om A og C ikke møtes.
 */
const SNAP_GRADER = 1e-6; // ~0,1 m. Delte noder har identiske koordinater.

function endepunktNokkel(p: GeoPoint): string {
    const rund = (v: number) => Math.round(v / SNAP_GRADER);
    return `${rund(p.lat)}:${rund(p.lon)}`;
}

export interface Loype {
    /** Segmentenes id-er, i den rekkefølgen de kom. */
    readonly segmenter: readonly string[];
    readonly navn: string | null;
    readonly points: readonly GeoPoint[];
}

export function slaaSammenSegmenter(linjer: readonly LinjeInn[]): Loype[] {
    const forelder = linjer.map((_, i) => i);
    const finn = (i: number): number => {
        while (forelder[i] !== i) {
            forelder[i] = forelder[forelder[i]];
            i = forelder[i];
        }
        return i;
    };
    const slaa = (a: number, b: number): void => {
        const ra = finn(a);
        const rb = finn(b);
        if (ra !== rb) forelder[rb] = ra;
    };

    const navnFor = (l: LinjeInn): string | null => {
        const n = (l.tags.name ?? l.tags['piste:name'] ?? '').trim();
        return n || null;
    };

    // Endepunkt → segmentene som ender der.
    const vedEndepunkt = new Map<string, number[]>();
    const vedNavn = new Map<string, number[]>();
    const legg = (m: Map<string, number[]>, k: string, i: number): void => {
        const liste = m.get(k);
        if (liste) liste.push(i);
        else m.set(k, [i]);
    };
    linjer.forEach((l, i) => {
        const navn = navnFor(l);
        if (navn) legg(vedNavn, navn.toLowerCase(), i);
        if (!l.points.length) return;
        for (const p of [l.points[0], l.points[l.points.length - 1]]) {
            legg(vedEndepunkt, endepunktNokkel(p), i);
        }
    });
    for (const gruppe of [...vedEndepunkt.values(), ...vedNavn.values()]) {
        for (let i = 1; i < gruppe.length; i++) slaa(gruppe[0], gruppe[i]);
    }

    const per = new Map<number, number[]>();
    linjer.forEach((_, i) => {
        const r = finn(i);
        const liste = per.get(r);
        if (liste) liste.push(i);
        else per.set(r, [i]);
    });
    return [...per.values()].map((indekser) => ({
        segmenter: indekser.map((i) => linjer[i].id),
        navn: indekser.map((i) => navnFor(linjer[i])).find((n) => n) ?? null,
        points: indekser.flatMap((i) => [...linjer[i].points]),
    }));
}

/** En [Loype] i den formen [maalFlater] leser. Id-en er den første
 *  segment-id-en, så en løype fortsatt kan navngis i rapporten. */
export function loypeSomLinje(l: Loype): LinjeInn {
    return {
        id: l.segmenter.length > 1 ? `${l.segmenter[0]} (+${l.segmenter.length - 1})` : l.segmenter[0],
        tags: l.navn ? { name: l.navn } : {},
        points: l.points,
        segmenter: l.segmenter.length,
    };
}

// ---------------------------------------------------------------------------
// MORANLEGGET
// ---------------------------------------------------------------------------

/**
 * ET NAVN SOM ALDRI KAN VÆRE ET MORANLEGG.
 *
 * `child ski area` er en engelsk TYPEBETEGNELSE som har havnet i `name` i
 * OSM — den beskriver et barneområde inne i et anlegg, ikke et anlegg som
 * heter noe. Brukes den som mor, får delflatene tittelen «child ski area» i
 * appen, som er verre enn ingen tittel.
 *
 * Lista er bevisst kort og eksakt, ikke et mønster. En delstrengregel på
 * «child» ville truffet et ekte anlegg som het noe med det ordet, og
 * feilen ville vært usynlig til noen leste rapporten.
 */
export const UGYLDIGE_MORNAVN: readonly string[] = ['child ski area'];

export function kanVaereMor(navn: string | null | undefined): boolean {
    if (!navn) return false;
    return !UGYLDIGE_MORNAVN.includes(navn.trim().toLowerCase());
}

export interface MorKandidat {
    readonly id: string;
    readonly navn: string;
    /** Ytterringene. Et multipolygon har flere. */
    readonly ringer: readonly (readonly GeoPoint[])[];
}

export type MorUtfall = 'entydig' | 'flere' | 'ingen';

export interface MorTreff {
    readonly flate: string;
    readonly utfall: MorUtfall;
    /** Alle mødre som inneholder senteret, i rekkefølgen de kom. */
    readonly kandidater: readonly { id: string; navn: string }[];
}

/**
 * HVILKET NAVNGITT ANLEGG INNEHOLDER SENTERET?
 *
 * PUNKT I RING, ikke nærhet. Det er hele poenget med regelen: en flate uten
 * omsluttende anlegg havner på uavklart-lista, ikke hos nærmeste nabo.
 * [insideOrNear] ville vært feil verktøy her — den godtar alt innenfor
 * polygonets BOKS pluss en toleranse, og en boks rundt et fjellanlegg dekker
 * halve dalen.
 *
 * SENTERET ER BBOKS-SENTERET, samme punkt som raden fikk i importen
 * ([centerOfBounds]). Det er ikke tyngdepunktet, og for en L-formet flate kan
 * det ligge utenfor flata selv. Det er akseptert: raden i basen ER det
 * punktet, så koblingen gjelder nøyaktig det som vises i appen.
 */
export function finnMoranlegg(
    senter: GeoPoint,
    kandidater: readonly MorKandidat[]
): MorTreff['kandidater'] {
    return kandidater
        .filter((k) => kanVaereMor(k.navn))
        .filter((k) => k.ringer.some((r) => pointInRing(senter, r)))
        .map((k) => ({ id: k.id, navn: k.navn }));
}

export function morUtfall(treff: MorTreff['kandidater']): MorUtfall {
    if (treff.length === 1) return 'entydig';
    return treff.length > 1 ? 'flere' : 'ingen';
}
