// lib/event-window.ts
// Tidsvinduet for arrangementer, samlet ett sted fordi det tidligere fantes to
// ulike svar på «er dette over?» — ett i lib/ingest.ts og ett i RPC-en
// activities_nearby — og by-modus i /api/activities hadde ikke noe svar i det
// hele tatt.
//
// To grenser, med vilje ulike:
//
//   UTLØP (24 t)   skriver status='expired' og kjøres av cron én gang i døgnet
//                  (0 5 * * * -> /api/sync). Den har slakk nettopp fordi den
//                  er treg: den skal aldri rekke å ta et arrangement som
//                  fortsatt pågår.
//   VISNING (2 t)  er et lesefilter som virker umiddelbart. Den er stram fordi
//                  et avsluttet arrangement ikke skal bli liggende i lista de
//                  ~21 timene det tar før cron kommer.
//
// Begge måler på greatest(starts_at, ends_at), ikke på starts_at alene. En
// utstilling over tre uker eller en teateroppsetning med spilleperiode skal
// leve ut perioden — ikke forsvinne ett døgn etter åpningsdagen.
//
// AVVIK FRA docs/arrangementer-og-betalende-aktorer.md: dokumentet
// spesifiserer coalesce(ends_at, starts_at). greatest() er valgt i stedet
// fordi coalesce tar ends_at UBETINGET når den finnes — også når den er
// tidligere enn starts_at, og da forsvinner arrangementet før det har begynt.
// Ingen vei dit finnes i dagens kode (lib/organizer.ts:103 avviser
// endsAt <= startsAt, og Deichman leverer fulle ISO-tidsstempler), men
// betalende arrangører leverer data utenfra. Postgres' greatest() ignorerer
// NULL og gir NULL først når begge er NULL, så oppførselen er ellers identisk
// med coalesce.
//
// Ingen nettverk, ingen database: rene funksjoner, testet i event-window.test.ts.

/** Slakk før cron skriver status='expired'. */
export const EXPIRY_GRACE_HOURS = 24;

/** Slakk før et arrangement slutter å vises. Speiler intervallet i RPC-en. */
export const LISTING_GRACE_HOURS = 2;

function cutoffIso(now: Date, hours: number): string {
    return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/** Grensen expireOldEvents() sammenligner mot: eldre enn dette er utløpt. */
export function expiryCutoff(now: Date = new Date()): string {
    return cutoffIso(now, EXPIRY_GRACE_HOURS);
}

/** Grensen lesefiltrene sammenligner mot: eldre enn dette skal ikke vises. */
export function listingCutoff(now: Date = new Date()): string {
    return cutoffIso(now, LISTING_GRACE_HOURS);
}

/**
 * By-modus-utgaven av RPC-ens tidsfilter, som et PostgREST `or`-uttrykk.
 *
 * SQL-en den speiler (migrasjon 0015):
 *
 *     a.kind = 'place'
 *     or greatest(a.starts_at, a.ends_at) is null
 *     or greatest(a.starts_at, a.ends_at) > <cutoff>
 *
 * PostgREST kan ikke uttrykke greatest() i et filter, men trenger det heller
 * ikke: «den seneste av to er større enn X» er det samme som «minst én av dem
 * er større enn X». Sammenligning mot NULL gir NULL (ikke sant), så en tom
 * kolonne faller ut av sin egen gren av seg selv.
 *
 *     ends_at.gt.<cutoff>     or  starts_at.gt.<cutoff>
 *
 * Er BEGGE tomme er greatest() NULL, og da må raden slippe gjennom på egen
 * gren — ellers ville et arrangement uten tidfesting aldri vises.
 *
 * Verdien dobbeltfnuttes fordi et ISO-tidsstempel inneholder både «:» og «.»,
 * som begge er reserverte tegn inne i et PostgREST-logikktre.
 */
export function cityModeEventWindowFilter(cutoff: string): string {
    const t = `"${cutoff}"`;
    return [
        'kind.eq.place',
        'and(ends_at.is.null,starts_at.is.null)',
        `ends_at.gt.${t}`,
        `starts_at.gt.${t}`,
    ].join(',');
}

/**
 * Sant når by-modus-sorteringen (`starts_at` stigende, nulls sist) kan bli
 * STYRENDE i stedet for virkningsløs — se defekt 3 i
 * docs/arrangementer-og-betalende-aktorer.md.
 *
 * Så lenge utvalget bare er steder har hver rad starts_at = null, og
 * nullsFirst:false gjør sorteringen til en nulloperasjon. Slipper
 * arrangementsrader inn i samme utvalg, legger de seg ØVERST med eldste
 * først, og kan fylle hele `limit` — da forsvinner stedene ut, ikke nedover.
 *
 * Defekten rettes ikke her (arrangementer skal få sitt eget kall og sitt eget
 * tak, se steg 2 i dokumentet). Funksjonen finnes for at overgangen ikke skal
 * skje ubemerket: kallstedet logger en advarsel, og testen låser betingelsen
 * så den ikke kan endres uten at noen leser hvorfor.
 */
export function cityModeSortIsLoadBearing(kind: string | null | undefined): boolean {
    return kind !== 'place';
}
