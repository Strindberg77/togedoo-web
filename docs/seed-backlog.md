# Seed-backlog — kjente steder OSM ikke ser

**Opprettet:** 9. september 2026
**Formål:** hindre at verifiserte steder går tapt mellom økter. Alt her er
funnet manuelt eller via offentlige kilder, og fanges IKKE av
`import-places.ts`.

Se `kategoripotensial-sport.md` for målingene som viser hvorfor.

---

## Hvorfor denne lista finnes

Fire uavhengige funn samme dag, alle samme mønster:

| Aktivitet | I OSM | I virkeligheten |
|---|---|---|
| Skateanlegg | `leisure=skatepark` = 0 nasjonalt | 13 kjente anlegg i fire byer |
| Klatring | 1253 `sport=climbing` | 75 faktiske anlegg, resten er klippevegger |
| Parkour | 7 navnløse polygoner nasjonalt | 3 anlegg i Oslo alene |
| Flerbrukshaller | 1307 `sport=multi` | innholdet er ukjent |

**OSM beskriver hva noe er bygget som, ikke hva som foregår der.** Anlegg
inne i flerbruksbygg og små nærmiljøanlegg er systematisk usynlige.

---

## Parkour — Oslo (3 steder)

Kilde: oslo.kommune.no/idrettsanlegg og osloparkourpark.no

| Sted | Adresse | Inne/ute | Merknad |
|---|---|---|---|
| Furuset parkourpark | Verdensparken, Furuset | Ute | Gratis. Parkourhindre, stativer, liten buldrevegg |
| Tøyen parkourpark | Taket av Tøyen T-banestasjon | Ute | Gratis. Rails og hindre. Mindre anlegg |
| Oslo Parkour Park | Konows gate 1–3, Gamlebyen | Inne | Betalt. Kurs, egentrening, familiefritrening |

**Status:** Furuset er ALLEREDE i basen, som Klatring — den kom med fordi
objektet også bærer `sport=climbing` (buldreveggen). De to andre er ikke
inne.

**Åpent spørsmål:** hvilken kategori? Furuset ligger i Klatring litt
tilfeldig. Egen Parkour-kategori ville hatt tre steder i Oslo — tynnere enn
Skøyter (1 nasjonalt), men det er en produktavveining. Ingen
parkour-illustrasjon finnes i assets.

---

## Rullesport — skateanlegg (13 steder)

Kilde: manuell research, verifisert mot klubbsider.

| Sted | By | Inne/ute | Merknad |
|---|---|---|---|
| Oslo Skatehall, Stavangergata 28 (Voldsløkka) | Oslo | Inne | Street, bowl, ramper. Brett og hjelm inkludert i billett. Kun skateboard |
| Voldsløkka uteområde | Oslo | Ute | Utenfor skatehallen |
| Skur 13, Tjuvholmen | Oslo | Inne | Ramper, rails, pipes. **Egne tider for skateboard, sparkesykkel og rulleskøyter** |
| Gamlebyen skatepark (GSF) | Oslo | Ute | Betongpark, eget nybegynnerområde |
| Fysak Slettebakken, Vilhelm Bjerknes' vei 42 | Bergen | Inne | Gratis, låner brett og hjelm. Fordelte tider |
| Fysak Åsane, Åsane Senter 50B, Ulset | Bergen | Inne | Gratis, låner utstyr. Fordelte tider |
| Fysak Melkeplassen, Øvre Fyllingsveien 35 | Bergen | Inne | **Skateboard, sparkesykkel, BMX og inlines deler åpningstid** |
| Trikkestallen | Trondheim | Inne | Street, bowl, minirampe |
| Regnbueparken, Stavne | Trondheim | Ute | ~3500 m² ved Nidelva. Eget nybegynnerområde |
| Finalebanen, Klostergata, Øya | Trondheim | Ute | |
| Rockheim skatepark, Brattørkaia 1 | Trondheim | Ute | Kanter, kuler, quarterpipe |
| Tasta skatepark, Tasta idrettspark | Stavanger | Ute | Street og bowl |
| Paradis skatehall | Stavanger | Inne | Stavanger skateklubb. Kurs og camper, sjekk Spond |

