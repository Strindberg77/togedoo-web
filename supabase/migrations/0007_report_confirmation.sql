-- Mengde-basert selvbekreftelse for stedsrapporter og tips (fase 1)
--
-- place_reports får rapportør-fingerprint (saltet hash av anonym device-ID
-- fra appen — ikke IP alene, siden en familie på samme wifi ville telle som
-- én), avstand rapportør→sted, og ny status 'auto_behandlet' for rapporter
-- lukket av auto-terskelen (3 unike rapportører på 'finnes_ikke' innen 60
-- dager, med posisjon nær stedet → rejected + locked uten admin).
-- ip_hash brukes kun til rate-limiting i databasen (dagens in-memory-limiter
-- nullstilles per serverless-instans og beskytter i praksis ikke).
--
-- activities.high_trust: to uavhengige pending-tips innen ~75 m med samme
-- kategori flagges og løftes øverst i admin-køen (ingen autopublisering).

alter table public.place_reports add column if not exists reporter_hash text;
alter table public.place_reports add column if not exists ip_hash text;
alter table public.place_reports add column if not exists reported_from_distance_m integer;

alter table public.place_reports drop constraint place_reports_status_check;
alter table public.place_reports add constraint place_reports_status_check
  check (status in ('ny', 'behandlet', 'auto_behandlet'));

-- Samme person teller aldri dobbelt på samme sted+årsak. Rapporter uten
-- fingerprint (reporter_hash null) er tillatt i ubegrenset antall — de
-- teller i admin-køen, men aldri mot auto-terskelen.
alter table public.place_reports add constraint place_reports_unique_reporter
  unique (activity_id, reason, reporter_hash);

create index place_reports_ip_recent_idx on public.place_reports (ip_hash, created_at);
create index place_reports_activity_reason_idx on public.place_reports (activity_id, reason);

alter table public.activities add column if not exists high_trust boolean not null default false;
