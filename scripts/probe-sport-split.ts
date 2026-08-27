// scripts/probe-sport-split.ts
//
// READ-ONLY DIAGNOSE — skriver ingenting. Teller sport-fordelingen blant de
// importerte «Ballbane»-stedene i databasen, så vi kan beslutte om ballsport
// (fotball/basket) fortjener egne kategorier eller bør bli et sport-FILTER
// oppå «Ballbane».
//
// Bakgrunn: import-places.ts henter Ballbane med
//   ["leisure"="pitch"]["sport"~"soccer|basketball|multi",i]
// så ALLE Ballbane har en sport-tag (soccer|basketball|multi, evt. semikolon-
// liste). Denne proben leser osm_tags->>'sport' og bryter det ned.
//
// Krever: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role — kun lesing).
// Kjør:   npx --yes tsx scripts/probe-sport-split.ts
//         npx --yes tsx scripts/probe-sport-split.ts --city Oslo   (én by)
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';

interface Row {
    municipality: string | null;
    osm_tags: Record<string, unknown> | null;
}

/** Normaliser sport-verdien til et sett av tokens: «multi;basketball» → {multi,basketball}. */
function sportTokens(raw: unknown): string[] {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return raw
        .toLowerCase()
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

async function main() {
    if (!isDatahubConfigured()) {
        throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');
    }
    const cityArg = (() => {
        const i = process.argv.indexOf('--city');
        return i !== -1 ? process.argv[i + 1] : null;
    })();

    const db = supabaseAdmin();

    // Paginert henting (Supabase-standard maks 1000/kall) — Ballbane er få, men
    // vi paginerer for å være robuste.
    const rows: Row[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
        let q = db
            .from('activities')
            .select('municipality, osm_tags')
            .eq('kind', 'place')
            .eq('category', 'Ballbane')
            .range(from, from + pageSize - 1);
        if (cityArg) q = q.eq('municipality', cityArg);
        const { data, error } = await q;
        if (error) throw new Error(`DB-feil: ${error.message}`);
        if (!data || data.length === 0) break;
        rows.push(...(data as Row[]));
        if (data.length < pageSize) break;
    }

    const total = rows.length;
    if (total === 0) {
        console.log('Ingen Ballbane-steder funnet' + (cityArg ? ` i ${cityArg}` : '') + '.');
        return;
    }

    // Tellere.
    let hasSoccer = 0;
    let hasBasketball = 0;
    let hasMulti = 0;
    let both = 0; // eksplisitt soccer OG basketball i samme tag
    let missing = 0; // ingen sport-tag (bør være ~0 gitt importfilteret)
    const rawCounts = new Map<string, number>();
    const byCity = new Map<string, { total: number; soccer: number; basket: number; multi: number }>();

    for (const r of rows) {
        const raw = r.osm_tags?.['sport'];
        const tokens = sportTokens(raw);
        const rawKey = typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : '(mangler)';
        rawCounts.set(rawKey, (rawCounts.get(rawKey) ?? 0) + 1);

        const soccer = tokens.includes('soccer');
        const basket = tokens.includes('basketball');
        const multi = tokens.includes('multi') || tokens.includes('multi_purpose') || tokens.includes('multisport');
        if (tokens.length === 0) missing += 1;
        if (soccer) hasSoccer += 1;
        if (basket) hasBasketball += 1;
        if (multi) hasMulti += 1;
        if (soccer && basket) both += 1;

        const city = r.municipality ?? '(ukjent)';
        const c = byCity.get(city) ?? { total: 0, soccer: 0, basket: 0, multi: 0 };
        c.total += 1;
        if (soccer) c.soccer += 1;
        if (basket) c.basket += 1;
        if (multi) c.multi += 1;
        byCity.set(city, c);
    }

    const pct = (n: number) => `${((n / total) * 100).toFixed(1)} %`;

    console.log(`\n=== Ballbane sport-fordeling ${cityArg ? `(${cityArg})` : '(alle byer)'} ===`);
    console.log(`Totalt Ballbane-steder: ${total}\n`);
    console.log(`  har sport=basketball : ${String(hasBasketball).padStart(4)}  (${pct(hasBasketball)})`);
    console.log(`  har sport=soccer     : ${String(hasSoccer).padStart(4)}  (${pct(hasSoccer)})`);
    console.log(`  har sport=multi*     : ${String(hasMulti).padStart(4)}  (${pct(hasMulti)})`);
    console.log(`  både soccer+basket   : ${String(both).padStart(4)}  (${pct(both)})`);
    console.log(`  uten sport-tag       : ${String(missing).padStart(4)}  (${pct(missing)})  [bør være ~0]`);

    console.log(`\n--- rå sport-verdier (topp 15) ---`);
    [...rawCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .forEach(([val, n]) => console.log(`  ${String(n).padStart(4)}  ${val}`));

    console.log(`\n--- per by (basket / soccer / multi av total) ---`);
    [...byCity.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([city, c]) =>
            console.log(
                `  ${city.padEnd(14)} total ${String(c.total).padStart(4)}  |  basket ${String(c.basket).padStart(4)}  soccer ${String(c.soccer).padStart(4)}  multi ${String(c.multi).padStart(4)}`
            )
        );
    console.log('');
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
