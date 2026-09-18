# Kategorifilter som også treffer fasetter: forslag

**Status:** forslag og kandidat-SQL (18.09.2026). Ingenting er byttet.
`supabase/migrations/0021_kategori_via_fasett_kandidat.sql` lager to NYE
funksjoner ved siden av dagens. Frederik kjører fila, kandidatene måles mot
dagens funksjoner, og først etter det foreslås byttet.

## Problemet

Kategorifilteret i `activities_search` (0017) og `activities_map` (0020) er

```sql
and (p_categories is null or a.category = any(p_categories))
```

Det ser bare på hovedkategorien. To rader skal komme opp under en kategori de
ikke har som hovedkategori:

- **Dyreparken:** Dyremøte, fasett `fornoyelsespark`. Skal treffes av
  Fornøyelsespark.
- **Trysil skisenter:** Skianlegg, fasett `aking`. Skal treffes av Aking.

## Fasettene i dag (published, målt 18.09.2026)

| Fasett | Hovedkategorier | Tilsvarer en kategori? |
|---|---|---|
| `aking` | Aking 14, Skianlegg 9, Lekeplass 1 | Ja: Aking, men bare hvis store og små bokstaver ignoreres |
| `alpint` | Skianlegg 201 | Nei. Presiserer Skianlegg |
| `terrengsykling` | Skianlegg 11 | Nei |
| `skileik` | Skianlegg 6 | Nei |
| `downhill` | Skianlegg 3 | Nei |
| `fornoyelsespark` | (Dyremøte 1 etter seeden) | Ja: Fornøyelsespark, men ASCII mot ø, så de matcher **aldri** som streng |

Tokenene er ASCII og oversettes aldri (`lib/facets.ts`). Kategorinøklene er
norske. Å utlede den ene fra den andre (`lower(token) = lower(kategori)`)
virker for `aking`, feiler for `fornoyelsespark` og ville gjort `alpint` til
en kategori den dagen noen lager en kategori som heter Alpint.

Skateboard- og BMX-fasettene i appen kommer ikke fra `facets`-kolonnen, men
fra `osm_tags.sport`. De berøres ikke her.

## Regelen

**En fasett teller som kategoritreff bare når den står i en eksplisitt tabell
fasett → kategori.** Tabellen bor i `lib/facets.ts`, ved siden av
`FACET_TOKENS`:

```ts
export const FASETT_SOM_KATEGORI: Partial<Record<FacetToken, string>> = {
    aking: 'Aking',
    fornoyelsespark: 'Fornøyelsespark',
};
```

- **Kvalifiserer:** fasetter som svarer på «hva ER stedet også?»
  (Dyreparken ER en fornøyelsespark, Trysil HAR en akebakke).
- **Kvalifiserer ikke:** fasetter som presiserer hovedkategorien (alpint,
  skileik), og som aldri skal gi treff i en annen kategori.
- **Filteret utvides, men innføres aldri av en fasett.** Uten
  kategorifilter er alt som før.

API-et oversetter `category=Aking` til `p_categories={Aking}` pluss
`p_category_facets={aking}`. SQL-en får ferdige lister og vet ingenting om
tabellen. Da er det én kilde, og en test kan låse at hvert token i tabellen
står i `FACET_TOKENS`, og at hver kategori finnes.

Konsekvens å vite om: Aking går fra 14 til 24 rader i et Aking-filter
(9 skianlegg og «Lekeplass i Simensbråten»). Det er meningen for skianleggene.
Lekeplassen har en tagget akebakke, og det er riktig at den kommer med.

## Kandidat-SQL

Se `supabase/migrations/0021_kategori_via_fasett_kandidat.sql`. Hver
funksjon er en kopi av originalen med én endret betingelse og én ny parameter
sist (`p_category_facets text[] default null`). Bare service_role har
kjøretilgang, slik at kandidatene ikke blir en del av det offentlige API-et.

`kategorier` i kartets bobler teller fortsatt på hovedkategorien, så i en
Fornøyelsespark-boble står Dyreparken som «Dyremøte: 1». Antall i boblen er
riktig.

## Målingen før byttet

Samme punkter som for 0019/0020, mot dagens funksjoner og kandidaten:

| Tilfelle | Parametre |
|---|---|
| Sør-Norge, alle kategorier | bbox 4,57.8,12.5,63.5 |
| Sør-Norge, Aking | + `{Aking}` / `{aking}` |
| Oslo, Lekeplass | bbox Oslo, `{Lekeplass}`, ingen fasett |
| Søk | `p_q = 'park'`, posisjon Oslo, `{Fornøyelsespark}` / `{fornoyelsespark}` |

For hvert tilfelle: samme resultat der ingen fasett er sendt (radene og
totalen er identiske), riktig tillegg der fasett er sendt, og svartid
(`explain analyze`, median av fem). Risikoen er at `or a.facets && …` hindrer
planen i å bruke kategorifilteret tidlig. `facets` har GIN-indeks (0016).

## Målt (18.09.2026)

