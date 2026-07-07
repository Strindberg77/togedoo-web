-- Arrangørkontoer (oppgave 2.9, del 2)
--
-- Innlogging skjer med Supabase Auth (magic link). organizers-raden
-- opprettes av API-et ved første innlogging. Hver konto får sin egen
-- kilde-rad (sources.organizer_id); anonym innsending fortsetter på den
-- delte kilden arrangor-innsending.
--
--   verified = true            -> innsendinger auto-publiseres
--   notify_on_submission=true  -> bekreftelses-e-post (opt-in, default av)

create table public.organizers (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  contact_email text not null,
  verified boolean not null default false,
  notify_on_submission boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.organizers enable row level security;
-- Ingen policies: kun service_role, all tilgang går via API-rutene.

alter table public.sources
  add column if not exists organizer_id uuid references public.organizers (id) on delete set null;

create unique index if not exists sources_organizer_id_key
  on public.sources (organizer_id)
  where organizer_id is not null;
