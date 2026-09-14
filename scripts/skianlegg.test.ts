// scripts/skianlegg.test.ts
// Skianlegg-kategorien: selektoren, plasseringen i match-prioriteten, og
// skillet mellom alpint og langrenn.
//
// Ingen nettverk. Den romlige funksjonen selv er testet i
// lib/geo-polygon.test.ts; her testes reglene rundt den.
// Kjør: node --import tsx --test scripts/skianlegg.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anyInsideOrNear, anyInsideOrNearAny, pointInRing } from '../lib/geo-polygon';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

const ski = async () => {
    const { PLACE_CATEGORIES } = await load();
    const cat = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg');
    assert.ok(cat, 'skianlegg-kategorien mangler');
    return cat!;
};

test('selektoren dekker alle fire tagge-mønstrene', async () => {
    const cat = await ski();
    // winter_sports
    assert.match(cat.selector, /"landuse"="winter_sports"/);
    // recreation_ground med piste:* — tre varianter, fordi Varingskollen bare
    // har piste:lit og Skimore Kongsberg bare piste:difficulty.
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["piste:type"\]/);
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["piste:lit"\]/);
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["piste:difficulty"\]/);
    // recreation_ground med sport~ski
    assert.match(cat.selector, /"landuse"="recreation_ground"\]\["sport"~"ski",i\]/);
    // sports_centre med sport~ski
    assert.match(cat.selector, /"leisure"="sports_centre"\]\["sport"~"ski",i\]/);
});

test('hver selektorlinje verner mot nedlagte anlegg', async () => {
    // disused:landuse=... har ingen landuse-nøkkel og treffes uansett ikke.
    // Vakten her er mot den andre formen: en aktiv nøkkel + disused=yes.
    const cat = await ski();
    const linjer = cat.selector.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(linjer.length >= 6, `forventet minst 6 linjer, fikk ${linjer.length}`);
    for (const l of linjer) {
        assert.match(l, /\["disused"!~"\."\]/, `mangler disused-vakt: ${l}`);
        assert.match(l, /\["abandoned"!~"\."\]/, `mangler abandoned-vakt: ${l}`);
    }
});

test('Skianlegg står FØR idrettshall i match-prioriteten', async () => {
    // Den viktigste enkeltlinja i denne endringen. idrettshall er en
    // ukvalifisert oppsamler for leisure=sports_centre, og rekkefølgen er
    // match-prioritet. Snus den, havner alpinanleggene i Idrettshall.
    const { PLACE_CATEGORIES } = await load();
    const keys = PLACE_CATEGORIES.map((c) => c.key);
    const iSki = keys.indexOf('skianlegg');
    const iHall = keys.indexOf('idrettshall');
    assert.ok(iSki >= 0 && iHall >= 0);
    assert.ok(iSki < iHall, `skianlegg (${iSki}) må stå før idrettshall (${iHall})`);
});

test('cable_car er IKKE en skiheis', async () => {
    // Krossobanen og Fløibanen er turistbaner. En generisk ["aerialway"]
    // ville gjort Fløyen til et alpinanlegg.
    const { SKI_LIFT_VALUES } = await load();
    assert.ok(!SKI_LIFT_VALUES.split('|').includes('cable_car'));
    for (const v of ['drag_lift', 't-bar', 'j-bar', 'platter', 'rope_tow',
        'magic_carpet', 'chair_lift', 'gondola', 'mixed_lift']) {
        assert.ok(SKI_LIFT_VALUES.split('|').includes(v), `mangler heisverdi ${v}`);
    }
});

test('bevis-selektoren henter mer enn kategoritesten trenger', async () => {
    // Bevisene brukes til TO ting: kategoritesten (heis eller downhill) og
    // fasettene (også sled, playground og mtb). Derfor er settet bredere.
    const { SKI_EVIDENCE_SELECTOR } = await load();
    assert.match(SKI_EVIDENCE_SELECTOR, /"aerialway"~/);
    assert.match(SKI_EVIDENCE_SELECTOR, /\["piste:type"\]/);
    assert.match(SKI_EVIDENCE_SELECTOR, /\["mtb:type"\]/);
    assert.match(SKI_EVIDENCE_SELECTOR, /"route"="mtb"/);
});

