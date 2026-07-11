// scripts/ungfritid-probe2.mjs
//
// Runde 2-probe for POST https://ungfritid.no/api/search, etter funn av
// ustabil sortering (overlapp mellom offset-sider) og total=1811 vs
// gamle 244. Tester:
//   A) determinisme: identisk body to ganger -> samme rekkefølge/sett?
//   B) sorterings-/partisjoneringskandidater, inkl. alphabeticLetter/-Interval
//      som allerede finnes i frontendens body
//   C) fullt sveip (limit=200) med beste mekanisme + dedup-måling over to
//      runder hvis ingen stabil sortering finnes
//   D) hvorfor 1811: aldersprofil på ageGroup, orgInUngfritid-flagget
//      (delt backend med Frivillig.no?) og total med ageFor satt
//
//   node scripts/ungfritid-probe2.mjs [kommune]   (default: Oslo)
//
// Gjør opptil ~40 kall med 700 ms pause (~1 min). Krever Node 18+.

const PLACE = process.argv[2] || 'Oslo';
const URL = 'https://ungfritid.no/api/search';
const PAUSE_MS = 700;

const HEADERS = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Togedoo datahub (hello@togedoo.com)',
    Origin: 'https://ungfritid.no',
    Referer: 'https://ungfritid.no/',
};

