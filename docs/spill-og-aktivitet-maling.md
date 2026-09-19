# Spill og aktivitet: måling før valg av kategori

**Status:** bare måling (19.09.2026). Ingen kategori er opprettet, ingen kode er
endret, og ingenting er skrevet til basen. Basen er lest med service-nøkkelen
(bare `GET` mot PostgREST). OSM er lest fra Overpass med Togedoo-identiteten.

Bakgrunn: Megazone (lasertag) vises som Idrettshall i appen. Spørsmålet er om
bowling, lasertag, spillehall, minigolf, biljard, shuffleboard, dart og
lignende skal få en egen kategori, og hvordan radene i så fall skal inn.

## Kort svar

- **Megazone er Idrettshall fordi importen tar alle `leisure=sports_centre`
  inn som Idrettshall**, uansett hva `sport` sier. Begge Megazone-radene (Oslo
  og Bergen) er `leisure=sports_centre` + `sport=laser_tag`.
- **Bare de to Megazone-radene** av de 315 publiserte Idrettshall-radene har en
  tagg for bowling, lasertag, biljard, dart, minigolf eller escape room. To
  andre er heller ikke idrettshaller: en gokartbane og en trampolinepark.
- **OSM har 195 slike steder i Norge**, etter at dubletter på tvers av taggene er
  fjernet. 124 har navn og 71 har ikke navn. Minigolf utgjør nesten halvparten
  (91). 58 av minigolfbanene har ikke navn.
- **22 av de 195 er puber eller barer, eller ligger innen 30 m fra en.** 8 har
  selv `amenity=pub` eller `amenity=bar`. Treffene på dart og shuffleboard er
  nesten bare puber. Ingen av de 195 har en aldersgrense tagget.
- **Av 20 tilfeldige treff er 9 ekte tilbud til barnefamilier (45 %).** 3 er
  uklare og 8 er ikke tilbud for barnefamilier. De fleste «nei» er minigolfbaner
  på campingplasser og hoteller, for gjestene.
- **Anbefaling: kuraterte rader, med OSM som kandidatliste.** Ikke en import med
  regler. Se nederst.

## 1. Megazone og Idrettshall

### Radene

| | Oslo | Bergen |
|---|---|---|
| id | `1390579e-14aa-419b-9471-54deb9f64e6e` | `c8b31a07-967a-4ca5-b78b-6ab1eefe5c51` |
| Kilde | `osm-steder` | `osm-steder` |
| external_id | `node/4736654480` | `node/7197772245` |
| Status | published, ikke låst | published, ikke låst |
| Fasetter | ingen | ingen |

`osm_tags`, Oslo:

```json
{ "name": "Megazone", "sport": "laser_tag", "leisure": "sports_centre",
  "website": "https://www.megazone.no/", "wheelchair": "no" }
```

`osm_tags`, Bergen:

```json
{ "name": "Megazone", "sport": "laser_tag", "leisure": "sports_centre",
  "opening_hours": "Mo-Fr 12:00-22:00, Sa 11:00-22:00; Su 11:00-21:00" }
```

### Regelen

`scripts/import-places.ts`, kategorien `idrettshall`:

```ts
selector: 'nwr["leisure"="sports_centre"](area.a);',
matches: (t: OsmTags) => t.leisure === 'sports_centre',
```

Kategoriene er i prioritert rekkefølge. Skianlegg og Klatring står foran og tar
sine `sports_centre`-er først. Idrettshall er oppsamleren for resten. Den ser
ikke på `sport`, så `sport=laser_tag` blir Idrettshall. Det samme gjelder
`sport=karting` og `sport=10pin`. Bowlinghaller med
`leisure=sports_centre` + `sport=10pin` finnes i OSM (Metro Bowling Lørenskog,
Sarpsborg Bowlingsenter, Sheiken Bowling), men ingen av dem ligger i de fire
importbyene, og derfor er ingen av dem i basen i dag.

### Idrettshall-radene som egentlig er noe annet

Alle 315 publiserte Idrettshall-rader er gått gjennom. Jeg har sett på `sport`,
`leisure`, `amenity`, `tourism` og navnet.

