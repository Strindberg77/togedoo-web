// scripts/aking.test.ts
// Aking-kategorien: selektoren, skillet mot alpint og mot lekeplass, og
// forankringen som gjør 14 veisegmenter til ÉN rad.
//
// KOORDINATENE ER KONSTRUERTE, ikke hentet fra OSM. Overpass er ikke
// tilgjengelig fra dette miljøet, og en oppdiktet «ekte» geometri ville vært
// verre enn en tydelig syntetisk: den ville sett verifisert ut. Tallene ligger
// i Oslo-området og har riktige STØRRELSESORDENER (segmenter titalls meter fra
// hverandre, ubeslektede bakker kilometer fra hverandre), som er alt
// grupperingen faktisk testes på. OSM-ID-ene som er ekte, er merket.
//
// Ingen nettverk. Kjør: node --import tsx --test scripts/aking.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boundsGapMeters, distanceMeters } from '../lib/geo-polygon';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

type Tags = Record<string, string | undefined>;

const aking = async () => {
    const { PLACE_CATEGORIES } = await load();
    const cat = PLACE_CATEGORIES.find((c) => c.key === 'aking');
    assert.ok(cat, 'aking-kategorien mangler');
    return cat!;
};

/** En way med `piste:type=sled` og en rett strekning fra (lat, lon). */
function segment(id: number, name: string | undefined, lat: number, lon: number, tags: Tags = {}) {
    return {
        type: 'way' as const,
        id,
        tags: { 'piste:type': 'sled', ...(name ? { name } : {}), ...tags },
        geometry: [
            { lat, lon },
            { lat: lat + 0.0005, lon: lon + 0.0005 },
        ],
    };
}

// ---------------------------------------------------------------------------
// Selektoren
// ---------------------------------------------------------------------------

test('selektoren henter piste:type=sled, og bare den taggen', async () => {
    const cat = await aking();
    assert.match(cat.selector, /"piste:type"~"sled"/);
    // Én linje. Skileik (piste:type=playground) og sport=toboggan er bevisst
    // utelatt — se kommentaren på AKING_SELECTOR.
    const linjer = cat.selector.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.equal(linjer.length, 1);
    assert.ok(!cat.selector.includes('playground'), 'skileik skal ikke hentes hit');
    assert.ok(!cat.selector.includes('toboggan'), 'sport=toboggan er ikke målt frittstående');
});

test('selektoren verner mot nedlagte bakker', async () => {
    const cat = await aking();
    assert.ok(cat.selector.includes('["disused"!~"."]'));
    assert.ok(cat.selector.includes('["abandoned"!~"."]'));
});

// ---------------------------------------------------------------------------
// Dommen per objekt
// ---------------------------------------------------------------------------

test('en akeløype er aking', async () => {
    const { akingVerdict } = await load();
    assert.equal(akingVerdict({ 'piste:type': 'sled', name: 'Sollibakken' }), 'aking');
});

test('downhill;sled blir ALDRI en akebakke', async () => {
    // Kategoriens eksistensgrunn. To objekter nasjonalt (Overpass, sep. 2026).
    // Å ake i en alpinbakke i åpningstiden er farlig, og en akebakke-nål der
    // ville vært en invitasjon.
    const { akingVerdict } = await load();
    assert.equal(
        akingVerdict({ 'piste:type': 'downhill;sled', name: 'Kombibakken' }),
        'alpint-blandet'
    );
    assert.equal(
        akingVerdict({ 'piste:type': 'sled;downhill', name: 'Kombibakken' }),
        'alpint-blandet',
        'rekkefølgen i semikolonlista skal ikke ha noe å si'
    );
});