test('skiVerdict: utforløype kvalifiserer, heis alene gjør det ikke', async () => {
    // KRAVET BLE STRAMMET etter tørrkjøringen mot Oslo. «Heis ELLER
    // utforløype» slapp inn Holmenkollen nasjonalanlegg, Linderudkollen
    // hoppbakke og Lia skisenter — et hoppanlegg har heis opp til tilløpet.
    const { skiVerdict } = await load();

    assert.equal(skiVerdict({}, [{ 'piste:type': 'downhill' }]), 'alpint');
    assert.equal(skiVerdict({}, [{ 'piste:type': 'downhill;nordic' }]), 'alpint');
    assert.equal(skiVerdict({ 'piste:type': 'downhill' }, []), 'alpint',
        'polygonets egne tagger teller også');

    // Heis uten utforløype: ikke importert, men RAPPORTERT.
    assert.equal(skiVerdict({}, [{ aerialway: 'chair_lift' }]), 'usikker-heis');
    assert.equal(skiVerdict({}, [{ aerialway: 'rope_tow' }]), 'usikker-heis');

    assert.equal(skiVerdict({}, [{ 'piste:type': 'nordic' }]), 'ikke-alpint');
    assert.equal(skiVerdict({}, [{ 'piste:type': 'sled' }]), 'ikke-alpint',
        'en akebakke alene gjør ikke polygonet til et alpinanlegg');
    assert.equal(skiVerdict({}, [{ 'mtb:type': 'downhill' }]), 'ikke-alpint',
        'en sykkelløype er ikke bevis for SKIanlegg');
    assert.equal(skiVerdict({}, []), 'ikke-alpint');
});

test('FEIL 2: hoppanlegg med heis slipper IKKE inn lenger', async () => {
    // Holmenkollen nasjonalanlegg (way/81300521) og Linderudkollen hoppbakke
    // (way/64845752) ble begge VERIFISERT i den første tørrkjøringen.
    // Mekanismen gjenskapt: hoppbakke + heis opp til tilløpet, ingen nedfart.
    const { skiVerdict } = await load();
    const hoppanlegg = skiVerdict({ 'piste:type': 'ski_jump' }, [
        { aerialway: 'chair_lift' },
        { 'piste:type': 'nordic' },
    ]);
    assert.equal(hoppanlegg, 'usikker-heis', 'rapporteres, importeres ikke');
    assert.notEqual(hoppanlegg, 'alpint');

    const medSportTagg = skiVerdict({ sport: 'ski_jumping' }, [{ aerialway: 't-bar' }]);
    assert.notEqual(medSportTagg, 'alpint');
});

test('et kombinert anlegg med BÅDE hoppbakke og alpinbakke består', async () => {
    // Grunnen til at ski_jump ikke er en diskvalifisering: en liste over
    // hoppsignaler ville tatt feil her, og slike anlegg er vanlige.
    const { skiVerdict } = await load();
    assert.equal(
        skiVerdict({ sport: 'ski_jumping' }, [
            { 'piste:type': 'ski_jump' },
            { 'piste:type': 'downhill' },
            { aerialway: 'chair_lift' },
        ]),
        'alpint'
    );
});

test('hoppsignalet regnes ut, men avgjør ingenting', async () => {
    // Det brukes kun til rapportlinja, så et «usikker-heis» kan forklares.
    const { hasSkiJump, hasDownhillPiste, hasSkiLift } = await load();
    assert.equal(hasSkiJump([{ 'piste:type': 'ski_jump' }]), true);
    assert.equal(hasSkiJump([{ sport: 'ski_jumping' }]), true);
    assert.equal(hasSkiJump([{ 'piste:type': 'downhill' }]), false);
    assert.equal(hasDownhillPiste([{ 'piste:type': 'downhill' }]), true);
    assert.equal(hasSkiLift([{ aerialway: 'gondola' }]), true);
    assert.equal(hasSkiLift([{ 'piste:type': 'downhill' }]), false);
});

test('matches krever romlig verifisering — tagger alene holder ikke', async () => {
    // Uten dette ville et ski-tagget polygon som kom inn via en ANNEN
    // kategoris spørring (idrettshall henter alle sports_centre) blitt
    // hevdet av Skianlegg, uten at heis-testen noen gang kjørte.
    const cat = await ski();
    const tags = { landuse: 'winter_sports', name: 'Et anlegg' };
    assert.equal(cat.matches(tags), false, 'uten element: ikke verifisert');
    assert.equal(cat.matches(tags, { type: 'way', id: 1, tags }), false);
    assert.equal(
        cat.matches(tags, { type: 'way', id: 1, tags, skiVerified: true }),
        true
    );
});

