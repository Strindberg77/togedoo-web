// scripts/dedup-opprydding.ts
//
// DUBLETTENE SOM ALLEREDE LIGGER I BASEN — funnet, dømt, og skrevet ut som
// SQL. Skriptet SKRIVER IKKE. Det kan ikke skrive: det åpner databasen med
// select og har ingen annen kodevei.
//
//   npx --yes tsx scripts/dedup-opprydding.ts
//   npx --yes tsx scripts/dedup-opprydding.ts --category=Lekeplass
//   npx --yes tsx scripts/dedup-opprydding.ts --vis=25
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR DET TRENGS I TILLEGG TIL DEDUPEN I IMPORTEN
//
// Importen har ingen slettevei — verifisert: det finnes ikke en `.delete()`
// eller `delete from` mot `activities` noe sted i kodebasen. Slutter den å
// produsere en rad, forsvinner ikke raden; den står publisert til noen gjør
// noe.
//
// Det er 263 par i basen (målt sep. 2026: fire byer, publiserte rader, samme
// kategori, under 10 m). De blir ikke borte av at importen blir smartere.
// Dedupen i importen hindrer NYE; dette skriptet finner de gamle.
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR MOT BASEN, OG IKKE SOM ET BIPRODUKT AV EN TØRRKJØRING
//
//   1. En tørrkjøring ser bare det OSM svarer NÅ. Er taperens objekt slettet
//      i OSM, er raden usynlig for importen — men den ligger der fortsatt.
//   2. Den trenger ikke Overpass. `location`, `osm_tags` og `external_id` er
//      alt regelen trenger, og alt ligger i basen.
//   3. Den kan kjøres om igjen og etterprøves uten å røre hentingen.
//
// REGELEN ER IKKE HER. Den ligger i lib/dedup.ts og deles med importen. Var
// den kopiert hit, kunne de to blitt uenige — og da ville oppryddingen tatt
// ned rad A mens neste import bygget A og fjernet B.
import { isDatahubConfigured, supabaseAdmin } from '../lib/supabase';
import {
    DEDUP_RADIUS_M,
    DEDUP_SAMMENLIGNING_M,
    dedupPairs,
    nedtakingsSql,
    osmType,
    uloste,
    type DedupKandidat,
    type DedupPar,
} from '../lib/dedup';
import { isUsablePlaceName } from '../lib/places';