test('lekeplassen med akebakke blir stjålet av INGEN', async () => {
    // Oslo har minst én leisure=playground med sport=toboggan + piste:type=sled.
    const { akingVerdict, osmFacetTokens, PLACE_CATEGORIES } = await load();
    const tags = {
        leisure: 'playground',
        sport: 'toboggan',
        playground: 'sledding',
        'piste:type': 'sled',
        name: 'Lekeplassen med akebakke',
    };
    // 1. Aking avviser den eksplisitt — også når BARE aking-spørringen kjører.
    assert.equal(akingVerdict(tags), 'lekeplass');
    // 2. Lekeplass hevder den, og står først i match-prioriteten.
    const cat = PLACE_CATEGORIES.find((c) => c.matches(tags, { type: 'way', id: 1, tags }));
    assert.equal(cat?.key, 'lekeplass');
    // 3. Den taper ingenting: standardregelen gir den fasetten aking likevel.
    assert.deepEqual(osmFacetTokens(tags), ['aking']);
});

test('uten brukbart navn faller objektet ut — og telles', async () => {
    const { akingVerdict } = await load();
    assert.equal(akingVerdict({ 'piste:type': 'sled' }), 'uten-navn');
    assert.equal(akingVerdict({ 'piste:type': 'sled', name: '   ' }), 'uten-navn');
});

test('en langrennsløype er ikke aking', async () => {
    const { akingVerdict } = await load();
    assert.equal(akingVerdict({ 'piste:type': 'nordic', name: 'Nordmarka' }), 'ikke-aking');
    assert.equal(akingVerdict({ 'piste:type': 'playground', name: 'Skileiken' }), 'ikke-aking');
});

// ---------------------------------------------------------------------------
// Forankringen — fella med de 14 segmentene
// ---------------------------------------------------------------------------

/** Korketrekkeren: relation/1459739 (EKTE OSM-id) med 14 medlemsveier.
 *  Geometrien er konstruert — se filhodet. */
function korketrekkeren() {
    const medlemmer = Array.from({ length: 14 }, (_, i) => ({
        type: 'way' as const,
        ref: 900001 + i,
        role: '',
        geometry: [
            { lat: 59.9836 - i * 0.001, lon: 10.679 + i * 0.0005 },
            { lat: 59.9836 - (i + 1) * 0.001, lon: 10.679 + (i + 1) * 0.0005 },
        ],
    }));
    const relasjon = {
        type: 'relation' as const,
        id: 1459739,
        tags: { 'piste:type': 'sled', name: 'Korketrekkeren', route: 'piste' },
        members: medlemmer,
    };
    // Hvert segment er tagget likt og kommer med i SAMME Overpass-svar.
    const segmenter = medlemmer.map((m) => ({
        type: 'way' as const,
        id: m.ref,
        tags: { 'piste:type': 'sled', name: 'Korketrekkeren' },
        geometry: m.geometry,
    }));
    return { relasjon, segmenter };
}

test('14 segmenter + relasjonen gir ÉN rad, forankret i relasjonen', async () => {
    // FELLA. Uten forankringen ville Korketrekkeren fått 14 nåler oppå
    // hverandre i Nordmarka ved første import.
    const { akingClusters } = await load();
    const { relasjon, segmenter } = korketrekkeren();
    const { anchors, domTelling } = akingClusters([...segmenter, relasjon]);
    assert.equal(anchors.length, 1, 'skal bli én akebakke, ikke 14 eller 15');
    assert.equal(anchors[0].type, 'relation');
    assert.equal(anchors[0].id, 1459739);
    // Tellingen skjer ETTER at relasjonsdekningen er trukket fra: rapporten
    // skal si hvor mange BAKKER som står igjen, ikke hvor mange objekter
    // Overpass sendte. 14 dekkede segmenter i «aking»-tallet ville sagt
    // «15 akebakker» om én bakke.
    assert.equal(domTelling.aking, 1, 'de 14 segmentene er dekket av relasjonen');
});

