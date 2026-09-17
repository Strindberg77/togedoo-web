# Utforsk: søk og stedsvalg i dag

**Status:** bare kodelesing, 17. sep. 2026. Ingen kode er endret, og basen er
ikke spurt. Tallene 201 Skianlegg i 132 kommuner er fra verifikasjonen samme
dag (se `skianlegg-adkomst.md`).

Utgangspunkt: søk på «Voss» i Utforsk gir null treff, og stedsvelgeren har bare
«Bruk posisjonen min» og fire byer. Dette dokumentet beskriver hvordan det
henger sammen. Det inneholder ingen anbefaling om UI.

Stier i `togedoo-modern` er merket **app**, stier i `togedoo-web` er merket
**web**.

---

## 1. Søkefeltet: både API-parameter og klientfilter

Søket gjør begge deler, og begge er avgrenset til stedet som alt er valgt.

**Til API-et.** Hvert tastetrykk lagres straks. Etter 350 ms hentes lista på
nytt fra samme kilde (app `lib/screens/explore_screen.dart:200-206`).
`_serverQuery` blir `q` (`:139-140`) og sendes med i begge hentemåtene:

- Posisjon: `lat`, `lng`, `radius` og `q` (`:311-318`).
- By: `municipality` og `q` (`:340-345`).

`DatahubService.fetchPlaces` bygger URL-en `/api/activities?kind=place&limit=100&…`
(app `lib/services/datahub_service.dart:29-57`). Byttet mellom de to skjer i
`_refetchPlaces` (`explore_screen.dart:385-398`). **Det finnes ingen tredje
gren uten sted.**

**I klienten.** `_buildGridView` filtrerer den hentede lista på nytt med samme
tekst (`explore_screen.dart:1480-1485`). `ExploreFilter.filterPlaces` sjekker
tittel, kategori, beskrivelse, adresse og **kommune** (app
`lib/services/explore_filter.dart:237-252`). Filteret ser bare de inntil 100
radene som er hentet.

### Hvorfor «Voss» gir null

- **By-modus (for eksempel Oslo).** API-et ANDer
  `(municipality ilike 'Oslo' OR near_city ilike 'Oslo')` med tekstsøket
  (web `app/api/activities/route.ts:222-240`). Ingen rad i Oslo har «Voss» i
  tekstfeltene, så svaret er tomt.
- **Posisjonsmodus.** RPC-en `activities_nearby` krever `st_dwithin(radius)`
  før tekstsøket (web `supabase/migrations/0015_event_window_ends_at.sql`).
  Står du 10 km fra Oslo sentrum, ligger Voss utenfor.
- **Kommunen søkes ikke i API-et.** `q` matcher `title`, `description`,
  `venue_name`, `address` og `category` (route.ts:235-238, samme felt i
  RPC-en). `municipality` og `near_city` er ikke med. Klientfilteret sjekker
  kommune, men bare i lista som alt er avgrenset til et annet sted.

Søket virker altså som «innsnevring innenfor valgt sted». Det kan aldri flytte
brukeren til et annet sted.

---

## 2. Radius

| Valg | Radius | Hvor |
|---|---|---|
| «Bruk posisjonen min» | 10 km ved start | app `explore_screen.dart:82` (`_radiusMeters = 10000`) |
| Avstandschips i filterarket | 5 / 10 / 20 / 50 km | app `explore_screen.dart:95`, seksjonen `:497-533` |
| By-valg (Oslo, Bergen, Trondheim, Stavanger) | **Ingen radius.** Filtrerer på `municipality` eller `near_city` | app `lib/services/places_source.dart:10`, web route.ts:222-228 |
| API-ets tak | `radius` klemmes til **100 000 m (100 km)**, standard er 10 000 | web route.ts:139 |

**Det finnes ikke noe 200 km-tak i koden.** Tallet står bare i en
tankeeksperiment-setning i web `docs/nasjonal-dekning.md:39`. Det faktiske
taket er 100 km i API-et, og appen går ikke over 50 km.

**Kan brukeren endre radius?**

- **Ja, men bare i posisjonsmodus.** Avstandsseksjonen i filterarket vises bare
  når `_placesMode == position` og en posisjon finnes (`explore_screen.dart:990`,
  `:1028`). Valget lagres ikke i `SharedPreferences`, så det er 10 km igjen ved
  neste start. Undertittelen i stedsvelgeren viser valgt radius (`:468`).
- **By-modus har ingen radius.** Byen er en kommunegrense pluss kuraterte
  `near_city`-rader.
- **Innstillingene har en død «Søkeradius».** Nedtrekket (0–2 km … 25 km+) i
  app `lib/screens/settings_screen.dart:124-129` er lokal `setState`. Det
  lagres ikke og leses ikke av Utforsk. Det samme gjelder `searchRadius` i
  `lib/widgets/profile/profile_state_manager.dart:128`.

---

## 3. `/api/activities` (web `app/api/activities/route.ts`)

