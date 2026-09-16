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
    /** Rader kjøringen ville skrevet. Resultatet av VÅR gruppering. */
    rader: number;
    /**
     * OBJEKTER hentet fra OSM, i settet [forventetSett] navngir. `null` når
     * kategorien ikke har en nasjonal forventning, eller når hentesteget ble
     * gjenopptatt fra en .import-work uten settelling.
     *
     * DET ER DENNE KOLONNEN «andel» REGNES PÅ. Fram til okt. 2026 sto rader
     * der, mot en forventning i objekter: aking ga «13 rader mot 89 forventet
     * (15 %)» og stanset kjøringen, mens 13 og 89 talte helt ulike ting.
     */
    objekter: number | null;
    /** Nasjonalt OBJEKTtall × andelen av planen kjøringen dekker. null = ikke målt. */
    forventet: number | null;
    /** Taggen forventningen ble talt på, f.eks. `piste:type=sled`. */
    forventetTag: string | null;
    /** Hentesettet objektene telles i, f.eks. `omrade`. */
    forventetSett: string | null;
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
    /** Kategorier utbyttevakten ikke fikk vurdert. Se [hoppetOverIUtbytte]. */
    utbytteHoppet: readonly string[];
    geokoding: { forsok: number; feil: number };
    overpass: { sporringer: number; medOmkamp: number };
    tommeSett: readonly string[];
    claims: { undertrykt: number; navneavvik: number };
    duplikatkandidater: readonly DupPar[];
    /** Rader med delt GENERERT tittel nær hverandre. Se [generatedTitleCollisions]. */
    delteGenererteTitler: readonly DupPar[];
    dom: 'GO' | 'STOPP';
    stoppGrunn?: string;
    skrivKommando: string;
    naa: string;
}

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—');

/** «151 par mellom 96 rader» — begge tallene, fordi det ene ikke gir det andre. */
const parTall = (par: readonly DupPar[]): string =>
    par.length === 0 ? '0' : `${par.length} par mellom ${beroerteRader(par)} rader`;

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
    // TO ENHETER, OG KOLONNENE SIER HVILKEN. «andel» regnes på objekter mot
    // objekter; radkolonnen står ved siden av UTEN forholdstall, fordi det
    // ikke finnes et anker å dele på — se [NasjonalForventning].
    L.push('  kategori        objekter   forventet   andel      rader   uten ekte navn');
    for (const k of i.kategorier) {
        const har = k.objekter !== null && k.forventet !== null;
        L.push(
            `  ${k.key.padEnd(14)}${(k.objekter === null ? '—' : String(k.objekter)).padStart(9)}` +
                `${(k.forventet === null ? '—' : String(Math.round(k.forventet))).padStart(12)}` +
                `${(har ? pct(k.objekter!, k.forventet!) : '—').padStart(8)}` +
                `${String(k.rader).padStart(11)}` +
                `${String(k.utenNavn).padStart(17)}`
        );
    }
    const grunnlag = i.kategorier.filter((k) => k.forventetTag && k.objekter !== null);
    if (grunnlag.length) {
        L.push(
            '  (forventning = objekter i Geofabrik-fila: ' +
                grunnlag.map((k) => `${k.key} ${k.forventetTag} i «${k.forventetSett}»`).join(', ') +
                ')'
        );
    }
    if (i.utbytteHoppet.length) {
        L.push(
            `  UTBYTTESJEKKEN HOPPET OVER ${i.utbytteHoppet.join(', ')} — hentesteget mangler` +
                `  ADVARSEL`
        );
        L.push(
            '      settellingen. Det skjer med en .import-work skrevet før okt. 2026.'
        );
        L.push('      Kjør uten --resume, eller med en tom --work, for å få vakten tilbake.');
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
    // PAR, IKKE RADER. Sep. 2026 ble denne linja lest som et radtall: «151 med
    // delt generert tittel» mot 13 rader uten gatetreff i tittelkilde-linja over,
    // og 13 ≠ 151 så ut som et avvik. Det var det ikke — en gruppe på n rader med
    // samme tittel gir C(n,2) par, så 17 rader alene gir 136. Begge tallene står
    // nå, og ordet «par» med dem.
    L.push(
        `  Duplikatkandidater ..... ${parTall(i.duplikatkandidater)}` +
            `  (+ ${parTall(i.delteGenererteTitler)} med delt GENERERT tittel)` +
            (i.delteGenererteTitler.length ? '  ADVARSEL' : '')
    );
    for (const d of i.delteGenererteTitler.slice(0, 5)) L.push(`      ${formatDupPar(d)}`);
    for (const d of i.duplikatkandidater.slice(0, 10)) L.push(`      ${formatDupPar(d)}`);
    if (i.duplikatkandidater.length > 10) {
        L.push(`      ... og ${i.duplikatkandidater.length - 10} par til`);
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
    return generatedTitlePairs(rader, meters).map(formatDupPar);
}

/**
 * ET PAR, IKKE EN RAD. Tellerne under er kvadratiske i gruppestørrelsen: n
 * rader med samme tittel gir n·(n−1)/2 par. Det er med vilje — hvert par er en
 * egen avgjørelse for mennesket som leser rapporten — men det gjør tallet
 * ubrukelig som mål på hvor mange steder som er berørt. Derfor [beroerteRader].
 */
export interface DupPar {
    kategori: string;
    /** Den delte tittelen, slik den står på a. */
    title: string;
    a: string;
    b: string;
    meters: number;
}

export function formatDupPar(p: DupPar): string {
    return (
        `${p.kategori} «${p.title}»: ${p.a} og ${p.b}, ` +
        `${Math.round(p.meters)} m fra hverandre`
    );
}

/** Hvor mange DISTINKTE rader parene dekker. Se [DupPar]. */
export function beroerteRader(par: readonly DupPar[]): number {
    const ider = new Set<string>();
    for (const p of par) {
        ider.add(p.a);
        ider.add(p.b);
    }
    return ider.size;
}

/**
 * POPULASJONEN ER ALLE GENERERTE TITLER, ikke bare de som endte på bare
 * kategorien. `osmNavn: false` dekker «ved gate», «i område», «i poststed» og
 * «kun kategori» under ett, og «ved gate» er normalt over 95 % av dem. En
 * tørrkjøring som viser 8 rader med «kun kategori» kan derfor fint gi hundrevis
 * av par her; tallene måler ikke det samme.
 */
export function generatedTitlePairs(rader: readonly DupRad[], meters = 2000): DupPar[] {
    return duplicatePairs(
        rader.filter((r) => !r.osmNavn).map((r) => ({ ...r, osmNavn: true })),
        meters
    );
}

export function duplicateCandidates(rader: readonly DupRad[], meters = 5000): string[] {
    return duplicatePairs(rader, meters).map(formatDupPar);
}

export function duplicatePairs(rader: readonly DupRad[], meters = 5000): DupPar[] {
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
    const ut: DupPar[] = [];
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
                    ut.push({
                        kategori,
                        title: a.title,
                        a: a.external_id,
                        b: b.external_id,
                        meters: d,
                    });
                }
            }
        }
    }
    return ut;
}