test('medlemmene ekskluderes EKSAKT på type/ref, ikke på navn eller avstand', async () => {
    // En node med samme tallverdi som en medlemsvei skal ikke forsvinne bare
    // fordi tallet går igjen.
    const { akingClusters } = await load();
    const { relasjon, segmenter } = korketrekkeren();
    const nodeMedSammeTall = {
        type: 'node' as const,
        id: 900001, // samme tall som way/900001, men en annen type
        lat: 59.93,
        lon: 10.74,
        tags: { 'piste:type': 'sled', name: "Griser'n", ele: '163' },
    };
    const { anchors } = akingClusters([...segmenter, relasjon, nodeMedSammeTall]);
    const navn = anchors.map((a) => a.tags?.name).sort();
    assert.deepEqual(navn, ['Korketrekkeren', "Griser'n"].sort());
});

test('rekkefølgen fra Overpass endrer ikke ankeret', async () => {
    // external_id er ankerets egen type/id, så et ustabilt valg ville gitt en
    // ny rad ved hver import.
    const { akingClusters } = await load();
    const { relasjon, segmenter } = korketrekkeren();
    const a = akingClusters([relasjon, ...segmenter]).anchors[0];
    const b = akingClusters([...segmenter.slice().reverse(), relasjon]).anchors[0];
    assert.equal(`${a.type}/${a.id}`, `${b.type}/${b.id}`);
});

// ---------------------------------------------------------------------------
// Navnegruppering — «Akebakken» er flere ways uten relasjon
// ---------------------------------------------------------------------------

test('flere ways med samme navn, nær hverandre, blir én bakke', async () => {
    const { akingClusters } = await load();
    const deler = [
        segment(1, 'Akebakken', 59.95, 10.75),
        segment(2, 'Akebakken', 59.9505, 10.7505),
        segment(3, 'Akebakken', 59.951, 10.751),
    ];
    const { anchors } = akingClusters(deler);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].id, 1, 'laveste id blir ankeret');
});

test('samme navn LANGT fra hverandre forblir to bakker', async () => {
    // «Akebakken» er et generisk navn. To bydeler kan ha hver sin, og en ren
    // navnegruppering uten avstand ville slått dem sammen til én nål.
    const { akingClusters, AKING_NAME_GROUP_M } = await load();
    const { anchors } = akingClusters([
        segment(1, 'Akebakken', 59.95, 10.75),
        segment(2, 'Akebakken', 59.99, 10.9), // flere km unna
    ]);
    assert.equal(anchors.length, 2);
    assert.equal(AKING_NAME_GROUP_M, 1000);
});

test('ULIKE navn i samme li forblir to bakker', async () => {
    // Sollibakken og Bjartbakken. Avstand alene kunne ikke skilt dem — derfor
    // er navnet grupperingsnøkkelen, ikke posisjonen.
    const { akingClusters } = await load();
    const { anchors } = akingClusters([
        segment(1, 'Sollibakken', 59.95, 10.75),
        segment(2, 'Bjartbakken', 59.9502, 10.7502),
    ]);
    assert.equal(anchors.length, 2);
});

test('enkeltlenke: A og C hører sammen når B ligger mellom', async () => {
    // Grupperingstaket er den største tillatte LUKEN mellom nabosegmenter,
    // ikke bakkens lengde. En 3 km lang bakke i tette segmenter er én bakke.
    const { akingClusters } = await load();
    const { anchors } = akingClusters([
        segment(1, 'Lang bakke', 59.95, 10.75),
        segment(2, 'Lang bakke', 59.957, 10.75),
        segment(3, 'Lang bakke', 59.964, 10.75),
        segment(4, 'Lang bakke', 59.971, 10.75),
    ]);
    assert.equal(anchors.length, 1, 'kjeden skal holde sammen');
});

test('en node blir én bakke uten særregel', async () => {
    const { akingClusters } = await load();
    const { anchors } = akingClusters([
        { type: 'node', id: 5, lat: 59.93, lon: 10.74, tags: { 'piste:type': 'sled', name: "Griser'n" } },
    ]);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].center?.lat, 59.93);
    assert.equal(anchors[0].center?.lon, 10.74);
});