test('is_free er UKJENT, ikke «betalt»', async () => {
    // Samme rettelse som museene fikk: en gal default er verre enn ingen.
    // Kategorien rommer heisanlegg som koster penger OG kommunale
    // barnebakker med gratis rope_tow.
    const cat = await ski();
    assert.equal(cat.isFree, null);
});

test('is_free leser fee-taggen når OSM faktisk har den', async () => {
    const { resolveIsFree } = await load();
    const cat = await ski();
    assert.equal(resolveIsFree({ fee: 'yes' }, cat.isFree), false);
    assert.equal(resolveIsFree({ fee: 'no' }, cat.isFree), true);
    assert.equal(resolveIsFree({}, cat.isFree), null);
});

test('Varingskollen skistadion faller ut, Kirkerudbakken består', async () => {
    // Det avgjørende tilfellet, gjenskapt med koordinater. Begge er
    // landuse=recreation_ground. Etter innstrammingen er forskjellen
    // NEDFARTEN, ikke heisen — et langrennsstadion med trekkheis ville
    // tidligere passert.
    const { skiVerdict } = await load();

    const polygon = [
        { lat: 60.0, lon: 10.0 },
        { lat: 60.0, lon: 10.02 },
        { lat: 60.01, lon: 10.02 },
        { lat: 60.01, lon: 10.0 },
    ];
    const inne = (pts: { lat: number; lon: number }[]) =>
        anyInsideOrNear(pts, polygon, 50);

    // Langrennsstadion: nordic-løype inne, ingen nedfart.
    const langrenn = [
        { tags: { 'piste:type': 'nordic' }, points: [{ lat: 60.005, lon: 10.01 }] },
    ];
    const langrennInne = langrenn.filter((e) => inne(e.points));
    assert.equal(langrennInne.length, 1, 'løypa ligger inne');
    assert.equal(
        skiVerdict({}, langrennInne.map((e) => e.tags)),
        'ikke-alpint'
    );

    // Alpinsenter: samme polygon, men en utforløype krysser det.
    const alpint = [
        { tags: { 'piste:type': 'nordic' }, points: [{ lat: 60.005, lon: 10.01 }] },
        {
            tags: { 'piste:type': 'downhill' },
            points: [
                { lat: 59.998, lon: 9.998 }, // starter utenfor polygonet
                { lat: 60.008, lon: 10.015 }, // ender inne
            ],
        },
    ];
    const alpintInne = alpint.filter((e) => inne(e.points));
    assert.equal(skiVerdict({}, alpintInne.map((e) => e.tags)), 'alpint');
});

test('en heis langt unna smitter ikke over på nabopolygonet', async () => {
    // Motprøven til testen over: tolleransen er 50 m, og den skal ikke la et
    // alpinanlegg i nabodalen gjøre langrennsstadionet til Skianlegg.
    const polygon = [
        { lat: 60.0, lon: 10.0 },
        { lat: 60.0, lon: 10.02 },
        { lat: 60.01, lon: 10.02 },
        { lat: 60.01, lon: 10.0 },
    ];
    const heisINabodalen = [{ lat: 60.05, lon: 10.06 }, { lat: 60.06, lon: 10.07 }];
    assert.equal(anyInsideOrNear(heisINabodalen, polygon, 50), false);
});

// ===========================================================================
// FEIL 1: alle relasjoner falt ut
// ===========================================================================
//
// Tørrkjøringen mot Oslo ga 4 av 4 relasjoner forkastet, inkludert
// Skimore Oslo (relation/2259942) — Oslos største alpinanlegg med 11 heiser.
//
// MERK om testdataene: koordinatene under er KONSTRUERTE. Overpass er
// blokkert fra containeren der denne koden ble skrevet, så de ekte
// geometriene til de tolv Oslo-objektene kunne ikke hentes. ID-ene og
// navnene er ekte; formene er gjenskapt for å reprodusere feilklassen.