| Rad | Kommune | OSM | Hva det er |
|---|---|---|---|
| Megazone | Oslo | `node/4736654480`, `sport=laser_tag` | Lasertag |
| Megazone | Bergen | `node/7197772245`, `sport=laser_tag` | Lasertag |

**Treff på bowling, lasertag, biljard, dart, minigolf eller escape room: 2.**
Ingen Idrettshall-rad har `sport=10pin`, `billiards`, `darts` eller
`miniature_golf`, eller en `leisure`-verdi for disse. Hver av de 315 radene har
`leisure=sports_centre`.

To rader er heller ikke idrettshaller, men utenfor listen du ga:

| Rad | Kommune | OSM | Hva det er |
|---|---|---|---|
| Harald Huysman Karting | Oslo | `way/1030656428`, `sport=karting` | Gokart |
| Rush trampolinepark | Bergen | `node/13716750101`, uten `sport` | Trampolinepark. **Dublett:** den kuraterte raden «Rush Trampolinepark Bergen» (Trampolinepark) finnes allerede |

## 2. Taggene i OSM for Norge

Hver tagg er målt for seg over hele Norge
(`area["ISO3166-1"="NO"][admin_level=2]`). Så har jeg søkt på navn for å se
om steder med disse navnene har andre tagger enn dem jeg målte.

### Taggene som finnes

| Tilbud | Tagg | Objekter | Med navn | Uten navn |
|---|---|---|---|---|
| Bowling | `leisure=bowling_alley` | 47 | 45 | 2 |
| Bowling | `sport=10pin`, `9pin` eller `bowling` | 31 | 24 | 7 |
| **Bowling, samlet uten dubletter** | | **66** | **57** | **9** |
| Lasertag | `sport=laser_tag` (og `leisure` som inneholder `laser`) | 3 | 3 | 0 |
| Spillehall | `leisure=amusement_arcade` | 11 | 10 | 1 |
| Minigolf | `leisure=miniature_golf`, `golf=miniature`, `sport=miniature_golf` | 91 | 33 | 58 |
| Biljard | `sport=billiards`, `snooker` eller `pool` | 5 | 4 | 1 |
| Dart | `sport=darts` | 4 | 4 | 0 |
| Shuffleboard | `sport=shuffleboard` | 4 | 2 | 2 |
| Escape room | `leisure=escape_game` | 15 | 15 | 0 |
| **Alle over, uten dubletter** | | **195** | **124** | **71** |

Et sted kan ha flere tagger. For eksempel har «Alltid Opplett» `sport=darts;minigolf;shuffleboard`.
Derfor er summen av linjene større enn 195.

Nabotagger, målt, men ikke regnet med i de 195:

| Tagg | Objekter | Med navn | Merknad |
|---|---|---|---|
| `leisure=adult_gaming_centre` | 8 | 8 | Bingo og spillelokaler. **Skal ikke inn** |
| `leisure=trampoline_park` | 14 | 11 | Kategorien Trampolinepark finnes allerede (kuratert) |
| `leisure=indoor_play` og `playground` + `indoor=yes` | 28 | 21 | Kategorien Innendørs lekeland finnes allerede (kuratert) |
| `sport=paintball` | 16 | 7 | Stort sett `leisure=pitch` ute |
| `sport=karting` | 59 | 12 | Mest baner uten navn. Gokart er et eget spørsmål |
| `sport=table_soccer` | 2 | 0 | Fotballspill ute, uten navn |

### Hvordan taggene brukes

- **Bowling er tagget på to måter, ofte med bare én av dem.** 12 steder har
  både `leisure=bowling_alley` og `sport=10pin`. 35 har bare
  `leisure=bowling_alley`, og 19 har bare `sport=10pin`/`bowling`, noen med
  `leisure=sports_centre` eller `leisure=pitch`. En import må lese begge.
- **`sport=bowling` er ikke alltid bowling.** Fire navnløse
  `leisure=pitch` + `sport=bowling` ligger i en park i Jåttåvågen i Stavanger.
  Det er trolig boccia eller kulespill ute, ikke bowlinghall.
