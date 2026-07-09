-- Faste steder fra OpenStreetMap (kind='place')
--
-- opening_hours: OSM sitt maskinlesbare format, lagres rått og formateres
-- i appen. locked: rader import-jobben aldri skal røre — settes når en
-- brukerrapport bekrefter at stedet er borte (status='rejected' + locked)
-- eller når en rad er manuelt korrigert. Hindrer at månedlig re-import
-- gjenoppliver/overskriver dem.

alter table public.activities add column if not exists opening_hours text;
alter table public.activities add column if not exists locked boolean not null default false;

insert into public.sources (slug, name, kind, url) values
  ('osm-steder', 'OpenStreetMap (faste steder)', 'crawl', 'https://www.openstreetmap.org')
on conflict (slug) do nothing;
