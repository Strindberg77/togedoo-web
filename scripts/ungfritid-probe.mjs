// scripts/ungfritid-probe.mjs
//
// Probe for Ungfritids interne søke-endepunkt (POST /api/search), fanget
// fra frontend-trafikk juli 2026. Kjøres manuelt FØR adapterbygging for å
// verifisere: (1) at minimal body fungerer uten Google Places-data,
// (2) offset/limit-paginering, (3) cursor-feltene nextActivityIDs osv.,
// (4) limit-tak, (5) at unike _id-er på tvers av sider ≈ total.
//
//   node scripts/ungfritid-probe.mjs [kommune]   (default: Oslo)
//
// Gjør ~10-15 kall med 700 ms pause. Krever Node 18+.

const PLACE = process.argv[2] || 'Oslo';
const URL = 'https://ungfritid.no/api/search';
const LIMIT = 50;
const MAX_PAGES = 10;
const PAUSE_MS = 700;

const HEADERS = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Togedoo datahub (hello@togedoo.com)',
    Origin: 'https://ungfritid.no',
    Referer: 'https://ungfritid.no/',
};

// Minimal body: alt fra det fangede kallet UTEN position/gmaps-objektet og
// uten filterverdier. Hypotesen er at place/municipality er nok.
function minimalBody(offset, limit = LIMIT) {
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
    };
}

