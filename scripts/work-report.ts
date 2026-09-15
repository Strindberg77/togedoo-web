// scripts/work-report.ts
//
// LESER EN KJØRING UT AV ARBEIDSKATALOGEN, uten å spørre Overpass på nytt.
//
// HVORFOR DEN FINNES: mellomleddet lagrer DATAENE, ikke LOGGEN. Etter den
// første nasjonale tørrkjøringen (sep. 2026) hadde Frederik bare den siste
// delen av utskriften i terminalen — hent-linjene og «utelatt»-linjene var
// rullet forbi, og de var nettopp det som trengtes for å diagnostisere.
//
// Alt loggen sa kan regnes ut PÅ NYTT fra artefaktene, fordi berikelsen er
// ren: klyngingen, den romlige testen og kommuneoppslaget rører ikke
// nettverket. Det eneste som ikke kan gjenskapes er geokodingen, og den står
// allerede som titler i berikelsesfila.
//
//   npx --yes tsx scripts/work-report.ts --work=.import-work
//   npx --yes tsx scripts/work-report.ts --work=.import-work --chunk=norge --near=500
//   npx --yes tsx scripts/work-report.ts --work=.import-work --lines=1000
//
// NESTE GANG: `| tee kjoring.log`. Dette verktøyet er for kjøringen som
// allerede er gjort.
import * as fs from 'node:fs';
import * as path from 'node:path';

import { distanceMeters } from '../lib/geo-polygon';
import { parseNdjson } from './work-store';
import {
    akingClusters,
    akingVerdict,
    elementPoints,
    groupFetchRecords,
    PLACE_CATEGORIES,
    type FetchRecord,
    type ImportRow,
} from './import-places';
import { municipalityIndex } from './municipality-index';