const arg = (navn: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${navn}=`))?.slice(navn.length + 3);

/** Én rad slik oppryddingen trenger den. */
export interface BaseRad {
    readonly external_id: string;
    readonly category: string;
    readonly title: string;
    readonly lat: number;
    readonly lng: number;
    readonly osm_tags: Record<string, string> | null;
}

export interface Oppryddingsplan {
    /** Par per kategori, i stabil rekkefølge. */
    readonly perKategori: Map<string, DedupPar[]>;
    /** external_id-ene som skal tas ned, sortert. */
    readonly tapere: string[];
    /** Rader som ble sett bort fra, med årsak. */
    readonly hoppetOver: { readonly ikkeOsm: number; readonly utenPunkt: number };
    /**
     * Hvor mange PAR TIL en løsere terskel ville funnet.
     *
     * Terskelen er 5 m, valgt fordi 27 % av parene i basen ligger i båndet
     * 5–10 m og vi ikke vet hvor mange av dem som er ekte naboer. Tallet står
     * her så valget kan etterprøves fra hver kjøring — ellers er det en
     * beslutning ingen ser igjen.
     */
    readonly vedLosereTerskel: { readonly radius: number; readonly ekstraPar: number };
}

/**
 * PLANEN, som en ren funksjon over radene. All I/O ligger i [main].
 *
 * Det er ikke bare ryddighet: kryssjekken i scripts/node-flate-dedup.test.ts
 * kjører NØYAKTIG denne funksjonen mot de samme stedene som importen får som
 * OSM-elementer, og krever samme svar. Uten en ren inngang her ville den
 * testen ikke vært mulig å skrive, og «samme regel» ville vært en påstand.
 */
export function oppryddingsplan(
    rader: readonly BaseRad[],
    radius = DEDUP_RADIUS_M,
    sammenligning = DEDUP_SAMMENLIGNING_M
): Oppryddingsplan {
    const perKategoriKandidater = new Map<string, DedupKandidat[]>();
    let ikkeOsm = 0;
    let utenPunkt = 0;

    for (const r of rader) {
        // Kuraterte seed-rader har external_id som «tryvann», ikke «way/123».
        // De eies av en annen kilde og styres av lib/osm-claims.ts — de skal
        // aldri pares her.
        if (osmType(r.external_id) === null) {
            ikkeOsm += 1;
            continue;
        }
        if (typeof r.lat !== 'number' || typeof r.lng !== 'number') {
            utenPunkt += 1;
            continue;
        }
        const liste = perKategoriKandidater.get(r.category) ?? [];
        liste.push({
            externalId: r.external_id,
            lat: r.lat,
            lng: r.lng,
            // SAMME navnetest som importen: isUsablePlaceName. Basen har
            // `osm_tags`, så navnet leses derfra og ikke fra `title` —
            // tittelen kan være generert («Lekeplass ved Kapellveien»), og en
            // generert tittel er ikke et navn.
            navn: isUsablePlaceName(r.osm_tags?.name) ? r.osm_tags!.name.trim() : null,
        });
        perKategoriKandidater.set(r.category, liste);
    }

    const perKategori = new Map<string, DedupPar[]>();
    const tapere = new Set<string>();
    let antall = 0;
    let antallLosere = 0;
    for (const [kategori, kandidater] of [...perKategoriKandidater].sort()) {
        const { par, tapere: t } = dedupPairs(kandidater, radius);
        antall += par.length;
        // Samme regel, løsere terskel. Kun til rapporten — ingenting av det
        // den finner brukes til å ta ned rader.
        if (sammenligning > radius) {
            antallLosere += dedupPairs(kandidater, sammenligning).par.length;
        }
        if (par.length === 0) continue;
        perKategori.set(kategori, par);
        for (const id of t) tapere.add(id);
    }

    return {
        perKategori,
        tapere: [...tapere].sort(),
        hoppetOver: { ikkeOsm, utenPunkt },
        vedLosereTerskel: {
            radius: sammenligning,
            ekstraPar: Math.max(0, antallLosere - antall),
        },
    };
}

/** Tabellen per kategori: de [vis] første parene, og hele resten oppsummert. */
export function formatPlan(plan: Oppryddingsplan, vis = 10): string {
    const L: string[] = [];
    const alle = [...plan.perKategori.values()].flat();
    const rest = uloste(alle);
    const droppet = alle.filter((p) => p.utfall === 'droppet');

    L.push(`DUBLETTER I BASEN (radius ${DEDUP_RADIUS_M} m, samme kategori)`);
    L.push(
        `  ${alle.length} par funnet — ${droppet.length} kan tas ned, ` +
            `${alle.length - droppet.length} kan ikke`
    );
    L.push('');

    for (const [kategori, par] of plan.perKategori) {
        const d = par.filter((p) => p.utfall === 'droppet');
        L.push(`  ${kategori}  —  ${par.length} par, ${d.length} kan tas ned`);
        for (const p of par.slice(0, vis)) {
            const merke =
                p.utfall === 'droppet'
                    ? 'TAS NED'
                    : p.utfall === 'to-flater'
                      ? 'ULØST  '
                      : 'BEHOLDT';
            L.push(
                `    ${merke}  ${p.taper.padEnd(20)} ${p.vinner.padEnd(20)} ` +
                    `${String(p.meter).padStart(5)} m  ${p.utfall}`
            );
        }
        if (par.length > vis) L.push(`    … og ${par.length - vis} par til i ${kategori}`);
        L.push('');
    }

    // ── RESTBEHOLDNINGEN ──────────────────────────────────────────────
    // Tallet som må stå, ellers tror neste person at duplikatene er borte
    // etter at SQL-en er kjørt.
    L.push(`  ETTER NEDTAKINGEN STÅR ${alle.length - droppet.length} PAR IGJEN:`);
    L.push(
        `    ${rest['to-flater']} flate mot flate — to flater med sammenfallende ` +
            `senter kan ikke skilles`
    );
    L.push(
        `      fra en ekte dublett uten geometri. Konsentriske flater (en bane inne i`
    );
    L.push(
        `      et idrettsområde) er et ekte OSM-mønster. Krever \`out geom\` for hele`
    );
    L.push(`      kategorien — egen sak.`);
    L.push(
        `    ${rest['navn-bare-pa-taper']} der bare den ene har navn — vinneren ville ` +
            `mistet navnet.`
    );
    L.push(
        `    ${rest['navn-uenighet']} med ulike navn — to navn motsier at det er samme ` +
            `sted.`
    );
    L.push(`    De to siste er OSM-data som bør rettes, ikke rader som bør fjernes.`);
    if (plan.vedLosereTerskel.ekstraPar > 0) {
        L.push('');
        L.push(
            `  Ved ${plan.vedLosereTerskel.radius} m ville ${plan.vedLosereTerskel.ekstraPar} ` +
                `par TIL blitt funnet. De tas IKKE ned nå.`
        );
        L.push(
            `  Terskelen er ${DEDUP_RADIUS_M} m fordi feilen ikke er symmetrisk: en for stor`
        );
        L.push(
            `  radius slår sammen to ekte nabosteder, og det ene forsvinner stille. En for`
        );
        L.push(
            `  liten lar en dublett stå, og det er synlig. PLACES_DEDUP_M=${plan.vedLosereTerskel.radius} prøver det andre.`
        );
    }
    if (plan.hoppetOver.ikkeOsm || plan.hoppetOver.utenPunkt) {
        L.push('');
        L.push(
            `  Sett bort fra: ${plan.hoppetOver.ikkeOsm} kuraterte rader ` +
                `(external_id er ikke en OSM-id), ${plan.hoppetOver.utenPunkt} uten koordinat.`
        );
    }
    return L.join('\n');
}

