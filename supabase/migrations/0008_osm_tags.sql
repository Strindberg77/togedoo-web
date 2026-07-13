-- Rå OSM-tagger for faste steder (kind='place')
--
-- Tag-dekningsproben (jul. 2026, Oslo/Trondheim/Stavanger) viste at kun
-- surface (63,7 %) og lit (27,2 %) på Ballbane har dekning over
-- visningsterskelen — men i stedet for å plukke enkeltkolonner lagres
-- alle rå tags som jsonb ved import. Det fanger også tagger vi ikke har
-- vurdert ennå, og nye visningsfelter krever da bare API-/app-endring,
-- ingen ny import-runde. API-et eksponerer kun utvalgte felter
-- (surface/lit i første omgang), aldri hele blobben.

alter table public.activities add column if not exists osm_tags jsonb;
