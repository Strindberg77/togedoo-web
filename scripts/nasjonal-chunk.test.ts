// scripts/nasjonal-chunk.test.ts
// HELE NORGE SOM ÉN CHUNK.
//
// Målt av Frederik mot overpass-api.de ved midnatt, bbox (57.5,4.0,71.5,31.5):
//   område  nwr[landuse=winter_sports]                445 obj   5,5 s   3,2 MB
//   bevis   nwr[piste:type~downhill|sled|playground] 7555 obj    35 s  11,3 MB
// Ingen remark, begge på første forsøk.
//
// Koordinatene i testene er KONSTRUERTE, spredt over Norge. De er valgt for
// avstandene, ikke for å gjengi ekte anlegg.
//
// Ingen nettverk. Kjør: node --import tsx --test scripts/nasjonal-chunk.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    anyInsideOrNearAny,
    boundsOf,
    boundsOverlap,
    rejectBoundsFor,
    type GeoPoint,
} from '../lib/geo-polygon';
import {
    chunkForCity,
    NATIONAL_AREA,
    NATIONAL_BBOX,
    nationalChunk,
    nationalCoverage,
    scopedSelector,
} from '../lib/import-chunks';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_QUERY_PAUSE_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

// ---------------------------------------------------------------------------
// a) PLANEN
// ---------------------------------------------------------------------------

test('--national gir ÉN chunk, uten by-anker', async () => {
    const { parseArgs } = await load();
    assert.equal(parseArgs(['--national']).national, true);
    const c = nationalChunk();
    assert.equal(c.id, 'norge');
    assert.equal(c.cityAnchor, null, 'municipality utledes per rad');
    assert.equal(c.overpassArea, NATIONAL_AREA, 'okt. 2026: området, ikke bboksen');
    assert.deepEqual(c.overpassScopes, ['(area.a)']);
    assert.equal(c.overpassTimeout, 300, 'samme timeout som målingen brukte');
});

test('bboksen er NØYAKTIG den som ble målt', () => {
    // Justeres tallene uten en ny måling, er 445/7555/5,5 s/35 s ikke lenger
    // sanne om koden som kjører. Boksen er nå RESERVE, men en reserve som er
    // endret i stillhet er ingen reserve.
    assert.equal(NATIONAL_BBOX, '(57.5,4.0,71.5,31.5)');
});

test('omraadet er NØYAKTIG det som ble målt', () => {
    // 4536 bevisobjekter og 91 akebakker ble målt mot DENNE setningen.
    // admin_level=2 er ikke pynt: uten den kan ISO3166-1=NO også treffe
    // underordnede grenser, og da avgjør tilfeldigheter hvilket område
    // Overpass finner.
    assert.equal(NATIONAL_AREA, 'area["ISO3166-1"="NO"]["admin_level"="2"]->.a');
});

test('--national og --city= utelukker hverandre', async () => {
    const { parseArgs } = await load();
    assert.throws(() => parseArgs(['--national', '--city=Oslo']), /utelukker hverandre/);
});

test('FRAVÆR av --city betyr fortsatt de fire byene', async () => {
    // Det avgjørende valget: nasjonal modus krever et EGET flagg. Lot vi
    // fravær av --city bety «hele landet», ville en kommando noen har kjørt i
    // et år plutselig hentet 55 000 objekter fra fire land.
    const { parseArgs, DEFAULT_CITIES } = await load();
    const a = parseArgs([]);
    assert.equal(a.national, false);
    assert.deepEqual(a.cities, DEFAULT_CITIES);
    assert.equal(DEFAULT_CITIES.length, 4);
});

test('den nasjonale planen dekker hele Norge, en by-plan gjør ikke', () => {
    assert.equal(nationalCoverage([nationalChunk()]), 1);
    assert.equal(nationalCoverage([chunkForCity('Oslo')]), null);
});

// ---------------------------------------------------------------------------
// AVGRENSNINGEN I SPØRRINGEN
// ---------------------------------------------------------------------------

test('HVER selektor bruker (area.a) som kanonisk avgrensning', async () => {
    // VAKTEN som gjør scopedSelector trygg. En selektor som glemte
    // konvensjonen ville blitt hentet for hele planeten uten at noe feilet.
    const { PLACE_CATEGORIES } = await load();
    for (const cat of PLACE_CATEGORIES) {
        for (const linje of cat.selector.split('\n').map((l) => l.trim()).filter(Boolean)) {
            assert.ok(
                linje.includes('(area.a)'),
                `${cat.key}: «${linje}» mangler (area.a) og ville blitt hentet uavgrenset`
            );
        }
    }
});

