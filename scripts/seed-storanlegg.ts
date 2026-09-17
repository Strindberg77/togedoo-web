// scripts/seed-storanlegg.ts
//
// FORSLAG, IKKE SEED. Tre store alpinanlegg som i dag har bbox-senteret i
// fjellsiden som kartpunkt. Se docs/skianlegg-adkomst.md.
//
//   npx --yes tsx scripts/seed-storanlegg.ts --dry-run
//
// Fila har INGEN skrivemodus. Uten --dry-run stopper den. Når Frederik har
// valgt tittel og adkomstpunkt, flyttes entryene til SEED og SPLIT i
// scripts/seed-vintertilbud.ts og claimene til OSM_CLAIMS i
// lib/osm-claims.ts — samme vei som Oslo-alpint (docs/runbooks/oslo-alpin.md).
//
// HVORFOR CLAIMENE STÅR HER OG IKKE I OSM_CLAIMS: en claim virker i det
// øyeblikket den ligger i lista. Neste import ville hoppet over Voss Resort
// uten at noen seed-rad fantes, og anlegget hadde forsvunnet fra appen.
// Dessuten ville assertClaimsResolve i seed-vintertilbud.ts kastet, fordi
// externalId-ene ikke finnes der ennå.
//
// ─────────────────────────────────────────────────────────────────────────
// ÉN RAD EIER HELE ANLEGGET, OGSÅ DELENE. En claim er et par (OSM-objekt,
// kuratert rad), og ingenting hindrer én rad i å eie flere objekter. Da blir
// Alphapark, «child ski area» og Geilolia aldri rader igjen, uansett om
// låsen på den gamle raden forsvinner. De 115 navnløse delflatene claimes
// IKKE: de er tatt ned med lås, og 115 claims ville druknet de som betyr noe.
import * as fs from 'node:fs';

import { OSM_CLAIMS, claimNameMatches, type OsmClaim } from '../lib/osm-claims';
import type { FacetToken } from '../lib/facets';
import { SEED as VINTER_SEED } from './seed-vintertilbud';
import { hent } from './skianlegg-flatemaal';

export const TODO = 'TODO' as const;
type Todo = typeof TODO;

export interface Adkomst {
    /** Kort navn på basen, slik det står på anleggets nettside der det finnes. */
    readonly base: string;
    readonly lat: number;
    readonly lng: number;
    /** Hva punktet ER i OSM — dalstasjon, parkering, billettsalg. */
    readonly hva: string;
    readonly moh: number;
}

export interface StoranleggForslag {
    readonly externalId: string;
    /** TODO til valgt. `titler` er kandidatene. */
    readonly title: string | Todo;
    readonly titler: readonly { tittel: string; kilde: string }[];
    /** TODO til valgt: `base` fra `adkomster`. */
    readonly valgtBase: string | Todo;
    readonly adkomster: readonly Adkomst[];
    /** Utkast. Nevner de øvrige basene, så ett punkt ikke skjuler dem. */
    readonly description: string;
    readonly municipality: string;
    readonly url: string;
    /** Kopiert fra dagens importrad. Seed-rader utleder ikke fasetter selv. */
    readonly facets: readonly FacetToken[];
    readonly dagens: { readonly lat: number; readonly lng: number; readonly moh: number };
}

