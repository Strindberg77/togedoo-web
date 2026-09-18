-- 0019_activities_map_tynne_ruter.sql
--
-- Kjøres i Supabase SQL-editor (samme vei som 0001–0018). Erstatter
-- activities_map fra 0018 med `create or replace`. SAMME SIGNATUR, med vilje:
-- en ny parameter ville laget en OVERLAST ved siden av den gamle, og
-- PostgREST ville ikke kunnet velge mellom dem. Ingen tabell, indeks eller
-- annen funksjon endres.
--
-- HVORFOR
-- I klyngemodus ble hver ikke-tom rute én boble, også ruter med ett sted.
-- Målt 19. sep. 2026, utsnittet appen havnet i etter ett trykk i Oslo
-- (10.7444–10.7721, 59.90552–59.93189, 192 steder, rutenett 6 × 11):
--
--   57 bobler — 11 med «1», 10 med «2», 14 med «3».
--
-- Én boble for ett sted er ærlig, men klønete. Nå får TYNNE RUTER (høyst 3
-- steder) med selve stedene, i samme radform som stedsmodus, så appen kan
-- tegne vanlige markører for dem og bobler for resten. I samme utsnitt blir
-- det 22 bobler og 73 markører.
--
-- HVA SOM ER UENDRET
--   * Hver rute har fortsatt antall, tyngdepunkt og kategorier — også de
--     tynne. Summen av `antall` er fortsatt lik total.
--   * Stedsmodus (total <= terskel) er uendret.
--   * Nøklene som fantes i 0018 er uendret. Det eneste nye er `steder` på
--     tynne ruter, så en klient som ikke kjenner nøkkelen, tegner bobler som
--     før.
--
-- GRENSEN: 3 STEDER PER RUTE
-- Målt mot ekte data (antall ruter som blir markører, og stedene i dem):
--
--   192-utsnittet (57 ruter):  <= 3: 35 ruter / 73 steder  → 22 bobler igjen
--                              <= 5: 49 ruter / 133 steder → 8 bobler igjen
--   Sør-Norge (42 ruter):      <= 3: 20 ruter / 42 steder
--   Oslo sentrum (30 ruter):   <= 3: 0 ruter
--
-- Med 5 blir 192-utsnittet nesten bare markører (133 av 192), og kartet
-- nærmer seg det terskelen på 150 skulle hindre. Med 3 forsvinner de
-- klønete 1-2-3-boblene, mens de tette områdene fortsatt er bobler. En
-- rute på et telefonkart er rundt 70 × 60 pt; tre markører på 32 pt får
-- plass der, fem gjør det ikke.
--
-- HVOR STORT SVARET KAN BLI
-- Antall fulle rader i klyngemodus er høyst (antall ruter) × (grense). Grensen
-- regnes ned slik at produktet aldri passerer 500, samme tak som terskelen
-- (0018):
--
--   tynn_grense = least(3, floor(500 / (kolonner × rader)))
--
--   Via /api/kart (maks 6 × 12 = 72 ruter): 72 × 3 = 216 rader.
--     Målt radstørrelse: snitt 590 B, maks 1588 B → typisk ~130 kB,
--     verst tenkelig ~340 kB.
--   Direkte med anon-nøkkelen (maks 20 × 20 = 400 ruter): grensen blir 1,
--     altså høyst 400 rader — under taket på 500 som stedsmodus alt tillater.
--
-- Det verste tilfellet krever at HVER rute har nøyaktig 3 steder. I praksis
-- er det færre: 73 rader i 192-utsnittet, 42 over Sør-Norge.
--
-- SECURITY INVOKER og kolonneutvalget er som i 0018: RLS gjelder, og bare
-- kolonnene /api/activities leser går ut — ikke contact_email eller
-- organizer_id. Kolonnene står nå ett sted (`rader`), og både stedsmodus og
-- tynne ruter bygger JSON derfra.
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
  -- Klemt som rutenettet (0018). Funksjonen kan kalles direkte med
  -- anon-nøkkelen, og en ubegrenset terskel ville gitt alle rader med full
  -- tekst i ett svar.
  terskel as (
    select greatest(0, least(p_threshold, 500)) as maks
  ),
  -- Høyst så mange steder i en rute før den blir en boble. 3, men regnet
  -- ned så (ruter × grense) aldri passerer 500 — se hodet.
  tynn as (
    select least(3, floor(500.0 / (g.cols * g.rws)))::integer as maks
    from grid g
  ),
  celler as (
    select
      h.id,
      h.lat,
      h.lng,
      -- jsonb_object_agg feiler på en null-nøkkel (0018).
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
  -- Radformen ett sted. Kolonnene er de samme som /api/activities leser
  -- (ROW_COLUMNS), og INGEN andre: contact_email og organizer_id skal ikke
  -- ut. cx/cy er med for å finne ruta, og fjernes før JSON-en går ut.
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
      c.cx,
      c.cy
    from hits h
    join celler c on c.id = h.id
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
          -- NYTT: tynne ruter får med stedene. Tette ruter får ingen
          -- `steder`-nøkkel, så svaret vokser bare der det hjelper.
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
