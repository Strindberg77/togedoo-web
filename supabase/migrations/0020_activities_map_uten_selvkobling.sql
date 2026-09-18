-- 0020_activities_map_uten_selvkobling.sql
--
-- Kjøres i Supabase SQL-editor (samme vei som 0001–0019). Erstatter
-- activities_map fra 0019 med `create or replace`, samme signatur. Ingen
-- tabell, indeks eller annen funksjon endres. OPPFØRSELEN ER IDENTISK med
-- 0019: samme nøkler, samme tynne ruter, samme rekkefølge.
--
-- HVORFOR — EN REGRESJON I 0019
-- 0019 bygde `rader` ved å koble `hits` mot `celler` på id, for å finne
-- ruta hver rad ligger i. Begge er materialiserte CTE-er, uten indeks og
-- uten statistikk. Målt 18. sep. 2026, Sør-Norge (7949 steder):
--
--   0018:                     ~200 ms (lokalt via /api/kart), ~0,6 s i produksjon
--   0019, service-nøkkel:     5,5 s direkte mot basen, 7,5–8,5 s i produksjon
--   0019, anon-nøkkel:        faller på statement timeout (3 s)
--
-- Tiden var den samme med og uten lat/lng, så avstandsberegningen var ikke
-- årsaken. Det som passer med tallene, er en nestet løkke over to
-- CTE-skanninger: 7949 × 7949 ≈ 63 millioner sammenligninger. Oslo sentrum
-- (1250 rader, ~1,5 millioner) merket det knapt. 0018 hadde ingen slik
-- kobling.
--
-- RETTELSEN
-- Ruta (cx, cy) regnes ÉN gang, i `hits`. Da trenger verken `celler` eller
-- `rader` å koble noe på id: `celler` leser rett fra `hits`, og `rader`
-- filtreres med et oppslag mot `klynger` — høyst 20 × 20 = 400 rader, så
-- oppslaget er billig uansett plan. Formelen for ruta står også bare ett
-- sted, i stedet for å gjentas.
--
-- Alt annet er som i 0019 (se hodet der): tynne ruter (<= 3 steder, regnet ned
-- så ruter × grense <= 500) får med stedene; `rader` bygges bare for radene
-- som skal ut; kolonneutvalget er det /api/activities leser; security
-- invoker; terskelen klemmes til 0–500.
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

grant execute on function public.activities_map to anon, authenticated;