- **Taggene er uryddige.** Lykkeland Lekepark (Steinkjer) har
  `leisure=bowling_alley; laser_tag; playground`, altså tre verdier med
  mellomrom i én tagg. Det tredje lasertag-treffet finnes bare fordi søket
  mitt sjekket `leisure` for `laser`.
- **«VR Games Zone» er tagget som escape room.** «Ibsen Escape» ligger i et
  museum.

### Navnesøket

Søkene er gjort på navn uten hensyn til store og små bokstaver. Tabellen viser hvor mange av treffene
taggene over ikke fanget.

| Søk | Treff | Ikke fanget av taggene | Hva de er |
|---|---|---|---|
| `bowling` | 53 | 10 | 4 er tagget som pub, bar eller gatekjøkken, for eksempel «Oslo Bar & Bowling» og «Kulå Bowling» (både pub og gatekjøkken). 4 har ingen hovedtagg, blant dem «Arendal Bowling» og «Lucky Strike Bowlingsenter». «Bowling1 Trondheim» er bare `building=industrial` |
| `laser`, `megazone` | 27 | 24 | Ingen er lasertag: bilvask, hudklinikker og gatenavn |
| `biljard`, `billiard`, `snooker`, `pool bar` | 5 | 0 | |
| `minigolf`, `mini golf`, `adventure golf` | 28 | 7 | Kafé, kiosk og camping med minigolf i navnet |
| `escape`, `exit room` | 12 | 4 | Én ekstra node for Escape Bryggen (`tourism=attraction`), resten er frisør, reisebyrå og en pub |
| `dart`, `shuffle` | 28 | 28 | Ingen er dart: stedsnavn som «Darthus» og «Vidartjern». Én bar: «Skjetten Dart & Kebab» |
| `spillehall`, `arcade`, `gaming`, `aktivitetshus` | 48 | 45 | Nesten bare kommunale aktivitetshus. Én butikk: «Dragons nest gaming» |

**Konklusjon:** Taggene fanger nesten alt, men ikke bowling. Rundt 1 av 6
bowlingsteder (10 av 66) har ikke bowlingtaggen, og fire av dem er tagget som
pub eller bar.

## 3. Pub, bar, nattklubb og aldersgrense

Jeg har sjekket de 195 stedene på tre måter:

| Kontroll | Antall |
|---|---|
| Selv tagget `amenity=pub`, `bar`, `nightclub`, `casino` eller `biergarten` | **8** |
| «pub» eller «bar» i navnet, uten slik tagg | 1 (Oslo bar & bowling, også innen 30 m) |
| Uten egen tagg, men med et utested innen 30 m | **14** |
| **Til sammen** | **22 av 195 (11 %)** |
| Aldersgrense tagget (`min_age`, `age`, `adult` og lignende) | **0** |

Hva som ble flagget, per tilbud:

| Tilbud | Steder | Flagget |
|---|---|---|
| Bowling | 66 | 5 |
| Lasertag | 3 | 0 |
| Spillehall | 11 | 3 |
| Minigolf | 91 | 5 |
| Biljard | 5 | 3 |
| Dart | 4 | 3 |
| Shuffleboard | 4 | 2 |
| Escape room | 15 | 2 |

Stedene som selv er pub eller bar: Billi Bob's (bowling og bar), Narvik
Bowling, Kong Oscar (biljard), Oche, Queens Pub (dart), Barkollektivet
(shuffleboard), Alltid Opplett (dart, minigolf og shuffleboard) og Oslo Camping
(minigolf, pub på samme node).

Dette ligger innen 30 m fra et utested: Royal Bowling & Biljard, Gravdal
Bowlingsenter, Harbour Bowl, Alta Bowling og Sportspub, Oslo bar & bowling,
Work-Work, House of Nerds og Chiruto (spillehaller), Biljarden, to escape rooms
og tre minigolfbaner ved camping eller utested. **30 m er grovt.** I en
bykjerne treffer det også naboen i neste bygning. Harbour Bowl og de to escape
rommene kan like gjerne være et nabotilfelle.

**Det viktigste å vite:**

