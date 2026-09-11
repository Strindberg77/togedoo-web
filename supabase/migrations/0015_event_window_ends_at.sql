-- 0015_event_window_ends_at.sql
-- Tidsvinduet for arrangementer måler på greatest(starts_at, ends_at), ikke på
-- starts_at alene. (Dokumentet sier coalesce — se «AVVIK FRA DOKUMENTET».)
--
-- BAKGRUNN (defekt 1 i docs/arrangementer-og-betalende-aktorer.md)
-- ends_at har ligget i skjemaet siden 0001, settes av arrangørflyten og leses
-- av /api/activities — men ingen av tidsfiltrene brukte den. For et
-- bibliotekarrangement på én time er starts_at riktig. For en utstilling over
-- tre uker, en festival over en helg eller en teateroppsetning med
-- spilleperiode er det direkte feil: tilbudet forsvant to timer etter
-- ÅPNINGSDAGEN, midt i perioden.
--
-- HVA SOM ENDRES
-- Kun WHERE-linjen for tid i activities_nearby. Signatur, argumentnavn,
-- defaultverdier, kategorilogikk, fritekstsøk, sortering og limit er ordrett
-- som i 0013 — create or replace bytter kroppen i samme funksjonsobjekt, så
-- ingen overload oppstår og ingen grant må settes på nytt.
--
--   Før:  and (a.kind = 'place' or a.starts_at is null
--              or a.starts_at > now() - interval '2 hours')
--   Nå:   and (a.kind = 'place' or greatest(a.starts_at, a.ends_at) is null
--              or greatest(a.starts_at, a.ends_at) > now() - interval '2 hours')
--
-- AVVIK FRA DOKUMENTET — et valg, ikke en forglemmelse
-- docs/arrangementer-og-betalende-aktorer.md spesifiserer
-- coalesce(ends_at, starts_at). Her står greatest(starts_at, ends_at).
--
-- coalesce tar ends_at UBETINGET når den finnes, også når den er tidligere enn
-- starts_at. En rad med feilført sluttid ville da vært utløpt før den i det
-- hele tatt har begynt. greatest tar den seneste av de to, og har ikke det
-- hullet.
--
-- Ingen vei dit finnes i dagens kode: lib/organizer.ts:103 avviser innsendinger
-- der endsAt <= startsAt, og Deichman-adapteren leverer fulle ISO-tidsstempler.
-- Men fra det øyeblikket betalende arrangører leverer data utenfra, er dataene
-- ikke lenger våre egne — og vakten koster ingenting her.
--
-- Ellers er de to identiske: Postgres' greatest() ignorerer NULL og gir NULL
-- først når alle argumentene er NULL, akkurat som coalesce faller til
-- starts_at når ends_at mangler.
--
-- Rader uten både starts_at og ends_at (alle steder, og arrangementer uten
-- tidfesting) slipper gjennom som før. Rader med bare starts_at oppfører seg
-- nøyaktig som før. Endringen kan derfor bare gjøre ÉN ting: la et arrangement
-- med sluttidspunkt leve lenger enn det gjorde i går.
--
-- Samme grense gjelder nå tre steder, og alle tre er endret i samme omgang:
--   1. denne funksjonen (radius-modus)
--   2. by-modus-grenen i app/api/activities/route.ts (hadde ingen)
--   3. expireOldEvents() i lib/ingest.ts (nattlig sveip, 24 t i stedet for 2)
--
-- Ikke-destruktiv: rører ingen rader, kun funksjonsdefinisjonen.

create or replace function public.activities_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 10000,
  p_kind text default null,
  p_category text default null,
  p_q text default null,
  p_limit integer default 200,
  p_categories text[] default null
)
returns setof public.activities
language sql
stable
set search_path = public, extensions
as $$
  select a.*
  from public.activities a
  where a.status = 'published'
    and a.location is not null
    and extensions.st_dwithin(
      a.location,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      p_radius_m
    )
    and (p_kind is null or a.kind = p_kind)
    -- Kategori: p_categories (liste) ELLER p_category (enkelt, bakoverkomp.).
    and (p_categories is null or a.category = any(p_categories))
    and (p_category is null or a.category = p_category)
    and (
      p_q is null or p_q = ''
      or a.title ilike '%' || p_q || '%'
      or coalesce(a.description, '') ilike '%' || p_q || '%'
      or coalesce(a.venue_name, '') ilike '%' || p_q || '%'
      or coalesce(a.address, '') ilike '%' || p_q || '%'
      or coalesce(a.category, '') ilike '%' || p_q || '%'
    )
    -- Tidsvindu: et tilbud lever ut spilleperioden sin, ikke ett døgn etter
    -- åpningsdagen. Steder har ingen tid og slipper alltid gjennom.
    and (
      a.kind = 'place'
      or greatest(a.starts_at, a.ends_at) is null
      or greatest(a.starts_at, a.ends_at) > now() - interval '2 hours'
    )
  order by a.location operator(extensions.<->)
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  limit least(p_limit, 500);
$$;

grant execute on function public.activities_nearby to anon, authenticated;
