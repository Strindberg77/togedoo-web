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
    /** Av dem: ekte oppslagsfeil (nettverk/HTTP/timeout), ikke «fant ingen adresse». */
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
 * Nasjonale objekttall per kategori, målt med osmium mot Geofabrik-fila
 * (sep. 2026).
 *
 * TALLET ER DEN DOMINERENDE TAGGEN, ikke et eksakt anslag for kategorien.
 * `ballbane` teller `leisure=pitch` (15 423), men selektoren siler også på
 * sport og access. `skianlegg` teller `landuse=winter_sports` (254), mens
 * selektoren har seks mønstre og den romlige testen forkaster noen. Tallene
 * er derfor et TAK for de fleste kategoriene.
 *
 * Det er nettopp derfor gulvet er 20 % og ikke 80 %: sjekken skal fange en
 * selektor som har sluttet å treffe, ikke et unøyaktig anslag.
 *
 * Kategorier UTEN et tall her hoppes over. `rullesport` og `klatring` er ikke
 * målt nasjonalt; å gjette et tall for dem ville gjort vakten til en
 * tilfeldighetsgenerator.
 */
export const NATIONAL_EXPECTATION: Readonly<Record<string, number>> = {
    ballbane: 15423, //    leisure=pitch
    lekeplass: 11901, //   leisure=playground
    badeplass: 4841, //    natural=beach
    park: 3070, //         leisure=park
    idrettshall: 2312, //  leisure=sports_centre
    museum: 1241, //       tourism=museum
    bibliotek: 721, //     amenity=library
    skianlegg: 254, //     landuse=winter_sports
    aking: 89, //          piste:type=sled
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
    radPerKategori: ReadonlyMap<string, number>,
    andelPlanenDekker: number,
    forventning: Readonly<Record<string, number>> = NATIONAL_EXPECTATION
): ImportStop | null {
    if (andelPlanenDekker < YIELD_MIN_PROGRESS) return null;
    const under: string[] = [];
    for (const [key, nasjonalt] of Object.entries(forventning)) {
        const faktisk = radPerKategori.get(key);
        // En kategori som ikke er med i kjøringen (--category=) har ingen
        // oppføring og skal ikke vurderes.
        if (faktisk === undefined) continue;
        const forventet = nasjonalt * andelPlanenDekker;
        if (forventet < 1) continue;
        const andel = faktisk / forventet;
        if (andel < YIELD_FLOOR) {
            under.push(
                `${key}: ${faktisk} rader mot ${Math.round(forventet)} forventet ` +
                    `(${Math.round(andel * 100)} %)`
            );
        }
    }
    if (!under.length) return null;
    return new ImportStop(
        'utbyttekollaps',
        `Etter ${Math.round(andelPlanenDekker * 100)} % av planen ligger disse under ` +
            `${Math.round(YIELD_FLOOR * 100)} % av forventet: ${under.join('; ')}. ` +
            `Det ser ut som en selektor som har sluttet å treffe, ikke som geografi. ` +
            `Sjekk selektoren mot en tag-endring i OSM før du kjører videre.`
    );
}