- **Dart, shuffleboard og biljard er i OSM nesten bare puber.** 3 av 4 dartsteder
  er puber eller barer. Det fjerde er en biljardklubb. Begge
  shuffleboardstedene med navn er barer. 3 av 5 biljardsteder er flagget.
- **Bowling er for det meste ikke tagget som bar**, men bowlinghaller serverer
  ofte alkohol, og mange har aldersgrense om kvelden. **Det står ikke i OSM**,
  og jeg har ikke sjekket det. Aldersgrensen må sjekkes per sted ved kuratering.
- **Work-Work, Chiruto og House of Nerds er barer med spill** (spillehall pluss
  bar på samme adresse). «Barkaden» og «Pizzabakeren Stord» er trolig også
  noe annet enn en spillehall for barn. Taggen `leisure=amusement_arcade` skiller dem ikke fra
  en spillehall for barn.
- **Listen over utesteder i OSM er ufullstendig**: 1 168 puber, barer og
  nattklubber i hele Norge. Ufullstendigheten er i OSM, ikke i målingen. Tallet 22 er derfor et
  **gulv**, ikke et tak.

## 4. Tjue tilfeldige treff, vurdert for hånd

Trukket fra de 195 med fast frø (`20260919`), sortert på OSM-id og stokket.
Vurderingen bygger på OSM-taggene og på hva som ligger rundt stedet (Overpass
`is_in` og 120 m rundt). **Jeg har ikke åpnet nettsidene** og vet ikke om
stedene er i drift i dag.

| # | Sted | Tagg | Hva som ligger rundt | Barnefamilier? |
|---|---|---|---|---|
| 1 | Mini golf, Tysvær | minigolf | Grindafjord Feriesenter (camping) | Nei, for campinggjester |
| 2 | Bowling 1 Vestkanten, Bergen | bowling | Kjøpesenter | **Ja** |
| 3 | Stord Minigolf | minigolf | Inne i Stord Golfpark | **Ja** |
| 4 | (uten navn), Oslo | minigolf, `fee=no` | Jordal skole, benker, treningsapparater | Uklart: trolig en del av skolegården eller parken |
| 5 | Bowling1 Gjøvik | bowling (bare `sport=10pin`) | | **Ja** |
| 6 | (uten navn), Sotra | minigolf | Skogtun Camping | Nei, for campinggjester |
| 7 | Sandviken Minigolf, Tinn | minigolf | Sandviken Camping | Uklart: har navn og kan være åpen for alle |
| 8 | (uten navn), Stavanger | `leisure=pitch` + `sport=bowling` | Park i Jåttåvågen | Nei, trolig kulespill ute, ikke bowling |
| 9 | (uten navn), Gjesdal | minigolf | Holmavatn Ungdoms- og Misjonssenter | Nei, for gjester |
| 10 | (uten navn), Kinn | minigolf | Krokane Camping | Nei, for campinggjester |
| 11 | (uten navn), Oslo | minigolf | Topcamp Bogstad | Nei, for campinggjester |
| 12 | Norse Oilfield Services minigolf & CountryClub, Stavanger | minigolf, `access=private` | | Nei, privat |
| 13 | Majorens golf («Aktivitetsbyen»), Sarpsborg | minigolf | | **Ja** |
| 14 | (uten navn), Modum | minigolf | Tyrifjord hotell | Nei, for hotellgjester |
| 15 | Escape Bryggen, Bergen | escape room | | **Ja**, for større barn |
| 16 | Fangene på Fortet, Stavanger | escape room | | **Ja** |
| 17 | Bowl it, Stord | bowling | Heiane storsenter | **Ja** |
| 18 | Skottevik feriesenter, Lillesand | minigolf | Feriesenter | Uklart |
| 19 | Perfect Escape, Oslo | escape room | | **Ja**, for større barn |
| 20 | Levanger Bowling | bowling | | **Ja** |

**Ja: 9 av 20 (45 %). Uklart: 3 (15 %). Nei: 8 (40 %).**

Alle 8 «nei» er minigolf eller den navnløse kulebanen. **Alle 7 bowlingsteder og escape
rommene i utvalget er «ja».** Derfor har jeg målt minigolf for seg:

