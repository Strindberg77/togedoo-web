// scripts/bbox-candidates.ts
//
// MÅLER BBOX-KANDIDATER MOT KOMMUNEGRENSENE, og skriver ut spørringene som
// gir den ekte målingen.
//
//   npx --yes tsx scripts/bbox-candidates.ts
//   npx --yes tsx scripts/bbox-candidates.ts --queries        # bare spørringene
//   npx --yes tsx scripts/bbox-candidates.ts --category=aking
//
// TO DELER, og skillet mellom dem er hele poenget:
//
//   AREAL   regnes ut her, offline, mot Kartverkets kommunegrenser. Det er
//           en PROXY. Objekter i OSM er ikke jevnt fordelt over areal — mye
//           av dagens boks er hav.
//
//   ANTALL  kan bare Overpass svare på. Derfor skriver skriptet ut ferdige
//           `out count;`-spørringer: de returnerer ETT tall og ingen
//           geometri, så en kandidat koster sekunder og noen hundre byte.
//
// Skriptet rører ikke nettet selv. Det er med vilje: valget av boks skal
// gjøres på tall Frederik har sett, ikke på en kjøring herfra.
import * as fs from 'node:fs';

import { boundsOf, type GeoBounds, type GeoPoint } from '../lib/geo-polygon';
import {
    BOX_MARGIN_M,
    bboxFilter,
    boxAreaKm2,
    optimalBands,
    padBox,
    uncovered,
} from '../lib/norway-boxes';
import { NATIONAL_BBOX } from '../lib/import-chunks';
import { PLACE_CATEGORIES, SKI_AREA_SELECTOR, SKI_EVIDENCE_SELECTOR } from './import-places';
import { MUNICIPALITY_FILE } from './municipality-index';