test('FEIL 1: en relasjon har ikke geometri på toppnivå — bare på medlemmene', async () => {
    // Mekanismen, isolert. Dette er hele årsaken: `el.geometry` er undefined
    // for en relation, og den gamle koden gjorde `poly.geometry ?? []` og
    // forkastet alt med færre enn tre punkter.
    const { polygonRings } = await load();

    const relasjon = {
        type: 'relation' as const,
        id: 2259942,
        tags: { landuse: 'winter_sports', name: 'Skimore Oslo' },
        // Ytre kant delt på to ways, slik Overpass leverer dem.
        members: [
            {
                type: 'way' as const,
                ref: 1,
                role: 'outer',
                geometry: [
                    { lat: 59.98, lon: 10.66 },
                    { lat: 59.98, lon: 10.7 },
                    { lat: 60.0, lon: 10.7 },
                ],
            },
            {
                type: 'way' as const,
                ref: 2,
                role: 'outer',
                geometry: [
                    { lat: 60.0, lon: 10.7 },
                    { lat: 60.0, lon: 10.66 },
                    { lat: 59.98, lon: 10.66 },
                ],
            },
        ],
    };

    assert.equal(relasjon.geometry, undefined, 'forutsetningen: ingen toppnivå-geometri');
    const rings = polygonRings(relasjon);
    assert.equal(rings.length, 1, 'medlemmene skal sys til én ring');
    assert.ok(rings[0].length >= 4);
});

test('en relasjon når helt fram til «alpint» med en nedfart inni', async () => {
    // Regresjonen i sin helhet: geometri → romlig test → dom.
    const { polygonRings, elementPoints, skiVerdict } = await load();
    const relasjon = {
        type: 'relation' as const,
        id: 2259942,
        tags: { landuse: 'winter_sports', name: 'Skimore Oslo' },
        members: [
            { type: 'way' as const, ref: 1, role: 'outer', geometry: [
                { lat: 59.98, lon: 10.66 }, { lat: 59.98, lon: 10.7 }, { lat: 60.0, lon: 10.7 } ] },
            { type: 'way' as const, ref: 2, role: 'outer', geometry: [
                { lat: 60.0, lon: 10.7 }, { lat: 60.0, lon: 10.66 }, { lat: 59.98, lon: 10.66 } ] },
        ],
    };
    const nedfart = {
        type: 'way' as const,
        id: 999,
        tags: { 'piste:type': 'downhill' },
        geometry: [{ lat: 59.99, lon: 10.68 }, { lat: 59.995, lon: 10.685 }],
    };

    const rings = polygonRings(relasjon);
    const inne = anyInsideOrNearAny(elementPoints(nedfart), rings, 50);
    assert.equal(inne, true, 'nedfarten ligger i multipolygonet');
    assert.equal(skiVerdict(relasjon.tags, [nedfart.tags]), 'alpint');
});

test('en way er uendret — rettingen brøt ikke det som virket', async () => {
    const { polygonRings } = await load();
    const way = {
        type: 'way' as const,
        id: 97706914,
        tags: { landuse: 'winter_sports', name: 'Jerikobakken' },
        geometry: [
            { lat: 59.9, lon: 10.6 },
            { lat: 59.9, lon: 10.62 },
            { lat: 59.91, lon: 10.62 },
            { lat: 59.91, lon: 10.6 },
        ],
    };
    assert.deepEqual(polygonRings(way), [way.geometry]);
});

test('bevis som er en RELASJON teller — route=mtb er typisk en relasjon', async () => {
    // Samme feilklasse på bevissiden: en relasjon har ingen punkter på
    // toppnivå, så den talte aldri som bevis og ga aldri fasetter.
    const { elementPoints } = await load();
    const mtbRute = {
        type: 'relation' as const,
        id: 4242,
        tags: { route: 'mtb' },
        members: [
            { type: 'way' as const, ref: 7, role: '', geometry: [
                { lat: 59.99, lon: 10.68 }, { lat: 59.991, lon: 10.681 } ] },
        ],
    };
    assert.deepEqual(elementPoints(mtbRute), [
        { lat: 59.99, lon: 10.68 },
        { lat: 59.991, lon: 10.681 },
    ]);
});