| Minigolf (91) | Antall |
|---|---|
| Innen 250 m fra camping, hotell eller annen overnatting | **61** (42 uten navn) |
| Ingen overnatting i nærheten | 30 (14 med navn) |
| `access=private` | 3 |

Av de 14 frittstående med navn ligger to inne i fornøyelsesparker vi
allerede har som kuraterte rader: «Minigolf Hunderfossen» (`way/274826415`)
og trolig «Minigolf» (`way/696667335`) i Foldvik. «Stord Minigolf» står to
ganger (`node/10226978635` og `way/840607823`). Da er det rundt ti
frittstående minigolfbaner igjen i hele landet.

## 5. Anbefaling

### Kuraterte rader, med OSM som kandidatliste

Ikke en import med regler. Grunnene:

1. **Etter reglene blir det for få steder til en import.** Hvis vi fjerner
   puber og barer, bingo, private anlegg, steder uten navn og minigolf ved
   camping og hotell, står vi igjen med omtrent 55 bowlingsteder, 3 steder for
   lasertag, 5–7 spillehaller, rundt 12 escape rooms (Reality Adventures står tre ganger
   og Escape Bryggen to) og rundt 10 minigolfbaner.
   Det er rundt 90 steder, og da er det raskere å kuratere dem enn å
   vedlikeholde en import. Det er samme vurdering som for fornøyelsesparkene.
2. **Det avgjørende er ikke tagget.** Om et sted serverer alkohol, om det har
   aldersgrense, og om det er for gjester eller for alle, står ikke i OSM. En
   regel kan flagge (utested innen 30 m, `amenity=bar`), men den kan ikke
   frikjenne. Et menneske må se på hvert sted.
3. **Bowlingtaggene er ufullstendige.** 10 av 66 bowlingsteder har bare
   navnet, og fire av dem er tagget som pub eller bar.
4. **OSM gir likevel punktet og kandidatlisten.** Et skript kan skrive ut
   kandidatene med flaggene fra denne målingen, og kuratoren velger. Det er et
   leseskript, ikke en import.

**Unntaket er bowling.** Bowling er det nærmeste vi kommer en ren import
(66 steder, 57 med navn, alle bowlinghaller med navn i utvalget er «ja»). Det
kan vurderes senere, men da med `leisure=bowling_alley` **eller**
`sport=10pin`, uten `amenity=pub|bar|nightclub`, og med utesteder innen 30 m
flagget for manuell kontroll. Aldersgrensen må sjekkes uansett.

### Hovedkategori og fasetter

**Én ny hovedkategori** for betalte aktivitetssteder med spill, der barn og
foreldre gjør noe sammen. Navnet bestemmer Frederik.

**Fasetter**, som ASCII-tokens i `lib/facets.ts`, som bare settes av seeden
(`SEED_ONLY_FACETS`), slik `fornoyelsespark` gjør i dag:

| Token | Hva | Med? |
|---|---|---|
| `bowling` | Bowlinghall | Ja |
| `lasertag` | Lasertag | Ja |
| `escaperom` | Escape room | Ja, men for større barn. Målgruppen bør stå på raden |
| `spillehall` | Spillmaskiner og arkadespill | Ja, men bare hvis barer med spill holdes ute |
| `minigolf` | Minigolf | Ja, for de frittstående. Ute, så `isIndoor` må settes per rad |
| `biljard`, `dart`, `shuffleboard` | | **Nei.** I OSM er dette nesten bare puber. Blir det en fasett, blir det en liste over barer |

**`FASETT_SOM_KATEGORI`:** Ingen av fasettene trenger å stå der i første
omgang. Det blir aktuelt hvis et sted har en annen hovedkategori men skal komme
opp under den nye. Et eksempel er Lykkeland Lekepark (Steinkjer), som er
lekeland med bowling og lasertag.

### Megazone og importregelen

Blir kategorien opprettet, holder det ikke å låse de to Megazone-radene.
Importen lager dem på nytt som Idrettshall ved neste kjøring, fordi
`matches` for Idrettshall tar alle `sports_centre`. Det trengs to ting, samme
mønster som skianleggene og fornøyelsesparkene:

