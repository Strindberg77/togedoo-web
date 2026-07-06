-- Seed av startkilder for ingestion (deichman + bergen-bibliotek).
--
-- 0001 inneholder samme insert, men uten konflikthåndtering — denne filen
-- kan trygt kjøres på nytt og reparerer et miljø der 0001 ble delvis kjørt
-- (tabellen finnes, men radene mangler). Slug-ene må matche ADAPTERS i
-- lib/ingest.ts.
insert into public.sources (slug, name, kind, url) values
  ('deichman', 'Deichman bibliotek', 'crawl', 'https://deichman.no/hva-skjer'),
  ('bergen-bibliotek', 'Bergen bibliotek', 'feed', 'https://bergenbibliotek.no/arrangement/rss.xml')
on conflict (slug) do update
  set name = excluded.name,
      kind = excluded.kind,
      url = excluded.url,
      active = true;