const KOLONNER = 'external_id, category, title, lat, lng, osm_tags';

async function main(): Promise<void> {
    if (!isDatahubConfigured()) {
        console.error(
            'Mangler SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Skriptet leser bare, ' +
                'men det må kunne lese.'
        );
        process.exit(1);
    }
    const kategori = arg('category');
    const vis = Number(arg('vis') ?? 10) || 10;

    const db = supabaseAdmin();
    const rader: BaseRad[] = [];
    // Paginering: PostgREST har et tak per svar, og basen er ~7 800 rader i
    // dag og ~39 500 etter nasjonal import. Uten løkka ville skriptet lest
    // det første tusenet og rapportert som om det var alt.
    const BOLK = 1000;
    for (let fra = 0; ; fra += BOLK) {
        let q = db
            .from('activities')
            .select(KOLONNER)
            .eq('kind', 'place')
            .eq('status', 'published')
            .order('external_id')
            .range(fra, fra + BOLK - 1);
        if (kategori) q = q.eq('category', kategori);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const bolk = (data ?? []) as unknown as BaseRad[];
        rader.push(...bolk);
        if (bolk.length < BOLK) break;
    }
    console.log(`Leste ${rader.length} publiserte steder${kategori ? ` i ${kategori}` : ''}.\n`);

    const plan = oppryddingsplan(rader);
    console.log(formatPlan(plan, vis));
    console.log(nedtakingsSql(plan.tapere));
    console.log(
        'Skriptet har ikke endret noe. Les utskriften, kjør så SQL-en over ' +
            'hvis den ser riktig ut.'
    );
}

const erDirekteKjort = process.argv[1]?.endsWith('dedup-opprydding.ts');
if (erDirekteKjort) {
    main().catch((e) => {
        console.error('Opprydding feilet:', e);
        process.exit(1);
    });
}
