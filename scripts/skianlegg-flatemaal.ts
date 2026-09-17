// scripts/skianlegg-flatemaal.ts
//
// MÅLER DE NAVNLØSE SKIANLEGG-FLATENE. Svarer på spørsmål 1–3 i utfordringen:
// boks og areal per flate, relasjonsmedlemskap, og utforløyper i boksen.
//
//   npx --yes tsx scripts/skianlegg-flatemaal.ts --ids=flater.txt
//   npx --yes tsx scripts/skianlegg-flatemaal.ts --ids=flater.txt --queries
//
// `--ids` peker på en fil med én external_id per linje, `way/123` eller
// `relation/456`. Hent den med SQL — se docs/skianlegg-navnlose-flater.md.
// `--queries` skriver ut spørringene uten å sende dem, slik at de kan kjøres
// for hånd eller limes inn i overpass-turbo.
//
// ─────────────────────────────────────────────────────────────────────────
// TRE SMÅ SPØRRINGER, ALLE PÅ ID — ingen nasjonal henting, ingen `out geom`
// på noe stort. Det er derfor de tåler dagtid, som er hele poenget: den
// nasjonale bevisspørringen måtte kjøres ved midnatt.
//
//   1  way(id:…); out tags bb;          boks + tagger, ingen geometri
//   2  rel(bw);   out body;             relasjonene flatene er MEDLEM av
//   3  way(around.f:100)[piste:type~downhill]; out geom;
//
// Spørring 3 er den eneste som henter geometri, og den er avgrenset til 100 m
// rundt flatene — ikke til et område. Antallet utforløyper i og rundt 115
// flater er små hundretall.
//
// ANALYSEN LIGGER I lib/flatemaal.ts og er testet uten nett. Dette skriptet
// henter og skriver ut; det tolker ingenting selv.
import * as fs from 'node:fs';

import {
    fordeling,
    maalFlater,
    median,
    STORRELSE_BOTTER,
    type FlateInn,
    type LinjeInn,
    type RelasjonInn,
} from '../lib/flatemaal';
import { fetchOverpass } from './import-places';

// OsmElement er ikke eksportert fra import-places, og skal ikke bli det for
// denne målingens skyld — formen hentes ut av returtypen i stedet.
type OsmElement = Awaited<ReturnType<typeof fetchOverpass>>[number];

