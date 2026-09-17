// scripts/skianlegg-flatemaal.ts
//
// KOBLER DE NAVNLØSE SKIANLEGG-FLATENE TIL ANLEGGET DE HØRER TIL.
//
//   npx --yes tsx scripts/skianlegg-flatemaal.ts --ids=flater.txt
//   npx --yes tsx scripts/skianlegg-flatemaal.ts --ids=flater.txt --queries
//
// `--ids` er en fil med én rad per flate: `way/123` eller `way/123,Trysil`.
// Kommunen er valgfri og brukes bare i nedtakslista. Hent den med SQL — se
// docs/skianlegg-moranlegg.md.
//
// SKRIVER INGENTING TIL BASEN. Utdataene er to filer og en rapport.
//
// ─────────────────────────────────────────────────────────────────────────
// SPØRRINGENE ER DELT I BITER PÅ 25, MED PAUSE OG MELLOMLAGRING
//
// 115 id-er i ett kall ga 504 på dagtid (målt). Hver bit lagres til
// `--cache` med én gang den er hentet, så en feilet bit kaster ikke dem som
// gikk bra: kjør på nytt, og de ferdige bitene leses fra disk uten å røre
// nettet. Cachen er nøkkel-per-spørring, ikke per kjøring, så en endret
// spørring gir en ny nøkkel og hentes på nytt.
//
// ─────────────────────────────────────────────────────────────────────────
// FIRE SPØRRINGSTYPER
//
//   A  bokser      way(id:…25 stk); .f out tags bb;      ingen geometri
//   B  relasjoner  rel(bw.f); rel(br.f); out body;
//   C  løyper      per flate: en PADDET BOKS, ikke around
//   D  mødre       navngitte Skianlegg-polygoner i unionsboksen, out geom
//
// HVORFOR C IKKE BRUKER `around`. `around.f:100` måler avstand til flatas
// RING. En nedfart midt inne i en stor flate kan ligge mer enn 100 m fra
// enhver kant, og ville ikke blitt hentet — nøyaktig de flatene med flest
// løyper ville mistet flest. Boksen har ikke det hullet.
//
// HVORFOR D ER ÉN SPØRRING OG IKKE DELT. Et moranlegg som OMSLUTTER en
// delflate kan ha kanten kilometer unna, så hverken `around` eller flatas
// egen boks finner det. Unionsboksen over alle flatene, med margin, er den
// minste avgrensningen som ikke kan miste en mor. Navngitte
// winter_sports-polygoner er et lite sett (254 i HELE Norge, målt).
import * as fs from 'node:fs';
import * as path from 'node:path';

import { boundsUnion, padBounds, type GeoBounds } from '../lib/geo-polygon';
import { nedtakingsSql } from '../lib/dedup';
import { fingerprint } from '../lib/import-chunks';
import {
    finnMoranlegg,
    fordeling,
    loypeSomLinje,
    maalFlater,
    median,
    morUtfall,
    slaaSammenSegmenter,
    STORRELSE_BOTTER,
    type FlateInn,
    type LinjeInn,
    type MorKandidat,
    type MorTreff,
    type RelasjonInn,
} from '../lib/flatemaal';
import { SKI_AREA_SELECTOR, fetchOverpass } from './import-places';