test('navnløse segmenter blir ingen rad, men telles', async () => {
    const { akingClusters } = await load();
    const { anchors, domTelling } = akingClusters([
        segment(1, undefined, 59.95, 10.75),
        segment(2, undefined, 59.9505, 10.7505),
        segment(3, 'Sollibakken', 59.96, 10.76),
    ]);
    assert.equal(anchors.length, 1);
    assert.equal(domTelling['uten-navn'], 2);
});

test('segmentene i en alpint-blandet relasjon sniker seg ikke inn', async () => {
    // Ellers ville navnegruppa gjenopprettet nøyaktig sammenblandingen
    // kategorien finnes for å fjerne.
    const { akingClusters } = await load();
    const medlemmer = [1, 2, 3].map((n) => ({ type: 'way' as const, ref: n, geometry: [{ lat: 59.9, lon: 10.6 }] }));
    const relasjon = {
        type: 'relation' as const,
        id: 77,
        tags: { 'piste:type': 'downhill;sled', name: 'Kombibakken' },
        members: medlemmer,
    };
    const segmenter = [1, 2, 3].map((n) => segment(n, 'Kombibakken', 59.9 + n * 0.0001, 10.6));
    const { anchors, domTelling } = akingClusters([...segmenter, relasjon]);
    assert.equal(anchors.length, 0);
    assert.equal(domTelling['alpint-blandet'], 1);
});

test('en NAVNLØS relasjon sperrer ikke for de navngitte segmentene sine', async () => {
    // Motsatt av testen over, og med vilje: er relasjonen selv ubrukelig som
    // anker, er de navngitte segmentene den beste kilden vi har.
    const { akingClusters } = await load();
    const relasjon = {
        type: 'relation' as const,
        id: 78,
        tags: { 'piste:type': 'sled' }, // uten navn
        members: [1, 2].map((n) => ({ type: 'way' as const, ref: n, geometry: [{ lat: 59.9, lon: 10.6 }] })),
    };
    const { anchors } = akingClusters([
        relasjon,
        segment(1, 'Bjartbakken', 59.9, 10.6),
        segment(2, 'Bjartbakken', 59.9002, 10.6002),
    ]);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].tags?.name, 'Bjartbakken');
});

// ---------------------------------------------------------------------------
// Kartpunktet
// ---------------------------------------------------------------------------

test('kartpunktet ligger PÅ bakken, ikke i skogen ved siden av', async () => {
    // En krum bakke har et bbox-senter som kan falle helt utenfor traseen.
    // Snappingen til nærmeste geometripunkt er hele forskjellen mot Skianlegg,
    // som er et flate-objekt der senteret ligger inne i anlegget.
    const { akingAnchorPoint } = await load();
    const lShape = [
        { lat: 59.95, lon: 10.75 },
        { lat: 59.95, lon: 10.76 },
        { lat: 59.96, lon: 10.76 },
    ];
    const punkt = akingAnchorPoint(lShape)!;
    assert.ok(
        lShape.some((p) => p.lat === punkt.lat && p.lon === punkt.lon),
        'punktet skal være ett av geometripunktene'
    );
});

test('tom geometri gir null, ikke NaN', async () => {
    const { akingAnchorPoint } = await load();
    assert.equal(akingAnchorPoint([]), null);
});

test('ankeret bærer ikke sin egen lat/lon videre', async () => {
    // coords() leser `el.lat ?? el.center?.lat`. Sto nodens egen lat igjen,
    // ville et gruppert punkt blitt overstyrt av ett av medlemmene.
    const { akingClusters } = await load();
    const { anchors } = akingClusters([
        { type: 'node', id: 1, lat: 59.95, lon: 10.75, tags: { 'piste:type': 'sled', name: 'Delt navn' } },
        { type: 'node', id: 2, lat: 59.9505, lon: 10.7505, tags: { 'piste:type': 'sled', name: 'Delt navn' } },
    ]);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].lat, undefined);
    assert.equal(anchors[0].lon, undefined);
});

