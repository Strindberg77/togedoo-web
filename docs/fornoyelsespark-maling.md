# Fornøyelsespark: måling før valg mellom import og kuratering

**Status:** bare måling (18.09.2026). Ingen kategori er opprettet, ingen kode
er endret, og ingenting er skrevet til basen. Basen er lest via produksjons-API-et
(`/api/activities`, `/api/kart`).

## Kort svar

- `tourism=theme_park` gir **24 objekter** i Norge. **8** av dem er ekte
  fornøyelses- eller familieparker. **4** er uklare småsteder. **12** er noe
  annet: klatreparker, museer, kulturparker, en friluftspark, en kommunal
  aktivitetspark og en feiltagging.
- Alle seks kjente parker (Tusenfryd, Hunderfossen, Kongeparken, Dyreparken,
  Lilleputthammer og Bø Sommarland) er tagget `tourism=theme_park`. Ingen av dem
  ligger bare under en annen tagg. **Ingen av dem finnes i basen**, verken under
  eget navn eller under en annen kategori innenfor ±0,6 km.
- 7 av de 8 ekte parkene har en **tagget hovedinngang** i OSM. Mikkelparken
  har bare polygonet.
- **Anbefaling: kuraterte seed-rader for de 8.** OSM brukes som kilde for
  inngangspunktet, og claims hindrer at importen lager dubletter. Se nederst.

## 1. Alle 24 `tourism=theme_park` i Norge

Spørring: `nwr["tourism"="theme_park"](area["ISO3166-1"="NO"][admin_level=2])`.
Kommunene er slått opp i Kartverkets kommuneinfo fra senterpunktet.
«Innhold» er antall `attraction=*` innenfor flaten, eller innen 250 m for
punkter.

### Ekte fornøyelses- og familieparker (8)

| Navn | Kommune | Type | Nettside | Innhold | Hva det er |
|---|---|---|---|---|---|
| Tusenfryd | Ås | way | tusenfryd.no | 44 (8 berg-og-dal, 10 tømmerrenne …) | Landets største fornøyelsespark |
| Kristiansand Dyrepark | Kristiansand | way | dyreparken.no | 55 (28 dyr, 20 vannsklier, 7 berg-og-dal) | Dyrepark, fornøyelsespark og badeland i ett |
| Kongeparken | Gjesdal | relation | kongeparken.no | 27 (22 karuseller, 3 berg-og-dal) | Fornøyelsespark |
| Hunderfossen Familiepark | Lillehammer | relation | hunderfossen.no | 4 | Familie- og eventyrpark |
| Lilleputthammer | Øyer | way | lilleputthammer.no | 2 | Småbarnspark (Lillehammer i miniatyr) |
| Bø Sommarland | Midt-Telemark | way | sommarland.no | 46 (42 vannsklier) | Vannpark ute. **Grensetilfelle:** kan like gjerne høre til Badeland |
| Foldvik Familiepark | Larvik | way | foldvik.no | 23 (13 dyr, minibiler, tog) | Familiepark med dyr |
| Mikkelparken | Ullensvang | way | mikkelparken.no | 5 (vannsklier, labyrint) | Barnepark |

### Uklare småsteder (4): bare et punkt, uten tagger som forteller mer

| Navn | Kommune | Type | Nettside | Hva det ser ut til å være |
|---|---|---|---|---|
| Lavvoland | Larvik | node | – | Ukjent. Ingen attraksjoner, ingen nettside |
| Skarnes lekeland | Sør-Odal | way | Facebook | Utendørs lekepark, trolig nærmere Lekeplass |
| Barnas Gård | Lillehammer | node | – | Ligger 700 m fra Hunderfossen, ved parkens parkering. Trolig en del av Hunderfossen eller en gård ved siden av |
| Oppfinnerparken | Lyngdal | node | – | Ukjent. Navnet peker mot en aktivitetspark |

### Noe annet (12)