const arg = (navn: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${navn}=`))?.slice(navn.length + 3);
const bareQueries = process.argv.includes('--queries');

/** Maks id-er per spørring. 115 i ett kall ga 504 på dagtid. */
export const BIT_STORRELSE = Number(arg('chunk') ?? 25) || 25;
/** Pause mellom bitene. Høflighet mot speilet, ikke en teknisk grense. */
const PAUSE_MS = Number(process.env.PLACES_OVERPASS_QUERY_PAUSE_MS ?? 2000) || 2000;
/** Margin rundt en flates boks når løypene hentes. */
const LOYPE_MARGIN_M = 200;
/** Margin rundt unionsboksen når mødrene hentes. */
const MOR_MARGIN_M = 5000;
/** Samme toleranse som importen bruker på bevis. Se [skiVerdict]. */
const BEVIS_TOLERANSE_M = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// INNDATA
// ---------------------------------------------------------------------------

export interface FlateRad {
    readonly id: string;
    readonly kommune: string | null;
}

export function lesIder(tekst: string): FlateRad[] {
    const rader = tekst
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
            const [id, kommune] = l.split(',').map((d) => d.trim());
            return { id, kommune: kommune || null };
        });
    const ugyldig = rader.filter((r) => !/^(way|relation|node)\/\d+$/.test(r.id));
    if (ugyldig.length) {
        throw new Error(`Ugyldige id-er: ${ugyldig.slice(0, 5).map((r) => r.id).join(', ')}`);
    }
    if (!rader.length) throw new Error('Id-lista er tom.');
    const sett = new Set(rader.map((r) => r.id));
    if (sett.size !== rader.length) {
        throw new Error(`Id-lista har duplikater: ${rader.length} rader, ${sett.size} unike.`);
    }
    return rader;
}

export function deleIBiter<T>(liste: readonly T[], storrelse: number): T[][] {
    const ut: T[][] = [];
    for (let i = 0; i < liste.length; i += storrelse) ut.push(liste.slice(i, i + storrelse));
    return ut;
}

// ---------------------------------------------------------------------------
// SPØRRINGENE
// ---------------------------------------------------------------------------

/** `way(id:1,2);` + `relation(id:9);` — tomme grener utelates, for
 *  `way(id:);` er en syntaksfeil som avbryter hele spørringen. */
export function settet(ider: readonly string[]): string {
    const nummer = (type: string) =>
        ider.filter((i) => i.startsWith(`${type}/`)).map((i) => i.split('/')[1]).join(',');
    const grener = (['way', 'relation', 'node'] as const)
        .map((t) => (nummer(t) ? `${t}(id:${nummer(t)});` : ''))
        .filter(Boolean)
        .join('\n  ');
    return `(\n  ${grener}\n)->.f;`;
}

export function qBokser(ider: readonly string[]): string {
    return `[out:json][timeout:120];\n${settet(ider)}\n.f out tags bb;`;
}

/**
 * `rel(bw.f)` finner relasjoner med en WAY i .f som medlem, `rel(br.f)` med en
 * RELASJON. Begge trengs. `out body`, ikke `out tags`: uten den kommer
 * relasjonen UTEN medlemsliste, svaret er 200 og ser riktig ut, og ingen flate
 * kan knyttes til den. Samme felle som OUT_GEOM_TAGS.
 */
export function qRelasjoner(ider: readonly string[]): string {
    return `[out:json][timeout:120];\n${settet(ider)}\n(\n  rel(bw.f);\n  rel(br.f);\n);\nout body;`;
}

export const bboxFilter = (b: GeoBounds): string =>
    `(${b.minlat.toFixed(5)},${b.minlon.toFixed(5)},${b.maxlat.toFixed(5)},${b.maxlon.toFixed(5)})`;

/** Én paddet boks per flate. Se filhodet for hvorfor ikke `around`. */
export function qLoyper(bokser: readonly GeoBounds[]): string {
    const linjer = bokser
        .map((b) => `way["piste:type"~"downhill"]${bboxFilter(padBounds(b, LOYPE_MARGIN_M))};`)
        .join('\n  ');
    return `[out:json][timeout:180];\n(\n  ${linjer}\n);\nout geom;`;
}

/**
 * MØDRENE: nøyaktig de samme mønstrene som [SKI_AREA_SELECTOR], men bare de
 * NAVNGITTE, og avgrenset til unionsboksen.
 *
 * Selektoren gjenbrukes framfor å skrives på nytt. Endres den i importen,
 * endres denne — ellers ville «navngitt Skianlegg-polygon» betydd to ulike
 * ting to steder.
 */
export function qModre(union: GeoBounds): string {
    const s = SKI_AREA_SELECTOR.split('(area.a)').join(
        `["name"]${bboxFilter(padBounds(union, MOR_MARGIN_M))}`
    );
    return `[out:json][timeout:180];\n(\n  ${s}\n);\nout geom;`;
}

// ---------------------------------------------------------------------------
// MELLOMLAGRING
// ---------------------------------------------------------------------------

export type OsmElement = Awaited<ReturnType<typeof fetchOverpass>>[number];

/**
 * Henter én spørring, eller leser den fra disk om den er hentet før.
 *
 * NØKKELEN ER SPØRRINGENS FINGERAVTRYKK, ikke bitnummeret. Endres spørringen,
 * endres nøkkelen, og cachen blir ikke gjenbrukt — samme regel som
 * hentestegets fingeravtrykk i importen, og av samme grunn: «rett spørringen
 * og kjør på nytt» skal ikke gi gårsdagens svar i stillhet.
 */
export async function hent(cacheDir: string, navn: string, q: string): Promise<OsmElement[]> {
    const fil = path.join(cacheDir, `${navn}-${fingerprint(q)}.json`);
    if (fs.existsSync(fil)) {
        console.log(`  [disk]  ${navn}`);
        return JSON.parse(fs.readFileSync(fil, 'utf8')) as OsmElement[];
    }
    const svar = await fetchOverpass(q, navn);
    fs.mkdirSync(cacheDir, { recursive: true });
    // Skriv til .tmp og gi nytt navn: en avbrutt skriving skal ikke etterlate
    // en halv JSON som neste kjøring leser som ferdig. Samme regel som
    // FileStore.write.
    fs.writeFileSync(`${fil}.tmp`, JSON.stringify(svar));
    fs.renameSync(`${fil}.tmp`, fil);
    console.log(`  [hentet] ${navn}: ${svar.length} objekter`);
    return svar;
}

function punkter(el: OsmElement): { lat: number; lon: number }[] {
    if (el.geometry?.length) {
        return el.geometry.map((g: { lat: number; lon: number }) => ({ lat: g.lat, lon: g.lon }));
    }
    if (el.members?.length) {
        return el.members.flatMap((m) => m.geometry ?? []).map((g) => ({ lat: g.lat, lon: g.lon }));
    }
    if (el.center) return [{ lat: el.center.lat, lon: el.center.lon }];
    if (typeof el.lat === 'number' && typeof el.lon === 'number') {
        return [{ lat: el.lat, lon: el.lon }];
    }
    return [];
}

/** Ytterringene til et moranlegg. `out geom` gir ways sin ring direkte; en
 *  relasjon må sys sammen av medlemmene — samme regel som [polygonRings]. */
function ringerAv(el: OsmElement): { lat: number; lon: number }[][] {
    if (el.geometry && el.geometry.length >= 3) return [el.geometry];
    const ytre = (el.members ?? [])
        .filter((m) => m.type === 'way' && (m.role ?? 'outer') !== 'inner')
        .map((m) => m.geometry ?? [])
        .filter((g) => g.length >= 3);
    return ytre;
}

// ---------------------------------------------------------------------------
// KJØRINGEN
// ---------------------------------------------------------------------------

export interface Nedtak {
    readonly external_id: string;
    readonly kommune: string;
    readonly mor: string;
    readonly morNavn: string;
    readonly begrunnelse: string;
}

async function main(rader: FlateRad[], cacheDir: string, utDir: string): Promise<void> {
    const biter = deleIBiter(rader, BIT_STORRELSE);
    console.log(`${rader.length} flater, ${biter.length} biter à maks ${BIT_STORRELSE}\n`);

    // ── A: bokser ────────────────────────────────────────────────────────
    const flaterRaa: OsmElement[] = [];
    for (const [i, bit] of biter.entries()) {
        flaterRaa.push(...(await hent(cacheDir, `bokser-${i + 1}`, qBokser(bit.map((r) => r.id)))));
        if (i < biter.length - 1) await sleep(PAUSE_MS);
    }

    const flater: FlateInn[] = flaterRaa.map((el) => ({
        id: `${el.type}/${el.id}`,
        tags: el.tags ?? {},
        bounds: el.bounds ?? null,
    }));
    const savnet = rader.filter((r) => !flater.some((f) => f.id === r.id));
    if (savnet.length) {
        console.log(
            `\n  ADVARSEL: ${savnet.length} id-er kom ikke tilbake fra Overpass ` +
                `(slettet i OSM siden importen?): ${savnet.slice(0, 5).map((r) => r.id).join(', ')}`
        );
    }

    // ── B: relasjoner ────────────────────────────────────────────────────
    const relRaa: OsmElement[] = [];
    for (const [i, bit] of biter.entries()) {
        await sleep(PAUSE_MS);
        relRaa.push(...(await hent(cacheDir, `rel-${i + 1}`, qRelasjoner(bit.map((r) => r.id)))));
    }
    const relasjoner: RelasjonInn[] = relRaa.map((el) => ({
        id: `${el.type}/${el.id}`,
        tags: el.tags ?? {},
        medlemmer: (el.members ?? []).map((m) => `${m.type}/${m.ref}`),
    }));

    // ── C: løyper ────────────────────────────────────────────────────────
    const segmentRaa = new Map<string, OsmElement>();
    for (const [i, bit] of biter.entries()) {
        const bokser = bit
            .map((r) => flater.find((f) => f.id === r.id)?.bounds)
            .filter((b): b is GeoBounds => Boolean(b));
        if (!bokser.length) continue;
        await sleep(PAUSE_MS);
        // Bitene overlapper i kantene, så samme way kan komme i to svar.
        for (const el of await hent(cacheDir, `loyper-${i + 1}`, qLoyper(bokser))) {
            segmentRaa.set(`${el.type}/${el.id}`, el);
        }
    }
    const segmenter: LinjeInn[] = [...segmentRaa.entries()].map(([id, el]) => ({
        id,
        tags: el.tags ?? {},
        points: punkter(el),
    }));
    const loyper = slaaSammenSegmenter(segmenter);

    // ── D: mødre ─────────────────────────────────────────────────────────
    const union = boundsUnion(flater.map((f) => f.bounds));
    if (!union) throw new Error('Ingen av flatene kom tilbake med boks — kan ikke finne mødre.');
    await sleep(PAUSE_MS);
    const morRaa = await hent(cacheDir, 'modre', qModre(union));
    const modre: MorKandidat[] = morRaa
        .filter((el) => el.tags?.name)
        .map((el) => ({
            id: `${el.type}/${el.id}`,
            navn: el.tags!.name!,
            ringer: ringerAv(el),
        }))
        .filter((m) => m.ringer.length > 0 && !rader.some((r) => r.id === m.id));

    skrivRapport({ rader, flater, segmenter, loyper, relasjoner, modre, utDir });
}

function skrivRapport(inn: {
    rader: FlateRad[];
    flater: FlateInn[];
    segmenter: LinjeInn[];
    loyper: ReturnType<typeof slaaSammenSegmenter>;
    relasjoner: RelasjonInn[];
    modre: MorKandidat[];
    utDir: string;
}): void {
    const { rader, flater, segmenter, loyper, relasjoner, modre, utDir } = inn;
    const maal = maalFlater(flater, loyper.map(loypeSomLinje), relasjoner);
    const kommuneFor = new Map(rader.map((r) => [r.id, r.kommune]));

    const treff: MorTreff[] = maal.map((m) => {
        const f = flater.find((x) => x.id === m.id)!;
        const senter = f.bounds
            ? {
                  lat: (f.bounds.minlat + f.bounds.maxlat) / 2,
                  lon: (f.bounds.minlon + f.bounds.maxlon) / 2,
              }
            : null;
        const k = senter ? finnMoranlegg(senter, modre) : [];
        return { flate: m.id, utfall: morUtfall(k), kandidater: k };
    });

    const tell = (u: string) => treff.filter((t) => t.utfall === u).length;

    console.log(`\n${'═'.repeat(72)}`);
    console.log(`1  MORANLEGG   ${modre.length} navngitte kandidater i unionsboksen`);
    console.log('═'.repeat(72));
    console.log(`\n  nøyaktig ÉN mor (entydig):   ${tell('entydig')}`);
    console.log(`  FLERE mødre:                 ${tell('flere')}`);
    console.log(`  INGEN mor:                   ${tell('ingen')}`);
    const perMor = new Map<string, number>();
    for (const t of treff.filter((x) => x.utfall === 'entydig')) {
        const k = `${t.kandidater[0].navn} (${t.kandidater[0].id})`;
        perMor.set(k, (perMor.get(k) ?? 0) + 1);
    }
    console.log('');
    for (const [navn, n] of [...perMor].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(n).padStart(4)} × ${navn}`);
    }

    console.log(`\n${'═'.repeat(72)}`);
    console.log('2  STØRRELSE OG LØYPER');
    console.log('═'.repeat(72));
    const medBoks = maal.filter((m) => m.breddeM !== null);
    const langs = medBoks.map((m) => Math.max(m.breddeM!, m.hoydeM!));
    console.log('\n  lengste side (m)');
    for (const b of fordeling(langs, STORRELSE_BOTTER)) {
        console.log(`    ${b.merke.padEnd(12)} ${String(b.antall).padStart(4)}  ${'█'.repeat(b.antall)}`);
    }
    console.log(`\n  median lengste side: ${Math.round(median(langs) ?? 0)} m`);
    console.log(
        `\n  ${segmenter.length} downhill-SEGMENTER slått sammen til ${loyper.length} LØYPER`
    );
    const korridor = maal.filter((m) => m.kryssende === 1 && m.stersteDekning >= 0.8);
    const anlegg = maal.filter((m) => m.kryssende >= 3);
    const tomme = maal.filter((m) => m.kryssende === 0);
    console.log(`    korridor (1 løype, ≥80 % av lengden): ${korridor.length}`);
    console.log(`    tre eller flere løyper:               ${anlegg.length}`);
    console.log(`    INGEN løype i boksen:                 ${tomme.length}`);
    // OPPDELINGEN, som er hele grunnen til sammenslåingen: hvor mange av
    // «tre eller flere» som er færre løyper tegnet i flere biter.
    const oppdelt = anlegg.filter((m) => m.kryssendeSegmenter > m.kryssende);
    console.log(
        `\n    av de ${anlegg.length}: ${oppdelt.length} har løyper tegnet i flere biter ` +
            `(${anlegg.reduce((s, m) => s + m.kryssendeSegmenter, 0)} segmenter → ` +
            `${anlegg.reduce((s, m) => s + m.kryssende, 0)} løyper)`
    );

    // ── 3: de uten løype ─────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(72)}`);
    console.log(`3  FLATER UTEN LØYPE I BOKSEN (${tomme.length})`);
    console.log('═'.repeat(72));
    console.log(
        '\n  Importen krevde en utforløype for at flata skulle bli rad, men den\n' +
            `  testen godtar alt innenfor boksen PLUSS ${BEVIS_TOLERANSE_M} m (insideOrNear måler\n` +
            '  mot boksen, ikke mot kanten). En flate uten løype INNE i boksen kan\n' +
            '  derfor ha fått beviset sitt fra marginen. Kolonnen under avgjør.\n'
    );
    for (const m of tomme) {
        const f = flater.find((x) => x.id === m.id)!;
        const iMargin = f.bounds
            ? loyper.some((l) =>
                  l.points.some((p) => {
                      const pad = padBounds(f.bounds!, BEVIS_TOLERANSE_M);
                      return (
                          p.lat >= pad.minlat &&
                          p.lat <= pad.maxlat &&
                          p.lon >= pad.minlon &&
                          p.lon <= pad.maxlon
                      );
                  })
              )
            : false;
        console.log(
            `    ${m.id.padEnd(18)} ${(kommuneFor.get(m.id) ?? '—').padEnd(12)} ` +
                (iMargin
                    ? `bevis i ${BEVIS_TOLERANSE_M}-m-marginen — forklart`
                    : 'INGEN løype i margin heller — OSM er endret, eller en annen årsak')
        );
    }

    // ── Nedtakslista ─────────────────────────────────────────────────────
    fs.mkdirSync(utDir, { recursive: true });
    const nedtak: Nedtak[] = treff
        .filter((t) => t.utfall === 'entydig')
        .map((t) => {
            const m = maal.find((x) => x.id === t.flate)!;
            return {
                external_id: t.flate,
                kommune: kommuneFor.get(t.flate) ?? '',
                mor: t.kandidater[0].id,
                morNavn: t.kandidater[0].navn,
                begrunnelse:
                    `senter i ${t.kandidater[0].id}; ${m.kryssende} løyper ` +
                    `(${m.kryssendeSegmenter} segmenter); ` +
                    `${Math.round(m.breddeM ?? 0)}×${Math.round(m.hoydeM ?? 0)} m`,
            };
        });
    const uavklart = treff
        .filter((t) => t.utfall !== 'entydig')
        .map((t) => ({
            external_id: t.flate,
            kommune: kommuneFor.get(t.flate) ?? '',
            utfall: t.utfall,
            kandidater: t.kandidater.map((k) => `${k.navn} ${k.id}`).join(' | '),
        }));

    const csv = (rader: readonly Record<string, string>[], felter: readonly string[]): string =>
        [felter.join(','), ...rader.map((r) => felter.map((f) => `"${r[f] ?? ''}"`).join(','))].join(
            '\n'
        ) + '\n';

    const nedtakFil = path.join(utDir, 'nedtak.csv');
    const uavklartFil = path.join(utDir, 'uavklart.csv');
    fs.writeFileSync(
        nedtakFil,
        csv(nedtak as unknown as Record<string, string>[], [
            'external_id',
            'kommune',
            'mor',
            'morNavn',
            'begrunnelse',
        ])
    );
    fs.writeFileSync(
        uavklartFil,
        csv(uavklart as unknown as Record<string, string>[], [
            'external_id',
            'kommune',
            'utfall',
            'kandidater',
        ])
    );

    // FINGERAVTRYKKET binder en senere skriving til NØYAKTIG denne lista.
    // Samme mekanisme som --approve i importen: hashen er over innholdet, så
    // en ny kjøring med ett annet par (flate, mor) gir et annet avtrykk og den
    // gamle kommandoen slutter å virke.
    const fp = fingerprint({
        v: 1,
        par: nedtak.map((n) => [n.external_id, n.mor]).sort(),
    });

    console.log(`\n${'═'.repeat(72)}`);
    console.log('TØRRKJØRING — INGENTING ER SKREVET');
    console.log('═'.repeat(72));
    console.log(`\n  nedtak:    ${nedtak.length} flater  → ${nedtakFil}`);
    console.log(`  uavklart:  ${uavklart.length} flater  → ${uavklartFil}`);
    console.log(`\n  FINGERAVTRYKK: ${fp}`);
    console.log(`\n  Når skrivesteget finnes, bindes det til nøyaktig denne lista:`);
    console.log(`    npx tsx scripts/skianlegg-nedtak.ts --inn=${nedtakFil} --approve=${fp}`);
    console.log(`\n  Endres ett eneste par (flate, mor), endres avtrykket og kommandoen`);
    console.log(`  over slutter å virke. Det er hele poenget.`);

    // SQL-EN SKRIVES UT, IKKE KJØRES — samme presedens som dedup-oppryddingen
    // og docs/runbooks/oslo-alpin.md: koden bygger lista, et menneske tar dem
    // ned. Funksjonen er den samme, så nedtakingen har én form i hele
    // kodebasen og ikke to.
    console.log(nedtakingsSql(nedtak.map((n) => n.external_id)));
}

