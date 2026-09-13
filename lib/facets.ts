// lib/facets.ts
// Fasett-tokenene (migrasjon 0016), som ÉN kilde delt av import og seed.
//
// Hvorfor en egen fil: seed-vintertilbud.ts kaller main() på modulnivå, så
// den kan ikke importeres av en test uten å kjøre seeden. Tokenene kan den
// derimot importere herfra — og da fanger `tsc` en skrivefeil i seed-tabellen
// før den når databasen. Det er en bedre vakt enn en test som leser kildekode.
//
// Tokenene er ASCII og oversettes ALDRI. Etiketten brukeren ser er klientens
// (CategoryTheme), og blir svensk, engelsk og tysk senere. Samme deling som
// mellom kategorinøkkel og etikett.
//
// Å legge til et token her er halve jobben: det må også finnes en fasett i
// appen som leser det, ellers er tokenet en påstand uten mottaker.

export const FACET_TOKENS = [
    // Fra piste:type
    'alpint',
    'aking',
    'skileik',
    // Fra mtb:type og route=mtb
    'downhill',
    'terrengsykling',
    // Fra sport. De to siste er UTLEDET fra skateboard, ikke lest —
    // se SKATEBOARD_IMPLIES under.
    'skateboard',
    'bmx',
    'sparkesykkel',
    'rulleskoyter',
] as const;

export type FacetToken = (typeof FACET_TOKENS)[number];

/**
 * ANTAKELSEN: et anlegg for skateboard er også et sted barn kjører
 * sparkesykkel og rulleskøyter.
 *
 * DETTE ER IKKE EN AVLESNING. Det er en påstand om virkeligheten, tatt fordi
 * OSM ikke kan fylle de to fasettene: målt i Geofabrik-filen (norway-260908)
 * finnes `kick_scooter` 3 ganger i HELE Norge, alltid sammen med skateboard,
 * og `roller_skating` i 5 sammensetninger. Uten utledningen ville begge
 * fasettene vært permanent tomme.
 *
 * Grunnlaget for å ta den likevel: kategorikortets illustrasjon viser en
 * sparkesykkel. Appen lover altså allerede noe filteret ikke leverer.
 *
 * RETNINGEN ER ENVEIS, og det er det viktigste her. Regelen går FRA
 * skateboard TIL de andre, aldri motsatt:
 *
 *   skateboard  ->  skateboard + sparkesykkel + rulleskoyter
 *   bmx         ->  bmx, og BARE bmx
 *
 * En BMX-bane i skogen er ikke et sted for rulleskøyter. Snus retningen, blir
 * fasetten usann for jordbane og hoppkuler.
 *
 * MÅLT I PROD (kategori Rullesport, sep. 2026): 68 rader har skateboard,
 * 10 har bmx, 0 har begge, 81 totalt. De to nye fasettene treffer altså de
 * samme 68 radene som Skateboard gjør — ikke flere, ikke færre.
 *
 * HVIS ANTAKELSEN VISER SEG FEIL for et konkret anlegg: sett `locked = true`
 * på raden og rett `facets` for hånd. Importen hopper over låste rader helt
 * (scripts/import-places.ts, oppslaget før upserten), så rettingen overlever
 * neste kjøring. Merk at låsen er per RAD, ikke per felt — se merknaden der.
 */
export const SKATEBOARD_IMPLIES: readonly FacetToken[] = [
    'skateboard',
    'sparkesykkel',
    'rulleskoyter',
];