| Navn | Kommune | Type | Hva det er | Nærmeste kategori vi har |
|---|---|---|---|---|
| Oslo klatrepark | Oslo | node | Klatrepark | Klatring |
| Helgøya klatrepark | Ringsaker | way | Klatrepark | Klatring |
| Høyt og Lavt Lillestrøm | Lillestrøm | way | Klatrepark | Klatring |
| Høyt & Lavt Hemsedal | Hemsedal | way | Klatrepark | Klatring |
| Gamlebyen modelljernbanesenter | Fredrikstad | node | Modelljernbane | Museum |
| Sápmi park | Kárášjohka/Karasjok | way | Samisk kultur- og opplevelsessenter | Museum |
| Viking Valley Gudvangen | Aurland | way | Vikinglandsby | Museum |
| Hallingparken (tidl. Gordarike Vikingpark) | Gol | way | Middelalderpark | Museum |
| Sunnhordlandstunet | Stord | node | Tun, også tagget `tourism=zoo` | Dyremøte |
| Doktortjønna friluftspark | Røros («Rosse») | node | Friluftspark med badetjern | Park/Badeplass |
| Bratten aktivitetspark | Bodø | way | Kommunal aktivitetspark, gratis og døgnåpen | Park/Lekeplass |
| (uten navn) w516854216 | Sunnfjord | way | Et gjerde ved Jølstraholmen camping, med `tourism=theme_park`. Feiltagging | – |

Import rett fra taggen ville altså gitt **4 klatreparker og 4 museer** under
fornøyelsespark. Taggen alene er ikke et filter.

## 2. Kjente parker under andre tagger

| Park | Hovedobjekt | Tagget også som | I basen? |
|---|---|---|---|
| Tusenfryd | `w48672338` `tourism=theme_park` | `Badefryd` er egen `leisure=water_park`. `old_name=Dyreparken` på parken er trolig en feil i OSM | Nei |
| Hunderfossen | `r10678827` `tourism=theme_park` + `barrier=fence` | Parkering `w256570365`/`w274826221` «Hunderfossen Familiepark Parking» | Nei |
| Kongeparken | `r6598772` `tourism=theme_park` | – (se rettelsen under) | Nei |
| Dyreparken | `w69166520` `tourism=theme_park`, **ikke** `tourism=zoo` | `Badelandet` er `leisure=water_park`, og Manyatta er `zoo=petting_zoo` | Nei |
| Lilleputthammer | `w273798788` `tourism=theme_park` | – | Nei |
| Bø Sommarland | `w307924173` `tourism=theme_park` | En navnløs `leisure=water_park` på samme sted | Nei |

Et bredere søk fant 192 fornøyelsesinnretninger (`attraction=`
berg-og-dal-baner, karuseller, vannsklier osv.). Bare 40 av dem ligger lenger
enn 1,5 km fra en `theme_park`. Det er vannsklier ved badeplasser og
svømmehaller, sommerakebaner og enkelte karuseller. **Ingen fornøyelsespark
mangler taggen.**

`leisure=water_park` og `tourism=zoo` gir 64 treff. De fleste er badeplasser,
svømmehaller og besøksgårder. Større steder vi heller ikke har i basen:
Straand Sommarland, Tropicana Badeland, Langedrag, Bjørneparken, Polar Park,
Park Nordica og Norsk Elgsenter. Til sammenlikning har Dyremøte **11** rader og
Badeland **8** i hele landet (`/api/kart` for hele Norge). Begge er kuraterte.

**Rettelse (seed-runden, 18.09.2026):** Første versjon av rapporten sa at
tre `leisure=park`-flater som heter «Kongeparken» (`w103268212`,
`w189732650`, `w614558426`) hørte til fornøyelsesparken, og at Park-importen
for Gjesdal ville laget dem som dubletter. Det var feil. Navnesøket var
landsdekkende, og ingen sjekket hvor flatene lå. De ligger i Tromsø, Bodø og
ved Trysil, 460–1 420 km fra Ålgård, og er vanlige byparker. De er IKKE
claimet, fordi en claim ville skjult tre ekte parker.

