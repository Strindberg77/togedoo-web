-- 0021_kategori_via_fasett_kandidat.sql
--
-- KANDIDATER, IKKE ERSTATNINGER. To nye funksjoner ved siden av dagens:
--   activities_search_kandidat  (kopi av activities_search, 0017)
--   activities_map_kandidat     (kopi av activities_map, 0020)
-- Dagens funksjoner røres ikke. API-et kaller dem ikke. Frederik kjører
-- fila, kandidatene måles mot dagens på ekte data, og først etter det
-- foreslås et bytte (en egen migrasjon som erstatter de to og dropper disse).
--
-- ENDRINGEN er én linje i hver funksjon, pluss én ny parameter sist:
--
--   p_category_facets text[] default null
--
--   før:  and (p_categories is null or a.category = any(p_categories))
--   nå:   and (p_categories is null
--              or a.category = any(p_categories)
--              or a.facets && coalesce(p_category_facets, '{}'))
--
-- REGELEN for når en fasett teller som kategoritreff, bor IKKE her. SQL-en
-- får en ferdig liste med fasett-tokens fra API-et. API-et slår opp i ÉN
-- tabell i lib/facets.ts (fasett → kategori), og sender bare tokens for
-- kategoriene brukeren har valgt:
--
--   category=Fornøyelsespark  →  p_categories      = {Fornøyelsespark}
--                                p_category_facets = {fornoyelsespark}
--   category=Aking            →  p_categories      = {Aking}
--                                p_category_facets = {aking}
--   category=Skianlegg        →  p_categories      = {Skianlegg}
--                                p_category_facets = null
--
-- Hvorfor en tabell og ikke lower(token) = lower(kategori): «aking» ~ «Aking»
-- går, men «fornoyelsespark» (ASCII) blir aldri «Fornøyelsespark», og
-- «alpint» skal ALDRI bli en kategori. Tokenene er ASCII fordi de ikke
-- oversettes; kategorinøklene er norske. De to skal ikke utledes av
-- hverandre.
--
-- UTEN FILTER (p_categories null) er alt som før: fasettene utvider bare et
-- kategorifilter som allerede er satt, de innfører aldri et nytt.
--
-- `kategorier` i activities_map_kandidat teller fortsatt på hovedkategorien.
-- Dyreparken i en Fornøyelsespark-boble står der som «Dyremøte: 1». Det er
-- sant (det er det stedet ER), og antall i boblen er uansett riktig.
--
-- TILGANG: bare service_role. Kandidatene skal måles, ikke brukes av appen,
-- og en funksjon anon kan kalle er en del av det offentlige API-et.
-- security invoker og search_path som originalene.