Frederik kjørte 0021. `explain analyze` over Sør-Norge: dagens
`activities_map` med Aking tok 58 ms varm (206 ms kald), kandidaten med
fasett 43 ms, og kandidaten uten filter 96 ms.

Måling via service-nøkkelen, ti kall per variant etter ett oppvarmingskall,
min / median / maks. Tidene inkluderer nettverket:

| Variant | Dagens | Kandidat | Innhold |
|---|---|---|---|
| Sør-Norge, kart, uten filter | 157 / 160 / 170 ms | 143 / 153 / 209 ms | identisk (7 957) |
| Sør-Norge, kart, Aking | 81 / 84 / 116 ms | 85 / 87 / 99 ms | 13 → 23 |
| Oslo sentrum, kart, uten filter | 85 / 95 / 108 ms | 88 / 94 / 124 ms | identisk (824) |
| Oslo sentrum, kart, Lekeplass | 81 / 86 / 94 ms | 82 / 93 / 597 ms | identisk (314) |
| Søk «park» fra Oslo, uten filter | 132 / 135 / 159 ms | 132 / 140 / 171 ms | identisk (51) |
| Søk «park» fra Oslo, Fornøyelsespark | 78 / 87 / 172 ms | 79 / 96 / 172 ms | 6 → 7 |

Maks 597 ms er ett enkelt kall. Medianen er på linje med dagens.

Innhold:

- **Uten fasettliste er svaret identisk:** kart for hele Norge (7 992),
  de 500 nærmeste fra Oslo, og Skianlegg over Sør-Norge (167).
- **Aking i hele landet går fra 14 til 24**, og alle de 14 gamle er med.
  De ti nye er Beitostølen Skisenter, Budor skitrekk, Gamlestølen,
  Lekeplass i Simensbråten, Nerskogen skisenter, Røros Alpinsenter
  Hummelfjell, Skarslia Ski- og Akesenter, Skianlegg ved Fageråsen 913,
  SkiGeilo og Trysil skisenter. I Sør-Norge-utsnittet er tallene 13 → 23;
  én Aking-rad ligger nord for utsnittet.
- **Fornøyelsespark gir 7:** de seks parkene og Dyreparken (Dyremøte).

Byttet er skrevet som `supabase/migrations/0022_kategori_via_fasett.sql`,
men ikke kjørt.

## Byttet, når målingen er godkjent

1. En migrasjon som erstatter `activities_search` og `activities_map` med
   kandidatenes kropp, og dropper kandidatene.
2. `app/api/activities/route.ts` og `app/api/kart/route.ts` sender
   `p_category_facets` fra tabellen.
3. **Den flate stien** i `/api/activities` (kommune-modus,
   `query.in('category', …)`, linje 164) må få samme utvidelse:
   `.or('category.in.(…),facets.ov.{…}')`. Ellers treffer Fornøyelsespark
   Dyreparken i kartet og i nasjonalt søk, men ikke i kommune-modus.

## Appen (togedoo-modern): hva må endres

Dette er bare lest. Ingenting i appen er endret.

1. **`ExploreFilter.placeMatches`** (`lib/services/explore_filter.dart`)
   sjekker `categories.contains(place.category)`. En rad som kommer via
   fasett, blir kastet her, og Dyreparken forsvinner fra lista selv om API-et
   leverer den. Dette må bli `category ∈ valgte ELLER place.facets ∩
   fasettene til de valgte`. `DatahubPlace.facets` er allerede parset.
2. **Tabellen må finnes i appen også.** Det enkleste er et felt på
   `CategoryTheme`, for eksempel `fasett: 'fornoyelsespark'` på
   Fornøyelsespark og `fasett: 'aking'` på Aking. Da er det én oppføring per
   kategori, på samme sted som etikett og søkeord.
3. **`categoryBreakdown`** (`lib/utils/place_summary.dart`) teller på
   `p.category`. I en Fornøyelsespark-liste ville det stått
   «Fornøyelsespark 6 · Dyremøte 1», og det ser ut som et filter som lekker.
   Når et filter er aktivt, bør raden telles under kategorien den ble truffet
   av.
4. **Kategorien må finnes i appen:** Fornøyelsespark i `CategoryTheme`
   (farge, ikon, illustrasjon), `ExploreFilter.filterChips`,
   `_serverCategories` og `outdoorPlaceCategories`. Uten den vises de seks
   radene med standardtemaet og uten chip.
5. **Kartet** filtrerer ikke på klientsiden (`OmradeController` sender
   kategoriene til `/api/kart` og viser det som kommer), så der holder
   API-endringen.

**Hvordan raden vises:** med **hovedkategoriens** ikon og farge. Dyreparken er
en dyrepark med markør, flis og detaljark som Dyremøte, uansett filter.
Kategorien er det stedet ER, og samme sted skal ikke skifte utseende etter
hvilket filter som er på. Det som endres, er underteksten når raden kom via
fasett: «Dyremøte og fornøyelsespark · Kristiansand» i stedet for
«Dyremøte · Kristiansand». Da ser forelderen hvorfor en dyrepark står i en
liste over fornøyelsesparker.