// ---------------------------------------------------------------------------
// Kategorien i rørledningen
// ---------------------------------------------------------------------------

test('Aking står ETTER lekeplass i match-prioriteten', async () => {
    const { PLACE_CATEGORIES } = await load();
    const keys = PLACE_CATEGORIES.map((c) => c.key);
    assert.ok(keys.indexOf('lekeplass') < keys.indexOf('aking'));
    assert.equal(keys[keys.indexOf('lekeplass') + 1], 'aking', 'rett etter, ikke et sted lenger bak');
});

test('matches krever akingVerified — taggene alene holder ikke', async () => {
    const cat = await aking();
    const tags = { 'piste:type': 'sled', name: 'Sollibakken' };
    assert.equal(cat.matches(tags, { type: 'way', id: 1, tags }), false);
    assert.equal(cat.matches(tags, { type: 'way', id: 1, tags, akingVerified: true }), true);
    assert.equal(cat.matches(tags), false, 'uten element skal den ikke hevde noe');
});

test('fasetten er låst til aking, også når et medlem er alpint', async () => {
    // Standardregelen over medlemstaggene ville skrevet «alpint» på en
    // akebakke-rad. Løftet holdes eksakt.
    const cat = await aking();
    assert.deepEqual(
        cat.facetsFor!({
            type: 'relation',
            id: 1,
            tags: { 'piste:type': 'sled' },
            memberTags: [{ 'piste:type': 'downhill' }, { 'piste:type': 'sled' }],
        }),
        ['aking']
    );
});

test('gratis er kategoriens påstand, men fee=yes vinner', async () => {
    const { resolveIsFree } = await load();
    const cat = await aking();
    assert.equal(cat.isFree, true);
    assert.equal(resolveIsFree({}, cat.isFree), true);
    assert.equal(resolveIsFree({ fee: 'yes' }, cat.isFree), false);
});

test('Aking har egen henter — standardveien gir ingen gruppering', async () => {
    const cat = await aking();
    assert.equal(typeof cat.fetchElements, 'function');
});

test('kategoriverdien er «Aking» — databasenøkkelen appen slår opp på', async () => {
    const cat = await aking();
    assert.equal(cat.category, 'Aking');
    assert.equal(cat.label, 'Aking');
});

// ---------------------------------------------------------------------------
// Avstandsprimitivene grupperingen hviler på
// ---------------------------------------------------------------------------

test('boundsGapMeters er symmetrisk', async () => {
    const a = { minlat: 59.95, minlon: 10.75, maxlat: 59.951, maxlon: 10.751 };
    const b = { minlat: 59.96, minlon: 10.76, maxlat: 59.961, maxlon: 10.761 };
    assert.equal(boundsGapMeters(a, b), boundsGapMeters(b, a));
});

test('overlappende bokser har gap 0', () => {
    const a = { minlat: 59.95, minlon: 10.75, maxlat: 59.96, maxlon: 10.76 };
    const b = { minlat: 59.955, minlon: 10.755, maxlat: 59.965, maxlon: 10.765 };
    assert.equal(boundsGapMeters(a, b), 0);
});

test('avstanden er cos-korrigert i lengderetningen', () => {
    // På 60°N er én lengdegrad omtrent halvparten av én breddegrad. Uten
    // korreksjonen ville grupperingen strukket seg dobbelt så langt øst/vest.
    const nord = distanceMeters({ lat: 60, lon: 10 }, { lat: 60.01, lon: 10 });
    const ost = distanceMeters({ lat: 60, lon: 10 }, { lat: 60, lon: 10.01 });
    assert.ok(ost < nord * 0.6 && ost > nord * 0.4, `${ost} vs ${nord}`);
});

