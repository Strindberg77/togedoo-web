-- Arrangørflyt (oppgave 2.9)
--
-- Innsendte events lander som status='pending' på kilden
-- arrangor-innsending og publiseres/avvises via admin-API-et i togedoo-web.
-- Pending-rader er allerede usynlige for lesing (RLS-policyen og
-- activities_nearby filtrerer på status='published').

alter table public.activities add column if not exists contact_email text;

insert into public.sources (slug, name, kind, url) values
  ('arrangor-innsending', 'Arrangørinnsendinger', 'organizer', null)
on conflict (slug) do nothing;
