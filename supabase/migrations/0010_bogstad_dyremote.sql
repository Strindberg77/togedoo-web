-- 0010_bogstad_dyremote.sql
--
-- Bogstad gård importeres fra OSM (tourism=museum) og havner i dag som
-- «Museum». I en familie-utflukts-sammenheng hører den bedre hjemme under
-- «Dyremøte» — den er en historisk herregård MED gårdsmiljø og dyr, og din
-- kuratering plasserte den som et dyre-/gårdsbesøksmål.
--
-- Alternativ A (valgt): flytt raden til Dyremøte og LÅS den. locked=true gjør
-- at OSM-re-importen aldri overskriver kategorien igjen (samme mekanisme som
-- for brukerrapporterte steder, jf. 0005/0006). Én rad, ingen duplikat, og
-- OSM-koordinatene/åpningstidene beholdes. Fritekstsøket finner den fortsatt
-- på navn uansett kategori.
--
-- Dette er en engangs-omklassifisering av en EKSISTERENDE rad. Forutsetter at
-- Bogstad allerede er importert (produksjon har kjørt OSM-importen). Er Bogstad
-- IKKE OSM-museum-tagget (og dermed ikke i importen), er dette en trygg no-op,
-- og stedet bør i stedet legges i scripts/seed-dyremote.ts.

update public.activities a
set category = 'Dyremøte', locked = true
from public.sources s
where a.source_id = s.id
  and s.slug = 'osm-steder'
  and a.category = 'Museum'
  and a.municipality = 'Oslo'
  and a.title ilike '%Bogstad%';