1. **Idrettshall må la være å ta** `sport=laser_tag`, `10pin`, `bowling` og
   `billiards`, og trolig `karting`. Det er en kodeendring i
   `scripts/import-places.ts`, med test.
2. **Claims** i `lib/osm-claims.ts` for `node/4736654480` og `node/7197772245`
   når de kuraterte radene finnes. De gamle OSM-radene tas ned med `unpublish`
   (`rejected` + `locked`), ikke slettes.

Ingenting av dette er gjort.

## Sidefunn, utenfor oppgaven

- **Dubletter mellom OSM-rader og kuraterte rader:**
  - Rush trampolinepark Bergen: OSM-raden er Idrettshall. Den kuraterte raden er Trampolinepark.
  - Leo's lekeland finnes som Lekeplass fra OSM i Oslo, Bergen, Trondheim og Stavanger (Forus). I Oslo, Bergen og Trondheim ligger det også en kuratert rad under Innendørs lekeland. Bergen-raden fra OSM har i tillegg `amenity=fast_food`. For Stavanger har jeg ikke sett etter en kuratert rad.
  - Rush Trampolinepark Trondheim: OSM-raden er Lekeplass. Den kuraterte raden er Trampolinepark.

  Det samme problemet som `lib/osm-claims.ts` løser for skianleggene.
- **Harald Huysman Karting** er Idrettshall. Om gokart hører til den nye
  kategorien, er et eget spørsmål.

## Hva som ikke er målt, og hva jeg ikke vet

- **Nettsidene er ikke åpnet.** Jeg vet ikke om stedene er i drift, om de
  serverer alkohol, eller om de har aldersgrense. «Ja» i utvalget betyr «ser
  ut som et tilbud for barnefamilier ut fra OSM».
- **Utvalget er lite.** 20 av 195. Andelen på 45 % har stor usikkerhet, og den
  er dominert av minigolf fordi minigolf er nesten halvparten av treffene.
- **30 m-grensen for utesteder er valgt av meg** og ikke kontrollert mot
  bygningene. Den gir falske treff i bykjerner og bommer der utestedet ikke
  er i OSM.
- **Navnesøket er bare på norske og engelske ord jeg valgte.** Et
  lasertag-sted som heter noe helt annet og mangler `sport=laser_tag`, er ikke
  funnet.
- **Ukjent i OSM:** VR-sentre, «aktivitetshus» med spill, kinoer med spillhall.
  Ikke målt.

## Slik ble det målt

- **Basen:** `activities` lest med service-nøkkelen, bare `GET`: alle
  publiserte Idrettshall-rader (315), Megazone-radene, og `osm_tags` for alle
  7 992 publiserte steder (se etter tagger for disse stedene i andre
  kategorier). Ingen skriving.
- **Overpass:** `overpass-api.de`, `User-Agent: Togedoo datahub
  (hello@togedoo.com)`, ett kall per tagg eller navnesøk, 5 s pause, med
  mellomlagring per svar. Mange kall fikk 504 eller 429 og ble kjørt på nytt
  med lengre pause. Til sammen rundt 40 vellykkede kall. Datastand
  19.09.2026 kl. 12:52 UTC (taggene) og 13:20 UTC (overnatting).
- **Spørringene:** `nwr[<tagg>](area.a); out tags center;` over
  `area["ISO3166-1"="NO"][admin_level=2]`. Utesteder:
  `amenity~"^(pub|bar|nightclub|casino|biergarten)$"` (1 168). Overnatting:
  `tourism~"^(camp_site|caravan_site|hotel|guest_house|hostel|chalet|motel|resort)$"`
  og `leisure=resort` (5 380).
- **Avstand:** luftlinje fra `center` (polygon) eller punktet.
- **Utvalget:** de 195 sortert på `type/id`, stokket med Fisher–Yates og en
  lineær kongruensgenerator med frø `20260919`, de 20 første. For 11 av dem
  ble omgivelsene slått opp i Overpass (`is_in` og 120 m rundt).
