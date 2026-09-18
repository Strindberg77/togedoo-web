# `/api/kart` — kontrakten

Hele kartutsnittet, ærlig: totalen, og enten alle stedene eller klynger som
dekker hele utsnittet. Kilden er SQL-funksjonen `activities_map` (migrasjon
0018, med tynne ruter fra 0019 og ytelsesrettingen i 0020). Formingen skjer i
`lib/kart.ts`, og ruta ligger i `app/api/kart/route.ts`.

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
    },
    {
      "antall": 2,             // TYNN RUTE (høyst 3 steder): stedene følger med
      "lat": 59.9101,
      "lng": 10.7502,
      "kategorier": { "Park": 1, "Lekeplass": 1 },
      "bbox": [10.7444, 59.9055, 10.7490, 59.9079],
      "steder": [ /* 2 rader, samme radform som data */ ]
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
  Det gjelder også tynne ruter: `antall` står alltid, med eller uten `steder`.
- **Tynne ruter har alle stedene sine.** Har en rute høyst 3 steder, er
  `steder.length === antall`. Tette ruter har ingen `steder`-nøkkel — ikke en
  tom liste, som ville påstått at ruta er tom.
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

## Tynne ruter: markører i stedet for bobler med «1»

**Grense: 3 steder per rute** (migrasjon 0019). Ruter med høyst så mange
steder får stedene med i `steder`, så appen kan tegne vanlige markører for
dem og bobler bare der det er tett. Kartbiblioteker løser det på samme måte.

Utsnittet appen havnet i etter ett trykk i Oslo (10.7444–10.7721,
59.90552–59.93189, 192 steder, rutenett 6 × 11) hadde 57 bobler, hvorav 11
med «1», 10 med «2» og 14 med «3». Målt med ulike grenser:

| Utsnitt | Grense 3 | Grense 5 |
|---|---|---|
| 192-utsnittet (57 ruter) | 35 ruter blir 73 markører, **22 bobler igjen** | 49 ruter blir 133 markører, 8 bobler igjen |
| Sør-Norge (42 ruter) | 20 ruter blir 42 markører | 26 ruter blir 69 markører |
| Oslo sentrum (30 ruter) | ingen | 1 rute |

Med 5 blir 192-utsnittet nesten bare markører (133 av 192), og kartet nærmer
seg det terskelen på 150 skulle hindre. En rute på et telefonkart er rundt
70 × 60 pt: tre markører på 32 pt får plass, fem gjør det ikke.

**Hvor stort svaret kan bli.** Antall fulle rader i klyngemodus er høyst
(antall ruter) × (grense), og grensen regnes ned så produktet aldri passerer
500, samme tak som terskelen:

| Kall | Største mulige | Størrelse |
|---|---|---|
| Via `/api/kart` (maks 72 ruter) | 72 × 3 = **216 rader** | typisk ~130 kB, verst ~340 kB (rad: snitt 590 B, maks 1 588 B) |
| Direkte med anon-nøkkelen (maks 400 ruter) | grensen blir 1: **400 rader** | under taket på 500 som stedsmodus alt tillater |

Det verste tilfellet krever at hver eneste rute har nøyaktig 3 steder. Målt:
73 rader og 51 kB for 192-utsnittet, 42 rader og 33 kB for Sør-Norge.

## Feil

`400` med `{ success: false, error }` når `bbox` mangler, ikke har fire
verdier, mangler utstrekning, eller når bare én av `lat`/`lng` er med. `500`
når basen feiler.

## Verifisert mot produksjonsdata

### Tynne ruter (0019/0020), 18. sep. 2026

Gjennom ruta (`next dev`), posisjon Oslo sentrum, 10 kall etter ett
oppvarmingskall: min / median / maks. «0018» er målt med samme metode samme
dag, rett før migrasjonen.

| Utsnitt | Resultat | 0018 | 0020 | Svar 0018 → 0020 |
|---|---|---|---|---|
| Sør-Norge (4.5–12.5, 57.9–63.5) | 22 bobler + 20 tynne ruter (42 markører), **summen er 7949** | 176 / **206** / 320 ms | 173 / **206** / 320 ms | 7,9 → 32,7 kB |
| 192-utsnittet (10.7444–10.7721, 59.90552–59.93189) | 22 bobler + 35 tynne ruter (73 markører), **summen er 192** | 106 / **128** / 211 ms | 108 / **137** / 539 ms | 9,8 → 51,5 kB |
| Oslo sentrum (10.68–10.82, 59.89–59.945) | 30 bobler, ingen tynne ruter, **summen er 1250** | 102 / **139** / 319 ms | 117 / **133** / 209 ms | 6,1 → 6,1 kB |

Sør-Norge ble tidligere målt til 181 ms i median (samme metode, 3 kall); 206 ms
i dag gjelder både før og etter. Frederik målte funksjonen alene med
`explain analyze` over 4.0–13.0, 57.5–63.5: **108,7 ms**.

Direkte mot basen med **anon-nøkkelen**, 5 kall: Sør-Norge 150 / 161 / 171 ms,
192-utsnittet 102 / 112 / 140 ms, Oslo sentrum 90 / 103 / 124 ms. Ingen
tidsavbrudd.

**0019 var en regresjon, rettet i 0020.** 0019 koblet treffene mot rutene på
`id` (to materialiserte CTE-er uten statistikk). Sør-Norge tok 5,5 s direkte med
service-nøkkelen og 7,5–8,5 s i produksjon, og anon-nøkkelen falt på
tidsgrensen (3 s). 0020 regner ruta én gang per rad og slår opp mot
klyngene i stedet; svartiden er tilbake der 0018 var. I produksjon (før denne
grenen er merget, så uten `steder` i svaret): Sør-Norge 654 ms, 192-utsnittet
418 ms, Oslo sentrum 428 ms i median.

**Appen leser det nye svaret uendret.** Appens egen parser (`KartSvar.fromJson`
i togedoo-modern) ble kjørt mot ekte svar fra ruta: alle 57 og 42 klynger kom
med, summen var lik totalen, og `steder`-nøkkelen ble ignorert. Appen viser
bobler som før til den lærer seg markørene.

### Første versjon (0018), 18. sep. 2026

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
  Sør-Norge tar rundt 200 ms i median gjennom ruta. Etter nasjonal import
  (35–50 000 rader) må det måles på nytt. Blir det tregt, er to ting
  naturlige å se på: at `hits` henter `a.*` også i klyngemodus, der bare
  `lat`, `lng`, `category` og radene i tynne ruter brukes, og en btree-indeks
  på `(lat, lng)`.
- **Mellomtabellene har ingen statistikk.** 0019 viste hva som skjer når to
  materialiserte CTE-er kobles på en nøkkel: planleggeren valgte en plan som
  tok 5,5 s i stedet for 0,2 s. Nye endringer i `activities_map` bør måles
  over Sør-Norge før de kjøres i produksjon.
- **Dubletter i datagrunnlaget vises som de er.** Kvartalet på Grünerløkka
  har to «Bordtennisbord ved Fossveien» og to «Bordtennisbord ved Helgesens
  gate». Det er samme sak som de navnløse skiflatene, og hører til
  datagrunnlaget, ikke kartet.