**Merk delt bruk:** Skur 13 og Fysak Melkeplassen deler anlegget i tid mellom
skateboard, sparkesykkel, BMX og inlines. Det er begrunnelsen for at
`skate-sparkesykkel.png` er én sammenslått kategori — ikke `pump_track`-
tellingen, som var ugyldig.

---

## Hva Rullesport krever (Fase C, andre halvdel)

Klatring var import alene. Rullesport er større fordi den har to spor:

**1. Import** — ny kategori i `PLACE_CATEGORIES`, samme mekanikk som
klatring:
- Selektor forankret i `sport`, IKKE `leisure` — `leisure=skatepark` finnes
  ikke i norsk OSM
- `sport=skateboard` 376, `bmx`-varianter 167, `pumptrack` 15,
  `roller_skiing` 39 nasjonalt
- **Regex, ikke likhet:** to tredjedeler av BMX ligger i `bmx;cycling` og
  `cycling;bmx`, og rekkefølgen varierer
- `skate-sparkesykkel.png` ligger klar i togedoo-modern main
- Fire steder i togedoo-modern: `category_theme.dart`,
  `explore_filter.dart`, `explore_screen.dart`, `place_copy.dart`

**2. Seed** — de 13 anleggene over, etter mønster fra
`seed-vintertilbud.ts`:
- Kartverket-geokoding, `pending` ved tvetydig treff
- `nearCity` for anlegg utenfor kommunegrensen
- `is_indoor` per sted (kolonnen finnes)

Importen gir uteanleggene. Seed gir hallene. Uten seed mangler Oslo
Skatehall, Skur 13, alle tre Fysak-hallene, Trikkestallen og Paradis — altså
seks av de sju innendørsanleggene.

**Åpent:** tagline i `place_copy.dart` må være sann for både innendørshall og
utendørs betongpark.

---

## Åpent spørsmål: kommunale anleggssider som kilde

§15 i `bidrag-mekanisme.md` avgrenset datakildene til tre: OSM,
Anleggsregisteret, brukere/aktører. Begrunnelsen var skalering til
Sverige/Danmark, vedlikeholdskostnad og datatype — og gjaldt **kommunale
bookingsystemer**.

oslo.kommune.no/idrettsanlegg er noe annet: et publisert anleggsregister med
beskrivelser, ikke et bookingsystem. Det ga oss to av tre parkouranlegg med
opplysninger OSM aldri kan ha — gratis eller betalt, åpent for alle eller
booking, hvilke aktiviteter anlegget rommer.

Verdt å ta opp igjen som avgrenset kilde for seeding, ikke som integrasjon.
Ingen beslutning tatt.

---

## Åpne punkter fra samme økt

- **Illustrasjonsstilene spriker.** De sju OSM-importerte kategoriene har
  flate hvite piktogrammer; de seks seedede pluss Klatring har fargerike
  tegnede illustrasjoner. Skillet følger nøyaktig import/seed-grensen. Ser
  ut som halvferdig, ikke som et valg.
- **Kartet i detaljarket er for lite.**
- **`sport=parkour` finnes på 7 objekter nasjonalt, ingen med `name`.**
  Fordelt på `leisure=pitch` (4), `leisure=fitness_station` (2), ingen
  leisure (1). Parkour er ikke en anleggstype i norsk OSM — det er en tagg
  på en ballbane eller treningsstasjon.

---

## Kjent gjeld: by-modus velger vilkårlig, ikke nærmest

**Funnet sep. 2026, under arbeidet med avstandssortering. Ikke løst.**

`/api/activities` har to moduser. Radius-modus (`lat`/`lng` sendt) går gjennom
PostGIS-RPC-en `activities_nearby`, som filtrerer på radius og sorterer
nærmest først. By-modus (`municipality` sendt) gjør noe helt annet:

```ts
.eq('status', 'published')
.order('starts_at', { ascending: true, nullsFirst: false })
.limit(limit)          // appen sender 100
```

For steder (`kind='place'`) er `starts_at` **null i alle rader**. Sorteringen
er derfor uten effekt, og hvilke 100 rader man får er i praksis bestemt av
databasens radrekkefølge.

Oslo har 3996 lekeplasser. En forelder i by-modus får altså 100 vilkårlige av
dem — ikke de nærmeste, og ikke de samme fra gang til gang hvis
radrekkefølgen endres av en reimport.

