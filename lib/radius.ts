// lib/radius.ts
//
// SØKERADIUSEN i radius-modus: standarden, taket, og tolkningen av
// `?radius=`-parameteren.
//
// ─────────────────────────────────────────────────────────────────────────
// HVORFOR DETTE ER EN EGEN FIL
//
// Tallet lå som en naken `Math.min(…, 100000)` i app/api/activities/route.ts,
// og appen hadde sin egen liste med valg. Det var TO tak
// (docs/nasjonal-dekning.md, funn 2), og det nederste vant i stillhet: appen
// kunne be om 200 km og få 100 km tilbake uten at noe sa fra. Oppdal ligger
// ~103 km fra Trondheim (målt, se under) og var derfor usynlig uansett hva
// appen spurte om.
//
// Delingen er nå en ANNEN, og det er hele poenget med endringen:
//
//   APPEN eier PRODUKTVALGET   — hvilke avstander en forelder kan velge
//                                 mellom. Det er en redaksjonell beslutning,
//                                 og den hører hjemme der chipsene er.
//   SERVEREN eier FORNUFTSGRENSEN — et tall så høyt at ingen rimelig
//                                 produktbeslutning treffer det, og så lavt
//                                 at `?radius=1e12` fra en ødelagt klient
//                                 ikke blir en full tabellskanning.
//
// Er de to tallene like, er vi tilbake til to tak: neste gang appen vil ha
// 250 km må serveren endres samtidig, og glemmer man det, feiler den i
// stillhet. Derfor er [RADIUS_MAX_M] bevisst mye høyere enn den største
// verdien appen tilbyr.
//
// ─────────────────────────────────────────────────────────────────────────
// ER TAKET EN YTELSESGRENSE? NEI — og det er verdt å si rett ut.
//
// Spørringen er `st_dwithin(...)` mot en GIST-indeks, deretter KNN-sortering
// og `limit least(p_limit, 500)` (migrasjon 0015). Kostnaden drives av
// LIMIT, ikke av radien: en radius som dekker hele tabellen gir samme arbeid
// som en tabell uten geografifilter i det hele tatt — og tabellen er ~7 800
// rader i dag, ~39 500 etter nasjonal import (osmium mot Geofabrik-fila,
// sep. 2026).
//
// Det er derfor IKKE målt at 500 km er tryggere enn 1 000 km. Påstanden her
// er svakere og ærligere: ved disse radtallene koster radien ingenting, så
// taket er en vakt mot en meningsløs parameter og ikke mot last. Den dagen
// tabellen er i millionklassen, er det denne setningen som ikke lenger
// holder, og da skal tallet måles på nytt.
//
// ─────────────────────────────────────────────────────────────────────────
// MÅLTE AVSTANDER (Kartverkets kommunegrenser, data/kommuner.geojson, fra
// bysentrene i lib/cities.ts). Nærmeste kant / sentroide / fjerneste kant:
//
//   Oppdal   fra Trondheim     82 /  103 / 137 km
//   Gol      fra Oslo         118 /  133 / 150 km
//   Hafjell (Øyer) fra Oslo   142 /  155 / 173 km
//   Hemsedal fra Oslo         146 /  166 / 188 km
//   Trysil   fra Oslo         143 /  169 / 209 km
//   Kvitfjell (Ringebu) Oslo  164 /  187 / 208 km
//   Hovden (Bykle) fra Oslo   183 /  205 / 235 km
//   Hovden (Bykle) fra Stav.   68 /   99 / 124 km
//
// Kommunen er en grov proxy for hvor anlegget ligger — den gir et intervall,
// ikke et punkt. Men den er MÅLT, og den er nok til å si at 100 km var for
// lavt og at 200 km dekker det norske alpinkjerneområdet sett fra Oslo.

/** Radiusen når klienten ikke ber om noe. Uendret fra før. */
export const RADIUS_DEFAULT_M = 10_000;

/**
 * FORNUFTSGRENSEN, ikke produktgrensen. Se filhodet.
 *
 * 500 km er valgt som «mye høyere enn noe appen vil tilby (200 km), lavt nok
 * til at en åpenbart ødelagt verdi avvises». Norge er ~1 750 km langt, så
 * 500 km er fortsatt en region og ikke landet.
 */
export const RADIUS_MAX_M = 500_000;

/**
 * Minste radius. 100 m, ikke 0: en radius på null gir alltid tomt svar, og et
 * tomt svar er ikke til å skille fra «det finnes ingenting her».
 *
 * FEILEN DETTE RETTER: uttrykket var `Math.min(Number(raw) || 10000, 100000)`.
 * `Math.min` har ingen nedre grense, så `?radius=-1` gikk rett gjennom til
 * st_dwithin og ga null rader uten en eneste advarsel.
 */
export const RADIUS_MIN_M = 100;

export interface ParsedRadius {
    /** Radiusen som faktisk brukes, i meter. */
    readonly meters: number;
    /**
     * Sann når klienten ba om noe annet enn det den fikk.
     *
     * HVORFOR DEN FINNES: uten den er avkortingen usynlig. Appen ber om
     * 200 km, får 100 km, og viser «Steder innen 200 km fra der du er» over
     * en liste som dekker halvparten. Feltet lar klienten oppdage det, og
     * lar en test slå fast at avkortingen skjedde.
     */
    readonly clamped: boolean;
}

/**
 * `?radius=` → meter.
 *
 * Tolkningen, uttømmende:
 *   mangler, tom, ikke et tall  → [RADIUS_DEFAULT_M], ikke avkortet
 *   under [RADIUS_MIN_M]        → [RADIUS_MIN_M], avkortet
 *   over [RADIUS_MAX_M]         → [RADIUS_MAX_M], avkortet
 *   ellers                      → verdien, avrundet til hele meter
 *
 * «Ikke et tall» teller ikke som avkortet: klienten ba ikke om noe gyldig,
 * så den fikk standarden — det er noe annet enn å få mindre enn den ba om.
 */
export function parseRadius(raw: string | null | undefined): ParsedRadius {
    if (raw === null || raw === undefined || raw.trim() === '') {
        return { meters: RADIUS_DEFAULT_M, clamped: false };
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { meters: RADIUS_DEFAULT_M, clamped: false };
    if (n < RADIUS_MIN_M) return { meters: RADIUS_MIN_M, clamped: true };
    if (n > RADIUS_MAX_M) return { meters: RADIUS_MAX_M, clamped: true };
    return { meters: Math.round(n), clamped: false };
}