## 3. Inngangspunkt for de ekte parkene

Polygonets midtpunkt er som regel midt inne i parken, 100–270 m fra porten.
Dette er det OSM har:

| Park | Hovedinngang (node) | Fra midtpunkt | Nærmeste parkering | Billettsalg |
|---|---|---|---|---|
| Tusenfryd | `n7687702285` `entrance=main` (59.74797, 10.77580). Også `n5589884756` med `access=customers` | 106 m | 191 m | `n11241914991` `shop=ticket` |
| Kristiansand Dyrepark | `n1257106325` «Byporten» `entrance=main` (58.18709, 8.14012) | 226 m | 606 m (navngitt «Kristiansand Dyrepark») | – |
| Kongeparken | `n686254300` `entrance=main` (58.77875, 5.84046) | 130 m | 118 m | – |
| Hunderfossen | `n2794927148` `entrance=main` (61.22579, 10.43579) | 163 m | 95 m (navngitt) | – |
| Lilleputthammer | Bare `entrance=yes` (3 noder), for eksempel `n2786099980` (61.23893, 10.43912) | 112 m | 45 m | – |
| Bø Sommarland | `n3131762432` `entrance=main` + `barrier=turnstile` (59.44680, 9.07352) | 270 m | 32 m | – |
| Foldvik Familiepark | `n6542382397` `entrance=main` (59.00216, 9.97083) | 128 m | 174 m | – |
| Mikkelparken | **Ingen**, bare polygonet. 4 parkeringsplasser innen 300 m | – | – | – |

## Anbefaling: kuraterte seed-rader, med OSM som kilde til punktet

1. **Taggen er for skitten til import.** Halvparten av treffene er ikke
   fornøyelsesparker, og fire til er uklare. En import måtte hatt en liste over
   tillatte objekter, og det er i praksis kuratering. Med 8 rader er det
   raskere å skrive dem enn å bygge og vedlikeholde filteret.
2. **Innholdet må skrives uansett.** Beskrivelse, sesong og målgruppe finnes
   ikke i OSM for disse stedene. Hunderfossen og Kongeparken har ikke engang
   åpningstider der.
3. **OSM gir likevel det viktigste feltet:** punktet. Bruk hovedinngangen fra
   tabellen over, kontrollert for hånd, ikke polygonets midtpunkt. For
   Mikkelparken må punktet settes manuelt.
4. **Legg inn claims** (`lib/osm-claims.ts`) for de 8 theme_park-objektene.
   Da lager ingen senere import dubletter ved siden av seed-radene. De tre
   «Kongeparken»-flatene skal ikke claimes; se rettelsen over.
5. **Beslutninger før seeden:**
   - Bø Sommarland: Fornøyelsespark eller Badeland?
   - Kristiansand Dyrepark: Fornøyelsespark eller Dyremøte? Den er begge.
   - De fire uklare: sjekke dem manuelt, eller la dem ligge.

Utenfor denne runden: de fire klatreparkene er gode kandidater for Klatring.
Ingen av dem finnes i basen i dag.

## Slik ble det målt

- Overpass (`overpass-api.de`, med `overpass.kumi.systems` som reserve):
  ett kall per objekt, 4 s pause, med `User-Agent` og mellomlagring per svar.
  Noen kall fikk 429/504 og ble kjørt på nytt. Hunderfossen tidsavbrøt med
  `map_to_area` og ble målt mot relasjonens utsnitt i stedet. Derfor er
  «parkering innen 300 m» der omtrentlig.
- Kommuner: Kartverket kommuneinfo `/v1/punkt`.
- Basen: `/api/activities?q=<navn>` for alle 24 navn og de større dyre- og
  vannparkene, `bbox` ±0,6 km rundt hvert objekt, og `/api/kart` for totalene
  per kategori.
