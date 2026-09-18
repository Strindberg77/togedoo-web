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
    // Bare fra seed. Kristiansand Dyrepark er ÉN rad med hovedkategori
    // Dyremøte, men skal også komme opp under Fornøyelsespark — samme deling
    // som Trysil skisenter (Skianlegg) med fasetten aking. Ingen OSM-tagg
    // setter den; importen har ingen selektor for tourism=theme_park.
    //
    // Mottakeren er kategorifilteret i API-et (FASETT_SOM_KATEGORI under,
    // migrasjon 0022). Appens eget klientfilter ser ennå bare på
    // hovedkategorien. Se docs/kategori-via-fasett.md.
    'fornoyelsespark',
] as const;

export type FacetToken = (typeof FACET_TOKENS)[number];

/**
 * Tokens som BARE settes av seed, aldri av importen. Unntaket fra regelen i
 * scripts/facets.test.ts om at hvert token skal kunne utledes fra en tagg:
 * for disse finnes det ingen tagg å utlede fra, og det er et valg, ikke en
 * glipp. Står et token her, må en seed-rad sette det — ellers er det dødt.
 */
export const SEED_ONLY_FACETS: readonly FacetToken[] = ['fornoyelsespark'];

/**
 * FASETT SOM KATEGORI: fasettene som også teller som treff i en kategori.
 *
 * Et kategorifilter ser på hovedkategorien. Noen steder er også noe annet:
 * Dyreparken er Dyremøte, men ER en fornøyelsespark; Trysil skisenter er
 * Skianlegg, men HAR akebakke. De skal komme opp under begge — som ÉN rad.
 *
 * Tabellen er REGELEN, og den er eksplisitt med vilje. Å utlede den
 * (`lower(token) === lower(kategori)`) virker for «aking», feiler for
 * «fornoyelsespark» (ASCII mot ø), og ville gjort «alpint» til et
 * kategoritreff den dagen en kategori het Alpint. Fasetter som PRESISERER
 * hovedkategorien (alpint, skileik, downhill, terrengsykling) står ikke her
 * og gir aldri treff i en annen kategori.
 *
 * Fasetten UTVIDER et kategorifilter som allerede er satt; den innfører
 * aldri et. SQL-en (migrasjon 0022) får ferdige lister og vet ingenting om
 * denne tabellen. Måling og bakgrunn: docs/kategori-via-fasett.md.
 *
 * Appen trenger den samme tabellen for sitt eget kategorifilter (se samme
 * dokument). Endres den her, må den endres der.
 */
export const FASETT_SOM_KATEGORI: Readonly<Partial<Record<FacetToken, string>>> = {
    aking: 'Aking',
    fornoyelsespark: 'Fornøyelsespark',
};

/**
 * Fasett-tokenene som skal gi treff for de valgte kategoriene, eller null når
 * ingen av dem har en fasett (da oppfører spørringen seg nøyaktig som før).
 */
export function categoryFacetsFor(categories: readonly string[] | null): FacetToken[] | null {
    if (!categories || categories.length === 0) return null;
    const valgt = new Set(categories);
    const tokens = (Object.keys(FASETT_SOM_KATEGORI) as FacetToken[]).filter((t) =>
        valgt.has(FASETT_SOM_KATEGORI[t]!)
    );
    return tokens.length > 0 ? tokens : null;
}

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
