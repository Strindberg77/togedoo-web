// scripts/count-nameless-places.ts
//
// LESE-ONLY diagnose: teller "genuint navnløse" faste steder (kind='place')
// i prod — rader der title == kategorinavn OG venue_name er tom/null. Dette
// er nøyaktig «kun-kategori»-fallbacken fra lib/places.ts: name-taggen manglet
// ELLER ble silt bort, og revers-geokodingen ga verken gate eller poststed
// (eller feilet), så tittelen ble stående som bare "Ballbane" / "Park" osv.
//
// Skriver ALDRI til databasen — kun SELECT. Trygg å kjøre mot prod.
//
//   npx tsx scripts/count-nameless-places.ts
//   npx tsx scripts/count-nameless-places.ts --json   (maskinlesbar oppsummering)
//
// Krever URL + en nøkkel i miljøet. Service role trengs IKKE — anon-nøkkelen
// holder, siden RLS tillater anonym lesing av status='published' (migr. 0001):
//   SUPABASE_URL           (eller NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  – ELLER –  SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
    console.error(
        'Mangler miljøvariabler. Sett SUPABASE_URL (eller NEXT_PUBLIC_SUPABASE_URL) og\n' +
            'en nøkkel: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY eller NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
    process.exit(1);
}

const asJson = process.argv.includes('--json');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

interface Row {
    title: string;
    category: string;
    municipality: string | null;
    venue_name: string | null;
}

// Henter alle publiserte steder side for side (PostgREST tar maks 1000 om
// gangen). Kun de fire kolonnene vi trenger — ingen skriving, ingen mutasjon.
async function fetchAllPlaces(): Promise<Row[]> {
    const PAGE = 1000;
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
            .from('activities')
            .select('title, category, municipality, venue_name')
            .eq('kind', 'place')
            .eq('status', 'published')
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`Spørring feilet: ${error.message}`);
        const batch = (data ?? []) as Row[];
        out.push(...batch);
        if (batch.length < PAGE) break;
    }
    return out;
}

const emptyVenue = (v: string | null) => v == null || v.trim() === '';
// Samme «tittelen er bare kategorinavnet» som brukeren ser på kortene.
const titleIsJustCategory = (r: Row) => r.title.trim() === r.category.trim();

async function main() {
    const rows = await fetchAllPlaces();
    const nameless = rows.filter((r) => titleIsJustCategory(r) && emptyVenue(r.venue_name));

    // DIVERGENT-BØTTA (ballbane-name-bug): title == kategorinavn MEN venue_name
    // ER satt. Navnet finnes altså i venue_name, mens title falt tilbake til
    // kategori. Disse er IKKE «navnløse» (telles ikke over) — men et kort som
    // viser `title` i stedet for displayName (venueName-først) vil vise
    // «Ballbane» selv om detaljarket (displayName) viser det ekte navnet.
    // Nøyaktig symptomet på skjermbildene. Dette bekrefter DATA-halvdelen.
    const divergent = rows.filter((r) => titleIsJustCategory(r) && !emptyVenue(r.venue_name));

    // Grupper per kategori × by.
    const byCatCity = new Map<string, Map<string, number>>();
    const byCat = new Map<string, number>();
    const totalByCatAll = new Map<string, number>(); // nevner: alle publiserte steder i kategorien
    for (const r of rows) totalByCatAll.set(r.category, (totalByCatAll.get(r.category) ?? 0) + 1);
    for (const r of nameless) {
        const city = r.municipality ?? '(ukjent)';
        byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
        if (!byCatCity.has(r.category)) byCatCity.set(r.category, new Map());
        const m = byCatCity.get(r.category)!;
        m.set(city, (m.get(city) ?? 0) + 1);
    }

    if (asJson) {
        console.log(
            JSON.stringify(
                {
                    total_places_published: rows.length,
                    total_nameless: nameless.length,
                    by_category: Object.fromEntries(
                        [...byCat.entries()].map(([cat, n]) => [
                            cat,
                            {
                                nameless: n,
                                of_total: totalByCatAll.get(cat) ?? n,
                                by_city: Object.fromEntries(byCatCity.get(cat) ?? []),
                            },
                        ])
                    ),
                },
                null,
                2
            )
        );
        return;
    }

    console.log(`\nLese-only sjekk mot prod — genuint navnløse faste steder`);
    console.log(`(title == kategorinavn OG venue_name tom, kind='place', status='published')\n`);
    console.log(`Totalt publiserte steder: ${rows.length}`);
    console.log(`Totalt genuint navnløse:  ${nameless.length}\n`);

    const cats = [...byCat.keys()].sort((a, b) => (byCat.get(b)! - byCat.get(a)!));
    for (const cat of cats) {
        const total = totalByCatAll.get(cat) ?? 0;
        const n = byCat.get(cat)!;
        const pct = total ? ((n / total) * 100).toFixed(0) : '—';
        console.log(`${cat.padEnd(12)} ${String(n).padStart(4)} navnløse av ${total} publiserte (${pct} %)`);
        const cities = [...(byCatCity.get(cat) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]);
        for (const [city, cn] of cities) console.log(`    ${String(cn).padStart(4)}  ${city}`);
    }
    if (nameless.length === 0) console.log('Ingen navnløse steder funnet. 🎉');

    // Divergent-bøtta: navnet i venue_name, title == kategori. Kort som viser
    // `title` vil her vise kategori, mens detaljark (displayName) viser navnet.
    console.log(`\nDivergent (title == kategori MEN venue_name satt): ${divergent.length}`);
    console.log(`(navnet finnes i venue_name — displayName henter det fram, rå title gjør ikke)`);
    if (divergent.length) {
        const dCat = new Map<string, number>();
        for (const r of divergent) dCat.set(r.category, (dCat.get(r.category) ?? 0) + 1);
        for (const [cat, n] of [...dCat.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${cat.padEnd(12)} ${String(n).padStart(4)}`);
        }
        console.log(`  Eksempler (title → venue_name):`);
        for (const r of divergent.slice(0, 8)) {
            console.log(`    «${r.title}» → «${r.venue_name}» (${r.category}, ${r.municipality ?? '?'})`);
        }
    }
}

main().catch((e) => {
    console.error('Diagnose feilet:', e);
    process.exit(1);
});