const arg = (navn: string, standard?: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${navn}=`))?.slice(navn.length + 3) ?? standard;

const workDir = arg('work', '.import-work')!;
const bareChunk = arg('chunk');
const naerMeter = Number(arg('near', '500'));
const maxLinjer = Number(arg('lines', '40')) || 40;

if (!fs.existsSync(workDir)) {
    console.error(`Fant ingen arbeidskatalog: ${workDir}`);
    process.exit(1);
}

const manifest = parseNdjson<{
    chunkId: string;
    stage: string;
    count: number;
    at: string;
    emptySets?: string[];
    seenClaims?: string[];
}>(fs.readFileSync(path.join(workDir, 'manifest.ndjson'), 'utf8'));

const chunkIds = [...new Set(manifest.map((m) => m.chunkId))].filter(
    (id) => !bareChunk || id === bareChunk
);

for (const chunkId of chunkIds) {
    console.log(`\n${'='.repeat(72)}\nCHUNK ${chunkId}\n${'='.repeat(72)}`);
    for (const m of manifest.filter((x) => x.chunkId === chunkId)) {
        console.log(
            `  ${m.stage.padEnd(7)} ${String(m.count).padStart(6)} linjer   ${m.at}` +
                (m.emptySets?.length ? `   tomme sett: ${m.emptySets.join(', ')}` : '') +
                (m.seenClaims?.length ? `   claims: ${m.seenClaims.join(', ')}` : '')
        );
    }

    // ── HENT ────────────────────────────────────────────────────────────
    const fetchFil = path.join(workDir, `${chunkId}.fetch.ndjson`);
    if (fs.existsSync(fetchFil)) {
        const records = parseNdjson<FetchRecord>(fs.readFileSync(fetchFil, 'utf8'));
        const grupper = groupFetchRecords(records);
        console.log('\n  HENT (rekonstruert fra mellomleddet)');
        for (const [key, sets] of [...grupper].sort()) {
            const deler = Object.entries(sets).map(([n, l]) => `${l.length} ${n}`);
            console.log(`    ${key.padEnd(12)} ${deler.join(', ')}`);
        }

        // ── UTENFOR NORGE ───────────────────────────────────────────────
        // Bboksen dekker Sverige, Danmark og Finland. Dette er andelen av
        // det HENTEDE som ikke ligger i en norsk kommune. Det er ikke
        // nøyaktig antall utelatte RADER — et objekt kan også falle på
        // kategori, koordinat eller --limit — men det svarer på det
        // spørsmålet «utelatt»-linjene svarte på.
        const idx = municipalityIndex();
        console.log('\n  GEOGRAFI (av hentede objekter)');
        for (const [key, sets] of [...grupper].sort()) {
            let inne = 0;
            let ute = 0;
            let utenPunkt = 0;
            for (const el of Object.values(sets).flat()) {
                // elementPoints dekker node, way (geometry) og relasjon
                // (members[].geometry) — det er den samme funksjonen
                // berikelsen bruker, så tallene her og der er om det samme.
                const p =
                    elementPoints(el)[0] ??
                    (el.center ? { lat: el.center.lat, lon: el.center.lon } : undefined);
                if (!p) {
                    utenPunkt += 1;
                    continue;
                }
                if (idx.lookup(p.lat, p.lon)) inne += 1;
                else ute += 1;
            }
            const sum = inne + ute;
            console.log(
                `    ${key.padEnd(12)} ${String(inne).padStart(6)} i Norge, ` +
                    `${String(ute).padStart(6)} utenfor` +
                    (sum ? ` (${Math.round((ute / sum) * 100)} % utenfor)` : '') +
                    (utenPunkt ? `, ${utenPunkt} uten punkt` : '')
            );
        }

        // ── BERIKELSE, KJØRT PÅ NYTT ────────────────────────────────────
        // Ren funksjon: ingen nettverk, ingen database. Dette er linjene
        // som rullet forbi i terminalen.
        console.log('\n  BERIKELSE (kjørt på nytt fra mellomleddet)');
        for (const cat of PLACE_CATEGORIES) {
            const sets = grupper.get(cat.key);
            if (!sets || !cat.enrichSets) continue;
            const ut = cat.enrichSets(sets);
            console.log(`    ${cat.key}: ${ut.summary ?? `${ut.elements.length} elementer`}`);
            // TELLINGEN STÅR I `summary`, ikke her. Den lages av den samme
            // funksjonen som feller dommene, så den kan ikke komme i utakt
            // med linjene under. En egen opptelling i rapportverktøyet ville
            // måttet gjette dommen ut av en formatert tekstlinje, og ville
            // vært en ANDRE sannhet om det samme tallet.
            for (const linje of ut.rapport.slice(0, maxLinjer)) console.log(`  ${linje}`);
            if (ut.rapport.length > maxLinjer) {
                // ORDLYDEN ER EN RETTING. Den sa «… 774 linjer til», og det
                // ble lest som «774 objekter hoppet over» i diagnosen etter
                // den første nasjonale tørrkjøringen. Tallet var antallet
                // SKJULTE linjer av 814, ikke antallet hoppet over — og de
                // 40 som VAR synlige var alle noder, fordi Overpass svarer
                // noder før ways og relasjoner. Nå står nevneren i linja, og
                // det finnes et flagg for å se resten.
                console.log(
                    `      … ${ut.rapport.length - maxLinjer} av ${ut.rapport.length} linjer ` +
                        `skjult — --lines=${ut.rapport.length} viser alle`
                );
            }
        }

        // ── AKING: HELE DOMSTELLINGEN ───────────────────────────────────
        const akingSets = grupper.get('aking');
        if (akingSets?.main) {
            const { anchors, domTelling } = akingClusters(akingSets.main);
            console.log('\n  AKING — hvorfor det ble så få');
            console.log(`    hentet ................ ${akingSets.main.length} objekter`);
            console.log(`    godkjent som aking .... ${domTelling.aking}`);
            console.log(`    avvist: alpint-blandet  ${domTelling['alpint-blandet']}`);
            console.log(`    avvist: lekeplass ..... ${domTelling.lekeplass}`);
            console.log(`    avvist: uten navn ..... ${domTelling['uten-navn']}`);
            console.log(`    avvist: ikke aking .... ${domTelling['ikke-aking']}`);
            console.log(`    ETTER KLYNGING ........ ${anchors.length} bakker`);
            const iNorge = anchors.filter((a) => {
                const lat = a.center?.lat ?? a.lat;
                const lon = a.center?.lon ?? a.lon;
                return typeof lat === 'number' && typeof lon === 'number'
                    ? Boolean(idx.lookup(lat, lon))
                    : false;
            }).length;
            console.log(`    …av dem i Norge ....... ${iNorge}`);

            // HVOR STOR ER «uten navn» EGENTLIG? Totalen er dominert av
            // naboland (91 av 313 objekter lå i Norge i første nasjonale
            // tørrkjøring), så 203 avviste sier ingenting om hvor mye som
            // faktisk er tapt her hjemme. Dette tallet er taket for hva en
            // romlig klynging av navnløse akebakker kunne lagt til — og det
            // er OBJEKTER, ikke rader: en klynging ville slått flere av dem
            // sammen. Se docs/runbooks/nasjonal-ski.md, funn 3.
            const navnloseINorge = akingSets.main.filter((el) => {
                if (akingVerdict(el.tags ?? {}) !== 'uten-navn') return false;
                const p = elementPoints(el)[0];
                return p ? Boolean(idx.lookup(p.lat, p.lon)) : false;
            }).length;
            console.log(
                `    uten navn, i Norge .... ${navnloseINorge} objekter ` +
                    `(taket for romlig klynging — se funn 3)`
            );
        }
    }

    // ── RADENE ──────────────────────────────────────────────────────────
    const enrichFil = path.join(workDir, `${chunkId}.enrich.ndjson`);
    if (!fs.existsSync(enrichFil)) continue;
    const rows = parseNdjson<ImportRow>(fs.readFileSync(enrichFil, 'utf8'));

    console.log('\n  RADER');
    const kategorier = [...new Set(rows.map((r) => r.category))].sort();
    for (const kat of kategorier) {
        const r = rows.filter((x) => x.category === kat);
        const kilde = (s: string) => r.filter((x) => x.titleSource === s).length;
        console.log(
            `    ${kat.padEnd(14)} ${String(r.length).padStart(5)}  ` +
                `osm-navn ${kilde('osm-navn')}, ved-gate ${kilde('ved-gate')}, ` +
                `i-område ${kilde('i-omraade')}, i-poststed ${kilde('i-poststed')}, ` +
                `kun-kategori ${kilde('kun-kategori')}`
        );
        console.log(
            `    ${''.padEnd(14)}        ` +
                `ekte geokodingsfeil ${r.filter((x) => x.geocodeError).length}, ` +
                `uten adresse ${r.filter((x) => x.addressMissing).length}`
        );
    }

    // ── DUPLIKATER ──────────────────────────────────────────────────────
    // TO analyser, fordi de svarer på ulike ting:
    //
    //   DELT TITTEL  — tre ways som alle heter «Skianlegg i Fageråsen».
    //                  Merk at DEN tittelen er GENERERT (områdenavn fra
    //                  Nominatim), ikke et OSM-navn. Tre navnløse polygoner
    //                  i samme område får samme tittel uten å være samme
    //                  anlegg. Kolonnen «kilde» sier hvilket det er.
    //   NÆRE HVERANDRE — geometrien, uavhengig av tittel. Det er dette som
    //                  avgjør om det er ett anlegg eller tre.
    console.log(`\n  DUPLIKATANALYSE (nærhet: ${naerMeter} m)`);
    for (const kat of kategorier) {
        const r = rows.filter((x) => x.category === kat);

        const perTittel = new Map<string, ImportRow[]>();
        for (const row of r) {
            const k = row.title.trim().toLowerCase();
            const liste = perTittel.get(k);
            if (liste) liste.push(row);
            else perTittel.set(k, [row]);
        }
        const delte = [...perTittel.entries()].filter(([, l]) => l.length > 1);
        const raderIDelteTitler = delte.reduce((n, [, l]) => n + l.length, 0);

        // Enkeltlenke på avstand, uavhengig av tittel.
        const rest = r.map((_, i) => i);
        const klynger: number[][] = [];
        while (rest.length) {
            const gruppe = [rest.shift()!];
            for (let i = 0; i < gruppe.length; i += 1) {
                const a = r[gruppe[i]];
                for (let j = rest.length - 1; j >= 0; j -= 1) {
                    const b = r[rest[j]];
                    const d = distanceMeters(
                        { lat: a.lat, lon: a.lng },
                        { lat: b.lat, lon: b.lng }
                    );
                    if (d <= naerMeter) {
                        gruppe.push(rest[j]);
                        rest.splice(j, 1);
                    }
                }
            }
            klynger.push(gruppe);
        }
        const flerledda = klynger.filter((k) => k.length > 1);
        const raderIKlynger = flerledda.reduce((n, k) => n + k.length, 0);

        console.log(
            `    ${kat.padEnd(14)} ${r.length} rader → ` +
                `${klynger.length} romlige klynger innen ${naerMeter} m ` +
                `(${flerledda.length} klynger med mer enn én rad, ${raderIKlynger} rader)`
        );
        console.log(
            `    ${''.padEnd(14)} ${delte.length} delte titler, ${raderIDelteTitler} rader`
        );
        for (const [tittel, liste] of delte.slice(0, 10)) {
            const kilder = [...new Set(liste.map((x) => x.titleSource))].join('/');
            const spredning = Math.round(
                Math.max(
                    ...liste.flatMap((a) =>
                        liste.map((b) =>
                            distanceMeters({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng })
                        )
                    )
                )
            );
            console.log(
                `        «${tittel}» ×${liste.length} [${kilder}] spredning ${spredning} m: ` +
                    liste.map((x) => x.external_id).join(', ')
            );
        }
        if (delte.length > 10) console.log(`        … ${delte.length - 10} til`);
    }
}
