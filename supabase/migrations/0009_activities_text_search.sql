-- 0009_activities_text_search.sql
-- Fritekstsøk (q) i steds-/aktivitetshentingen.
--
-- Den flate spørringen i /api/activities bruker ilike direkte (Supabase .or).
-- Radius-RPC-en activities_nearby må ta et eget tekstargument, så den utvides
-- her med p_q. API-et sanerer q (kun bokstaver/tall/mellomrom/bindestrek, maks
-- 50 tegn) FØR den sendes hit, så ilike-mønsteret er trygt (ingen wildcard-/
-- injeksjonsflate).
--
-- Ingen pg_trgm-indeks: tabellen er liten, og ilike kjører på en allerede
-- filtrert delmengde (geo + kategori + kind), så sekvensielt søk er umerkbart.
-- Legg til en GIN-trigram-indeks på (title, description) FØRST hvis
-- stedstabellen vokser til titusener rader eller søkelatens blir målbar.

drop function if exists public.activities_nearby(
  double precision, double precision, integer, text, text, integer
);

create or replace function public.activities_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 10000,
  p_kind text default null,
  p_category text default null,
  p_q text default null,
  p_limit integer default 200
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
    and (p_category is null or a.category = p_category)
    and (
      p_q is null or p_q = ''
      or a.title ilike '%' || p_q || '%'
      or coalesce(a.description, '') ilike '%' || p_q || '%'
      or coalesce(a.venue_name, '') ilike '%' || p_q || '%'
      or coalesce(a.address, '') ilike '%' || p_q || '%'
    )
    and (a.kind = 'place' or a.starts_at is null or a.starts_at > now() - interval '2 hours')
  order by a.location operator(extensions.<->)
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  limit least(p_limit, 500);
$$;

grant execute on function public.activities_nearby to anon, authenticated;