function baseBody(offset = 0, limit = 50, extra = {}) {
    return {
        searchKeyword: '',
        gender: null,
        ageFor: null,
        alphabeticInterval: null,
        alphabeticLetter: null,
        suitableActivities: [],
        activityCategories: [],
        isShowingActivities: true,
        offset,
        limit,
        nextOrganizationIDs: null,
        nextActivityIDs: null,
        currentOrganizationIDs: null,
        currentActivityIDs: null,
        category: [],
        suitable: [],
        place: PLACE,
        municipality: true,
        district: false,
        county: false,
        nearest: false,
        searchOrganizations: false,
        ...extra,
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(body, label) {
    await sleep(PAUSE_MS);
    const res = await fetch(URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    const text = await res.text();
    try {
        const json = JSON.parse(text);
        const acts = json?.result?.activities ?? json?.data?.activities;
        if (!acts) {
            console.log(`  [${label}] HTTP ${res.status}, uventet konvolutt: ${Object.keys(json)}`);
            return null;
        }
        return { status: res.status, total: acts.total, hits: acts.hits ?? [] };
    } catch {
        console.log(`  [${label}] HTTP ${res.status}, ikke JSON: ${text.slice(0, 150)}`);
        return null;
    }
}

const ids = (p) => p.hits.map((h) => h._id);
const names = (p) => p.hits.map((h) => (h.name ?? '').toLowerCase());

function compareRuns(a, b) {
    const ia = ids(a);
    const ib = ids(b);
    const sameOrder = ia.length === ib.length && ia.every((x, i) => x === ib[i]);
    const setA = new Set(ia);
    const common = ib.filter((x) => setA.has(x)).length;
    return { sameOrder, common, lenA: ia.length, lenB: ib.length };
}

function isAlphabetical(p) {
    const n = names(p).filter(Boolean);
    if (n.length < 3) return false;
    const sorted = [...n].sort((x, y) => x.localeCompare(y, 'nb'));
    return n.every((x, i) => x === sorted[i]);
}

async function main() {
    console.log(`=== Ungfritid-probe runde 2: place=${PLACE} ===`);

    // ---------- A: determinisme ----------
    console.log('\nTEST A — identisk minimal body, to kjøringer:');
    const a1 = await search(baseBody(), 'A1');
    const a2 = await search(baseBody(), 'A2');
    if (!a1 || !a2) return;
    const cmp = compareRuns(a1, a2);
    const stableDefault = cmp.sameOrder;
    console.log(`  total=${a1.total} | identisk rekkefølge: ${cmp.sameOrder} | felles id-er: ${cmp.common}/${cmp.lenA}`);
    console.log(
        cmp.sameOrder
            ? '  => Default-sortering er deterministisk. Overlappen i runde 1 skyldtes noe annet (rapporter!).'
            : cmp.common === cmp.lenA
              ? '  => Samme SETT, ulik rekkefølge: ustabil sortering bekreftet uavhengig av offset/position.'
              : '  => Ulikt sett mellom to identiske kall: full ustabilitet bekreftet.'
    );

    // ---------- B: sorterings-/partisjoneringskandidater ----------
    console.log('\nTEST B — kandidater for stabil rekkefølge (kjøres 2x hver):');
    const candidates = [
        ['alphabeticLetter="a"', { alphabeticLetter: 'a' }],
        ['alphabeticInterval="a-e"', { alphabeticInterval: 'a-e' }],
        ['sort="name"', { sort: 'name' }],
        ['sortBy="name"', { sortBy: 'name' }],
        ['orderBy="name"', { orderBy: 'name' }],
        ['sort="created"', { sort: 'created' }],
    ];
    const working = [];
    for (const [label, extra] of candidates) {
        const r1 = await search(baseBody(0, 50, extra), label);
        const r2 = await search(baseBody(0, 50, extra), label);
        if (!r1 || !r2) continue;
        const c = compareRuns(r1, r2);
        const alpha = isAlphabetical(r1);
        const firstLetters = [...new Set(names(r1).map((n) => n[0] ?? '?'))].slice(0, 8).join('');
        const effect = r1.total !== a1.total ? ` total=${r1.total} (endret!)` : '';
        console.log(
            `  ${label.padEnd(28)} deterministisk=${c.sameOrder} alfabetisk=${alpha} forbokstaver="${firstLetters}"${effect}`
        );
        if (c.sameOrder && (alpha || r1.total !== a1.total)) working.push({ label, extra, total: r1.total });
    }
    console.log(
        working.length
            ? `  => Virksomme kandidater: ${working.map((w) => w.label).join('; ')}`
            : '  => Ingen kandidat ga både deterministisk og påvirket resultat — se rådata over.'
    );

    // ---------- C: fullt sveip ----------
    console.log('\nTEST C — fullt sveip med limit=200:');
    const LIMIT = 200;
    const maxPages = Math.ceil(a1.total / LIMIT) + 2;
    async function sweep(extra, tag) {
        const seen = new Set();
        let overlapTotal = 0;
        for (let page = 0; page < maxPages; page++) {
            const p = await search(baseBody(page * LIMIT, LIMIT, extra), `${tag} offset=${page * LIMIT}`);
            if (!p) break;
            const o = ids(p).filter((i) => seen.has(i)).length;
            overlapTotal += o;
            ids(p).forEach((i) => seen.add(i));
            console.log(`  ${tag} offset=${String(page * LIMIT).padEnd(5)} hits=${p.hits.length} overlapp=${o} unike-hittil=${seen.size}`);
            if (p.hits.length < LIMIT) break;
        }
        return { seen, overlapTotal };
    }
    const sortFix = working.find((w) => w.total === a1.total)?.extra ?? {};
    const s1 = await sweep(sortFix, 'sveip1');
    console.log(`  Sveip 1: ${s1.seen.size}/${a1.total} unike, total intern overlapp=${s1.overlapTotal}`);
    let allSeen = s1.seen;
    if (s1.seen.size < a1.total * 0.98) {
        console.log('  Dekning < 98% — kjører sveip 2 for å måle konvergens (dedup-strategien):');
        const s2 = await sweep(sortFix, 'sveip2');
        const news = [...s2.seen].filter((i) => !s1.seen.has(i)).length;
        allSeen = new Set([...s1.seen, ...s2.seen]);
        console.log(`  Sveip 2 ga ${news} NYE id-er. Kumulativt: ${allSeen.size}/${a1.total}.`);
    }

    // ---------- D: hvorfor 1811 — alder og plattform-miksing ----------
    console.log('\nTEST D — profil på innsamlede aktiviteter:');
    // Gjenbruk siste sveips hits? Vi trenger objektene, ikke bare id-er — hent en frisk side med 200 for profilering.
    const sample = await search(baseBody(0, 200, sortFix), 'profil');
    if (sample) {
        let barn = 0, ungdom = 0, voksen = 0, utenAlder = 0, inUngfritid = 0, notInUngfritid = 0, orgFlagUkjent = 0;
        for (const h of sample.hits) {
            const ag = Array.isArray(h.ageGroup) && h.ageGroup.length ? h.ageGroup[0] : null;
            const from = ag ? parseInt(ag.from, 10) : NaN;
            const to = ag ? parseInt(ag.to, 10) : NaN;
            if (isNaN(from) && isNaN(to)) utenAlder++;
            else if (!isNaN(from) && from >= 18) voksen++;
            else if (!isNaN(to) && to <= 12) barn++;
            else ungdom++;
            const flag = h.organization?.orgInUngfritid;
            if (flag === true) inUngfritid++;
            else if (flag === false) notInUngfritid++;
            else orgFlagUkjent++;
        }
        console.log(`  Aldersprofil (n=${sample.hits.length}): barn(til<=12)=${barn}, ungdom/blandet=${ungdom}, voksen(fra>=18)=${voksen}, uten aldersinfo=${utenAlder}`);
        console.log(`  orgInUngfritid: true=${inUngfritid}, false=${notInUngfritid}, mangler=${orgFlagUkjent}`);
        if (notInUngfritid > sample.hits.length * 0.2) {
            console.log('  => VESENTLIG andel utenfor Ungfritid: /api/search søker trolig hele den delte Frivillig.no-plattformen.');
            console.log('     Adapteren MÅ filtrere på organization.orgInUngfritid === true (eller tilsvarende).');
        }
    }
    const withAge = await search(baseBody(0, 1, { ageFor: '10' }), 'ageFor=10');
    if (withAge) {
        console.log(`  total med ageFor="10": ${withAge.total} (mot ${a1.total} uten) — ` +
            (withAge.total < a1.total * 0.5 ? 'ageFor filtrerer kraftig; forklarer trolig 244-avviket sammen med plattform-flagget.' : 'ageFor endrer lite.'));
    }

    // ---------- Oppsummering ----------
    console.log('\n=== OPPSUMMERING ===');
    console.log(`Determinisme uten fiks: ${stableDefault ? 'JA' : 'NEI'}`);
    console.log(`Sorterings-/partisjonsfiks funnet: ${working.length ? working.map((w) => w.label).join('; ') : 'NEI'}`);
    console.log(`Dekning etter sveip: ${allSeen.size}/${a1.total} unike id-er`);
    console.log('Lim hele utskriften tilbake til Claude for byggebeslutning.');
}

main().catch((e) => console.error('Probe feilet:', e));