create or replace function public.activities_search_kandidat(
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
  p_limit integer default 50,
  p_category_facets text[] default null
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
      and (p_categories is null
           or a.category = any(p_categories)
           -- NYTT: fasett-treff. Bare fasetter API-et har sendt, altså
           -- de som i lib/facets.ts er erklært som «samme ting som en
           -- kategori». alpint og downhill kommer aldri hit.
           or a.facets && coalesce(p_category_facets, '{}'::text[]))
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

create or replace function public.activities_map_kandidat(
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
  p_lng double precision default null,
  p_category_facets text[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with grid as (
    select greatest(1, least(p_cols, 20)) as cols,
           greatest(1, least(p_rows, 20)) as rws
  ),
  -- Treffene, med ruta regnet ut her og bare her. Kanten mot øst og nord
  -- klemmes inn i siste rute, så hvert sted havner i nøyaktig én.
  hits as (
    select
      a.*,
      least(
        floor((a.lng - p_west) / nullif(p_east - p_west, 0) * g.cols)::integer,
        g.cols - 1
      ) as cx,
      least(
        floor((a.lat - p_south) / nullif(p_north - p_south, 0) * g.rws)::integer,
        g.rws - 1
      ) as cy
    from public.activities a
    cross join grid g
    where a.status = 'published'
      and a.lat is not null
      and a.lng is not null
      and a.lat between p_south and p_north
      and a.lng between p_west and p_east
      and (p_kind is null or a.kind = p_kind)
      and (p_categories is null
           or a.category = any(p_categories)
           -- NYTT: fasett-treff. Bare fasetter API-et har sendt, altså
           -- de som i lib/facets.ts er erklært som «samme ting som en
           -- kategori». alpint og downhill kommer aldri hit.
           or a.facets && coalesce(p_category_facets, '{}'::text[]))
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
  -- Klemt som rutenettet (0018). Funksjonen kan kalles direkte med
  -- anon-nøkkelen, og en ubegrenset terskel ville gitt alle rader med full
  -- tekst i ett svar.
  terskel as (
    select greatest(0, least(p_threshold, 500)) as maks
  ),
  -- Høyst så mange steder i en rute før den blir en boble: 3, regnet ned så
  -- (ruter × grense) aldri passerer 500 (0019).
  tynn as (
    select least(3, floor(500.0 / (g.cols * g.rws)))::integer as maks
    from grid g
  ),
  celler as (
    select
      h.lat,
      h.lng,
      -- jsonb_object_agg feiler på en null-nøkkel (0018).
      coalesce(h.category, 'Ukjent') as category,
      h.cx,
      h.cy
    from hits h
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
  -- Radformen ett sted. Kolonnene er de samme som /api/activities leser
  -- (ROW_COLUMNS), og INGEN andre: contact_email og organizer_id skal ikke
  -- ut. cx/cy er med for å finne ruta, og fjernes før JSON-en går ut.
  --
  -- BARE RADENE SOM SKAL UT: alle i stedsmodus, ellers bare de i tynne
  -- ruter (0019). Ingen kobling på id — ruta står alt på raden, og
  -- oppslaget går mot `klynger` (høyst 400 rader).
  rader as (
    select
      h.id,
      h.kind,
      h.title,
      h.description,
      h.category,
      h.target_audience,
      h.venue_name,
      h.address,
      h.municipality,
      h.near_city,
      h.lat,
      h.lng,
      h.starts_at,
      h.ends_at,
      h.is_free,
      h.price_text,
      h.url,
      h.image_url,
      h.opening_hours,
      h.osm_tags,
      h.is_indoor,
      h.facets,
      case
        when p_lat is null or p_lng is null then null
        else extensions.st_distance(
          h.location,
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
          false
        )
      end as distance_m,
      h.cx,
      h.cy
    from hits h
    where (select n from total) <= (select maks from terskel)
       or exists (
         select 1
         from klynger k
         where k.cx = h.cx
           and k.cy = h.cy
           and k.antall <= (select maks from tynn)
       )
  )
  select case
    when (select n from total) <= (select maks from terskel) then jsonb_build_object(
      'total', (select n from total),
      'modus', 'steder',
      'steder', coalesce((
        select jsonb_agg(to_jsonb(r) - 'cx' - 'cy' order by r.distance_m nulls last, r.id)
        from rader r
      ), '[]'::jsonb)
    )
    else jsonb_build_object(
      'total', (select n from total),
      'modus', 'klynger',
      'klynger', coalesce((
        select jsonb_agg(
          jsonb_build_object(
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
          )
          -- Tynne ruter får med stedene (0019). Tette ruter får ingen
          -- `steder`-nøkkel.
          || case
               when k.antall <= (select maks from tynn) then jsonb_build_object(
                 'steder', (
                   select jsonb_agg(to_jsonb(r) - 'cx' - 'cy' order by r.distance_m nulls last, r.id)
                   from rader r
                   where r.cx = k.cx and r.cy = k.cy
                 )
               )
               else '{}'::jsonb
             end
          order by k.antall desc, k.cy, k.cx
        )
        from klynger k
      ), '[]'::jsonb)
    )
  end;
$$;

revoke execute on function public.activities_search_kandidat from public, anon, authenticated;
revoke execute on function public.activities_map_kandidat from public, anon, authenticated;
grant execute on function public.activities_search_kandidat to service_role;
grant execute on function public.activities_map_kandidat to service_role;