export const FORSLAG: readonly StoranleggForslag[] = [
    {
        externalId: 'voss-resort',
        title: TODO,
        titler: [
            { tittel: 'Voss Resort', kilde: 'vossresort.no (logo, tittel)' },
            { tittel: 'Voss Resort Fjellheisar', kilde: 'OSM name + operator — selskapsnavnet' },
        ],
        valgtBase: TODO,
        adkomster: [
            { base: 'Gondolen, Voss sentrum', lat: 60.62919, lng: 6.41115, moh: 58, hva: 'dalstasjon Voss Gondol (way/675982736), 60 m fra Voss stasjon' },
            { base: 'Bavallen', lat: 60.65732, lng: 6.41646, moh: 283, hva: 'dalstasjon Bavallsekspressheisen (way/30743028); billettsalg Varmestovo 110 m' },
            { base: 'Tråstølen', lat: 60.65529, lng: 6.40048, moh: 564, hva: 'dalstasjon Tråstølheisen (way/52265018); P6 (gratis) 130 m' },
        ],
        description:
            'TODO: Et av de største skianleggene på Vestlandet, med gondol fra Voss sentrum. ' +
            'Med bil kan du også parkere i Bavallen eller på Tråstølen.',
        municipality: 'Voss',
        url: 'https://vossresort.no/no/vinter/',
        facets: ['alpint'],
        dagens: { lat: 60.6544365, lng: 6.3932421, moh: 658 },
    },
    {
        externalId: 'trysil-skisenter',
        title: TODO,
        titler: [
            { tittel: 'Trysil skisenter', kilde: 'skistar.com — «Trysil skisenter»' },
            { tittel: 'SkiStar Trysil', kilde: 'skistar.com — driftsselskap + sted' },
            { tittel: 'Trysilfjellet', kilde: 'fjellet; står ikke i OSM-taggene' },
        ],
        valgtBase: TODO,
        adkomster: [
            { base: 'Turistsenteret', lat: 61.31111, lng: 12.24674, moh: 415, hva: 'dalstasjon Trysilgondolen (way/1385891650); billettsalg node/1177505919 90 m; 20 parkeringer ≤ 400 m' },
            { base: 'Høyfjellsenteret', lat: 61.32333, lng: 12.15439, moh: 821, hva: '«Ski Tickets» (node/698846811) ved resepsjonen; P1 110 m, F12 Familietrekket 190 m' },
            { base: 'Skihytta', lat: 61.30307, lng: 12.19953, moh: 800, hva: 'dalstasjon S1 Skihytta Ekspress (way/507848254); parkering way/444035312 290 m (150 m fra S3 Valleheisen)' },
            { base: 'Høgegga', lat: 61.32810, lng: 12.22220, moh: 407, hva: 'dalstasjon H1 Høgekspressen (way/23274411); INGEN parkering i OSM ≤ 400 m' },
        ],
        description:
            'TODO: Norges største skianlegg. Fire innfallsporter: Turistsenteret (gondol), ' +
            'Høyfjellsenteret (barnevennlig), Skihytta og Høgegga.',
        municipality: 'Trysil',
        url: 'https://www.skistar.com/no/vare-skisteder/trysil/vinter-i-trysil/',
        facets: ['alpint', 'aking', 'terrengsykling', 'downhill'],
        dagens: { lat: 61.3121404, lng: 12.19845645, moh: 861 },
    },
    {
        externalId: 'skigeilo',
        title: TODO,
        titler: [
            { tittel: 'SkiGeilo', kilde: 'skigeilo.no (logo, tittel)' },
            { tittel: 'Ski Geilo', kilde: 'OSM name' },
            { tittel: 'Geilo skisenter', kilde: 'skigeilo.no — «Skisenteret på Geilo»' },
        ],
        valgtBase: TODO,
        adkomster: [
            { base: 'Geiloheisen (sentrum)', lat: 60.53463, lng: 8.19813, moh: 826, hva: 'dalstasjon Geiloheisen Express (way/31468685); parkering «Geiloheisen, ved Hegnavegen» (node/1152953487, gratis) 110 m' },
            { base: 'Slaatta', lat: 60.53724, lng: 8.21079, moh: 815, hva: 'Slaattaheisene/rullebånd (way/261992762); 8 parkeringer og Geilo stasjon ≤ 400 m' },
            { base: 'Vestlia', lat: 60.52117, lng: 8.19849, moh: 779, hva: 'dalstasjon Vestliheisen Express (way/31468693); parkering way/968089912 130 m' },
            { base: 'Kikut', lat: 60.51589, lng: 8.20891, moh: 921, hva: 'dalstasjon Kikutheisen Express (way/31468696); Kikut A/B/C på nettsiden, INGEN parkering i OSM ≤ 400 m' },
            { base: 'Havsdalen', lat: 60.54625, lng: 8.19690, moh: 968, hva: 'dalstasjon Fjellheisen (way/31468690); parkering way/1182563338 (avgift) 110 m' },
        ],
        description:
            'TODO: Skianlegg på begge sider av Geilo. Heiser fra sentrum (Geiloheisen, Slaatta), ' +
            'og egne parkeringer i Vestlia, på Kikut og i Havsdalen.',
        municipality: 'Hol',
        url: 'https://www.skigeilo.no/',
        facets: ['alpint', 'skileik', 'aking'],
        dagens: { lat: 60.53081065, lng: 8.2019806, moh: 772 },
    },
];

