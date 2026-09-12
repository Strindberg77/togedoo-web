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
] as const;

export type FacetToken = (typeof FACET_TOKENS)[number];