// Full-ish body: som over, men med position-objektet (uten gmaps) — for å
// se om position påvirker resultatet i det hele tatt.
function fullishBody(offset) {
    return {
        ...minimalBody(offset),
        position: {
            description: PLACE,
            locationType: 'KOMMUNE',
            isFixture: false,
            label: PLACE,
            matchedSubstrings: [],
        },
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(body, label) {
    const res = await fetch(URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        console.log(`  [${label}] HTTP ${res.status} — IKKE JSON: ${text.slice(0, 200)}`);
        return null;
    }
    const acts = json?.result?.activities ?? json?.data?.activities ?? null;
    const orgs = json?.result?.organizations ?? json?.data?.organizations ?? null;
    if (!acts) {
        console.log(`  [${label}] HTTP ${res.status} — uventet konvolutt, toppnøkler: ${Object.keys(json)}`);
        return null;
    }
    // Cursor-felter kan ligge på toppnivå, i result, eller per fasett.
    const cursors = {};
    for (const key of ['nextActivityIDs', 'nextOrganizationIDs', 'currentActivityIDs', 'currentOrganizationIDs']) {
        const val = json[key] ?? json.result?.[key] ?? acts?.[key] ?? null;
        if (val !== null && val !== undefined) cursors[key] = Array.isArray(val) ? `[${val.length} ids]` : val;
    }
    return {
        status: res.status,
        total: acts.total,
        hits: acts.hits ?? [],
        orgTotal: orgs?.total,
        cursors,
        rawKeys: Object.keys(json.result ?? json),
    };
}

function ids(page) {
    return page.hits.map((h) => h._id);
}

async function main() {
    console.log(`=== Ungfritid-probe: POST /api/search, place=${PLACE} ===\n`);

    // --- Test 1: minimal body, bredt søk ---
    console.log('TEST 1 — minimal body (uten position/gmaps), offset=0:');
    const p1min = await search(minimalBody(0), 'minimal');
    if (!p1min) return console.log('\nKONKLUSJON: minimal body avvist — se rå respons over.');
    console.log(
        `  HTTP ${p1min.status} | activities.total=${p1min.total} | hits=${p1min.hits.length} | organizations.total=${p1min.orgTotal}`
    );
    console.log(`  result-nøkler: ${p1min.rawKeys.join(', ')}`);
    console.log(`  cursor-felter i respons: ${Object.keys(p1min.cursors).length ? JSON.stringify(p1min.cursors) : '(ingen utfylt)'}`);
    await sleep(PAUSE_MS);

    // --- Test 2: full-ish body — endrer position-objektet resultatet? ---
    console.log('\nTEST 2 — samme søk MED position-objekt (uten gmaps):');
    const p1full = await search(fullishBody(0), 'fullish');
    if (p1full) {
        const same = p1full.total === p1min.total && ids(p1full)[0] === ids(p1min)[0];
        console.log(`  total=${p1full.total} | hits[0] ${same ? 'identisk' : 'AVVIKER'} fra test 1`);
        console.log(
            same
                ? '  => position-objektet er unødvendig; minimal body holder.'
                : '  => position påvirker søket — adapteren må sende det.'
        );
    }
    await sleep(PAUSE_MS);

    // --- Test 3: limit-tak ---
    console.log('\nTEST 3 — respekteres limit over 50? (limit=200):');
    const pBig = await search(minimalBody(0, 200), 'limit200');
    if (pBig) console.log(`  hits=${pBig.hits.length} (total=${pBig.total}) => effektivt tak: ${pBig.hits.length}`);
    await sleep(PAUSE_MS);

    // --- Test 4: offset-paginering + dedup-verifisering ---
    console.log('\nTEST 4 — offset-sveip (limit=50):');
    const seen = new Set(ids(p1min).filter(Boolean));
    let prevFirst = ids(p1min)[0];
    let page = p1min;
    let pages = 1;
    let cursorSeen = Object.keys(p1min.cursors).length > 0;
    console.log(`  offset=0   -> hits=${page.hits.length}, hits[0]=${prevFirst}`);
    for (let offset = LIMIT; offset < page.total + LIMIT && pages < MAX_PAGES; offset += LIMIT) {
        await sleep(PAUSE_MS);
        const p = await search(minimalBody(offset), `offset=${offset}`);
        if (!p) break;
        const first = ids(p)[0] ?? '(tom side)';
        const overlap = ids(p).filter((i) => seen.has(i)).length;
        ids(p).forEach((i) => seen.add(i));
        if (Object.keys(p.cursors).length) cursorSeen = true;
        const blar = first !== prevFirst && p.hits.length > 0;
        console.log(
            `  offset=${String(offset).padEnd(4)}-> hits=${p.hits.length}, hits[0]=${first}, overlapp mot tidligere=${overlap}${blar ? '' : '  <-- BLAR IKKE'}`
        );
        prevFirst = first;
        pages += 1;
        if (p.hits.length < LIMIT) break;
    }
    console.log(`  Unike _id totalt: ${seen.size} av total=${p1min.total}`);

    // --- Test 5: cursor-eksperiment (kun hvis relevant) ---
    console.log('\nTEST 5 — cursor-felter:');
    if (!cursorSeen) {
        console.log('  Ingen next*/current*-felter ble fylt ut i noen respons => ren offset/limit, cursorene kan sendes som null.');
    } else {
        console.log('  Cursor-felter BLE fylt ut (se over). Eksperiment: send page-1-ids tilbake som currentActivityIDs:');
        await sleep(PAUSE_MS);
        const body = { ...minimalBody(0), currentActivityIDs: ids(p1min) };
        const pc = await search(body, 'cursor');
        if (pc) {
            const overlap = ids(pc).filter((i) => ids(p1min).includes(i)).length;
            console.log(`  hits=${pc.hits.length}, overlapp mot side 1=${overlap} ${overlap === 0 ? '=> ekskluderings-cursor: fungerer som paginering' : '=> uklart; hold på offset/limit'}`);
        }
    }

    // --- Oppsummering ---
    console.log('\n=== OPPSUMMERING ===');
    console.log(`Dekning: ${seen.size}/${p1min.total} unike aktiviteter hentet via offset-sveip.`);
    console.log(
        seen.size >= p1min.total * 0.98
            ? 'PAGINERING BEKREFTET: offset/limit fungerer, adapteren kan bygges på minimal body.'
            : 'PAGINERING UFULLSTENDIG: se sveipet over for hvor det stopper — lim hele utskriften tilbake.'
    );
}

main().catch((err) => console.error('Probe feilet:', err));
