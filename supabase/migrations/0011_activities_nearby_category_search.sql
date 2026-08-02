-- 0011_activities_nearby_category_search.sql
-- Utvider fritekstsøket (p_q) i radius-RPC-en activities_nearby til også å
-- treffe på category-kolonnen.
--
-- Bakgrunn: 0009 la p_q-søk på title/description/venue_name/address. Men
-- kategorinavnet («Ballbane», «Museum», «Dyremøte» …) er nettopp det
-- brukeren skriver i fritekst. Uten category-treff bommer f.eks. «BALL» på
-- alle navngitte ballbaner (title = «Voldsløkka», category = «Ballbane»),
-- og resultatet ble by-avhengig av hvor mange baner som tilfeldigvis hadde
-- «ball» i navnet. Den flate spørringen i /api/activities fikk samme
-- category.ilike lagt til parallelt.
--
-- Signaturen er uendret fra 0009, så create or replace holder — ingen drop.
-- 0009 røres IKKE i ettertid (den er allerede kjørt mot prod); denne
-- migrasjonen erstatter funksjonskroppen forlengs.

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
      or coalesce(a.category, '') ilike '%' || p_q || '%'
    )
    and (a.kind = 'place' or a.starts_at is null or a.starts_at > now() - interval '2 hours')
  order by a.location operator(extensions.<->)
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  limit least(p_limit, 500);
$$;

grant execute on function public.activities_nearby to anon, authenticated;
