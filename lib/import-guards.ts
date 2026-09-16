// lib/import-guards.ts
//
// STOPPVILKÅRENE: hva som skal avbryte en kjøring UTEN at noen ber om det.
//
// Fram til sep. 2026 stoppet bare to ting av seg selv — en rad uten by-anker
// (kaster) og en chunk-feil (isoleres til den chunken). Alt annet var en
// loggmelding. For én by er det nok: utskriften leses. For en nasjonal
// kjøring over natta er det ikke nok, og en systematisk feil rekker å skrive
// tusenvis av rader.
//
// Alle tersklene her er RENE FUNKSJONER over tall kjøringen allerede har.
// Ingen av dem trenger nettverk, og alle kan testes.
//
// TERSKLENE ER VALGT, IKKE MÅLT. Det står ved hver enkelt, og det er ikke en
// unnskyldning — det er informasjon til den som en dag ser en falsk positiv og
// skal vite om tallet er hellig.

/**
 * Avbryter HELE kjøringen, ikke bare chunken.
 *
 * Skillet er viktig: [importCity] fanger en vanlig feil og går videre til
 * neste chunk, fordi en Overpass-504 for Trondheim ikke skal stanse Bergen.
 * En ImportStop er av en annen art — den betyr at noe er galt med KJØRINGEN,
 * og da ville de neste 300 chunkene gjort samme feil 300 ganger.
 */
export class ImportStop extends Error {
    constructor(
        readonly vilkaar: string,
        message: string
    ) {
        super(message);
        this.name = 'ImportStop';
    }
}

// ---------------------------------------------------------------------------
// 1) CLAIM-NAVNEAVVIK
// ---------------------------------------------------------------------------

/**
 * Terskelen er ÉN. Ikke et forhold, ikke et vindu.
 *
 * En claim som peker på feil OSM-objekt gjør to ting samtidig, og begge er
 * stille: den undertrykker et sted som skulle vært importert, og den lar
 * stedet claimen EGENTLIG gjaldt bli importert som duplikat ved siden av den
 * kuraterte raden. Ingen upsert fanger noen av delene.
 *
 * Det er heller ingen grunn til å vente på flere: et navneavvik er en feil i
 * lib/osm-claims.ts, ikke i dataene, og den gjentar seg i hver chunk.
 */
export function claimMismatchStop(
    osmId: string,
    osmName: string | undefined,
    ventet: readonly (string | null)[]
): ImportStop {
    return new ImportStop(
        'claim-navneavvik',
        `Claimen på ${osmId} ventet «${ventet.map((n) => n ?? '(uten navn)').join('» / «')}», ` +
            `men OSM sier «${osmName ?? '(uten navn)'}». En claim med feil id undertrykker FEIL ` +
            `sted OG slipper det rette gjennom som duplikat. Rett lib/osm-claims.ts før du ` +
            `kjører videre.`
    );
}

// ---------------------------------------------------------------------------
// 2) GEOKODINGSFEIL
// ---------------------------------------------------------------------------

/**
 * Andel mislykkede revers-oppslag som stopper kjøringen.
 *
 * **0,20 er VALGT, IKKE MÅLT.** Ingen har talt hva en normal kjøring gir.
 * Tallet skal kalibreres første gang en full nasjonal tørrkjøring finnes —
 * inntil da er det et forsiktig anslag, ikke en observasjon.
 *
 * Hvorfor det likevel må stå der: en rad som fikk tittelen «Lekeplass» fordi
 * Kartverket var nede, blir ikke bedre neste kjøring. Importen skriver samme
 * dårlige tittel igjen, og upserten angrer ingenting. Det er en av de få
 * feilene i denne rørledningen som faktisk fester seg.
 *
 * TERSKELEN ER KALIBRERT FOR BYKATEGORIER, og det er verdt å vite når den
 * slår ut: for et alpinanlegg i fjellet er adresseløshet normalen, ikke et
 * symptom. Den første nasjonale tørrkjøringen stanset på nettopp den
 * forvekslingen. Rettingen var å telle riktig ting, ikke å heve terskelen.
 */
export const GEOCODE_FAILURE_THRESHOLD = 0.2;

/**
 * Minste antall FORSØK før andelen betyr noe.
 *
 * Uten et gulv ville en chunk med tre navnløse steder og ett feilet oppslag
 * gitt 33 % og stanset kjøringen. Ti er valgt fordi det er det minste tallet
 * der 20 % ikke kan utløses av én enkelt hendelse.
 */
export const GEOCODE_MIN_SAMPLE = 10;

export interface GeocodeTelling {
    /** Rader som faktisk forsøkte et oppslag (manglet brukbart OSM-navn). */
    forsok: number;
    /**
     * Av dem: EKTE oppslagsfeil — tjenesten svarte ikke.
     *
     * «Fant ingen adresse» hører IKKE hjemme her, og det var feilen i den
     * første nasjonale tørrkjøringen (sep. 2026): 51 av 157 ble talt som feil
     * mens alle 51 var Kartverket som svarte korrekt at det ikke finnes en
     * adresse innen 200 m. Skillet håndheves nå av [GeocodeFailureKind] i
     * lib/places.ts, og teller bare `kind: 'feil'`.
     */
    feil: number;
}