test('scopedSelector bytter ALLE forekomster, ikke bare den første', async () => {
    const { PLACE_CATEGORIES } = await load();
    const ski = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!;
    assert.ok(ski.selector.split('(area.a)').length > 2, 'flere linjer i denne');
    const ut = scopedSelector(ski.selector, nationalChunk('bbox'));
    assert.ok(!ut.includes('(area.a)'), 'ingen rest');
    assert.equal(ut.split(NATIONAL_BBOX).length - 1, ski.selector.split('(area.a)').length - 1);
});

test('en by-spørring har area-setningen, en nasjonal reserve har bbox', async () => {
    const { overpassQuery } = await load();
    const by = overpassQuery(chunkForCity('Oslo'), 'nwr["leisure"="park"](area.a);', 'out center tags');
    assert.match(by, /area\["boundary"="administrative"\]\["admin_level"="7"\]\["name"="Oslo"\]->\.a;/);
    assert.match(by, /\(area\.a\);/);
    assert.match(by, /\[timeout:180\]/);

    const reserve = overpassQuery(nationalChunk('bbox'), 'nwr["leisure"="park"](area.a);', 'out center tags');
    assert.ok(!reserve.includes('area.a'), 'ingen area-referanse igjen');
    assert.ok(!reserve.includes('->.a'), 'ingen tom area-setning med semikolon');
    assert.match(reserve, /nwr\["leisure"="park"\]\(57\.5,4\.0,71\.5,31\.5\);/);
    assert.match(reserve, /\[timeout:300\]/);

    // STANDARDEN har samme FORM som by-spørringen — bare på admin_level 2.
    // Det er hele poenget: én mekanisme, to nivåer.
    const norge = overpassQuery(nationalChunk(), 'nwr["leisure"="park"](area.a);', 'out center tags');
    assert.match(norge, /area\["ISO3166-1"="NO"\]\["admin_level"="2"\]->\.a;/);
    assert.match(norge, /nwr\["leisure"="park"\]\(area\.a\);/);
    assert.match(norge, /\[timeout:300\]/);
});

// ---------------------------------------------------------------------------
// b) AVGRENSNING TIL NORGE
// ---------------------------------------------------------------------------

test('bboksen dekker naboland — avgrensningen skjer på koordinatet', async () => {
    // 445 polygoner mot 254 i Geofabrik-fila. Forskjellen er Sverige,
    // Danmark og Finland.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const { municipalityIndex } = await import('./municipality-index');
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const rows = await buildRows(
        null,
        [
            { type: 'way', id: 1, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } },
            { type: 'way', id: 2, tags: { leisure: 'park', name: 'Kungstradgarden' }, center: { lat: 59.3307, lon: 18.0716 } },
            { type: 'way', id: 3, tags: { leisure: 'park', name: 'Kongens Have' }, center: { lat: 55.6867, lon: 12.5776 } },
            { type: 'way', id: 4, tags: { leisure: 'park', name: 'Esplanadi' }, center: { lat: 60.1675, lon: 24.9474 } },
        ],
        50,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.deepEqual(rows.map((r) => r.title), ['Sofienbergparken']);
    assert.equal(rows[0].municipality, 'Oslo');
});