test('et ødelagt multipolygon faller tilbake på bounds i stedet for å forsvinne', async () => {
    // En åpen ytre kant kan ikke sys. Da er bounds grovere, men å miste
    // anlegget er verre — det var nettopp den stille feilen.
    const { polygonRings, boundsRing } = await load();
    const odelagt = {
        type: 'relation' as const,
        id: 1410326,
        tags: { name: 'Leirskallen skisenter' },
        bounds: { minlat: 59.86, minlon: 10.79, maxlat: 59.87, maxlon: 10.81 },
        members: [
            { type: 'way' as const, ref: 1, role: 'outer', geometry: [
                { lat: 59.86, lon: 10.79 }, { lat: 59.86, lon: 10.81 } ] },
        ],
    };
    assert.deepEqual(polygonRings(odelagt), [], 'åpen kant kan ikke sys');
    const fallback = boundsRing(odelagt.bounds);
    assert.equal(fallback.length, 5);
    assert.equal(pointInRing({ lat: 59.865, lon: 10.8 }, fallback), true);
});

test('inner-medlemmer (hull) tas ikke med i ytterkanten', async () => {
    const { polygonRings } = await load();
    const medHull = {
        type: 'relation' as const,
        id: 1,
        tags: {},
        members: [
            { type: 'way' as const, ref: 1, role: 'outer', geometry: [
                { lat: 60.0, lon: 10.0 }, { lat: 60.0, lon: 10.02 },
                { lat: 60.02, lon: 10.02 }, { lat: 60.02, lon: 10.0 },
                { lat: 60.0, lon: 10.0 } ] },
            { type: 'way' as const, ref: 2, role: 'inner', geometry: [
                { lat: 60.005, lon: 10.005 }, { lat: 60.005, lon: 10.01 },
                { lat: 60.01, lon: 10.01 }, { lat: 60.005, lon: 10.005 } ] },
        ],
    };
    assert.equal(polygonRings(medHull).length, 1, 'kun ytterkanten');
});

// ===========================================================================
// Tellingen i «0 elementer»-advarselen
// ===========================================================================

test('ADVARSEL-tellingen må sende elementet til matches()', async () => {
    // ÅRSAKEN, isolert. matches() fikk et andre argument da Skianlegg kom
    // til, fordi tagger alene ikke skiller et alpinanlegg fra et
    // langrennsstadion — dommen ligger på elementet (skiVerified).
    // buildRows ble oppdatert, tellelinja ikke. Resultat: fem steder hentet
    // og skrevet, mens advarselen meldte «0 elementer for Skianlegg».
    const { PLACE_CATEGORIES } = await load();
    const ski = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!;
    const el = {
        type: 'relation' as const,
        id: 2259942,
        tags: { landuse: 'winter_sports', name: 'Skimore Oslo' },
        skiVerified: true,
    };

    // Slik den gamle tellelinja kalte den:
    const utenElement = PLACE_CATEGORIES.find((c) => c.matches(el.tags, undefined));
    assert.notEqual(utenElement, ski, 'uten elementet finner den ikke Skianlegg');

    // Slik buildRows kaller den — og slik tellingen gjør nå:
    const medElement = PLACE_CATEGORIES.find((c) => c.matches(el.tags, el));
    assert.equal(medElement, ski);
});

test('tellingen gir 5 for fem verifiserte anlegg', async () => {
    // Retning 1: advarselen skal IKKE fyre når noe faktisk kom inn.
    const { PLACE_CATEGORIES } = await load();
    const ski = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!;
    const elementer = [64845752, 65479699, 80369623, 81300521, 97706914].map((id) => ({
        type: 'way' as const,
        id,
        tags: { landuse: 'winter_sports' },
        skiVerified: true,
    }));
    const antall = elementer.filter(
        (el) => PLACE_CATEGORIES.find((c) => c.matches(el.tags ?? {}, el)) === ski
    ).length;
    assert.equal(antall, 5);
});