// ---------------------------------------------------------------------------
// REGRESJONER FRA TØRRKJØRINGEN MOT OSLO (sep. 2026)
//
//   34 objekter → 4 akebakker (2 alpint-blandet, 1 lekeplass, 15 uten navn)
//     relation/1459739  Korketrekkeren  HOPPET OVER — ingen geometri
//     way/26228807      Korketrekkeren  navnegruppe×10
//     way/558688673     Sollibakken     (falt ut, havnet blant «uten navn»)
//
// To feil, én rotårsak hver. Begge er verifisert mot kilden, ikke gjettet.
// ---------------------------------------------------------------------------

test('FEIL 1: spørringen sier `out geom`, ALDRI `out geom tags`', async (t) => {
    // ROTÅRSAKEN, verifisert i Overpass-kildekoden:
    //   map_ql_parser.cc — `out` starter på mode="body"; ordet `tags`
    //     OVERSKRIVER mode til "tags", mens `geom` bare setter geometry.
    //   print.cc:80      — mode "tags" = ID | TAGS. Ingen MEMBERS.
    //   output_json.cc:235 — hele members-blokka er portet på MEMBERS,
    //     mens en WAY sin `geometry` (l. 187) og en NODE sin lat/lon (l. 126)
    //     holder med GEOMETRY.
    // Derfor fikk ways geometri, noden Griser'n koordinater — og relasjonen
    // ingen medlemmer. Denne testen leser den EKTE spørringsteksten.
    const realFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = realFetch; });
    const sendt: string[] = [];
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
        sendt.push(decodeURIComponent(String(init?.body ?? '')));
        return new Response(JSON.stringify({ elements: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;

    const cat = await aking();
    await cat.fetchElements!('Oslo');
    assert.equal(sendt.length, 1);
    assert.match(sendt[0], /out geom;/);
    assert.ok(
        !/out geom tags/.test(sendt[0]),
        'ordet «tags» slår av medlemslista — da kan ingen relasjon forankre noe'
    );
});

test('FEIL 1: en relasjon MED medlemmer forankrer og ekskluderer dem', async () => {
    // Etter rettingen: dette er formen `out geom` faktisk gir.
    const { akingClusters } = await load();
    const { relasjon, segmenter } = korketrekkeren();
    const { anchors } = akingClusters([...segmenter, relasjon]);
    assert.equal(anchors.length, 1);
    assert.equal(`${anchors[0].type}/${anchors[0].id}`, 'relation/1459739');
});

test('FEIL 1: en relasjon UTEN medlemsliste blir fortsatt ankeret', async () => {
    // NØYAKTIG formen tørrkjøringen fikk: tagger og bounds, ingen members.
    // Før rettingen ga den «HOPPET OVER — ingen geometri», og external_id
    // ble en vilkårlig way. Reserveveien forankrer på boksen OG dekker
    // segmentene på navn + punkt-i-boks, så det fortsatt blir ÉN rad.
    const { akingClusters } = await load();
    const { segmenter } = korketrekkeren();
    const utenMedlemmer = {
        type: 'relation' as const,
        id: 1459739,
        tags: { 'piste:type': 'sled', name: 'Korketrekkeren', route: 'piste' },
        bounds: { minlat: 59.969, minlon: 10.679, maxlat: 59.9836, maxlon: 10.6865 },
    };
    const { anchors, rapport } = akingClusters([...segmenter, utenMedlemmer]);
    assert.equal(anchors.length, 1, 'ikke to nåler på samme bakke');
    assert.equal(`${anchors[0].type}/${anchors[0].id}`, 'relation/1459739');
    assert.ok(
        rapport.some((r) => r.includes('bounds (grov)')),
        'rapporten skal si at punktet er grovt'
    );
});

test('FEIL 1: en rute-relasjon er en LINJE — ringsammensying ville kastet den', async () => {
    // Hvorfor akingGeometry IKKE bruker polygonRings/assembleRings, slik
    // Skianlegg gjør: de er skrevet for multipolygoner og forkaster alt som
    // ikke lukker seg. Korketrekkeren er en åpen trasé fra Frognerseteren til
    // Midtstuen.
    const { akingGeometry, polygonRings } = await load();
    const apenTrase = {
        type: 'relation' as const,
        id: 42,
        tags: { 'piste:type': 'sled', name: 'Åpen trasé' },
        members: [
            { type: 'way' as const, ref: 1, geometry: [{ lat: 59.98, lon: 10.68 }, { lat: 59.978, lon: 10.681 }] },
            { type: 'way' as const, ref: 2, geometry: [{ lat: 59.978, lon: 10.681 }, { lat: 59.976, lon: 10.682 }] },
            { type: 'way' as const, ref: 3, geometry: [{ lat: 59.976, lon: 10.682 }, { lat: 59.974, lon: 10.683 }] },
        ],
    };
    assert.deepEqual(polygonRings(apenTrase), [], 'polygonveien forkaster en åpen trasé');
    const geo = akingGeometry([apenTrase]);
    assert.ok(geo, 'punktskyen finnes selv om ringen ikke gjør det');
    assert.equal(geo!.grunnlag, 'medlemsgeometri');
    const alle = apenTrase.members.flatMap((m) => m.geometry);
    assert.ok(
        alle.some((p) => p.lat === geo!.punkt.lat && p.lon === geo!.punkt.lon),
        'punktet skal ligge på traseen'
    );
});

test('FEIL 2: piste:name teller som navn — Sollibakken falt ut på dette', async () => {
    const { akingVerdict, akingClusters } = await load();
    const tags = { 'piste:type': 'sled', 'piste:name': 'Sollibakken' };
    assert.equal(akingVerdict(tags), 'aking');
    const { anchors } = akingClusters([
        { type: 'way', id: 558688673, tags, geometry: [{ lat: 59.95, lon: 10.75 }, { lat: 59.9505, lon: 10.7505 }] },
    ]);
    assert.equal(anchors.length, 1);
});

test('FEIL 2: første BRUKBARE navn vinner, ikke første som finnes', async () => {
    // En akebakke lagt oppå en skogsvei har `name` = veiens navn.
    // «Første som finnes» ville valgt veinavnet, fått det forkastet av
    // isUsablePlaceName som rent gatenavn, og mistet bakken — med
    // piste:name-taggen liggende rett ved siden av.
    const { resolvePlaceName, AKING_NAME_TAGS } = await load();
    assert.deepEqual(
        resolvePlaceName(
            { name: 'Frognerseterveien', 'piste:name': 'Sollibakken' },
            AKING_NAME_TAGS
        ),
        { value: 'Sollibakken', tag: 'piste:name' }
    );
    // … men et brukbart `name` har fortsatt forrang.
    assert.deepEqual(
        resolvePlaceName({ name: 'Sollibakken', 'piste:name': 'Nedre løype' }, AKING_NAME_TAGS),
        { value: 'Sollibakken', tag: 'name' }
    );
});

test('FEIL 2: grupperingen leser SAMME kjede som tittelen', async () => {
    // Ellers ville segmentet med piste:name fått tom nøkkel og gruppert seg
    // med hvilket som helst annet navnløst objekt i nærheten.
    const { akingClusters } = await load();
    const { anchors } = akingClusters([
        segment(1, 'Akebakken', 59.95, 10.75),
        {
            type: 'way',
            id: 2,
            tags: { 'piste:type': 'sled', 'piste:name': 'Akebakken' },
            geometry: [{ lat: 59.9505, lon: 10.7505 }, { lat: 59.951, lon: 10.751 }],
        },
    ]);
    assert.equal(anchors.length, 1, 'samme navn fra to tagger er samme bakke');
});

test('FEIL 2: mekanismen er opt-in — ingen annen kategori leser piste:name', async () => {
    // Sjekket, ikke antatt: før sep. 2026 leste buildRows `tags.name` fire
    // steder og ingenting annet. En GLOBAL fallback-kjede ville stille endret
    // titlene på alle ~7800 eksisterende radene ved neste import.
    const { PLACE_CATEGORIES } = await load();
    const medNameTags = PLACE_CATEGORIES.filter((c) => c.nameTags).map((c) => c.key);
    assert.deepEqual(medNameTags, ['aking']);
});

test('FEIL 2: default-kjeden oppfører seg bit for bit som før', async () => {
    const { resolvePlaceName } = await load();
    assert.deepEqual(resolvePlaceName({ name: 'Sofienbergparken' }), {
        value: 'Sofienbergparken',
        tag: 'name',
    });
    // Ubrukelig navn gir null — samme utfall som isUsablePlaceName ga før.
    assert.equal(resolvePlaceName({ name: 'Håkavikveien' }), null);
    assert.equal(resolvePlaceName({}), null);
    // … og uten kategoriens liste ser den ALDRI piste:name.
    assert.equal(resolvePlaceName({ 'piste:name': 'Sollibakken' }), null);
});

test('buildRows setter venue_name fra piste:name', async () => {
    // Ende til ende: navnet må gå hele veien til raden, ikke bare til
    // grupperingen. Et brukbart navn kortslutter geokodingen, så ingen
    // nettverkskall skjer her.
    const { buildRows, PLACE_CATEGORIES } = await load();
    const cat = PLACE_CATEGORIES.find((c) => c.key === 'aking')!;
    const rows = await buildRows(
        'Oslo',
        [
            {
                type: 'way',
                id: 558688673,
                tags: { 'piste:type': 'sled', 'piste:name': 'Sollibakken' },
                center: { lat: 59.95, lon: 10.75 },
                akingVerified: true,
            },
        ],
        50,
        [cat]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Sollibakken');
    assert.equal(rows[0].venue_name, 'Sollibakken');
    assert.equal(rows[0].titleSource, 'osm-navn');
    assert.equal(rows[0].nameTag, 'piste:name');
    // Rå tagger er urørt: ingen syntetisk `name` er skrevet inn i osm_tags.
    assert.equal(rows[0].osm_tags.name, undefined);
});

// ---------------------------------------------------------------------------
// Kartpunktet: advarsel i stedet for stillhet
// ---------------------------------------------------------------------------

test('bakker over terskelen merkes UPÅLITELIG i rapporten', async () => {
    // Akebakken (950 m) og Korketrekkeren (1240 m) er nettopp de to der nåla
    // står midt i løypa i stedet for der man starter.
    const { akingClusters, AKING_DIAGONAL_WARN_M } = await load();
    assert.equal(AKING_DIAGONAL_WARN_M, 500);
    const { rapport } = akingClusters([
        // To segmenter 557 m fra hverandre: innenfor grupperingstaket
        // (1000 m), men med en samlet diagonal på ~670 m.
        segment(1, 'Lang bakke', 59.95, 10.75),
        segment(2, 'Lang bakke', 59.9555, 10.75),
        // ~80 m diagonal
        segment(3, 'Kort bakke', 59.93, 10.74),
    ]);
    const lang = rapport.find((r) => r.includes('Lang bakke'))!;
    const kort = rapport.find((r) => r.includes('Kort bakke'))!;
    assert.match(lang, /UPÅLITELIG KARTPUNKT/);
    assert.ok(!/UPÅLITELIG/.test(kort), 'en vanlig akebakke skal ikke merkes');
    assert.ok(
        rapport.some((r) => r.includes('1 av 2')),
        'oppsummeringslinja skal si hvor mange rader som er upålitelige'
    );
});

test('rapporten sier hvilken tagg navnet kom fra', async () => {
    const { akingClusters } = await load();
    const { rapport } = akingClusters([
        {
            type: 'way',
            id: 558688673,
            tags: { 'piste:type': 'sled', 'piste:name': 'Sollibakken' },
            geometry: [{ lat: 59.95, lon: 10.75 }, { lat: 59.9501, lon: 10.7501 }],
        },
    ]);
    assert.match(rapport[0], /navn fra piste:name/);
});
