// lib/import-approval.ts
//
// GODKJENNINGEN: oppsummeringen Frederik sier ja eller nei til, og
// fingeravtrykket som binder «ja» til NØYAKTIG de radene.
//
// Signalet lå tidligere spredt i tusenvis av logglinjer. For én by går det an
// å lese dem; for en nasjonal kjøring gjør det ikke det, og da blir «ja» i
// praksis et ja til noe ingen har sett.
//
// Alt her er rene funksjoner over tall kjøringen allerede har. Formatet er
// bygget rundt de tre linjene som betyr mest:
//
//   NYE vs. OPPDATERER   — en upsert som oppdaterer 300 eksisterende rader er
//                          noe helt annet enn en som setter inn 300.
//   ANDEL MOT FORVENTET  — 103 % er beroligende, 41 % er et stopp.
//   FINGERAVTRYKKET      — det som gjør at ja betyr ja til DISSE radene.
import { distanceMeters } from './geo-polygon';
import { fingerprint } from './import-chunks';

export interface KategoriLinje {
    key: string;
    rader: number;
    /** Nasjonalt tall × andelen av planen kjøringen dekker. null = ikke målt. */
    forventet: number | null;
    /** Rader som ikke fikk et ekte OSM-navn som tittel. */
    utenNavn: number;
}

export interface ForhandsDiff {
    /** external_id-er i kjøringen som IKKE finnes i basen fra før. */
    nye: number;
    /** …som finnes fra før og blir OPPDATERT. */
    oppdaterer: number;
}

export interface GodkjenningsInput {
    /** Fingeravtrykket som må oppgis til --approve. */
    fingerprint: string;
    chunks: number;
    raderTotalt: number;
    /** null = ingen databasetilgang, altså ukjent. Ikke null = målt. */
    diff: ForhandsDiff | null;
    kategorier: KategoriLinje[];
    geokoding: { forsok: number; feil: number };
    overpass: { sporringer: number; medOmkamp: number };
    tommeSett: readonly string[];
    claims: { undertrykt: number; navneavvik: number };
    duplikatkandidater: readonly string[];
    /** Rader med delt GENERERT tittel nær hverandre. Se [generatedTitleCollisions]. */
    delteGenererteTitler: readonly string[];
    dom: 'GO' | 'STOPP';
    stoppGrunn?: string;
    skrivKommando: string;
    naa: string;
}

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—');

/**
 * Oppsummeringen, som ren tekst. Skal kunne leses på et minutt.
 *
 * Bevisst KORT: alt som ikke kan endre et ja til et nei, hører hjemme i
 * kjøringens logg og ikke her.
 */
export function formatApproval(i: GodkjenningsInput): string {
    const L: string[] = [];
    L.push('');
    L.push('='.repeat(72));
    L.push(`GODKJENNING  ${i.fingerprint}   ${i.chunks} chunk(s)   ${i.naa}`);
    L.push('');
    L.push(`  DOM: ${i.dom}${i.stoppGrunn ? `  — ${i.stoppGrunn}` : ''}`);
    L.push(
        `  RADER: ${i.raderTotalt}` +
            (i.diff
                ? `   (nye ${i.diff.nye}, oppdaterer ${i.diff.oppdaterer})`
                : '   (nye/oppdaterer: UKJENT — ingen databasetilgang)')
    );
    L.push('');
    L.push('  kategori        rader   forventet   andel   uten ekte navn');
    for (const k of i.kategorier) {
        L.push(
            `  ${k.key.padEnd(14)}${String(k.rader).padStart(6)}` +
                `${(k.forventet === null ? '—' : String(Math.round(k.forventet))).padStart(12)}` +
                `${(k.forventet === null ? '—' : pct(k.rader, k.forventet)).padStart(8)}` +
                `${String(k.utenNavn).padStart(17)}`
        );
    }
    L.push('');
    L.push(
        `  Geokodingsfeil ......... ${i.geokoding.feil} av ${i.geokoding.forsok} forsøk` +
            (i.geokoding.forsok ? ` (${pct(i.geokoding.feil, i.geokoding.forsok)})` : '')
    );
    L.push(
        `  Overpass-omkamper ...... ${i.overpass.medOmkamp} av ${i.overpass.sporringer} spørringer` +
            (i.overpass.medOmkamp ? '  ADVARSEL' : '')
    );
    L.push(`  Bekreftet tomme sett ... ${i.tommeSett.length}`);
    L.push(
        `  Claims ................. ${i.claims.undertrykt} objekter undertrykt, ` +
            `${i.claims.navneavvik} navneavvik${i.claims.navneavvik ? '  ADVARSEL' : ''}`
    );
    L.push(
        `  Duplikatkandidater ..... ${i.duplikatkandidater.length}` +
            `  (+ ${i.delteGenererteTitler.length} med delt GENERERT tittel)` +
            (i.delteGenererteTitler.length ? '  ADVARSEL' : '')
    );
    for (const d of i.delteGenererteTitler.slice(0, 5)) L.push(`      ${d}`);
    for (const d of i.duplikatkandidater.slice(0, 10)) L.push(`      ${d}`);
    if (i.duplikatkandidater.length > 10) {
        L.push(`      ... og ${i.duplikatkandidater.length - 10} til`);
    }
    L.push('');
    if (i.dom === 'GO') {
        L.push('  SKRIV:');
        L.push(`    ${i.skrivKommando}`);
    } else {
        L.push('  INGEN SKRIVEKOMMANDO — rett det som stoppet kjøringen først.');
    }
    L.push('='.repeat(72));
    return L.join('\n');
}