export function geocodeFailureStop(
    chunkLabel: string,
    t: GeocodeTelling
): ImportStop | null {
    if (t.forsok < GEOCODE_MIN_SAMPLE) return null;
    const andel = t.feil / t.forsok;
    if (andel <= GEOCODE_FAILURE_THRESHOLD) return null;
    return new ImportStop(
        'geokodingsfeil',
        `${chunkLabel}: ${t.feil} av ${t.forsok} revers-oppslag feilet ` +
            `(${Math.round(andel * 100)} %, terskel ${Math.round(GEOCODE_FAILURE_THRESHOLD * 100)} %). ` +
            `Kartverket er trolig nede eller rategrenser. Rader som får tittelen «Lekeplass» ` +
            `nå, blir ikke bedre neste kjøring — upserten skriver samme tittel igjen.`
    );
}

// ---------------------------------------------------------------------------
// 3) UTBYTTEKOLLAPS
// ---------------------------------------------------------------------------

/**
 * NASJONALE OBJEKTTALL per kategori, målt med osmium mot Geofabrik-fila
 * (sep. 2026).
 *
 * ENHETEN ER OBJEKTER, OG DET ER HELE POENGET MED DENNE TYPEN.
 *
 * Fram til okt. 2026 var dette et `Record<string, number>`, og
 * [yieldCollapseStop] sammenlignet tallene med ANTALL RADER. De to er ikke
 * samme størrelse, og for aking er de ikke engang samme størrelsesorden:
 *
 *   aking       13 rader mot 89 «forventet» → 15 % → STOPP
 *   skianlegg  307 rader mot 254 «forventet» → 121 %
 *
 * Begge er meningsløse. 89 er `piste:type=sled`-OBJEKTER; 13 er BAKKER etter
 * relasjonsforankring og navnegruppering — Korketrekkeren alene er 14 objekter
 * som blir 1 rad. Og 254 er bare `landuse=winter_sports`, mens selektoren
 * dekker seks mønstre og hentet 423 objekter.
 *
 * En tallverdi kan ikke bære enheten sin. Derfor er den nå et objekt som sier
 * HVA som er talt og HVOR det skal telles, og vakten teller samme sted.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FORHOLDET MELLOM OBJEKT OG RAD ER VÅRT, IKKE OSM SITT
 *
 * Objekter kommer fra OSM og kan telles utenfor koden vår. Rader er resultatet
 * av grupperingen, forankringen, dedupen og claims — regler vi selv endrer.
 * Et radtall som «fasit» ville altså blitt feil av at VI forbedret noe, og det
 * er nøyaktig den vakten man slutter å tro på.
 *
 * Derfor: vakten stopper på OBJEKTER. Radene rapporteres ved siden av, uten et
 * forholdstall, fordi det ikke finnes et tall å dele på.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TALLET ER ET GULV, IKKE ET ANSLAG. Det teller ÉN tagg, mens selektorene
 * gjerne dekker flere mønstre. `skianlegg` har seks; `ballbane` siler i tillegg
 * på sport og access, så der ligger det an til å bli et tak i praksis. Ingen av
 * delene betyr noe så lenge terskelen er 20 %: sjekken skal fange en selektor
 * som har sluttet å treffe, ikke et unøyaktig anslag.
 *
 * ANKERET er Geofabrik-uttrekket og osmium — ikke en kjøring. Tallene kan
 * regnes ut på nytt offline, deterministisk, uten å røre Overpass, og de er
 * uavhengige av alt vi selv gjør med dataene etterpå. Det er den egenskapen
 * som gjør dem brukbare som fasit; et radtall fra én kjøring har den ikke.
 *
 * Kategorier UTEN en oppføring hoppes over. `rullesport` og `klatring` er ikke
 * målt nasjonalt; å gjette et tall for dem ville gjort vakten til en
 * tilfeldighetsgenerator.
 */
export interface NasjonalForventning {
    /** Objekter i Geofabrik-fila med taggen under. */
    readonly objekter: number;
    /** Taggen som FAKTISK ble talt. Ikke hele selektoren. */
    readonly tag: string;
    /**
     * Hentesettet objektene skal telles i, som `<kategori>/<sett>` heter i
     * manifestet uten kategoridelen.
     *
     * DETTE FELTET ER IKKE PYNT. `skianlegg` henter to sett: `omrade` (423
     * objekter, blir rader) og `bevis` (4 536 objekter, blir ALDRI rader — de
     * er inndata til den romlige testen). Summerte vakten begge, ville
     * forholdstallet vært 1 952 % og sjekken ubrukelig for alltid.
     */
    readonly sett: string;
}