const arg = (navn: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${navn}=`))?.slice(navn.length + 3);
const bareQueries = process.argv.includes('--queries');

/**
 * DE TRE SPØRRINGENE, som ren funksjon av id-lista.
 *
 * Skilt ut og eksportert for test. En feil her koster en spørring mot et
 * speil som allerede har gitt 504 på dagtid, og feilen ville vært usynlig:
 * `way(id:)` med tom liste er en syntaksfeil, og en glemt `relation`-gren
 * ville stilltiende utelatt flatene som er relasjoner.
 */
export function byggSporringer(ider: readonly string[]): {
    flater: string;
    relasjoner: string;
    loyper: string;
} {
    const nummer = (type: string): string =>
        ider
            .filter((i) => i.startsWith(`${type}/`))
            .map((i) => i.split('/')[1])
            .join(',');

    // Flatene kan være både ways og relations. Begge settes i .f, som
    // spørring 2 og 3 bygger videre på. En tom gren utelates helt —
    // `way(id:);` er en syntaksfeil.
    const settet = [
        nummer('way') ? `way(id:${nummer('way')});` : '',
        nummer('relation') ? `relation(id:${nummer('relation')});` : '',
        nummer('node') ? `node(id:${nummer('node')});` : '',
    ]
        .filter(Boolean)
        .join('\n  ');

    const sett = `(\n  ${settet}\n)->.f;`;

    return {
        flater: `[out:json][timeout:120];\n${sett}\n.f out tags bb;`,

        // `rel(bw.f)` = relasjoner som har en WAY i .f som medlem.
        // `rel(br.f)`  = relasjoner som har en RELASJON i .f som medlem.
        // BEGGE trengs: flatene er en blanding, og bare bw ville utelatt
        // foreldrene til dem som selv er relasjoner.
        //
        // `out body` er nødvendig, ikke `out tags`: uten den kommer
        // relasjonen UTEN medlemsliste, og da kan ingen flate knyttes til
        // den. Nøyaktig samme felle som OUT_GEOM_TAGS i import-places.
        relasjoner:
            `[out:json][timeout:120];\n${sett}\n` +
            `(\n  rel(bw.f);\n  rel(br.f);\n);\nout body;`,

        // 100 m, ikke 0: en nedfart tegnet fra parkeringen utenfor flata skal
        // telle, og analysen avgjør selv om linja faktisk er INNE i boksen.
        loyper:
            `[out:json][timeout:180];\n${sett}\n` +
            `(\n  way(around.f:100)["piste:type"~"downhill"];\n` +
            `  relation(around.f:100)["piste:type"~"downhill"];\n);\nout geom;`,
    };
}

export function lesIder(tekst: string): string[] {
    const ider = tekst
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    const ugyldig = ider.filter((i) => !/^(way|relation|node)\/\d+$/.test(i));
    if (ugyldig.length) {
        throw new Error(`Ugyldige id-er: ${ugyldig.slice(0, 5).join(', ')}`);
    }
    if (!ider.length) throw new Error('Id-lista er tom.');
    return ider;
}

// SAMME VAKT SOM import-places: uten den ville en `import` fra testen kjørt
// hele skriptet, lest --ids fra testkjørerens argumenter og avsluttet
// prosessen før en eneste test hadde kjørt.
const isDirectRun = process.argv[1]?.endsWith('skianlegg-flatemaal.ts');

function curl(q: string): string {
    return (
        `curl -sS -A 'togedoo-import/1.0' https://overpass-api.de/api/interpreter \\\n` +
        `  --data-urlencode 'data=${q.replace(/'/g, "'\\''")}'`
    );
}

function punkter(el: OsmElement): { lat: number; lon: number }[] {
    if (el.geometry?.length) return el.geometry.map((g: { lat: number; lon: number }) => ({ lat: g.lat, lon: g.lon }));
    if (el.center) return [{ lat: el.center.lat, lon: el.center.lon }];
    if (typeof el.lat === 'number' && typeof el.lon === 'number') {
        return [{ lat: el.lat, lon: el.lon }];
    }
    return [];
}

async function main(ider: readonly string[], idFil: string): Promise<void> {
    const Q = byggSporringer(ider);
    console.log(`${ider.length} flater lest fra ${idFil}\n`);

    if (bareQueries) {
        for (const [navn, q] of [
            ['1  BOKS OG TAGGER', Q.flater],
            ['2  RELASJONER FLATENE ER MEDLEM AV', Q.relasjoner],
            ['3  UTFORLØYPER INNTIL 100 M', Q.loyper],
        ] as const) {
            console.log(`${'─'.repeat(72)}\n# ${navn}\n${'─'.repeat(72)}`);
            console.log(curl(q) + '\n');
        }
        return;
    }

    const flaterRaa = await fetchOverpass(Q.flater, 'flatemaal/bokser');
    const relRaa = await fetchOverpass(Q.relasjoner, 'flatemaal/relasjoner');
    const loyperRaa = await fetchOverpass(Q.loyper, 'flatemaal/loyper');

    const flater: FlateInn[] = flaterRaa.map((el) => ({
        id: `${el.type}/${el.id}`,
        tags: el.tags ?? {},
        bounds: el.bounds ?? null,
    }));
    const relasjoner: RelasjonInn[] = relRaa.map((el) => ({
        id: `${el.type}/${el.id}`,
        tags: el.tags ?? {},
        medlemmer: (el.members ?? []).map((m) => `${m.type}/${m.ref}`),
    }));
    const linjer: LinjeInn[] = loyperRaa.map((el) => ({
        id: `${el.type}/${el.id}`,
        tags: el.tags ?? {},
        points: punkter(el),
    }));

    const savnet = ider.filter((i) => !flater.some((f) => f.id === i));
    if (savnet.length) {
        console.log(
            `  ADVARSEL: ${savnet.length} id-er kom ikke tilbake fra Overpass ` +
                `(slettet i OSM siden importen?): ${savnet.slice(0, 5).join(', ')}\n`
        );
    }

    const maal = maalFlater(flater, linjer, relasjoner);
    skrivRapport(maal, linjer.length, relasjoner.length);
}