test('tellingen gir 0 når kategorien VIRKELIG er tom', async () => {
    // Retning 2: advarselen skal fortsatt fyre. Den fanget en ekte feilklasse
    // i september, der en hel kategori falt til null i stillhet.
    const { PLACE_CATEGORIES } = await load();
    const ski = PLACE_CATEGORIES.find((c) => c.key === 'skianlegg')!;
    // Ingen ski-elementer i det hele tatt.
    const bareLekeplasser = [
        { type: 'way' as const, id: 1, tags: { leisure: 'playground' } },
    ];
    assert.equal(
        bareLekeplasser.filter(
            (el) => PLACE_CATEGORIES.find((c) => c.matches(el.tags ?? {}, el)) === ski
        ).length,
        0
    );
    // Og: ski-taggede polygoner som IKKE besto den romlige testen teller
    // heller ikke. Det er riktig — de ble aldri hentet inn.
    const ikkeVerifisert = [
        { type: 'way' as const, id: 2, tags: { landuse: 'winter_sports' } },
    ];
    assert.equal(
        ikkeVerifisert.filter(
            (el) => PLACE_CATEGORIES.find((c) => c.matches(el.tags ?? {}, el)) === ski
        ).length,
        0
    );
});

test('vanlige kategorier teller uendret uten elementet', async () => {
    // Rettingen skal ikke ha endret noe for de kategoriene som avgjør på
    // tagger alene. Andre argument er valgfritt, og de ignorerer det.
    const { PLACE_CATEGORIES } = await load();
    const lekeplass = PLACE_CATEGORIES.find((c) => c.key === 'lekeplass')!;
    const el = { type: 'way' as const, id: 1, tags: { leisure: 'playground' } };
    assert.equal(PLACE_CATEGORIES.find((c) => c.matches(el.tags)), lekeplass);
    assert.equal(PLACE_CATEGORIES.find((c) => c.matches(el.tags, el)), lekeplass);
});

// ===========================================================================
// url fra nettside, og by-ankeret
// ===========================================================================

test('url settes fra website når OSM har den', async () => {
    // Skimore Oslo: website=http://www.tryvann.no/ i taggene, mens url i
    // basen var openstreetmap.org/relation/2259942.
    const { sanitizeWebsite } = await import('../lib/website');
    const osmLenke = 'https://www.openstreetmap.org/relation/2259942';
    const url = (t: Record<string, string | undefined>) =>
        sanitizeWebsite(t.website ?? t['contact:website']) ?? osmLenke;

    assert.equal(url({ website: 'http://www.tryvann.no/' }), 'http://www.tryvann.no/');
    assert.equal(url({ 'contact:website': 'www.a.no' }), 'https://www.a.no/');
    // website vinner over contact:website.
    assert.equal(url({ website: 'a.no', 'contact:website': 'b.no' }), 'https://a.no/');
    // Ugyldig verdi faller tilbake til OSM-lenka, ikke til null.
    assert.equal(url({ website: 'post@a.no' }), osmLenke);
    assert.equal(url({}), osmLenke);
});

test('OSM-objektet er ikke tapt — external_id er lenka', async () => {
    // Grunnen til at det er trygt å la url peke på anleggets side: lenka til
    // OSM kan bygges når som helst fra external_id, som ER «<type>/<id>».
    const externalId = 'relation/2259942';
    assert.equal(
        `https://www.openstreetmap.org/${externalId}`,
        'https://www.openstreetmap.org/relation/2259942'
    );
});

test('rowsMissingCityAnchor: en rad uten by er usynlig i by-modus', async () => {
    const { rowsMissingCityAnchor } = await load();
    const rad = (extra: Record<string, unknown>) =>
        ({
            external_id: 'way/1',
            kind: 'place',
            title: 't',
            description: '',
            category: 'Skianlegg',
            target_audience: 'For alle',
            venue_name: null,
            address: null,
            municipality: '',
            lat: 60,
            lng: 10,
            opening_hours: null,
            is_free: null,
            price_text: null,
            url: 'https://a.no/',
            osm_tags: {},
            facets: [],
            status: 'published',
            titleSource: 'osm-navn',
            osmName: null,
            ...extra,
        }) as Parameters<typeof rowsMissingCityAnchor>[0][number];

    // Per-by-modus setter alltid municipality — ingen treff.
    assert.deepEqual(rowsMissingCityAnchor([rad({ municipality: 'Oslo' })]), []);
    // near_city alene holder også (seedens form for utenbys-steder).
    assert.deepEqual(rowsMissingCityAnchor([rad({ near_city: 'Oslo' })]), []);
    // Ingen av delene: fanget. Dette er tilstanden nasjonal modus kan skape.
    assert.equal(rowsMissingCityAnchor([rad({})]).length, 1);
    assert.equal(rowsMissingCityAnchor([rad({ municipality: '   ' })]).length, 1);
});