test('utenlandske objekter koster ALDRI geokoding', async () => {
    // Det dyreste i hele rørledningen er ~1,1 s per navnløs rad. Objekter
    // utenfor Norge utelates FØR geokodingsbehovet regnes ut, så prisen for
    // å filtrere sent er båndbredde og minne — ikke tid.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const { municipalityIndex } = await import('./municipality-index');
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const rows = await buildRows(
        null,
        // Uten navn: ville utløst et revers-oppslag over nett hvis den ikke
        // ble utelatt først. Testen ville hengt eller feilet på nettverk.
        [{ type: 'way', id: 2, tags: { leisure: 'park' }, center: { lat: 59.3307, lon: 18.0716 } }],
        50,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.deepEqual(rows, []);
});

// ---------------------------------------------------------------------------
// c) rowsMissingCityAnchor
// ---------------------------------------------------------------------------

test('vakten beskytter fortsatt: en rad uten by-anker fanges', async () => {
    const { rowsMissingCityAnchor } = await load();
    const rad = (over: Record<string, unknown>) =>
        ({ external_id: 'way/1', municipality: '', near_city: null, ...over }) as never;
    assert.equal(rowsMissingCityAnchor([rad({})]).length, 1, 'tom municipality');
    assert.equal(rowsMissingCityAnchor([rad({ municipality: '   ' })]).length, 1, 'bare mellomrom');
});

test('vakten kaster IKKE på legitime nasjonale rader', async () => {
    // Med cityAnchor null kommer municipality fra grensefila. Vakten skal
    // være stille da — ellers ville den nasjonale chunken vært umulig.
    const { buildRows, rowsMissingCityAnchor, PLACE_CATEGORIES } = await load();
    const { municipalityIndex } = await import('./municipality-index');
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const rows = await buildRows(
        null,
        [
            { type: 'way', id: 1, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } },
            { type: 'way', id: 2, tags: { leisure: 'park', name: 'Nygaardsparken' }, center: { lat: 60.386, lon: 5.324 } },
            { type: 'way', id: 3, tags: { leisure: 'park', name: 'Nordparken' }, center: { lat: 69.65, lon: 18.96 } },
        ],
        50,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.equal(rows.length, 3);
    assert.deepEqual(rowsMissingCityAnchor(rows), [], 'ingen rader mangler by-anker');
    assert.deepEqual(rows.map((r) => r.municipality).sort(), ['Bergen', 'Oslo', 'Tromsø']);
});

test('et OMRÅDE SOM IKKE LØSER SEG stanser kjøringen — det ser ikke ut som et tomt land', async () => {
    // DEN ENE INNVENDINGEN MOT area[ISO3166-1=NO] SOM OVERLEVDE MÅLINGEN:
    // løser området seg ikke på speilet, svarer `area[...]->.a` med et TOMT
    // SETT og hele spørringen gir 0 objekter — uten å feile. Et land uten
    // alpinanlegg ser likt ut.
    //
    // Den er dekket, og av to uavhengige lag. Dette fester det andre:
    // utbyttesjekken. For ÉN nasjonal chunk er nationalCoverage 1, så
    // forventningen er hele det nasjonale tallet, og 0 av 254 er langt under
    // gulvet på 20 %.
    //
    // (Det første laget ligger i hentesteget: et tomt svar bekreftes med en
    // ekstra spørring og havner i «Bekreftet tomme sett» i oppsummeringen.
    // Se scripts/tomt-hentesteg.test.ts.)
    const { yieldCollapseStop, NATIONAL_EXPECTATION } = await import('../lib/import-guards');
    const dekning = nationalCoverage([nationalChunk()]);
    assert.equal(dekning, 1, 'én nasjonal chunk dekker hele landet');

    const tomt = yieldCollapseStop(new Map([['skianlegg', 0]]), dekning!);
    assert.ok(tomt, '0 av 254 må stanse kjøringen');
    assert.match(tomt.message, /skianlegg: 0 rader mot 254 forventet/);

    // Og det MÅLTE tallet skal ikke stanse noe: 4536 bevisobjekter ga i
    // Geofabrik-fila 254 polygoner, og det er nøyaktig forventningen.
    assert.equal(NATIONAL_EXPECTATION.skianlegg, 254);
    assert.equal(yieldCollapseStop(new Map([['skianlegg', 254]]), dekning!), null);
    // Aking: området målte 91 objekter, forventningen er 89.
    assert.equal(yieldCollapseStop(new Map([['aking', 91]]), dekning!), null);
});

test('Svalbard og Jan Mayen stoppes av vakten, uansett hva området tar med', async () => {
    // SPØRSMÅL 2 I OPPGAVEN, besvart der det ER mulig å svare offline.
    //
    // Om `area["ISO3166-1"="NO"]` omfatter Svalbard og Jan Mayen kan ikke
    // avgjøres herfra — det avhenger av taggingen i OSM, og den kan ikke leses
    // uten nett. Men SPØRSMÅLET SPILLER INGEN ROLLE for hva som havner i
    // basen: grensefila har 357 fastlandskommuner (kommunenummer 03–56,
    // nordligste punkt 71,19° N på Nordkapp). Svalbard (2100) og Jan Mayen
    // (2211) står ikke i den, så et punkt der finner ingen kommune og faller
    // ut her — nøyaktig som en svensk park.
    //
    // Det var det samme før byttet, av en annen grunn: bboksen stopper på
    // 71,5° N og 4,0° Ø, mens Longyearbyen ligger på 78,2° N og Jan Mayen på
    // 8,7° V. Ingen av dem har noen gang vært hentet.
    const { buildRows, rowsMissingCityAnchor, PLACE_CATEGORIES } = await load();
    const { municipalityIndex } = await import('./municipality-index');
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const rows = await buildRows(
        null,
        [
            { type: 'way', id: 1, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } },
            // Longyearbyen
            { type: 'way', id: 2, tags: { leisure: 'park', name: 'Svalbardparken' }, center: { lat: 78.2232, lon: 15.6469 } },
            // Olonkinbyen, Jan Mayen
            { type: 'way', id: 3, tags: { leisure: 'park', name: 'Jan Mayen-parken' }, center: { lat: 70.9221, lon: -8.7187 } },
        ],
        50,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.deepEqual(rows.map((r) => r.title), ['Sofienbergparken']);
    assert.deepEqual(rowsMissingCityAnchor(rows), [], 'ingen rad slipper gjennom uten kommune');
});

test('en utenlandsk rad når aldri vakten — den er utelatt før', async () => {
    // Rekkefølgen er poenget: ble den stående med tom municipality, ville
    // vakten kastet og HELE chunken stanset for én svensk park.
    const { buildRows, rowsMissingCityAnchor, PLACE_CATEGORIES } = await load();
    const { municipalityIndex } = await import('./municipality-index');
    const park = PLACE_CATEGORIES.find((c) => c.key === 'park')!;
    const rows = await buildRows(
        null,
        [
            { type: 'way', id: 1, tags: { leisure: 'park', name: 'Sofienbergparken' }, center: { lat: 59.921, lon: 10.766 } },
            { type: 'way', id: 2, tags: { leisure: 'park', name: 'Kungstradgarden' }, center: { lat: 59.3307, lon: 18.0716 } },
        ],
        50,
        [park],
        (lat, lng) => municipalityIndex().lookup(lat, lng)
    );
    assert.deepEqual(rowsMissingCityAnchor(rows), []);
    assert.equal(rows.length, 1);
});

// ---------------------------------------------------------------------------
// d) KLYNGINGEN NASJONALT
// ---------------------------------------------------------------------------

/** Fem steder med SAMME navn, spredt fra Agder til Finnmark. */
const SPREDT: [string, number, number][] = [
    ['Agder', 58.15, 8.0],
    ['Ostlandet', 59.95, 10.75],
    ['Vestlandet', 60.39, 5.32],
    ['Trondelag', 63.43, 10.39],
    ['Finnmark', 69.65, 18.96],
];

test('fem akebakker med samme navn i hver sin ende av Norge blir FEM rader', async () => {
    // Faren ved én nasjonal chunk: akingClusters grupperer på navn, og nå
    // ligger hele landet i samme gruppe. Taket er 1000 m, og dette VISER at
    // det holder — det er ikke et resonnement.
    const { akingClusters } = await load();
    const objekter = SPREDT.map(([sted, lat, lon], i) => ({
        type: 'way' as const,
        id: 100 + i,
        tags: { 'piste:type': 'sled', name: 'Marikollen skisenter' },
        geometry: [
            { lat, lon },
            { lat: lat + 0.0005, lon: lon + 0.0005 },
        ],
        // stedsnavnet er bare for lesbarhet i en feilmelding
        _sted: sted,
    }));
    const { anchors } = akingClusters(objekter);
    assert.equal(anchors.length, 5, 'fem bakker, ikke én');
    assert.deepEqual(
        anchors.map((a) => a.id).sort((x, y) => x - y),
        [100, 101, 102, 103, 104]
    );
});

test('taket virker også den andre veien: 900 m unna er samme bakke', async () => {
    // Uten dette ville testen over bare bevist at grupperingen ikke virker.
    const { akingClusters, AKING_NAME_GROUP_M } = await load();
    assert.equal(AKING_NAME_GROUP_M, 1000);
    const seg = (id: number, lat: number) => ({
        type: 'way' as const,
        id,
        tags: { 'piste:type': 'sled', name: 'Marikollen skisenter' },
        geometry: [
            { lat, lon: 10.75 },
            { lat: lat + 0.0005, lon: 10.75 },
        ],
    });
    // 0,009 grader ≈ 1 km mellom startpunktene, men segmentene er 55 m lange,
    // så luken mellom boksene er under taket.
    const { anchors } = akingClusters([seg(1, 59.95), seg(2, 59.9581)]);
    assert.equal(anchors.length, 1);
});

test('Skianlegg grupperer ALDRI på navn — fem polygoner blir fem rader', async () => {
    // Skillet er verdt å feste: Skianleggs «klynging» er den romlige
    // bevistesten per polygon, ikke navnegruppering. Navnekollisjoner kan
    // derfor ikke slå sammen alpinanlegg, uansett hvor stor chunken er.
    const { skianleggVerify } = await load();
    const omrade = SPREDT.map(([, lat, lon], i) => ({
        type: 'way' as const,
        id: 200 + i,
        tags: { landuse: 'winter_sports', name: 'Marikollen skisenter' },
        geometry: [
            { lat, lon },
            { lat: lat + 0.01, lon },
            { lat: lat + 0.01, lon: lon + 0.02 },
            { lat, lon: lon + 0.02 },
            { lat, lon },
        ],
    }));
    const bevis = SPREDT.map(([, lat, lon], i) => ({
        type: 'way' as const,
        id: 300 + i,
        tags: { 'piste:type': 'downhill' },
        geometry: [{ lat: lat + 0.005, lon: lon + 0.01 }],
    }));
    const ut = skianleggVerify({ omrade, bevis });
    assert.equal(ut.elements.length, 5);
});

test('bevis fra et ANNET anlegg smitter ikke over ved nasjonal skala', async () => {
    // Med hele landet i ett sett er alle bevis kandidater for alle polygoner.
    // Den romlige testen er det eneste som skiller dem.
    const { skianleggVerify } = await load();
    const ut = skianleggVerify({
        omrade: [
            {
                type: 'way',
                id: 1,
                tags: { landuse: 'winter_sports', name: 'Uten nedfart' },
                geometry: [
                    { lat: 58.15, lon: 8.0 },
                    { lat: 58.16, lon: 8.0 },
                    { lat: 58.16, lon: 8.02 },
                    { lat: 58.15, lon: 8.02 },
                    { lat: 58.15, lon: 8.0 },
                ],
            },
        ],
        // Nedfarten ligger i Finnmark.
        bevis: [{ type: 'way', id: 2, tags: { 'piste:type': 'downhill' }, geometry: [{ lat: 69.65, lon: 18.96 }] }],
    });
    assert.deepEqual(ut.elements, []);
});

// ---------------------------------------------------------------------------
// e) FORKASTNINGSFILTERET — samme dommer, målbart raskere
// ---------------------------------------------------------------------------

test('filteret er et OVERSETT: det forkaster aldri et ekte treff', () => {
    // Egenskapstest mot den ufiltrerte varianten, på tilfeldige data.
    // Ufiltrert: 445 x 7555 par tok 281,4 s. Filtrert: 0,1 s, samme dommer.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ring = (lat: number, lon: number, r: number): GeoPoint[] =>
        Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * 2 * Math.PI;
            return { lat: lat + r * Math.sin(a), lon: lon + r * 2 * Math.cos(a) };
        });

    let sjekket = 0;
    let treff = 0;
    for (let k = 0; k < 3000; k++) {
        // Tett sammen, så filteret faktisk får noe å gjøre i BEGGE retninger.
        const rings = [ring(59.9 + rnd() * 0.05, 10.7 + rnd() * 0.05, 0.004)];
        const points = ring(59.9 + rnd() * 0.05, 10.7 + rnd() * 0.05, 0.001);
        const fasit = anyInsideOrNearAny(points, rings, 50);
        const reject = rejectBoundsFor(rings, 50);
        const pb = boundsOf(points);
        const filtrert = Boolean(reject && pb && boundsOverlap(pb, reject)) && fasit;
        assert.equal(filtrert, fasit, `avvik i runde ${k}`);
        sjekket++;
        if (fasit) treff++;
    }
    assert.equal(sjekket, 3000);
    assert.ok(treff > 50, `for få ekte treff (${treff}) — testen beviste ingenting`);
    assert.ok(treff < 2950, `for få avvisninger (${treff}) — testen beviste ingenting`);
});

test('forkastningsboksen er unionen av hver rings EGNE utvidede boks', () => {
    // Ikke den utvidede unionen. padBounds regner meter om til lengdegrader
    // med boksens egen midtbreddegrad, og en union fra Lindesnes til Nordkapp
    // har en annen midtbreddegrad enn en ring i Finnmark. Utvidet etter
    // unionen ville padding i øst/vest blitt for smal.
    const sor = [
        { lat: 58.0, lon: 8.0 },
        { lat: 58.01, lon: 8.0 },
        { lat: 58.01, lon: 8.01 },
    ];
    const nord = [
        { lat: 71.0, lon: 25.0 },
        { lat: 71.01, lon: 25.0 },
        { lat: 71.01, lon: 25.01 },
    ];
    const hver = rejectBoundsFor([sor, nord], 50)!;
    const samlet = rejectBoundsFor([[...sor, ...nord]], 50)!;
    // Den nordlige ringen krever bredere padding i lengde enn en boks med
    // midtbreddegrad ~64,5 gir.
    assert.ok(
        hver.maxlon - hver.minlon > samlet.maxlon - samlet.minlon,
        'per-ring-padding må være minst like bred'
    );
});
