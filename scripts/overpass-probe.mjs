// scripts/overpass-probe.mjs
//
// Dekningsundersøkelse for faste steder (kind='place') i OpenStreetMap
// via Overpass API, FØR importbeslutning. Teller treff per kategori per
// by (én spørring per by) og måler tagg-kvalitet på et utvalg
// (andel med navn, adresse, geometri-type).
//
//   node scripts/overpass-probe.mjs                (Oslo Bergen Trondheim Stavanger)
//   node scripts/overpass-probe.mjs Oslo Bergen    (egne byer)
//
// ~8 spørringer med 3 s pause — godt innenfor overpass-api.de sin
// fair-use-policy. Krever Node 18+.

const CITIES = process.argv.slice(2).length ? process.argv.slice(2) : ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];
const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];
const PAUSE_MS = 3000;
const UA = 'Togedoo datahub-undersokelse (hello@togedoo.com)';

// [Kategorinavn, Overpass-selektor]. nwr = node+way+relation.
const CATEGORIES = [
    ['Lekeplasser', 'nwr["leisure"="playground"]'],
    ['Ballbinger/baner (fri lek)', 'nwr["leisure"="pitch"]["sport"~"soccer|basketball|multi",i]["access"!="private"]'],
    ['Skatepark/pumptrack/BMX', 'nwr["sport"~"skateboard|bmx",i]'],
    ['Strender/badeplasser', 'nwr["natural"="beach"]'],
    ['Svømmehall/badeland', 'nwr["leisure"~"water_park|swimming_pool"]["access"!="private"]'],
    ['Parker', 'nwr["leisure"="park"]'],
    ['Ishall/skøytebane', 'nwr["leisure"="ice_rink"]'],
    ['Idrettshall/-senter', 'nwr["leisure"="sports_centre"]'],
    ['Gapahuk/vindskjul', 'nwr["amenity"="shelter"]["shelter_type"="lean_to"]'],
    ['Bålplass/grillplass', 'nwr["leisure"="firepit"]'],
    ['Akebakke/toboggan', 'nwr["sport"="toboggan"]'],
    ['Fornøyelsespark', 'nwr["tourism"="theme_park"]'],
    ['Minigolf', 'nwr["leisure"="miniature_golf"]'],
    ['Klatrepark/høydepark', 'nwr["sport"="climbing_adventure"]'],
];

// Kvalitetsutvalg: disse kategoriene får tag-inspeksjon (30 objekter hver).
const QUALITY_CATEGORIES = [
    ['Lekeplasser', 'nwr["leisure"="playground"]', 'leisure', 'playground'],
    ['Strender/badeplasser', 'nwr["natural"="beach"]', 'natural', 'beach'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function areaClause(city) {
    // Norske kommuner er admin_level=7. Oslo er også fylke (4), men
    // kommune-arealet på nivå 7 finnes og er det vi vil ha.
    return `area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;`;
}

async function overpass(query, label) {
    for (const endpoint of ENDPOINTS) {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
                body: 'data=' + encodeURIComponent(query),
            });
            if (res.status === 429 || res.status === 504) {
                console.log(`  [${label}] ${endpoint} svarte ${res.status} — prøver neste speil...`);
                await sleep(PAUSE_MS);
                continue;
            }
            if (!res.ok) {
                console.log(`  [${label}] HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
                return null;
            }
            return await res.json();
        } catch (err) {
            console.log(`  [${label}] ${endpoint} feilet: ${err.message} — prøver neste speil...`);
        }
    }
    return null;
}

async function countsForCity(city) {
    const statements = CATEGORIES.map(([, sel]) => `${sel}(area.a); out count;`).join('\n');
    const query = `[out:json][timeout:120];\n${areaClause(city)}\n${statements}`;
    const json = await overpass(query, `${city} tellinger`);
    if (!json) return null;
    const counts = (json.elements ?? [])
        .filter((e) => e.type === 'count')
        .map((e) => Number(e.tags?.total ?? e.tags?.count ?? 0));
    if (counts.length !== CATEGORIES.length) {
        console.log(`  [${city}] Uventet antall count-blokker: ${counts.length} (ventet ${CATEGORIES.length})`);
    }
    return counts;
}

async function qualityForCity(city) {
    const statements = QUALITY_CATEGORIES.map(([, sel]) => `${sel}(area.a); out tags center 30;`).join('\n');
    const query = `[out:json][timeout:120];\n${areaClause(city)}\n${statements}`;
    const json = await overpass(query, `${city} kvalitet`);
    if (!json) return null;
    const results = [];
    for (const [name, , key, value] of QUALITY_CATEGORIES) {
        const els = (json.elements ?? []).filter((e) => e.tags?.[key] === value);
        if (!els.length) {
            results.push(`  ${city} / ${name}: 0 i utvalget`);
            continue;
        }
        const n = els.length;
        const withName = els.filter((e) => e.tags?.name).length;
        const withAddr = els.filter((e) => Object.keys(e.tags ?? {}).some((k) => k.startsWith('addr:'))).length;
        const withCoords = els.filter((e) => e.lat != null || e.center?.lat != null).length;
        const types = els.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
        results.push(
            `  ${city} / ${name} (utvalg n=${n}): navn=${Math.round((100 * withName) / n)}%, adresse-tagger=${Math.round((100 * withAddr) / n)}%, koordinater=${Math.round((100 * withCoords) / n)}%, geometri=${JSON.stringify(types)}`
        );
        const eksempler = els.filter((e) => e.tags?.name).slice(0, 3).map((e) => e.tags.name);
        if (eksempler.length) results.push(`    eksempler: ${eksempler.join(' | ')}`);
    }
    return results;
}

async function main() {
    console.log(`=== Overpass-probe: faste steder, byer: ${CITIES.join(', ')} ===\n`);
    const table = [];
    for (const city of CITIES) {
        console.log(`Henter tellinger for ${city}...`);
        const counts = await countsForCity(city);
        table.push([city, counts]);
        await sleep(PAUSE_MS);
    }

    console.log('\n=== ANTALL TREFF PER KATEGORI ===');
    const nameW = Math.max(...CATEGORIES.map(([n]) => n.length)) + 2;
    console.log(' '.repeat(nameW) + CITIES.map((c) => c.padStart(11)).join(''));
    CATEGORIES.forEach(([catName], i) => {
        const row = table.map(([, counts]) => String(counts?.[i] ?? '?').padStart(11)).join('');
        console.log(catName.padEnd(nameW) + row);
    });

    console.log('\n=== TAGG-KVALITET (utvalg) ===');
    for (const city of CITIES) {
        const q = await qualityForCity(city);
        if (q) q.forEach((line) => console.log(line));
        await sleep(PAUSE_MS);
    }

    console.log('\nLim hele utskriften tilbake til Claude for importbeslutning.');
}

main().catch((e) => console.error('Probe feilet:', e));
