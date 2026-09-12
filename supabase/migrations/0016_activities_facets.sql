-- 0016_activities_facets.sql
-- Fasett-tokens per rad, som en egen kolonne ved siden av osm_tags.
--
-- BAKGRUNN
-- Fasettmedlemskap leses i dag KUN fra osm_tags->>'sport'
-- (route.ts:131 -> DatahubPlace -> ExploreFilter._placeMatchesSport). Det
-- holder for Ballbane og Rullesport, som begge er forankret i sport-taggen,
-- men ikke for noe av det som kommer:
--
--   * alpint, aking og skileik ligger i piste:type, ikke i sport
--   * downhill og terrengsykling ligger i mtb:type og route=mtb
--   * SEED-rader har osm_tags = null. De får sports = [] og forsvinner i det
--     oyeblikket brukeren huker av en fasett.
--
-- Det siste er en reell feil i dag, ikke en framtidig: alle sju vinterradene
-- er seedet, og ingen av dem har osm_tags.
--
-- HVORFOR text[] OG IKKE jsonb
-- Dette er et SETT med tokens, ikke en struktur. `@>` og `&&` er innebygd,
-- GIN-indeksen er en linje, og PostgREST eksponerer cs/ov direkte. jsonb
-- ville invitert til nostet data vi ikke trenger og ikke vil ha her.
--
-- HVORFOR not null default '{}'
-- null og tom liste ville betydd det samme — «ingen fasetter» — og da matte
-- hver leser handtere begge. Samme grunn som at is_free ble smalnet til
-- true | null i stedet for tre tilstander (migrasjon/commit dfba1b2).
--
-- VERDIENE er ASCII-tokens, ikke etiketter: alpint, aking, skileik, downhill,
-- terrengsykling. Tokenet er stabilt og oversettes aldri; etiketten er
-- klientens og blir svensk, engelsk og tysk senere. Samme deling som mellom
-- kategorinokkel og CategoryTheme.label.
--
-- ADDITIVT, IKKE ERSTATNING
-- Kolonnen kommer VED SIDEN AV sports (som utledes fra osm_tags i API-et).
-- API-et returnerer begge, og klienten tar unionen. Da virker Ballbane og
-- Rullesport uendret, og de nye fasettene virker pa seed-rader. sports kan
-- avvikles senere, i ro, nar ingenting leser den lenger.
--
-- Ikke-destruktiv: legger kun til en kolonne og en indeks. Eksisterende rader
-- beholder alt og far facets = '{}'.

alter table public.activities
  add column if not exists facets text[] not null default '{}';

-- GIN: oppslag med && (overlapper) og @> (inneholder) over et sett.
-- Uten indeks ville et framtidig serverside-fasettfilter vaert en full scan.
create index if not exists activities_facets_idx
  on public.activities using gin (facets);