Appen bruker bare dette endepunktet for å liste steder.
`/api/places/submit` og `/api/places/report` skriver, de lister ikke.

| Parameter | Oppførsel |
|---|---|
| `kind` | Eksakt (`place` fra appen) |
| `lat`, `lng`, `radius` | Når lat og lng er gyldige, brukes RPC-en `activities_nearby`: PostGIS, nærmest først. Radius har standard 10 km og tak 100 km. |
| `category` | Kommaseparert liste, eksakt `in` eller `any` |
| `municipality` | Bare uten lat/lng. `municipality ilike X OR near_city ilike X`, **eksakt navn** (ingen wildcard). Sanert, maks 50 tegn. |
| `q` | Sanert (bokstaver, tall, mellomrom, bindestrek), maks 50 tegn. `ilike *q*` på title, description, venue_name, address og category. |
| `targetAudience` | Eksakt. I radius-modus filtreres det etter at limit er brukt (route.ts:185-189). |
| `limit` | Standard 200, tak 500 (route.ts:159, og `least(p_limit, 500)` i RPC-en). Appen sender 100. |

**Sortering**

- Radius: avstand fra punktet, i databasen, før limit.
- Uten lat/lng: `order by starts_at nulls last` og så limit. Steder har ingen
  `starts_at`, så **utvalget av steder er vilkårlig**. Deretter sorteres utvalget
  på avstand fra bysentrum (route.ts:253-254). Det gjelder bare de fire byene i
  `CITY_CENTRES` (web `lib/cities.ts:34-39`). For andre navn beholdes
  databasens rekkefølge. Problemet er beskrevet i `nasjonal-dekning.md` og
  `seed-backlog.md`.

**Paginering:** ingen. Det finnes ingen offset og ingen cursor. `count` er
antall rader i svaret, ikke totalen.

**Tekstsøk på tvers av landet: API-et kan det allerede, men appen bruker det
aldri.** Et kall uten `lat`, `lng` og `municipality`, men med `q`, går til
den flate grenen uten stedsfilter (route.ts:206-240) og søker i alle
publiserte rader. Det har tre svakheter:

- Kommune og `near_city` er ikke blant feltene `q` søker i.
- Rekkefølgen er vilkårlig. Det finnes ingen rangering på tittel-treff og
  ingen avstand.
- Det finnes ingen `pg_trgm`-indeks. Det er et bevisst valg i web
  `supabase/migrations/0009_activities_text_search.sql:10`, fordi tabellen er
  liten.

---

## 4. Stedsdata vi kan søke i uten ny kilde

**På radene** (web `supabase/migrations/0001_datahub_foundation.sql`,
`0012_activities_near_city.sql`):

- `municipality`: har btree-indeks (`activities_municipality_idx`), som hjelper
  eksakt oppslag og ikke `ilike '*x*'`. Importen setter feltet per chunk og
  kaster før upsert hvis det mangler (web `lib/import-chunks.ts:38-43`,
  `rowsMissingCityAnchor`). Seed-radene har det som obligatorisk felt. Andelen
  rader uten kommune er ikke målt her.
- `near_city`: settes bare på kuraterte utflukter og peker på en av de fire
  byene.
- `address` og `venue_name`: fritekst, ujevn dekning.
- `lat`, `lng` og `location` (geography): har GiST-indeks.
- `osm_tags` gir bydel (`addr:suburb` og lignende). API-et eksponerer den som
  `bydel`, men den er ikke søkbar.
- Appmodellen har alt `municipality` og `nearCity` (app
  `lib/models/datahub_place.dart:14-19`).

**Kommunegrensene** (web `data/kommuner.geojson`, med `data/README.md`):

- Kartverket 2024, L-kvalitet, 10,3 MB, **357 kommuner** med `kommunenummer`
  og `kommunenavn`. Lisensen er CC BY 4.0, og **Kartverket skal krediteres der
  dataene vises.**
- Fila leses bare av skript og er ikke med i Next.js-bunten.
- `lib/municipality.ts` finner kommune fra et koordinat offline og
  normaliserer 22 tospråklige navn (`BILINGUAL_MUNICIPALITIES`,
  `canonicalMunicipality`). Den sørger for at kommunenavnene i fila og på
  radene skrives likt.
- Av fila kan man lage en navneliste og et representativt punkt per kommune
  (sentroide eller et punkt i polygonet) uten nettverkskall. Det finnes ikke
  en slik avledet fil i dag.

**Geokoding** (web `lib/geocode.ts`) bruker Kartverkets adresse-API og
stedsnavn-API med cache. Den brukes bare på serveren ved import og tips. Den
er ikke eksponert som endepunkt, og den er en ekstern tjeneste, ikke data i
repoet.

---

## 5. Tom liste

`_buildPlacesEmpty` (app `explore_screen.dart:1661-1748`) har fem grener:

