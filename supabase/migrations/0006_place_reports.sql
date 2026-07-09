-- Brukertips og feilrapporter for steder (kind='place')
--
-- Tips om nye steder gjenbruker activities med status='pending' på kilden
-- bruker-tips, og modereres med eksisterende admin-API. Feilrapporter
-- («finnes ikke», «feil lokasjon», «feil info») lagres her; medhold i
-- «finnes ikke» gir status='rejected' + locked=true på aktiviteten, som
-- OSM-re-importen aldri rører (locked kom i 0005).

create table public.place_reports (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  reason text not null check (reason in ('finnes_ikke', 'feil_lokasjon', 'feil_info')),
  comment text not null default '',
  status text not null default 'ny' check (status in ('ny', 'behandlet')),
  created_at timestamptz not null default now()
);

create index place_reports_status_idx on public.place_reports (status);

alter table public.place_reports enable row level security;
-- Ingen policies: kun service_role, all tilgang via API-rutene.

insert into public.sources (slug, name, kind, url) values
  ('bruker-tips', 'Brukertips (steder)', 'manual', null)
on conflict (slug) do nothing;
