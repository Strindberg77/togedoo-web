// scripts/piste-filter.test.ts
// VAKTEN over verdifilteret på bevisspørringen.
//
// nwr["piste:type"] uten verdifilter hentet alle 47 988 langrennssegmentene
// nasjonalt, med out geom, for verdier ingen leser. Filteret kutter settet til
// ~3 240 (3 108 utforløyper + 89 akebakker + 43 skileik) — og gjør dermed en
// nasjonal kjøring mulig i det hele tatt.
//
// FAREN VED ET SLIKT FILTER: leser noen senere en ny piste:type-verdi uten å
// utvide filteret, hentes objektene aldri, og fasetten forsvinner i stillhet.
// Ingen test ville feilet, ingen logg ville sagt fra — rapporten ville bare
// vist «0».
//
// Testen under PRØVER hver dokumenterte piste:type-verdi mot de ekte leserne
// og krever at enhver verdi som utløser en reaksjon står i filteret.
//
// Ingen nettverk. Kjør: node --import tsx --test scripts/piste-filter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PLACES_OVERPASS_BACKOFF_MS = '0';
process.env.PLACES_OVERPASS_ENDPOINTS = 'https://speil-a.test/api';

const load = () => import('./import-places');

/**
 * Verdiene piste:type kan ha i OSM, etter skjemaet. Lista trenger ikke være
 * komplett for at vakten skal virke — den må bare inneholde de verdiene noen
 * kunne finne på å lese. Kommer en ny verdi i OSM som en leser bryr seg om,
 * legges den til her OG i READ_PISTE_TYPES.
 */
const ALLE_PISTE_TYPES = [
    'downhill',
    'nordic',
    'skitour',
    'sled',
    'hike',
    'sleigh',
    'ice_skate',
    'snow_park',
    'playground',
    'connection',
    'ski_jump',
    'fatbike',
];

test('HVER verdi en leser reagerer på står i filteret', async () => {
    // Selve vakten. Prøver de ekte funksjonene, ikke en kopi av reglene.
    const { READ_PISTE_TYPES, osmFacetTokens, hasDownhillPiste, skiVerdict, akingVerdict } =
        await load();
    const filtrert = new Set<string>(READ_PISTE_TYPES);

    for (const verdi of ALLE_PISTE_TYPES) {
        const tags = { 'piste:type': verdi };
        const reaksjoner: string[] = [];
        if (osmFacetTokens(tags).length) reaksjoner.push('osmFacetTokens');
        if (hasDownhillPiste([tags])) reaksjoner.push('hasDownhillPiste');
        if (skiVerdict(tags, []) !== 'ikke-alpint') reaksjoner.push('skiVerdict');
        if (akingVerdict({ ...tags, name: 'Testbakken' }) === 'aking') {
            reaksjoner.push('akingVerdict');
        }
        if (reaksjoner.length) {
            assert.ok(
                filtrert.has(verdi),
                `«${verdi}» leses av ${reaksjoner.join(', ')}, men slippes ikke gjennom ` +
                    `av bevisfilteret. Legg den til i READ_PISTE_TYPES — ellers hentes ` +
                    `objektene aldri, og fasetten forsvinner i stillhet.`
            );
        }
    }
});

test('ingen verdi i filteret er død — alle leses av noen', async () => {
    // Motsatt retning: en verdi som ingen leser skal ikke hentes. Det var
    // nettopp det nordic gjorde.
    const { READ_PISTE_TYPES, osmFacetTokens, hasDownhillPiste } = await load();
    for (const verdi of READ_PISTE_TYPES) {
        const tags = { 'piste:type': verdi };
        const lest = osmFacetTokens(tags).length > 0 || hasDownhillPiste([tags]);
        assert.ok(lest, `«${verdi}» hentes, men leses ikke av noen — fjern den`);
    }
});

test('nordic leses ikke, og hentes ikke', async () => {
    // 47 988 segmenter nasjonalt. Den dyreste enkeltposten i hele importen,
    // for null informasjon.
    const { READ_PISTE_TYPES, osmFacetTokens, hasDownhillPiste, skiVerdict } = await load();
    const nordic = { 'piste:type': 'nordic' };
    assert.deepEqual(osmFacetTokens(nordic), []);
    assert.equal(hasDownhillPiste([nordic]), false);
    assert.equal(skiVerdict(nordic, []), 'ikke-alpint');
    assert.ok(!(READ_PISTE_TYPES as readonly string[]).includes('nordic'));
});

test('selektoren bygges AV lista, ikke ved siden av den', async () => {
    // Uten dette kunne lista og spørringen komme i utakt uten at noe feilet.
    const { READ_PISTE_TYPES, SKI_EVIDENCE_SELECTOR } = await load();
    assert.match(
        SKI_EVIDENCE_SELECTOR,
        new RegExp(`"piste:type"~"${READ_PISTE_TYPES.join('\\\\|')}"`)
    );
});

test('filteret er understreng, ikke ankret — semikolonlister må slippe gjennom', async () => {
    // «downhill;sled» finnes i dataene (to objekter nasjonalt). Et ankret
    // ^(...)$ ville forkastet dem, og da ville et kombinert anlegg mistet
    // beviset sitt.
    const { SKI_EVIDENCE_SELECTOR } = await load();
    const linje = SKI_EVIDENCE_SELECTOR.split('\n').find((l) => l.includes('piste:type'))!;
    assert.ok(!linje.includes('^('), 'ankring ville forkastet «nordic;downhill»');
    // Etterlikner Overpass sin understreng-matching mot de ekte verdiene.
    const re = new RegExp('downhill|sled|playground');
    for (const v of ['downhill', 'downhill;sled', 'nordic;downhill', 'sled', 'playground']) {
        assert.ok(re.test(v), `${v} må slippe gjennom`);
    }
    for (const v of ['nordic', 'skitour', 'hike', 'ice_skate']) {
        assert.ok(!re.test(v), `${v} skal ikke hentes`);
    }
});

test('heis- og mtb-linjene er urørt', async () => {
    // Filteret gjelder piste:type alene. Heistesten leser aerialway, og
    // mtb-fasettene leser mtb:type og route=mtb.
    const { SKI_EVIDENCE_SELECTOR } = await load();
    assert.match(SKI_EVIDENCE_SELECTOR, /"aerialway"~"\^\(/);
    assert.match(SKI_EVIDENCE_SELECTOR, /nwr\["mtb:type"\]/);
    assert.match(SKI_EVIDENCE_SELECTOR, /nwr\["route"="mtb"\]/);
});
