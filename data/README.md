# `data/` — referansedata

Filer som IKKE er kildekode og IKKE importeres av appen. De leses av skript
under `scripts/`, og ligger i repoet fordi de må være reproduserbare: en URL
kan endre innhold eller forsvinne, et git-objekt kan ikke.

## `kommuner.geojson` — kommunegrenser

| | |
|---|---|
| Kilde | [Kartverket](https://kartkatalog.geonorge.no), via [robhop/fylker-og-kommuner](https://github.com/robhop/fylker-og-kommuner) |
| Fil | `Kommuner-L.geojson` (høyeste av tre kvaliteter) |
| Versjon | 2024 |
| Lisens | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — **attribusjon til Kartverket kreves der dataene vises** |
| sha256 | `cbaa800120130c881c607f8834852b4b9abbea75d767bed795a5781b21cf736f` |
| Størrelse | 10,3 MB (357 kommuner) |

### Hvorfor L og ikke M eller S

Målt mot L over et rutenett på 12 000 punkter i Norge (0,05° × 0,10°):

| Kvalitet | Størrelse | Ulik kommune | Bare én av de to traff |
|---|---|---|---|
| S | 1,25 MB | 0,37 % | 1,34 % |
| M | 3,3 MB | 0,12 % | 0,65 % |
| **L** | **10,3 MB** | — (referansen) | — |

Feilene ligger langs kystlinje og kommunegrenser, altså nøyaktig der et
badeplass- eller alpinanlegg kan ligge. `municipality` avgjør om en rad er
synlig i by-modus, så 7 MB spart mot 0,8 % feil er en dårlig byttehandel for
en fil som røres én gang i året.

Fila importeres aldri av appkode, så den havner ikke i Next.js-bunten.

### Hvordan den holdes oppdatert

Kommunegrenser endres ved kommunereform, i praksis ved et årsskifte.

1. Last ned `Kommuner-L.geojson` på nytt fra repoet over.
2. Erstatt fila her, og oppdater versjon og sha256 i tabellen.
3. Kjør `node --import tsx --test lib/municipality.test.ts`. Testene slår ut
   hvis antall kommuner endres, hvis et kjent kontrollpunkt havner i feil
   kommune, eller hvis en tospråklig kommune mangler i
   [BILINGUAL_MUNICIPALITIES].
4. Kommer en NY tospråklig kommune til, feiler testen til den er lagt inn i
   overstyringstabellen. Det er med vilje: valget av hvilket navn appen bruker
   skal tas av et menneske, ikke av posisjonen i en streng.

**Git-diffen er revisjonssporet.** Endrer grensene seg, skal det synes i en
gjennomlesing — ikke oppdages fordi en rad plutselig ble usynlig i by-modus.
