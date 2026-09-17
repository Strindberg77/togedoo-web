-- 0017_activities_search.sql
--
-- Kjøres i Supabase SQL-editor (samme vei som 0001–0016). Ikke-destruktiv:
-- oppretter én ny funksjon, endrer ingen tabell, indeks eller eksisterende
-- funksjon.
--
-- HVORFOR (docs/utforsk-stedsvalg-funn.md, docs/api-activities.md)
-- Søk skal være nasjonalt, blaing «nærmest først» uten yttergrense, og
-- avstand et valgfritt filter. activities_nearby bærer ikke det:
--   * p_radius_m er alltid et filter (default 10 km)
--   * limit er least(p_limit, 500) uten offset eller markør — målt 17. sep.
--     2026: radius 3000 km og limit 5000 gir 500 rader, og rad 501 av 8016
--     kan aldri nås
--   * fritekst treffer ikke municipality
--   * avstanden returneres ikke
-- Å hente alt via PostgREST og sortere i API-et ville kostet ni kall per
-- forespørsel i dag (maks 1000 rader per kall) og langt flere etter en
-- nasjonal import.
--
-- Ny funksjon ved siden av activities_nearby. Den gamle røres ikke, så
-- appens kall kan ligge på den til byttet er verifisert.
--
-- SECURITY INVOKER, som activities_nearby: RLS-policyen activities_public_read
-- (0001) gjelder, så anon ser bare published også gjennom funksjonen.
-- `status = 'published'` står likevel i WHERE, for service_role-kallet.
--
-- Ingen ny indeks. Radius bruker GiST-indeksen fra 0001. Avstandssorteringen
-- og kartutsnittet går over de treffene filtrene slipper gjennom, som er
-- billig ved ~8000 rader. Svartiden er målt og står i docs/api-activities.md.
--
-- Rekkefølge og cursor:
--   med posisjon:  distance_m, id       cursor = (p_after_distance_m, p_after_id)
--   uten posisjon: title, id            cursor = (p_after_title, p_after_id)
-- Keyset, ikke offset: en side 2 bygger på siste rad på side 1, så rader som
-- publiseres eller tas ned mellom kallene gir verken dubletter eller hull.
--
-- Avstand er luftlinje på kule (use_spheroid = false). Samme mål som `<->`,
-- som activities_nearby sorterer på i dag, så rekkefølgen blir den samme.
create or replace function public.activities_search(
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_m double precision default null,   -- null = ingen grense
  p_west double precision default null,       -- bbox: alle fire eller ingen
  p_south double precision default null,
  p_east double precision default null,
  p_north double precision default null,
  p_kind text default null,
  p_categories text[] default null,
  p_target_audience text default null,
  p_q text default null,
  p_after_distance_m double precision default null,
  p_after_title text default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, kind text, title text, description text, category text,
  target_audience text, venue_name text, address text, municipality text,
  near_city text, lat double precision, lng double precision,
  starts_at timestamptz, ends_at timestamptz, is_free boolean,
  price_text text, url text, image_url text, opening_hours text,
  osm_tags jsonb, is_indoor boolean, facets text[],
  distance_m double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with origin as (
    select case
      when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
    end as pt
  ),
  hits as (
    select a.*,
           case when o.pt is null then null
                else extensions.st_distance(a.location, o.pt, false) end as dist
    from public.activities a
    cross join origin o
    where a.status = 'published'
      and a.location is not null
      and (p_kind is null or a.kind = p_kind)
      and (p_categories is null or a.category = any(p_categories))
      and (p_target_audience is null
           or lower(a.target_audience) = lower(p_target_audience))
      -- p_q kommer med % _ og \ escapet av API-et; ilike bruker \ som
      -- escape-tegn når ingen ESCAPE er oppgitt.
      and (
        p_q is null or p_q = ''
        or a.title ilike '%' || p_q || '%'
        or coalesce(a.description, '') ilike '%' || p_q || '%'
        or coalesce(a.venue_name, '') ilike '%' || p_q || '%'
        or coalesce(a.address, '') ilike '%' || p_q || '%'
        or coalesce(a.category, '') ilike '%' || p_q || '%'
        or coalesce(a.municipality, '') ilike '%' || p_q || '%'   -- NYTT
      )
      -- Radius er et filter, ikke en port. Bruker GiST-indeksen.
      and (p_radius_m is null or o.pt is null
           or extensions.st_dwithin(a.location, o.pt, p_radius_m, false))
      -- Kartutsnitt på lat/lng-kolonnene, ikke en geography-boks: en
      -- geography-polygon har storsirkel-kanter og ville bommet langs
      -- nord- og sørkanten av utsnittet.
      and (p_west is null
           or (a.lat between p_south and p_north
               and a.lng between p_west and p_east))
      -- Tidsvindu, uendret fra 0015.
      and (
        a.kind = 'place'
        or greatest(a.starts_at, a.ends_at) is null
        or greatest(a.starts_at, a.ends_at) > now() - interval '2 hours'
      )
  )
  select h.id, h.kind, h.title, h.description, h.category, h.target_audience,
         h.venue_name, h.address, h.municipality, h.near_city, h.lat, h.lng,
         h.starts_at, h.ends_at, h.is_free, h.price_text, h.url, h.image_url,
         h.opening_hours, h.osm_tags, h.is_indoor, h.facets, h.dist
  from hits h
  where p_after_id is null
     or (h.dist is not null and (h.dist, h.id) > (p_after_distance_m, p_after_id))
     or (h.dist is null and (h.title, h.id) > (p_after_title, p_after_id))
  order by h.dist,                                   -- null for alle uten posisjon
           case when h.dist is null then h.title end,
           h.id
  -- 501: API-et ber om limit + 1 for å svare hasMore uten et ekstra kall.
  limit least(greatest(p_limit, 1), 501);
$$;

grant execute on function public.activities_search to anon, authenticated;