const SOURCE = 'kuratert-vintertilbud';

export const FORESLATTE_CLAIMS: readonly OsmClaim[] = [
    {
        osmId: 'relation/4107373', source: SOURCE, externalId: 'voss-resort',
        expectName: 'Voss Resort Fjellheisar',
        note: 'Bbox-senteret ligger på 658 moh. i fjellsiden; man møter opp ved gondolen i sentrum eller i Bavallen.',
    },
    {
        osmId: 'way/1348055350', source: SOURCE, externalId: 'voss-resort',
        expectName: 'Alphapark',
        note: 'Terrengpark inne i Voss Resort (5 av 5 noder i relation/4107373); fixme: sesongbygget, fra løypekartet 2024.',
    },
    {
        osmId: 'way/1210019615', source: SOURCE, externalId: 'trysil-skisenter',
        expectName: 'Trysil',
        note: 'Bbox-senteret ligger på 861 moh. midt i fjellet; fire baser med egen vei inn.',
    },
    {
        osmId: 'way/55606470', source: SOURCE, externalId: 'trysil-skisenter',
        expectName: 'child ski area',
        note: 'Barneområde ved Høyfjellsenteret, 6 av 6 noder i way/1210019615. Navnet er en engelsk typebetegnelse.',
    },
    {
        osmId: 'relation/17004845', source: SOURCE, externalId: 'skigeilo',
        expectName: 'Ski Geilo',
        note: 'Relasjonen har to ringer, én på hver side av dalen; bbox-senteret havner mellom dem, 430 m utenfor begge.',
    },
    // KREVER FREDERIKS JA: de tre under er ikke blant de tre anleggene i
    // oppdraget, men de er published rader med punkt inne i Ski Geilo.
    {
        osmId: 'relation/10859554', source: SOURCE, externalId: 'skigeilo',
        expectName: 'Geilolia',
        note: 'recreation_ground inne i Ski Geilo sin sørlige ring. Published rad i dag.',
    },
    {
        osmId: 'way/1238316509', source: SOURCE, externalId: 'skigeilo',
        expectName: null,
        note: 'Sørlig ytterring i relation/17004845, uten navn. Published rad i dag («Skianlegg i Geilolie»).',
    },
    {
        osmId: 'way/1238316510', source: SOURCE, externalId: 'skigeilo',
        expectName: null,
        note: 'Nordlig ytterring i relation/17004845, uten navn. Published rad i dag («Skianlegg ved Vesleåne 68»).',
    },
];

// ---------------------------------------------------------------------------
// KONTROLLENE — rene, testbare
// ---------------------------------------------------------------------------

export function aapneTodo(f: StoranleggForslag): string[] {
    const ut: string[] = [];
    if (f.title === TODO) ut.push('title');
    if (f.valgtBase === TODO) ut.push('valgtBase');
    else if (!f.adkomster.some((a) => a.base === f.valgtBase)) ut.push(`valgtBase «${f.valgtBase}» finnes ikke i adkomster`);
    if (f.description.startsWith('TODO')) ut.push('description');
    return ut;
}