function skrivRapport(
    maal: ReturnType<typeof maalFlater>,
    antallLinjer: number,
    antallRelasjoner: number
): void {
    const medBoks = maal.filter((m) => m.breddeM !== null);
    const langs = medBoks.map((m) => Math.max(m.breddeM!, m.hoydeM!));
    const areal = medBoks.map((m) => m.arealKm2!);

    console.log('═'.repeat(72));
    console.log(`1  STØRRELSE   ${medBoks.length} flater med boks, ${maal.length - medBoks.length} uten`);
    console.log('═'.repeat(72));
    console.log('\n  lengste side (m)');
    for (const b of fordeling(langs, STORRELSE_BOTTER)) {
        console.log(`    ${b.merke.padEnd(12)} ${String(b.antall).padStart(4)}  ${'█'.repeat(b.antall)}`);
    }
    console.log(`\n  median lengste side: ${Math.round(median(langs) ?? 0)} m`);
    console.log(`  median areal:        ${(median(areal) ?? 0).toFixed(3)} km²`);
    console.log(`  minste / største:    ${(Math.min(...areal)).toFixed(4)} / ${(Math.max(...areal)).toFixed(3)} km²`);

    console.log(`\n${'═'.repeat(72)}`);
    console.log(`2  RELASJONER   ${antallRelasjoner} relasjoner hentet`);
    console.log('═'.repeat(72));
    const iRel = maal.filter((m) => m.relasjon);
    const medNavn = iRel.filter((m) => m.relasjonNavn);
    console.log(`\n  medlem av en relasjon:        ${iRel.length} av ${maal.length}`);
    console.log(`  …der relasjonen har NAVN:     ${medNavn.length}`);
    const perRel = new Map<string, number>();
    for (const m of medNavn) {
        const k = `${m.relasjonNavn} (${m.relasjon})`;
        perRel.set(k, (perRel.get(k) ?? 0) + 1);
    }
    for (const [navn, n] of [...perRel].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`    ${String(n).padStart(4)} × ${navn}`);
    }

    console.log(`\n${'═'.repeat(72)}`);
    console.log(`3  UTFORLØYPER   ${antallLinjer} downhill-objekter innen 100 m`);
    console.log('═'.repeat(72));
    const krysser = maal.filter((m) => m.kryssende > 0);
    console.log(`\n  har minst én utforløype i boksen:  ${krysser.length} av ${maal.length}`);
    console.log('\n  antall utforløyper i boksen');
    for (const b of fordeling(maal.map((m) => m.kryssende), [1, 2, 3, 6, 11])) {
        console.log(`    ${b.merke.padEnd(12)} ${String(b.antall).padStart(4)}  ${'█'.repeat(b.antall)}`);
    }
    // DET AVGJØRENDE: én linje som går hele lengden = flata er den linjas
    // korridor, og raden er en dublett av noe som allerede finnes.
    const korridor = maal.filter((m) => m.kryssende === 1 && m.stersteDekning >= 0.8);
    const anlegg = maal.filter((m) => m.kryssende >= 3);
    console.log(`\n  ÉN løype som går ≥80 % av lengden (korridor):  ${korridor.length}`);
    console.log(`  TRE eller flere løyper i boksen (anlegg):      ${anlegg.length}`);
    console.log(`  verken–eller:                                  ${maal.length - korridor.length - anlegg.length}`);
}

if (isDirectRun) {
    const idFil = arg('ids');
    if (!idFil) {
        console.error('Mangler --ids=<fil>. Én external_id per linje, f.eks. way/123456.');
        process.exit(1);
    }
    main(lesIder(fs.readFileSync(idFil, 'utf8')), idFil).catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