const arg = (navn: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${navn}=`))?.slice(navn.length + 3);
const bareQueries = process.argv.includes('--queries');
const katArg = arg('category');

const gj = JSON.parse(fs.readFileSync(MUNICIPALITY_FILE, 'utf8'));
type Kommune = { navn: string; nr: string; punkter: GeoPoint[] };
const kommuner: Kommune[] = gj.features.map((f: any) => {
    const punkter: GeoPoint[] = [];
    const walk = (c: any): void => {
        if (typeof c[0] === 'number') punkter.push({ lat: c[1], lon: c[0] });
        else for (const d of c) walk(d);
    };
    walk(f.geometry.coordinates);
    return { navn: f.properties.name, nr: f.properties.kommunenummer, punkter };
});
const alle = kommuner.flatMap((k) => k.punkter);

const DAGENS: GeoBounds = (() => {
    const [a, b, c, d] = NATIONAL_BBOX.slice(1, -1).split(',').map(Number);
    return { minlat: a, minlon: b, maxlat: c, maxlon: d };
})();

const km2 = (v: number) => `${Math.round(v).toLocaleString('nb')} km²`;

/** Båndene ved k, med margin, slik de ville blitt brukt. */
function bands(k: number): GeoBounds[] {
    return optimalBands(alle, k).map((b) => padBox(b, BOX_MARGIN_M));
}

const kandidater: { navn: string; bokser: GeoBounds[] }[] = [
    { navn: 'dagens (én boks)', bokser: [DAGENS] },
    ...[1, 2, 3, 4, 5, 6, 8].map((k) => ({ navn: `${k} bånd`, bokser: bands(k) })),
];

if (!bareQueries) {
    console.log(`GRENSEFILA: ${kommuner.length} kommuner, ${alle.length.toLocaleString('nb')} punkter`);
    const norge = boundsOf(alle)!;
    console.log(`NORGES EKTE BBOX: ${bboxFilter(norge)}  ${km2(boxAreaKm2(norge))}`);
    console.log(`MARGIN PER BOKS: ${BOX_MARGIN_M} m\n`);

    console.log('KANDIDATER (areal er en PROXY — se filhodet)');
    console.log('  kandidat            bokser        samlet areal   mot dagens   dekker alle kommuner');
    for (const { navn, bokser } of kandidater) {
        const a = bokser.reduce((s, b) => s + boxAreaKm2(b), 0);
        const ute = uncovered(alle, bokser);
        const mangler = new Set(
            kommuner.filter((k) => k.punkter.some((p) => ute.includes(p))).map((k) => k.navn)
        );
        console.log(
            `  ${navn.padEnd(18)} ${String(bokser.length).padStart(4)}   ` +
                `${km2(a).padStart(14)}   ${((a / boxAreaKm2(DAGENS)) * 100).toFixed(0).padStart(6)} %` +
                `   ${ute.length === 0 ? 'ja' : `NEI (${[...mangler].slice(0, 3).join(', ')})`}`
        );
    }

    for (const k of [4, 5]) {
        console.log(`\nBOKSENE VED k=${k}:`);
        for (const b of bands(k)) {
            console.log(`  ${bboxFilter(b).padEnd(34)} ${km2(boxAreaKm2(b)).padStart(14)}`);
        }
    }
}

// ───────────────────────── SPØRRINGENE ─────────────────────────
//
// `out count;` gir ETT objekt tilbake: {"type":"count","tags":{"total":"…",
// "nodes":"…","ways":"…","relations":"…"}}. Altså både totalen OG
// node-andelen, som er nøyaktig det funn 2 handler om.
//
// -A trengs: uten User-Agent svarer speilets Apache 406 og ikke 200.

const selektorer: { navn: string; linjer: string }[] = katArg
    ? [
          ...(katArg === 'skianlegg'
              ? [
                    { navn: 'skianlegg:omrade', linjer: SKI_AREA_SELECTOR },
                    { navn: 'skianlegg:bevis', linjer: SKI_EVIDENCE_SELECTOR },
                ]
              : []),
          ...PLACE_CATEGORIES.filter((c) => c.key === katArg && c.selector).map((c) => ({
              navn: c.key,
              linjer: c.selector!,
          })),
      ]
    : [
          { navn: 'skianlegg:omrade', linjer: SKI_AREA_SELECTOR },
          { navn: 'skianlegg:bevis', linjer: SKI_EVIDENCE_SELECTOR },
          ...PLACE_CATEGORIES.filter((c) => c.key === 'aking' && c.selector).map((c) => ({
              navn: c.key,
              linjer: c.selector!,
          })),
      ];

if (selektorer.length === 0) {
    console.error(`Fant ingen selektor for --category=${katArg}.`);
    process.exit(1);
}

console.log(`\n${'='.repeat(72)}\nSPØRRINGER — kjør hver, og skriv ned «total» og «nodes»\n${'='.repeat(72)}`);
console.log(
    '\nHver spørring returnerer ETT tall og ingen geometri, så en kandidat\n' +
        'koster sekunder. Kjør alle på samme tidspunkt av døgnet — ellers måler\n' +
        'du speilets belastning og ikke boksen (Oslo alene ga 504 på dagtid).\n'
);

interface Variant {
    readonly navn: string;
    /** Setningen foran unionen, uten semikolon. */
    readonly omrade: string;
    /** `null` = ingen bbox, selektoren beholder sin egen `(area.a)`. */
    readonly bokser: readonly GeoBounds[] | null;
}

const varianter: Variant[] = [
    { navn: 'A  dagens boks', omrade: '', bokser: [DAGENS] },
    { navn: 'B  4 bånd', omrade: '', bokser: bands(4) },
    { navn: 'C  5 bånd', omrade: '', bokser: bands(5) },
    // Området SOM BLE FORKASTET, tatt med her nettopp fordi det aldri er
    // målt. `out count;` er den billigste måten å finne ut om det i det hele
    // tatt løser seg — svarer den 0, er området problemet og ikke dataene.
    {
        navn: 'D  area[ISO3166-1=NO]',
        omrade: 'area["ISO3166-1"="NO"]["admin_level"="2"]->.a',
        bokser: null,
    },
];

/** Selektorlinjene med ett filter per boks (eller uendret for område). */
function scoped(linjer: string, bokser: readonly GeoBounds[] | null): string {
    const rene = linjer
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    if (!bokser) return rene.join('\n  ');
    return rene
        .flatMap((l) => bokser.map((b) => l.split('(area.a)').join(bboxFilter(b))))
        .join('\n  ');
}

for (const { navn, linjer } of selektorer) {
    console.log(`\n${'─'.repeat(72)}\n${navn}\n${'─'.repeat(72)}`);
    for (const v of varianter) {
        const scope = scoped(linjer, v.bokser);
        const setninger = scope.split('\n').length;
        const q =
            `[out:json][timeout:300];\n` +
            (v.omrade ? `${v.omrade};\n` : '') +
            `(\n  ${scope}\n);\nout count;`;
        console.log(`\n# ${v.navn}   ${setninger} setninger`);
        console.log(
            `curl -sS -A 'togedoo-import/1.0' https://overpass-api.de/api/interpreter \\\n` +
                `  --data-urlencode 'data=${q.replace(/'/g, "'\\''")}'`
        );
    }
}
