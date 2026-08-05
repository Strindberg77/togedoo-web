-- 0012_activities_near_city.sql
-- «Nærliggende utflukter»: steder som ligger UTENFOR en bys kommunegrense,
-- men som i praksis hører til byens nærområde (f.eks. Varingskollen i
-- Nittedal hører til Oslo-regionen). Vi beholder ekte municipality (for
-- adresse/attribusjon) og knytter stedet til en «hjemby» via near_city.
--
-- By-modus i /api/activities blir da: municipality ilike '<by>' OR near_city
-- ilike '<by>'. Radius-/PostGIS-søket (activities_nearby) er allerede
-- kommunegrense-agnostisk og trenger ingen endring — det finner disse
-- stedene på koordinat uansett.
--
-- Kolonnen er nullbar og default null, så eksisterende rader (municipality-
-- baserte) er uendret; kun kuraterte utflukts-rader setter near_city.

alter table public.activities
  add column if not exists near_city text default null;
