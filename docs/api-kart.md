# `/api/kart` — kontrakten

Hele kartutsnittet, ærlig: totalen, og enten alle stedene eller klynger som
dekker hele utsnittet. Kilden er SQL-funksjonen `activities_map` (migrasjon
0018). Formingen skjer i `lib/kart.ts`, og ruta ligger i `app/api/kart/route.ts`.

## Hvorfor et eget endepunkt

Kartet brukte `/api/activities` med `bbox`. Det sorterer på avstand fra
**brukeren** og kutter på `limit`. Målt mot produksjon 18. sep. 2026, med
posisjon i Oslo sentrum og `limit=100`:

| Utsnitt | Steder i utsnittet | `/api/activities` svarte |
|---|---|---|
| Oslo sentrum (10.68–10.82, 59.89–59.945) | 1250 | 100 rader, alle innen 950 m fra posisjonen |
| Samme utsnitt flyttet 2 km øst | 1350 | **De samme 100 radene, i samme rekkefølge** |

Kartet viste en rund klatt rundt brukeren, og «Søk i dette området» ga aldri
noe nytt.

`/api/kart` er et eget endepunkt og ikke en modus i `/api/activities`, fordi
svaret har en annen form (klynger, ikke rader) og ingen blaing.
`/api/activities` er uendret.

## To kall for ett kart

| Til | Kall |
|---|---|
| **Markører og bobler** | `GET /api/kart?bbox=…&lat=…&lng=…&kind=place` |
| **Lista i arket**, nærmest brukeren først, med blaing | `GET /api/activities?bbox=…&lat=…&lng=…&kind=place&limit=…` og så `&cursor=…`. Uendret, se [api-activities.md](api-activities.md). |

Totalen i arket («1250 steder i området») skal hentes fra `/api/kart`, ikke
fra lengden på lista.

## Forespørsel

| Parameter | Betydning |
|---|---|
| `bbox` | **Påkrevd.** `vest,sør,øst,nord` i grader. Alle fire, og utsnittet må ha utstrekning i begge retninger. Ellers svarer ruta 400. |
| `lat`, `lng` | Valgfritt, begge eller ingen. Gir `distanceM` på stedene og sorterer dem nærmest brukeren først. Påvirker ikke utvalget eller klyngene. |
| `kind` | `place` fra appen. |
| `category` | Kommaseparert, eksakt. Samme kategorifilter som lista, så totalen og klyngene teller det brukeren har valgt. |

## Svar

```jsonc
{
  "success": true,
  "modus": "klynger",          // "steder" | "klynger"
  "total": 1250,               // alle publiserte i utsnittet med gjeldende filter, uavhengig av alt annet
  "terskel": 150,              // over dette: klynger
  "rutenett": { "kolonner": 6, "rader": 5 },
  "data": [],                  // modus "steder": ALLE stedene, samme radform som /api/activities
  "klynger": [                 // modus "klynger": én per ikke-tom rute, størst først
    {
      "antall": 102,
      "lat": 59.9174,          // TYNGDEPUNKTET: snittet av stedene i ruta, ikke rutas midte
      "lng": 10.7853,
      "kategorier": { "Lekeplass": 48, "Ballbane": 26, "Park": 21 },   // størst først
      "bbox": [10.7733, 59.9120, 10.7967, 59.9230]                     // rutas utsnitt, til å zoome inn
    }
  ],
  "attribution": "Stedsdata © OpenStreetMap contributors (ODbL) — openstreetmap.org/copyright",
  "timestamp": "…"
}
```

**Løftene:**

- **`total` er sann.** Den teller alle publiserte steder i utsnittet med
  gjeldende filter, uavhengig av terskel og rutenett.
- **Stedsmodus gir alle stedene.** Er `total` ≤ `terskel`, inneholder `data`
  alle stedene i utsnittet, ikke de nærmeste brukeren. `data.length === total`.
