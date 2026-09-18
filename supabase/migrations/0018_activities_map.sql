-- 0018_activities_map.sql
--
-- Kjøres i Supabase SQL-editor (samme vei som 0001–0017). Ikke-destruktiv:
-- oppretter én ny funksjon. Endrer ingen tabell, indeks eller eksisterende
-- funksjon — activities_search og activities_nearby er urørt.
--
-- HVORFOR
-- Kartet i appen lyver. Det henter /api/activities med bbox, sortert på
-- avstand fra BRUKEREN og kuttet på 100. Målt 18. sep. 2026 mot produksjon:
--
--   Utsnitt over Oslo sentrum (10.68–10.82, 59.89–59.945): 1250 steder.
--   Svaret: 100 rader, alle innen 950 m fra posisjonen.
--   Samme utsnitt flyttet 2 km øst: 1350 steder. Svaret: DE SAMME 100
--   radene, i samme rekkefølge.
--
-- Kartet viser en rund klatt rundt brukeren og kaller det «100+ steder», og
-- «Søk i dette området» ser død ut. Kartet trenger to ting listen ikke gjør:
--
--   1. TOTALEN i utsnittet, uavhengig av limit.
--   2. HELE UTSNITTET: enten alle stedene (når de er få), eller klynger med
--      antall og tyngdepunkt (når de er mange).
--
-- Kan ikke gjøres i API-et alene: PostgREST gir maks 1000 rader per kall.
-- Klynger over Sør-Norge (7949 steder i dag, 35–50 000 etter nasjonal import)
-- ville krevd 8–50 rundturer per kartbevegelse bare for å telle. Her er det
-- én spørring, og bare klyngene går over nettet.
--
-- EN FUNKSJON, TO SVAR
--   total <= p_threshold: modus 'steder' — ALLE stedene i utsnittet, med
--                         avstand fra p_lat/p_lng når oppgitt. Terskelen
--                         klemmes til 0–500, som rutenettet klemmes til 1–20.
--   total >  p_threshold: modus 'klynger' — ett rutenett (p_cols × p_rows)
--                         over utsnittet; per rute antall, TYNGDEPUNKT
--                         (snitt av punktene, ikke rutas midte) og antall per
--                         kategori.
-- Hvert sted havner i nøyaktig én rute (kanten mot øst/nord klemmes inn i
-- siste rute), så summen av klyngene er alltid lik total.
--
-- Utsnittet filtreres på lat/lng-kolonnene, som i activities_search: en
-- geography-boks har storsirkelkanter og ville bommet langs nord- og
-- sørkanten.
--
-- SECURITY INVOKER, som activities_search: RLS-policyen activities_public_read
-- (0001) gjelder, og anon ser bare published.
--
-- Ingen ny indeks. Filteret går over ~8000 rader i dag; svartiden er målt og
-- står i docs/api-kart.md. Blir den et problem etter nasjonal import, er en
-- btree på (lat, lng) det naturlige neste steget — men ikke før det er målt.
create or replace function public.activities_map(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_kind text default null,
  p_categories text[] default null,
  p_cols integer default 6,
  p_rows integer default 8,
  p_threshold integer default 150,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with hits as (
    select a.*
    from public.activities a
    where a.status = 'published'
      and a.lat is not null
      and a.lng is not null
      and a.lat between p_south and p_north
      and a.lng between p_west and p_east
      and (p_kind is null or a.kind = p_kind)
      and (p_categories is null or a.category = any(p_categories))
      -- Tidsvindu, uendret fra 0015.
      and (
        a.kind = 'place'
        or greatest(a.starts_at, a.ends_at) is null
        or greatest(a.starts_at, a.ends_at) > now() - interval '2 hours'
      )
  ),
  total as (
    select count(*)::integer as n from hits
  ),
  grid as (
    select greatest(1, least(p_cols, 20)) as cols,
           greatest(1, least(p_rows, 20)) as rws
  ),
  -- Klemt som rutenettet. Funksjonen kan kalles direkte med anon-nøkkelen,
  -- og en ubegrenset terskel ville gitt ALLE rader med full tekst i ett
  -- svar. 500 er godt over det et kart kan vise (API-et bruker 150).
  terskel as (
    select greatest(0, least(p_threshold, 500)) as maks
  ),
  celler as (
    select
      h.lat,
      h.lng,
      -- jsonb_object_agg feiler på en null-nøkkel, og ÉN rad uten kategori
      -- ville veltet hele kartet. Kolonnen er `not null` i dag (0001), og
      -- 0 publiserte rader mangler kategori (målt 18. sep. 2026) — dette er
      -- vernet om det endrer seg.
      coalesce(h.category, 'Ukjent') as category,
      least(
        floor((h.lng - p_west) / nullif(p_east - p_west, 0) * g.cols)::integer,
        g.cols - 1
      ) as cx,
      least(
        floor((h.lat - p_south) / nullif(p_north - p_south, 0) * g.rws)::integer,
        g.rws - 1
      ) as cy
    from hits h
    cross join grid g
  ),
  per_kategori as (
    select cx, cy, category, count(*)::integer as n
    from celler
    group by cx, cy, category
  ),
  klynger as (
    select cx, cy, count(*)::integer as antall, avg(lat) as lat, avg(lng) as lng
    from celler
    group by cx, cy
  ),
  steder as (
    select
      h.*,
      case
        when p_lat is null or p_lng is null then null
        else extensions.st_distance(
          h.location,
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
          false
        )
      end as dist
    from hits h
  )
  select case
    when (select n from total) <= (select maks from terskel) then jsonb_build_object(
      'total', (select n from total),
      'modus', 'steder',
      'steder', coalesce((
        -- Samme kolonner som /api/activities leser (ROW_COLUMNS), og ingen
        -- andre: contact_email og organizer_id skal ikke ut her heller.
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'kind', s.kind,
          'title', s.title,
          'description', s.description,
          'category', s.category,
          'target_audience', s.target_audience,
          'venue_name', s.venue_name,
          'address', s.address,
          'municipality', s.municipality,
          'near_city', s.near_city,
          'lat', s.lat,
          'lng', s.lng,
          'starts_at', s.starts_at,
          'ends_at', s.ends_at,
          'is_free', s.is_free,
          'price_text', s.price_text,
          'url', s.url,
          'image_url', s.image_url,
          'opening_hours', s.opening_hours,
          'osm_tags', s.osm_tags,
          'is_indoor', s.is_indoor,
          'facets', s.facets,
          'distance_m', s.dist
        ) order by s.dist nulls last, s.id)
        from steder s
      ), '[]'::jsonb)
    )
    else jsonb_build_object(
      'total', (select n from total),
      'modus', 'klynger',
      'klynger', coalesce((
        select jsonb_agg(jsonb_build_object(
          'cx', k.cx,
          'cy', k.cy,
          'antall', k.antall,
          'lat', k.lat,
          'lng', k.lng,
          'kategorier', (
            select jsonb_object_agg(p.category, p.n)
            from per_kategori p
            where p.cx = k.cx and p.cy = k.cy
          )
        ) order by k.antall desc, k.cy, k.cx)
        from klynger k
      ), '[]'::jsonb)
    )
  end;
$$;

grant execute on function public.activities_map to anon, authenticated;
