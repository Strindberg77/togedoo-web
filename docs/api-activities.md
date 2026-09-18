# `/api/activities` — kontrakten

Slik svarer endepunktet etter migrasjon 0017 (`activities_search`) og
omkoblingen av ruta, 17. sep. 2026. Dette er kontrakten app-runden bygger mot.

Modellen: **søk er nasjonalt**, **blaing er «nærmest først» uten yttergrense**,
og **avstand er et valgfritt filter, ikke en port**. Bakgrunnen står i
[utforsk-stedsvalg-funn.md](utforsk-stedsvalg-funn.md).

---

## To veier gjennom ruta

| Forespørselen har | Vei | Rekkefølge | Blaing |
|---|---|---|---|
| `lat`+`lng`, `bbox`, `cursor`, eller `q` uten `municipality` | `activities_search` (migrasjon 0017) | avstand, så `id` — eller tittel, så `id`, uten posisjon | ja |
| `municipality` (med eller uten `q`), eller ingenting | flat spørring, **uendret fra før** | vilkårlig utvalg, så avstand fra bysentrum | nei |

By-veien er med vilje urørt: appen som kjører i dag skal ikke merke runden.
Den arver også sine gamle svakheter — se «Kjent gjeld» nederst.

## Parametre

| Parameter | Betydning |
|---|---|
| `kind` | `place` eller `event`. Eksakt. |
| `lat`, `lng` | Posisjonen det måles fra. **Begge eller ingen** — én av dem gir 400. |
| `radius` | Meter. **Valgfritt filter.** Utelates den, er det ingen avstandsgrense. Intet tak (grensa på 100 km er borte). Må være positiv. |
| `bbox` | `vest,sør,øst,nord` i grader. **Alle fire eller 400.** Krysser ikke datolinja. |
| `category` | Kommaseparert liste. Eksakt match på hovedkategorien, **eller** på en fasett som teller som kategoritreff (`FASETT_SOM_KATEGORI` i `lib/facets.ts`): `Fornøyelsespark` treffer også Dyreparken (Dyremøte), og `Aking` treffer også skianlegg med akebakke. Gjelder begge stiene, også den flate kommune-stien. Se docs/kategori-via-fasett.md. |
| `municipality` | Eksakt kommunenavn, eller `near_city` (kuratert hjemby). Holder forespørselen på den flate veien. |
| `targetAudience` | Eksakt, uavhengig av store og små bokstaver. |
| `q` | Fritekst, maks 50 tegn. Treffer `title`, `description`, `venue_name`, `address`, `category` og **`municipality`** (nytt). `near_city` er IKKE med: den er en kurateringsmerkelapp, ikke stedets beliggenhet. |
| `limit` | Sidestørrelse. Standard 200, tak 500. Uendret. |
| `cursor` | Ugjennomsiktig markør fra forrige sides `nextCursor`. |