/** Feil som gjør forslaget ubrukelig, uavhengig av TODO-ene. */
export function strukturfeil(
    forslag: readonly StoranleggForslag[],
    claims: readonly OsmClaim[],
    eksisterende: readonly OsmClaim[],
    seedIder: readonly string[]
): string[] {
    const feil: string[] = [];
    const ider = new Set(forslag.map((f) => f.externalId));
    for (const c of claims) {
        if (!ider.has(c.externalId)) feil.push(`${c.osmId} → ${c.externalId}: ingen slik rad i forslaget`);
        if (eksisterende.some((e) => e.osmId === c.osmId)) feil.push(`${c.osmId} er allerede claimet i OSM_CLAIMS`);
    }
    for (const f of forslag) {
        if (seedIder.includes(f.externalId)) feil.push(`${f.externalId} finnes alt i seed-vintertilbud`);
        if (!claims.some((c) => c.externalId === f.externalId)) feil.push(`${f.externalId} eier ingen OSM-objekter`);
    }
    return feil;
}

export function qNavn(osmIds: readonly string[]): string {
    const linjer = osmIds.map((id) => {
        const [type, nr] = id.split('/');
        return `${type}(${nr});`;
    });
    return `[out:json][timeout:60];\n(\n  ${linjer.join('\n  ')}\n);\nout tags;`;
}

async function main(): Promise<void> {
    if (!process.argv.includes('--dry-run')) {
        console.error(
            'seed-storanlegg.ts har ingen skrivemodus. Kjør med --dry-run.\n' +
                'Når tittel og base er valgt: flytt entryene til seed-vintertilbud.ts og claimene til lib/osm-claims.ts.'
        );
        process.exit(1);
    }

    const feil = strukturfeil(FORSLAG, FORESLATTE_CLAIMS, OSM_CLAIMS, VINTER_SEED.map((s) => s.externalId));
    if (feil.length) throw new Error(`Forslaget er ikke gyldig:\n  ${feil.join('\n  ')}`);

    // NAVNEKONTROLLEN mot ekte OSM, samme regel som importen bruker.
    const ider = [...new Set(FORESLATTE_CLAIMS.map((c) => c.osmId))];
    const cacheDir = '.flatemaal-cache';
    fs.mkdirSync(cacheDir, { recursive: true });
    const objekter = await hent(cacheDir, 'claims-navn', qNavn(ider));
    const navn = new Map(objekter.map((el) => [`${el.type}/${el.id}`, el.tags?.name]));

    console.log('TØRRKJØRING — INGENTING ER SKREVET.\n');
    let todo = 0;
    for (const f of FORSLAG) {
        const aapne = aapneTodo(f);
        todo += aapne.length;
        console.log(`${f.externalId}  (${f.municipality})`);
        console.log(`  tittel:  ${f.title}   kandidater: ${f.titler.map((t) => t.tittel).join(' | ')}`);
        console.log(`  base:    ${f.valgtBase}`);
        for (const a of f.adkomster) {
            console.log(`    - ${a.base.padEnd(24)} ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}  ${String(a.moh).padStart(4)} moh`);
        }
        console.log(`  dagens:  ${f.dagens.lat}, ${f.dagens.lng}  ${f.dagens.moh} moh`);
        console.log(`  fasetter ${f.facets.join(', ')}`);
        for (const c of FORESLATTE_CLAIMS.filter((x) => x.externalId === f.externalId)) {
            const n = navn.get(c.osmId);
            const status = !navn.has(c.osmId)
                ? 'FINNES IKKE I OSM'
                : claimNameMatches(c, n)
                  ? 'navn ok'
                  : `NAVNEAVVIK: OSM sier «${n}»`;
            console.log(`  claim   ${c.osmId.padEnd(20)} «${c.expectName ?? '(uten navn)'}»  ${status}`);
        }
        console.log(aapne.length ? `  ÅPNE TODO: ${aapne.join(', ')}\n` : '  klar\n');
    }
    console.log(
        todo
            ? `IKKE KLAR: ${todo} åpne TODO. Ingen rad kan flyttes til seed-vintertilbud.ts før de er valgt.`
            : 'Alle valg er gjort. Flytt entryene og claimene, og følg rekkefølgen i docs/skianlegg-adkomst.md.'
    );
}

const isDirectRun = process.argv[1]?.endsWith('seed-storanlegg.ts');
if (isDirectRun) {
    main().catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exit(1);
    });
}
