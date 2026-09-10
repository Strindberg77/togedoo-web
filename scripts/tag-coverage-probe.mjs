// tag-coverage-probe.mjs — tag-dekning for de fem stedskategoriene.
// Samme Overpass-spørringer, byer og kategorisering som
// scripts/import-places.ts; teller hvilke tags som faktisk finnes i de
// norske dataene, med verdifordeling for de mest aktuelle taggene.
//
//   node tag-coverage-probe.mjs                (Oslo Bergen Trondheim Stavanger)
//   node tag-coverage-probe.mjs Oslo           (én by)
//
// 4 spørringer med 5 s pause — innenfor fair-use. Krever Node 18+.
const CITIES = process.argv.slice(2).length ? process.argv.slice(2) : ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'Togedoo datahub-undersokelse (hello@togedoo.com)';

const CATS = [
  // Museum ligger FØRST i match-rekkefølgen: et vitensenter kan også være
  // tagget leisure=park e.l. på omkringliggende areal — museumstaggen skal
  // vinne for selve institusjonen.
  { label: 'Museum',      match: t => t.tourism === 'museum' },
  { label: 'Lekeplass',   match: t => t.leisure === 'playground' },
  { label: 'Ballbane',    match: t => t.leisure === 'pitch' },
  { label: 'Idrettshall', match: t => t.leisure === 'sports_centre' },
  { label: 'Badeplass',   match: t => t.natural === 'beach' },
  { label: 'Park',        match: t => t.leisure === 'park' },
];
const SELECTORS = `
  nwr["tourism"="museum"](area.a);
  nwr["leisure"="playground"](area.a);
  nwr["leisure"="pitch"]["sport"~"soccer|basketball|multi",i]["access"!="private"](area.a);
  nwr["leisure"="sports_centre"](area.a);
  nwr["natural"="beach"](area.a);
  nwr["leisure"="park"](area.a);`;

// Tagger som er kandidater til rikere stedsinfo i appen — disse får også
// verdifordeling, ikke bare dekningsprosent.
const VALUE_KEYS = ['surface', 'wheelchair', 'lit', 'access', 'fee', 'charge', 'covered', 'indoor', 'baby', 'min_age', 'max_age', 'supervised', 'dog', 'opening_hours', 'website'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const agg = new Map(CATS.map(c => [c.label, { n: 0, keys: new Map(), values: new Map() }]));

for (const city of CITIES) {
  const query = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"="${city}"]->.a;
(${SELECTORS}
);
out tags;`;
  let elements = null;
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: 'data=' + encodeURIComponent(query) });
      if (res.status === 429 || res.status === 504) { await sleep(5000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      elements = (await res.json()).elements ?? [];
      break;
    } catch (e) { console.error(`${city}: ${ep}: ${e.message}`); await sleep(5000); }
  }
  if (!elements) { console.error(`${city}: fikk ikke svar, hopper over`); continue; }
  console.error(`${city}: ${elements.length} elementer`);
  for (const el of elements) {
    const t = el.tags ?? {};
    const cat = CATS.find(c => c.match(t));
    if (!cat) continue;
    const a = agg.get(cat.label);
    a.n++;
    for (const [key, val] of Object.entries(t)) {
      a.keys.set(key, (a.keys.get(key) ?? 0) + 1);
      if (VALUE_KEYS.includes(key)) {
        const vk = `${key}=${val}`;
        a.values.set(vk, (a.values.get(vk) ?? 0) + 1);
      }
    }
  }
  await sleep(5000);
}

for (const [label, { n, keys, values }] of agg) {
  console.log(`\n=== ${label} — ${n} steder (${CITIES.join(', ')}) ===`);
  console.log('Tag-dekning (≥2 % eller kandidat-tag):');
  for (const [key, cnt] of [...keys.entries()].sort((a, b) => b[1] - a[1])) {
    if (cnt / n >= 0.02 || VALUE_KEYS.includes(key) || key === 'opening_hours')
      console.log(`  ${key.padEnd(24)} ${String(cnt).padStart(5)}  (${((cnt / n) * 100).toFixed(1)}%)`);
  }
  const vals = [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (vals.length) {
    console.log('Toppverdier for kandidat-tagger:');
    for (const [vk, cnt] of vals) console.log(`  ${vk.padEnd(30)} ${cnt}`);
  }
}