| Tilstand | Tekst i dag |
|---|---|
| Henter | «Finner posisjonen din …» / «Henter steder i {by} …» |
| Feil | Feilmeldingen og «Prøv igjen» |
| Søk, kategori eller egenskap aktiv (`_isFiltering`, `:1467-1470`) | «Ingen steder matcher søket eller filteret.» |
| Posisjon, ingen data | «Ingen steder i nærheten ennå — Togedoo dekker foreløpig Oslo, Bergen, Trondheim og Stavanger.» og fire by-chips |
| By, ingen data | «Ingen steder i {by} ennå. Prøv en annen by:» og fire by-chips |

Det er tre problemer:

- **Søketeksten sier ikke hvor det ble søkt.** «Voss» i Oslo-modus gir
  «Ingen steder matcher søket eller filteret.», og det leses som at Voss ikke
  finnes i Togedoo.
- **Posisjonsteksten er feil nå.** Dekningen er ikke lenger fire byer. Brukeren
  på Voss med GPS av får bare tilbud om fire byer langt unna.
- **Tom-teksten skiller ikke mellom «ingen treff innen 10 km» og «ingen treff
  noe sted».** Appen vet ikke forskjellen, fordi den aldri spør uten sted.

Hva teksten burde si, uten UI-form:

- **Avgrensningen:** «i Oslo» eller «innen 10 km».
- **Hva som ble søkt på:** «Voss».
- **Et faktisk alternativ når det finnes et:** for eksempel at det finnes
  treff et annet sted, eller at det finnes steder i en kommune med det navnet.
  Det krever et kall uten stedsfilter, eller en kommuneliste. Se retningene
  under.

Fire-by-setningen bør bort uansett hvilken retning som velges.

---

## Mulige retninger

Retningene utelukker ikke hverandre. Ingen av dem er anbefalt her.

### A. Nasjonalt tekstsøk ved siden av stedsvalget

Når brukeren skriver, søkes det i hele landet i stedet for, eller i tillegg
til, valgt sted.

- **API:**
  - Legg `municipality` og `near_city` til feltene `q` søker i.
  - Gi den flate grenen en meningsfull rekkefølge. Mulighetene er tittel-treff
    først, avstand fra en valgfri `lat`/`lng` uten radiusfilter, eller begge.
    Det siste krever en RPC-endring og dermed en migrasjon.
  - Vurder `pg_trgm` hvis ytelsen krever det. Ingen ny kilde trengs.
- **App:**
  - En tredje hentegren i `_refetchPlaces` uten sted.
  - Klientfilteret må ikke lenger stå som eneste sannhet, fordi det kjører på
    en annen mengde.
  - Avstandsetikettene må ha regler for treff langt unna.
  - Tom-teksten må skille lokalt fra nasjonalt.
- **Åpent spørsmål:** hva som skjer med kategorifilter og limit 100 når
  mengden er hele landet.

### B. Kommune som stedsvalg (357 i stedet for 4)

Byvelgeren blir en søkbar kommuneliste. «Voss» blir et sted man velger, ikke
en tekst man søker på.

- **Data:** et skript som lager en liten fil fra `data/kommuner.geojson` med
  navn, nummer og representativt punkt, kanonisert med `lib/municipality.ts`.
  Kartverket-attribusjonen må vises der listen vises.
- **API:**
  - By-modus virker alt for alle kommunenavn, fordi `municipality` er eksakt
    `ilike`.
  - `CITY_CENTRES` må erstattes med punktene fra fila, ellers blir
    sorteringen vilkårlig utenfor de fire byene.
  - Det vilkårlige utvalget før limit (`order by starts_at`) blir et større
    problem i kommuner med mange rader.
  - Eventuelt et endepunkt som returnerer kommuner med antall publiserte
    steder, så lista kan vise hvor det finnes noe.
- **App:**
  - `kPlaceCities` og `kDefaultCity` blir data i stedet for en konstant.
  - Tom-teksten og by-chipsene må skrives om.
  - Det må avgjøres hvordan `near_city` (hjemby for utflukter) oppfører seg
    for kommuner som ikke er en av de fire.

### C. Valgfritt punkt med radius

Brukeren velger et sted (kommune, stedsnavn eller adresse), og appen bruker
posisjonsmodus med det punktet i stedet for GPS.

- **API:**
  - Radius-grenen virker allerede for hvilket som helst punkt, med tak på
    100 km.
  - Oppslaget fra navn til punkt trenger enten kommunepunktene fra B (ingen ny
    kilde) eller et nytt endepunkt foran Kartverket-geokodingen i
    `lib/geocode.ts` (ekstern tjeneste og ratebegrensning).
- **App:**
  - En ny modus: posisjon uten GPS. `PositionQuality` og avstandsetikettene
    er bygd for «din posisjon», så «140 m» må enten bety avstand fra det
    valgte punktet eller skjules.
  - Radiuschipsene (5–50 km) gjelder da i begge moduser, og valget bør
    lagres.
  - Den døde «Søkeradius» i innstillingene må enten kobles til eller fjernes.
- **Åpent spørsmål:** kommunegrense eller radius. Et punkt med 20 km radius i
  Voss tar med nabokommuner. Kommunefilteret i B gjør ikke det.
