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
    assert.equal(domTelling.aking, 15, 'alle 15 objektene er gyldige — de slås sammen');
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