export const NATIONAL_EXPECTATION: Readonly<Record<string, NasjonalForventning>> = {
    ballbane: { objekter: 15423, tag: 'leisure=pitch', sett: 'main' },
    lekeplass: { objekter: 11901, tag: 'leisure=playground', sett: 'main' },
    badeplass: { objekter: 4841, tag: 'natural=beach', sett: 'main' },
    park: { objekter: 3070, tag: 'leisure=park', sett: 'main' },
    idrettshall: { objekter: 2312, tag: 'leisure=sports_centre', sett: 'main' },
    museum: { objekter: 1241, tag: 'tourism=museum', sett: 'main' },
    bibliotek: { objekter: 721, tag: 'amenity=library', sett: 'main' },
    skianlegg: { objekter: 254, tag: 'landuse=winter_sports', sett: 'omrade' },
    aking: { objekter: 89, tag: 'piste:type=sled', sett: 'main' },
};

/**
 * Hvor stor del av det forholdsmessige nasjonale tallet som må være nådd.
 *
 * **VALGT, IKKE MÅLT.** 0,20 betyr at en kategori må ligge fem ganger under
 * forventning før kjøringen stanser — løst nok til at et unøyaktig
 * forventningstall ikke utløser den.
 */
export const YIELD_FLOOR = 0.2;

/**
 * Hvor langt i planen sjekken slår inn.
 *
 * De første chunkene sier ingenting: en kategori kan mangle i de fem første
 * kommunene av rene geografiske grunner.
 */
export const YIELD_MIN_PROGRESS = 0.25;

/**
 * FORHOLDSMESSIG FORVENTNING ANTAR JEVN FORDELING over chunkene, og det er
 * den svakeste forutsetningen i hele modulen. Oslo har 3 996 av 11 901
 * lekeplasser — en tredel i én kommune. Kjøres distriktene først, kan
 * lekeplass ligge lavt uten at noe er galt.
 *
 * To ting demper det, og de er grunnen til at sjekken likevel er verdt å ha:
 *
 *  1. Gulvet er 20 %, ikke 80 %. Skjevheten må være ekstrem for å utløse den.
 *  2. For ÉN NASJONAL CHUNK er antakelsen eksakt: `andelPlanenDekker` er 1,
 *     og sjekken blir «fikk vi minst 20 % av 254 alpinanlegg». Det er nettopp
 *     den kjøringen dette bygges for.
 *
 * Skal sjekken brukes på en plan med mange chunks og skjev fordeling, må
 * forventningen bli per chunk — og det krever data vi ikke har.
 */
export function yieldCollapseStop(
    /**
     * OBJEKTER HENTET per kategori, talt i settet [NasjonalForventning.sett]
     * peker på. IKKE rader — se typedokumentasjonen for hvorfor.
     *
     * En kategori som mangler her vurderes ikke. Det dekker to tilfeller:
     * kategorien var ikke med i kjøringen (`--category=`), eller hentesteget
     * ble gjenopptatt fra en `.import-work` som er eldre enn settellingen.
     * Kalleren skal SI det i det andre tilfellet — se [hoppetOverIUtbytte].
     */
    objektPerKategori: ReadonlyMap<string, number>,
    andelPlanenDekker: number,
    forventning: Readonly<Record<string, NasjonalForventning>> = NATIONAL_EXPECTATION
): ImportStop | null {
    if (andelPlanenDekker < YIELD_MIN_PROGRESS) return null;
    const under: string[] = [];
    for (const [key, f] of Object.entries(forventning)) {
        const faktisk = objektPerKategori.get(key);
        if (faktisk === undefined) continue;
        const forventet = f.objekter * andelPlanenDekker;
        if (forventet < 1) continue;
        const andel = faktisk / forventet;
        if (andel < YIELD_FLOOR) {
            under.push(
                `${key}: ${faktisk} objekter i settet «${f.sett}» mot ${Math.round(forventet)} ` +
                    `forventet fra ${f.tag} (${Math.round(andel * 100)} %)`
            );
        }
    }
    if (!under.length) return null;
    return new ImportStop(
        'utbyttekollaps',
        `Etter ${Math.round(andelPlanenDekker * 100)} % av planen ligger disse under ` +
            `${Math.round(YIELD_FLOOR * 100)} % av forventet: ${under.join('; ')}. ` +
            `Begge tall er OBJEKTER fra OSM, ikke rader. Det ser ut som en selektor som ` +
            `har sluttet å treffe, ikke som geografi. Sjekk selektoren mot en tag-endring ` +
            `i OSM før du kjører videre.`
    );
}

/**
 * Kategoriene vakten IKKE fikk vurdert fordi hentesteget mangler settellingen.
 *
 * Et gjenopptatt hentesteg skrevet før okt. 2026 har ingen `settAntall` i
 * manifestet. Da kan [yieldCollapseStop] ikke telle noe, og den hopper over
 * kategorien — riktig, siden alternativet er å stoppe på et tall som ikke
 * finnes. Men en vakt som slår seg av i stillhet er verre enn ingen vakt, så
 * kalleren spør her og skriver det i oppsummeringen.
 */
export function hoppetOverIUtbytte(
    objektPerKategori: ReadonlyMap<string, number>,
    kategorier: readonly string[],
    forventning: Readonly<Record<string, NasjonalForventning>> = NATIONAL_EXPECTATION
): string[] {
    return kategorier.filter((k) => forventning[k] !== undefined && !objektPerKategori.has(k));
}
