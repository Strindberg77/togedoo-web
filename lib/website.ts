// lib/website.ts
// Validering av nettadresser fra OSM.
//
// ÉN KILDE, to lesere: API-et (`website`-feltet i /api/activities) og
// stedsimporten (`url`-kolonnen). Lå regelen to steder, kunne de to gitt ulikt
// svar for samme rad — og da ville «Besøk nettside» i appen pekt et annet sted
// enn kolonnen sa.
//
// OSM-tagger er brukerskrevne fritekstfelt. `website` inneholder i praksis
// alt fra en ren adresse til e-postadresser, telefonnumre, flere adresser
// med semikolon mellom, og adresser uten skjema. Funksjonen her er derfor
// like mye et FILTER som en normalisering: alt som ikke trygt kan åpnes i
// appens webview skal bli null, ikke en gjetning.

/** Lengste adresse vi tar imot. En OSM-verdi på flere hundre tegn er i
 *  praksis alltid søppel, og kolonnen skal ikke bære den. */
const MAX_URL_LENGTH = 500;

/**
 * Normaliser én OSM-nettadresse, eller null hvis den ikke kan brukes.
 *
 * REGLENE, og hvorfor de er som de er:
 *
 *  FLERE ADRESSER («a.no;b.no») → første brukbare.
 *      Semikolon er OSMs konvensjon for flere verdier i én tagg. Å forkaste
 *      hele verdien ville mistet en fullt brukbar adresse; å sette dem sammen
 *      ville gitt en adresse som ikke finnes. Uten dette ga den gamle regelen
 *      «https://a.no;https//b.no» — en URL som verken er den ene eller andre.
 *
 *  MANGLER SKJEMA («www.museum.no») → https:// legges på.
 *      Vanligste slurven, og intensjonen er utvetydig. https framfor http
 *      fordi vi åpner den i en webview.
 *
 *  E-POSTADRESSE («post@museum.no») → null.
 *      Den gamle regelen gjorde dette til «https://post@museum.no/»: en gyldig
 *      URL der «post» er et brukernavn. Den tar brukeren til museum.no med en
 *      etterlatt legitimasjonsdel i adressen, og det er ikke en nettside.
 *      Avvises på @ i vertsdelen, ikke på et e-postmønster — da fanges også
 *      «bruker:passord@vert».
 *
 *  ANNET SKJEMA (mailto:, tel:, ftp:, javascript:) → null.
 *      Kun http og https kan åpnes trygt. javascript: er den som gjør dette
 *      til mer enn ryddighet.
 *
 *  RESTEN («ikke en url», tom streng) → null.
 */
export function sanitizeWebsite(raw: string | null | undefined): string | null {
    if (!raw) return null;
    // Flere adresser: ta den første som holder mål. Komma er ikke OSM-
    // konvensjon, men forekommer, og en adresse inneholder aldri komma.
    for (const del of raw.split(/[;,]/)) {
        const treff = enkeltAdresse(del);
        if (treff) return treff;
    }
    return null;
}

function enkeltAdresse(raw: string): string | null {
    const trimmet = raw.trim();
    if (!trimmet || trimmet.length > MAX_URL_LENGTH) return null;

    const medSkjema = (() => {
        try {
            return new URL(trimmet);
        } catch {
            // Uten skjema er «example.no» ikke en URL. Legg på https og prøv
            // igjen — men bare hvis det faktisk ser ut som et vertsnavn.
            try {
                return new URL(`https://${trimmet}`);
            } catch {
                return null;
            }
        }
    })();
    if (!medSkjema) return null;

    if (medSkjema.protocol !== 'http:' && medSkjema.protocol !== 'https:') return null;
    // Brukernavn/passord i adressen betyr nesten alltid at verdien var en
    // e-postadresse. Se doc-kommentaren over.
    if (medSkjema.username || medSkjema.password) return null;
    // Et vertsnavn uten punktum er ikke et domene («localhost», «ikke en url»
    // etter at mellomrom er strippet av URL-parseren).
    if (!medSkjema.hostname.includes('.')) return null;
    if (medSkjema.href.length > MAX_URL_LENGTH) return null;

    return medSkjema.href;
}
