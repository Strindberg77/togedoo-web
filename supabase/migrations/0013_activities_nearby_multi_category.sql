-- 0013_activities_nearby_multi_category.sql
-- Flervalg av kategorier i radius-RPC-en activities_nearby.
--
-- Ny p_categories text[] tar en LISTE av kategorier. p_category text beholdes
-- som BAKOVERKOMPATIBELT alias (enkeltkategori) — kall som fortsatt sender
-- p_category virker uendret.
--
-- Bakoverkompatibilitet / ingen overload-tvetydighet: den gamle 7-argument-
-- signaturen (…, p_category text, p_q, p_limit) droppes og erstattes av én
-- 8-argument-variant der p_category står i SAMME posisjon og p_categories er
-- lagt til sist (begge med default null). Fordi det bare finnes ETT
-- funksjonsobjekt, kan et kall med p_category aldri bli tvetydig mot et kall
-- med p_categories.
--
-- WHERE-logikk (begge default null → intet kategorifilter):
--   p_categories gitt  → a.category = any(p_categories)
--   p_category  gitt   → a.category = p_category
--   (begge gitt        → snittet; nye kall sender kun én av dem)

drop function if exists public.activities_nearby(
  double precision, double precision, integer, text, text, text, integer
);

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
    and (a.kind = 'place' or a.starts_at is null or a.starts_at > now() - interval '2 hours')
  order by a.location operator(extensions.<->)
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  limit least(p_limit, 500);
$$;

grant execute on function public.activities_nearby to anon, authenticated;