- **Klyngene summerer til totalen.** Hvert sted havner i nøyaktig én rute.
- **Tyngdepunktet ligger i sin egen rute.** Trykk på en klynge og zoom til
  `bbox`, så får kartet nøyaktig de stedene klyngen talte.

## Terskel og rutenett

**Terskel: 150.** Et kart på telefon er rundt 400 × 700 pt, og en markør er
32 pt. Ved 150 markører dekker de omtrent halve kartet og overlapper overalt,
og hver er en egen widget i `flutter_map`. Over det er én markør per sted verken
lesbart eller raskt. Verdien sendes i svaret, så appen ikke trenger å vite den.
SQL-funksjonen klemmer terskelen til 0–500 uansett hvem som kaller den.

**Rutenett:** 6 kolonner, og så mange rader at rutene blir omtrent kvadratiske
i **kilometer**, klemt til 4–12 rader. Én lengdegrad er 56 km i Oslo og 37 km
i Tromsø; uten korrigering ville rutene blitt høye og smale. Kartet får aldri
mer enn 6 × 12 = 72 bobler, og tomme ruter gir ingen boble.

## Feil

`400` med `{ success: false, error }` når `bbox` mangler, ikke har fire
verdier, mangler utstrekning, eller når bare én av `lat`/`lng` er med. `500`
når basen feiler.

## Verifisert mot produksjonsdata

18. sep. 2026, gjennom ruta (`next dev`), posisjon Oslo sentrum. Svartiden
er målt over tre kall: min / median / maks.

| Utsnitt | Modus | Total | Resultat | Svartid |
|---|---|---|---|---|
| Oslo sentrum (10.68–10.82, 59.89–59.945) | klynger, 6 × 5 | 1250 | 30 klynger, **summen er 1250**, alle tyngdepunkt i egen rute | 135 / 151 / 151 ms |
| Kvartal på Grünerløkka (10.755–10.765, 59.920–59.925) | steder | 14 | Alle 14, nærmest brukeren først (0,9–1,2 km) | 175 / 249 / 365 ms |
| Trysil (12.05–12.35, 61.28–61.36) | steder | 3 | Paradisbukta, Skianlegg ved Fageråsen 913, Trysil skisenter | 118 / 123 / 276 ms |
| Sør-Norge (4.5–12.5, 57.9–63.5) | klynger, 6 × 9 | 7949 | 42 klynger, **summen er 7949**; største: Oslo 3144, Trondheim 1496, Bergen 1298 | 175 / 181 / 710 ms |

Den største ruta over Oslo sentrum har 102 steder (Lekeplass 48, Ballbane 26,
Park 21), med tyngdepunkt i 59.9174, 10.7853.

**`/api/activities` er uendret.** Tre av dagens app-kall ga identiske svar
lokalt og i produksjon: radius 10 km, `municipality=Oslo`, og `q=Geilo`. Lista
i utsnittet blar fortsatt riktig: to sider à 50, stigende avstand, ingen
dubletter.

## Sikkerhet

`activities_map` er `security invoker`, så RLS gjelder, og anon ser bare
published. Den gir de samme kolonnene som `/api/activities`, altså ikke
`contact_email` eller `organizer_id`. Terskelen klemmes til 500 også ved
direkte kall med anon-nøkkelen (verifisert: terskel 100 000 over Sør-Norge
gir fortsatt klynger).

## Kjent gjeld

- **Ingen indeks.** Filteret på `lat`/`lng` går over rundt 8000 rader, og
  Sør-Norge tar 181 ms i median. Etter nasjonal import (35–50 000 rader) må
  det måles på nytt. Blir det tregt, er to ting naturlige å se på: at `hits`
  henter `a.*` også i klyngemodus, der bare `lat`, `lng` og `category`
  brukes, og en btree-indeks på `(lat, lng)`.
- **Dubletter i datagrunnlaget vises som de er.** Kvartalet på Grünerløkka
  har to «Bordtennisbord ved Fossveien» og to «Bordtennisbord ved Helgesens
  gate». Det er samme sak som de navnløse skiflatene, og hører til
  datagrunnlaget, ikke kartet.