`%`, `_` og `\` i `q` escapes, så de er vanlige tegn og ikke wildcards.

## Svaret

```jsonc
{
  "success": true,
  "mode": "datahub",
  "data": [ /* … */ ],
  "count": 20,          // antall rader i data, ikke totalen
  "hasMore": true,      // finnes det en side til?
  "nextCursor": "eyJk…", // null når hasMore er false
  "attribution": "Stedsdata © OpenStreetMap contributors (ODbL) — openstreetmap.org/copyright",
  "timestamp": "2026-09-17T…"
}
```

Hver rad har feltene fra før, pluss:

| Felt | Betydning |
|---|---|
| `distanceM` | Luftlinje i **hele meter** fra `lat`/`lng`. `null` uten posisjon (også i by-modus). |

`distanceFromCityKm` er uendret: satt kun i by-modus, `null` ellers. De to er
ulike avstander med vilje — den ene fra brukeren, den andre fra bysentrum.

## Blaing

1. Be om side 1 med ønsket `limit`.
2. Er `hasMore` sann, send `nextCursor` som `cursor` i neste kall. Alt annet
   skal være likt.
3. `nextCursor: null` betyr at lista er slutt.

Markøren er **keyset**, ikke offset: den peker på siste rad på forrige side
(avstand og `id`, eller tittel og `id`). Rader som publiseres eller tas ned
mellom to kall gir derfor verken dubletter eller hull. Markøren bærer den
**urundede** avstanden — `distanceM` er avrundet bare for visning.

En markør hører til én sortering. Brukes en markør fra et søk uten posisjon
sammen med `lat`/`lng`, svarer ruta 400 i stedet for å hoppe et vilkårlig
sted ut i lista.

## Feil

`400` med `{ success: false, error: "…" }` for: halv posisjon, `bbox` med
færre enn fire tall eller snudde hjørner, `radius` som ikke er positiv,
ødelagt markør, og markør fra feil sortering. `500` er som før.

## Verifisert mot produksjonsdata

Fra Oslo sentrum (59.9139, 10.7522), 17. sep. 2026, alt gjennom ruta:

| Sjekk | Resultat |
|---|---|
| `q=Geilo` uten radius | SkiGeilo (Hol), 157 km |
| `q=Voss` | Voss Resort (Voss), 252 km — sammen med Haugsåsen og Myrkdalen, som ligger i Voss kommune |
| `q=Trysil` | Trysil skisenter (Trysil), 175 km |
| Uten `q`, `limit=20` | Stigende avstand fra 267 m; side 2 starter der side 1 sluttet, ingen dubletter, og side 1 + side 2 er ordrett lik ett kall med `limit=40` |
| `bbox=8.15,60.48,8.26,60.57` | SkiGeilo, med avstand fra Oslo |
| `bbox` med tre verdier | 400 |
| Dagens app-kall | Se under |

**Dagens app-kall er uendret.** Tre kall ble kjørt gjennom den nye ruta og
sammenlignet med `activities_nearby` med de gamle parametrene:

| Kall | Rader | Identisk rekkefølge | Identiske felt |
|---|---|---|---|
| posisjon + `radius=10000` | 100 | ja | ja |
| posisjon + `radius=50000` + to kategorier | 37 | ja | ja |
| posisjon + `radius=10000` + `q=ball` | 100 | ja | ja |
| by-modus `municipality=Oslo` | 100 | flat vei, urørt | ja |

Derfor går også radiuskallene nå gjennom `activities_search`. Svaret har i
tillegg `distanceM`, `hasMore` og `nextCursor`.

### Svartid

Målt mot `next dev` på samme maskin, tre kall hver, raskeste og median:

| Kall | Raskeste | Median |
|---|---|---|
| Nasjonalt uten `q`, side 1 (20 rader) | 126 ms | 135 ms |
| Nasjonalt uten `q`, rad ~4001–4020 (302 km ute) | 155 ms | 155 ms |
| `q=Geilo` | 143 ms | 144 ms |

Tallene inkluderer Next.js i utviklingsmodus og nettverket til Supabase. En
dyp side koster omtrent det samme som side 1: keyset-blaing leser ikke gjennom
sidene foran seg.

## Sikkerhet

`activities_search` er `security invoker`, som `activities_nearby`. RLS-policyen
`activities_public_read` (migrasjon 0001) gjelder, så anon ser bare
`status = 'published'`. Verifisert med anon-nøkkelen: 8016 publiserte rader,
0 rejected, og funksjonen svarer.

## Kjent gjeld

- **By-veien er uendret, med sine gamle feil.** Utvalget før `limit` er
  vilkårlig (`order by starts_at`, `null` for alle steder), og bare de fire
  byene i `lib/cities.ts` har et sentrum å sortere etter. Se
  `nasjonal-dekning.md`.
- **`limit` deles av alle valgte kategorier.** En tett kategori kan fortrenge
  en tynn. Blaing demper det nå, men løser det ikke.
- **`targetAudience` filtreres nå i databasen**, ikke på det ferdige utvalget.
  Det er en reell forbedring for et filter appen ikke sender i dag: før kunne
  et målgruppefilter tømme de 100 nærmeste og se ut som «ingen treff».
- **Ingen indeks for fritekst.** `ilike` uten `pg_trgm` er greit ved ~8000
  rader. Blir tabellen mye større, må det måles på nytt.