const isDirectRun = process.argv[1]?.endsWith('skianlegg-flatemaal.ts');
if (isDirectRun) {
    const idFil = arg('ids');
    if (!idFil) {
        console.error('Mangler --ids=<fil>. Én rad per flate: way/123 eller way/123,Trysil.');
        process.exit(1);
    }
    const rader = lesIder(fs.readFileSync(idFil, 'utf8'));
    const cacheDir = arg('cache') ?? '.flatemaal-cache';
    const utDir = arg('ut') ?? '.flatemaal-ut';

    if (bareQueries) {
        const biter = deleIBiter(rader, BIT_STORRELSE);
        console.log(`${rader.length} flater, ${biter.length} biter à maks ${BIT_STORRELSE}\n`);
        const curl = (q: string) =>
            `curl -sS -A 'togedoo-import/1.0' https://overpass-api.de/api/interpreter \\\n` +
            `  --data-urlencode 'data=${q.replace(/'/g, "'\\''")}'`;
        console.log('# A  BOKSER — bit 1 av ' + biter.length + ' (de øvrige er like)');
        console.log(curl(qBokser(biter[0].map((r) => r.id))) + '\n');
        console.log('# B  RELASJONER — bit 1');
        console.log(curl(qRelasjoner(biter[0].map((r) => r.id))) + '\n');
        console.log('# C og D krever boksene fra A. Kjør uten --queries.');
    } else {
        main(rader, cacheDir, utDir).catch((err) => {
            console.error(err instanceof Error ? err.message : err);
            process.exit(1);
        });
    }
}
