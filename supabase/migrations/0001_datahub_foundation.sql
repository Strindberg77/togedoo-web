-- Togedoo Community datahub — grunnskjema
--
-- Kjøres i Supabase-prosjektet under ThinkB8-organisasjonen (SQL-editor
-- eller supabase db push). Krever PostGIS, som Supabase har innebygd.
--
-- Designprinsipper:
--   - Alle aktiviteter (tidfestede events OG statiske steder) ligger i én
--     tabell, skilt med `kind`. Appens kart trenger begge i samme spørring.
--   - Koordinater settes ved innsamling (server-side geokoding), aldri i
--     appen. `location` er en generert PostGIS-kolonne for radius-søk.
--   - Skriving skjer kun med service_role (ingestion + arrangørflyt går via
--     API-et i togedoo-web). Anonym lesing er begrenset til publiserte rader.
--   - `sources.kind = 'organizer'` og `activities.status = 'pending'` er
--     forberedt for arrangørflyten (oppgave 2.9).

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Kilder
-- ---------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('crawl', 'feed', 'organizer', 'manual')),
  url text,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_sync_status text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Aktiviteter (events og statiske steder)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  external_id text not null,
  kind text not null check (kind in ('event', 'place')),
  title text not null,
  description text not null default '',
  category text not null default 'Aktivitet',
  target_audience text not null default 'For alle',
  venue_name text,
  address text,
  municipality text,
  lat double precision,
  lng double precision,
  location extensions.geography(point, 4326)
    generated always as (
      case
        when lat is not null and lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
        else null
      end
    ) stored,
  starts_at timestamptz,
  ends_at timestamptz,
  is_free boolean,
  price_text text,
  url text,
  image_url text,
  status text not null default 'published'
    check (status in ('pending', 'published', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index activities_location_idx on public.activities using gist (location);
create index activities_kind_category_idx on public.activities (kind, category);
create index activities_municipality_idx on public.activities (municipality);
create index activities_starts_at_idx on public.activities (starts_at);
create index activities_status_idx on public.activities (status);

create or replace function public.tg_activities_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger activities_touch_updated_at
  before update on public.activities
  for each row execute function public.tg_activities_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Geokodings-cache (unngår gjentatte kall mot Kartverket/Nominatim)
-- ---------------------------------------------------------------------------
create table public.geocode_cache (
  query text primary key,
  lat double precision,
  lng double precision,
  formatted_address text,
  provider text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: anonym lesing av publiserte aktiviteter, alt annet kun service_role
-- ---------------------------------------------------------------------------
alter table public.sources enable row level security;
alter table public.activities enable row level security;
alter table public.geocode_cache enable row level security;

create policy "activities_public_read"
  on public.activities for select
  to anon, authenticated
  using (status = 'published');

-- Ingen policies på sources/geocode_cache: kun service_role har tilgang.

-- ---------------------------------------------------------------------------
-- Radius-søk: alt publisert innen p_radius_m meter fra punktet
-- ---------------------------------------------------------------------------
create or replace function public.activities_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 10000,
  p_kind text default null,
  p_category text default null,
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
    and (a.kind = 'place' or a.starts_at is null or a.starts_at > now() - interval '2 hours')
  order by a.location operator(extensions.<->)
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  limit least(p_limit, 500);
$$;

grant execute on function public.activities_nearby to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Startkilder
-- ---------------------------------------------------------------------------
insert into public.sources (slug, name, kind, url) values
  ('deichman', 'Deichman bibliotek', 'crawl', 'https://deichman.no/hva-skjer'),
  ('bergen-bibliotek', 'Bergen bibliotek', 'feed', 'https://bergenbibliotek.no/arrangement/rss.xml');