/**
 * FINGERAVTRYKKET FOR EN HEL BOLK: hash over (chunk, berikelsens
 * fingeravtrykk) for alle chunkene i planen.
 *
 * Det er dette som gjør at «ja» betyr ja til DISSE radene. Endres en
 * selektor, en kategoriliste, --limit eller claim-lista mellom godkjenningen
 * og skrivingen, endres berikelsens fingeravtrykk, og dermed dette — og
 * skrivingen nekter.
 *
 * SORTERT PÅ CHUNK-ID, så rekkefølgen på --city ikke gir et annet
 * fingeravtrykk for de samme radene.
 *
 * Mangler en chunk sitt berikelsessteg, finnes det ikke noe å godkjenne, og
 * funksjonen returnerer null framfor å hashe et hull.
 */
export function batchFingerprint(
    chunkIds: readonly string[],
    enrichFingerprintFor: (chunkId: string) => string | undefined
): string | null {
    const deler: [string, string][] = [];
    for (const id of [...chunkIds].sort()) {
        const fp = enrichFingerprintFor(id);
        if (!fp) return null;
        deler.push([id, fp]);
    }
    if (!deler.length) return null;
    return fingerprint({ v: 1, bolk: deler });
}

export interface DupRad {
    external_id: string;
    category: string;
    title: string;
    lat: number;
    lng: number;
    /** Kun rader med ekte OSM-navn sammenlignes — se under. */
    osmNavn: boolean;
}

/**
 * KLYNGE-DUPLIKATER OVER CHUNK-GRENSER.
 *
 * Aking og Skianlegg forankrer en klynge på ett VALGT objekt. Deles klyngen av
 * en områdegrense, velges ulike ankere på hver side, og upserten fanger det
 * ikke: to `external_id`, ett fysisk sted.
 *
 * Kandidat = samme kategori, samme tittel, ulik external_id, innenfor
 * [meters].
 *
 * KUN RADER MED EKTE OSM-NAVN. Genererte titler («Lekeplass ved Storgata»)
 * ville gitt støy uten innhold: to lekeplasser ved samme gate er to
 * lekeplasser, ikke ett duplikat.
 *
 * Dette er en RAPPORTLINJE, ikke et stoppvilkår. Den kan bare regnes ut når
 * alle chunkene er beriket, og den krever et menneske til å avgjøre om to
 * «Solbakken» er ett anlegg eller to.
 *
 * MERK at den er unødvendig for én nasjonal chunk: uten en områdegrense kan
 * en klynge ikke deles. Den finnes for planer med mange chunks.
 */
/**
 * DELT GENERERT TITTEL — den andre halvdelen av duplikatbildet.
 *
 * [duplicateCandidates] sammenligner bare rader med EKTE OSM-navn, med vilje:
 * to «Lekeplass ved Storgata» er to lekeplasser. Den første nasjonale
 * tørrkjøringen (sep. 2026) viste at den regelen har en blindsone.
 *
 * way/55097596, 55097597 og 55097598 het alle «Skianlegg i Fageråsen». Det er
 * IKKE et OSM-navn — det er tre NAVNLØSE polygoner som alle fikk samme
 * områdenavn fra Nominatim. duplicateCandidates så dem ikke, og tre rader for
 * det som trolig er ett anlegg gikk rett gjennom.
 *
 * Derfor en egen teller, og et STRAMMERE avstandstak: et generert områdenavn
 * gjentar seg legitimt over en hel bygd, så 2 km er grensen der «samme navn og
 * nesten samme sted» begynner å bety noe.
 *
 * FORTSATT BARE EN RAPPORTLINJE. Om tre polygoner i Fageråsen er ett anlegg
 * eller tre er et spørsmål om OSM-modellering, ikke noe en terskel kan avgjøre.
 */
export function generatedTitleCollisions(
    rader: readonly DupRad[],
    meters = 2000
): string[] {
    return duplicateCandidates(
        rader.filter((r) => !r.osmNavn).map((r) => ({ ...r, osmNavn: true })),
        meters
    );
}

export function duplicateCandidates(rader: readonly DupRad[], meters = 5000): string[] {
    const perKategori = new Map<string, Map<string, DupRad[]>>();
    for (const r of rader) {
        if (!r.osmNavn) continue;
        let perNavn = perKategori.get(r.category);
        if (!perNavn) perKategori.set(r.category, (perNavn = new Map()));
        const navn = r.title.trim().toLowerCase();
        const liste = perNavn.get(navn);
        if (liste) liste.push(r);
        else perNavn.set(navn, [r]);
    }
    const ut: string[] = [];
    for (const kategori of [...perKategori.keys()].sort()) {
        const perNavn = perKategori.get(kategori)!;
        for (const navn of [...perNavn.keys()].sort()) {
            const liste = perNavn.get(navn)!;
            if (liste.length < 2) continue;
            for (let i = 0; i < liste.length; i++) {
                for (let j = i + 1; j < liste.length; j++) {
                    const a = liste[i];
                    const b = liste[j];
                    if (a.external_id === b.external_id) continue;
                    const d = distanceMeters(
                        { lat: a.lat, lon: a.lng },
                        { lat: b.lat, lon: b.lng }
                    );
                    if (d > meters) continue;
                    ut.push(
                        `${kategori} «${a.title}»: ${a.external_id} og ${b.external_id}, ` +
                            `${Math.round(d)} m fra hverandre`
                    );
                }
            }
        }
    }
    return ut;
}