**Avstandssorteringen som ble lagt inn løser ikke dette.** Den sorterer
utvalget etter at det er hentet, altså de 100 vilkårlige radene i pen
rekkefølge. For kategorier under grensen på 100 — Skianlegg med 6 i dag og
~30 etter alpinseeden, Klatring med 23, Rullesport med 81 — er den fullt ut
riktig, fordi utvalget da er hele kategorien. Over grensen er den kosmetikk.

**Hva som skal til:** sortere i databasen FØR `limit`, altså med bysentrum
tilgjengelig i SQL. Det betyr enten en ny RPC eller en utvidelse av
`activities_nearby` med et by-filter og valgfri radius. Det krever migrasjon,
og ble bevisst utsatt.

**Konsekvens for seeding:** å seede flere rader inn i en kategori som allerede
er over 100 i én by hjelper ikke brukeren i by-modus før dette er fikset.
Kategoriene i denne backloggen ligger alle godt under grensen, så de er ikke
berørt.
## Rullesport — fasetter uten treff (10. september 2026)

Fasettene Pumptrack og Rulleski gir null treff i Oslo. Anleggene
finnes; OSM-taggene gjør ikke.

### Pumptrack — Oslo

Kilde: manuell research, verifisert mot beskrivelser med adresse.

| Sted | Adresse | Merknad |
|---|---|---|
| Ammerud pumptrack | Ammerudgrenda 4, 0959 Oslo | Oslos første pumptrack, bygget 2020 av LilloVelo + kommunen. Gratis, åpen hele året |
| Bjørndal pumptrack | Seterbråtveien 4, 1271 Oslo | Oslos første asfalterte pumptrack, i Bjørndal idrettspark |
| Manglerud sykkelpark | Plogveien 22, 0681 Oslo | Baner med ulik vanskelighetsgrad. Skøyteløype om vinteren |
| Sykkelbanen i Trolldalen | Stordamveien 47, 0671 Oslo | Nybegynnerløype i skogsterreng, fast dekke av flis |
| Voldsløkka pumptrack | Voldsløkka, Oslo | Ikke verifisert mot adresse |

I basen i dag: 3 pumptracks, alle i Stavanger.

### Rulleski — Oslo

Holmenkollen, Fossum (kortere runde), Linderudkollen.

Ingen har `sport=roller_skiing` i OSM — ellers ville importen
fanget dem. Nasjonalt finnes 39 treff, men ingen i de fire byene.

Fasetten er bevisst beholdt selv om den er tom: tokenet er ekte,
importselektoren henter det allerede, og uten fasetten ville de
første løypene vært usynlige til neste app-release.

---

## Undertaggede anlegg — en egen kategori problem

**Bøler Betongpark** (way i basen, kategori Rullesport) har
`sport=skateboard` og ingenting mer. Beskrivelsen fra kommunen
sier at anlegget har «kuler, trapper, rails og kanter, og en lang
rampe for de minste til å øve seg på sparkesykkel og BMX».

Stedet er altså riktig i basen, men usynlig under BMX-fasetten.

Dette er ikke seed-materiale i vanlig forstand — stedet finnes
allerede. Det som mangler er en tagg. Det er nøyaktig det
bidragsmekanismen skal fange: en forelder som vet at Bøler har
BMX-rampe kan bekrefte det, uten at noen må redigere OSM.

Verdt å ha som konkret eksempel når bidragsmekanismen skal
utformes: den skal ikke bare legge til steder, men berike steder
som allerede er der.

---

## Mønsteret, oppsummert

Fem uavhengige funn samme dag, alle med samme form:

| Aktivitet | Hva OSM sier | Hva som finnes |
|---|---|---|
| Skateanlegg | `leisure=skatepark` = 0 nasjonalt | 13 kjente anlegg i fire byer |
| Klatring | 1253 `sport=climbing` | 75 faktiske anlegg, resten er klippevegger |
| Parkour | 7 navnløse polygoner nasjonalt | 3 anlegg i Oslo alene |
| Pumptrack | 3, alle i Stavanger | Minst 5 i Oslo |
| Rulleski | 39 nasjonalt, 0 i de fire byene | 3 kjente løyper i Oslo |

**OSM sier hva noen har tagget, ikke hva som finnes.** Det gjelder
både manglende steder og manglende egenskaper på steder som er
der.
