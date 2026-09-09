# Kategorigruppering — forslag til fullstendig liste (v2)

**Grunnlag:** `norway-260908.osm.pbf`, nasjonal telling av `sport=*` og
`leisure=*` (se `kategoripotensial-sport.md`)
**Status:** forslag til beslutning, ikke vedtatt

> **v2 erstatter v1.** Første versjon var skrevet uten kjennskap til
> seed-sporet og til fasett-mekanismen. Den foreslo Innendørs lek og
> Isaktivitet som nye kategorier — begge finnes allerede (Badeland,
> Trampolinepark, Innendørs lekeland, Skøyter). v1 behandlet også alt som
> sekkeposter der fasetter er riktigere.

---

## Dagens 13 kategorier og hvor de kommer fra

**Fra OSM-import** (`import-places.ts`): Museum, Bibliotek, Lekeplass,
Ballbane (vises som «Ball- og racketsport»), Idrettshall, Badeplass, Park

**Fra kuratert seed** (`seed-*.ts`): Dyremøte, Skianlegg, Badeland,
Trampolinepark, Innendørs lekeland, Skøyter

**Ferdige illustrasjoner uten kategori:** `klatring.png`,
`skate-sparkesykkel.png` (Fase C), `standard.png` (reserve)

---

## Beslutningsregelen

Regelen er allerede etablert i `seed-vintertilbud.ts` og gjelder alle nye
kategorier:

- **Konsistent OSM-tagging og godt volum** → import
- **Lav eller sprikende tagging, kommersielle tilbud, steder utenfor
  kommunegrensen** → kuratert seed med Kartverket-geokoding
- **Underoppdeling av eksisterende kategori** → fasett, ikke ny kategori

Seed-sporet har to egenskaper importen mangler: `nearCity` (Varingskollen i
Nittedal hører til Oslos nærområde) og `pending`-status ved tvetydig
geokoding, slik at feilplasserte steder ikke serveres.

---

## Fase C — klar til bygging

### Klatring — import
| Tagg | Antall |
|---|---|
| `sport=climbing` | 1253 |
| `sport=climbing_adventure` | 122 |

Fjerde største sport-verdi i Norge. Illustrasjon finnes. Konsistent tagget.

Vurder `titleLabelFor` som skiller klatrevegg fra klatrepark i trær — det er
to ulike opplevelser. Samme mekanisme som `ballTitleLabel()`.

Utendørs klatrefelt bør sannsynligvis skilles fra innendørs sentre. Krever
inspeksjon av faktiske objekter før selektoren låses.

### Rullesport — import + seed
| Tagg | Antall |
|---|---|
| `sport=skateboard` | 376 |
| `sport=bmx` + `bmx;cycling` + `cycling;bmx` | 167 |
| `sport=pumptrack` + `cycling;pumptrack` | 15 |
| `sport=roller_skiing` + `roller_skiing;cycling` | 39 |

**Kritisk funn:** `leisure=skatepark` finnes IKKE i norsk OSM — null treff i
hele landet, hele listen gjennomgått. Det samme gjelder `leisure=pump_track`.
Selektoren må bygges på `sport`. `probe-sparkesykkel.ts` spurte etter begge
disse og kunne aldri gitt annet enn 0.

**Sammensatte verdier:** to tredjedeler av BMX-volumet ligger i `bmx;cycling`
og `cycling;bmx`. Rekkefølgen varierer også ellers i datasettet
(`soccer;basketball` og `basketball;soccer` er samme type anlegg). Regex, ikke
eksakt likhet.

**Seed-behovet:** importen gir uteanleggene. Innendørshallene er tagget som
bygg og kommer ikke med. Klar seed-liste med kjent fasit:

| Sted | By | Inne/ute |
|---|---|---|
| Oslo Skatehall, Voldsløkka | Oslo | Inne |
| Voldsløkka uteområde | Oslo | Ute |
| Skur 13, Tjuvholmen | Oslo | Inne |
| Gamlebyen skatepark | Oslo | Ute |
| Fysak Slettebakken | Bergen | Inne |
| Fysak Åsane | Bergen | Inne |
| Fysak Melkeplassen | Bergen | Inne |
| Trikkestallen | Trondheim | Inne |
| Regnbueparken, Stavne | Trondheim | Ute |
| Finalebanen, Øya | Trondheim | Ute |
| Rockheim skatepark, Brattøra | Trondheim | Ute |
| Tasta skatepark | Stavanger | Ute |
| Paradis skatehall | Stavanger | Inne |

**Fasett-kandidat:** Skateboard / Sparkesykkel / BMX / Pumptrack. Skur 13 og
Fysak Melkeplassen har dokumentert delt bruk mellom disse — samme anlegg,
ulike tider. Fasett viser forskjellen uten å splitte kategorien.

---

## Fasett, ikke ny kategori

### Bordtennis
`sport=table_tennis` = 403.

Ballbane-selektoren dekker i dag
`soccer|basketball|multi|tennis|volleyball|handball`. Bordtennis mangler,
men appen viser allerede en Bordtennis-fasett under Racketsport. Legg
`table_tennis` inn i selektoren — da fylles en fasett som allerede finnes.

---

## Neste pulje — import

### Frisbeegolf
| Tagg | Antall |
|---|---|
| `sport=disc_golf` | 123 |
| `leisure=disc_golf_course` | 110 |
| `leisure=disc_golf` | 1 |

**Dedupliseringskrav:** de to store tallene er stort sett samme anlegg tagget
på to nøkler. Uten dedup blir dobbeltoppføringer systematiske, ikke
tilfeldige som i Fase E. Gratis og utendørs — god familieaktivitet.

### Minigolf
| Tagg | Antall |
|---|---|
| `leisure=miniature_golf` | 88 |
| `sport=miniature_golf` | 7 |

Samme dedupliseringsproblem, mindre skala.

### Ridning
| Tagg | Antall |
|---|---|
| `sport=equestrian` | 453 |
| `leisure=horse_riding` | 89 |
| `sport=horse_riding` | 13 |

**Skal ikke med:** `sport=horse_racing` (95) er travbaner — publikumsanlegg,
ikke deltakelse.

---

## Krever verifisering før beslutning

### Sjakk — `sport=chess` = 119
Over dobbelt så mye som gymnastikk. Sannsynligvis utendørs sjakkbrett i
parker, ikke sjakklubber. Et betongbrett i en park er en fin aktivitet, men
noe helt annet enn tallet først antyder. Inspiser objekter før beslutning.

### Trampoline utenfor park — `sport=trampoline` = 590
Høyere enn svømming, men nesten sikkert dominert av hagetrampoliner.
Trampolinepark-kategorien finnes allerede via seed. Test om
`["access"!="private"]` skiller kommersielle anlegg fra hager. Gjør den ikke
det, la tallet ligge.

### Svømming
`leisure=swimming_pool` 1862, `sport=swimming` 453, `swimming_area` 234,
`bathing_place` 175. Badeplass og Badeland finnes allerede. Samme
hagebasseng-mistanke gjelder de 1862.

---

## Krever produkteierbeslutning

| Gruppe | Volum | Spørsmål | Vei |
|---|---|---|---|
| Motorsport | motocross 194, karting 58, enduro 15, speedway 6 | Barneklasser finnes, men aldersgrenser varierer per anlegg | Seed |
| Modell og radiostyrt | `model_aerodrome` 30, `rc_car` 11, `leisure=flightsimulator` 1 | Lavterskel og barnevennlig, men lavt volum | Seed |
| Skyting | `shooting` 431, `leisure=shooting_ground` 15, `shooting_range` 14, `archery` 27 | Reelle barnepartier i norske klubber, men våpen i barneapp er en bevisst avgjørelse | — |
| Spillehaller | `amusement_arcade` 11, `adult_gaming_centre` 8 | Aldersgrense varierer | Seed |
| Paintball | `sport=paintball` 15 | Aldersgrense og våpenlikhet | — |

**Drone:** ingen egen OSM-tagg. Modellflyfelt brukes i praksis til droner,
men presis dronedata må komme fra NLF modellflyseksjonen og Luftfartstilsynet
— §15 tredje kilde (aktører selv), ikke kartdata.

**Parkour:** `sport=parkour` = 7. For lite alene. Vurder som fasett under
Rullesport, eller la stå.

---

## Skal ikke med

| Tagg | Antall | Hvorfor |
|---|---|---|
| `sport=free_flying` | 2367 | Paragliding-startpunkter i fjellsider. Nest størst i Norge — ville dominert enhver udifferensiert import |
| `sport=horse_racing` | 95 | Travbaner, publikum |
| `sport=BASE` | 29 | BASE-hopping |
| `leisure=tanning_salon` | 28 | |
| `sport=cliff_diving` | 25 | Klippestup |
| `sport=parachuting` | 8 | |

**Søppel som må filtreres:** `leisure=yes` (6), `leisure=*` (3, bokstavelig
asterisk), `sport=yes` (7), `paddoc` (skrivefeil for paddock), `ski piste`
(mellomrom i stedet for understrek), `grass`, `outdoor`, `nature`,
`skotthyll` (10, lokalt særtilfelle), `dødball` (6).

---

## Tekniske krav som gjelder alle nye selektorer

1. **Regex, ikke eksakt likhet.** Sammensatte verdier med varierende
   rekkefølge finnes gjennom hele datasettet. Gjelder også etterprøving av
   eksisterende Fase B-selektorer.
2. **Deduplisering på tvers av `sport` og `leisure`.** Frisbeegolf og minigolf
   er dokumenterte tilfeller.
3. **`["access"!="private"]`** finnes allerede i ballbane- og
   bibliotek-selektorene. Test om den løser hagetrampoliner og private
   bassenger.
4. **Verifiser objekttype før bygging** der tallet er mistenkelig høyt:
   trampoline, sjakk, svømmebasseng.

---

## Det ingen kategoriutvidelse løser

- Aktiviteter inne i flerbruksbygg — Fysak-hallene, Skur 13, Oslo Skatehall.
  Delvis løsbart med seed, men ikke skalerbart til hele landet.
- **1307 `sport=multi`-anlegg nasjonalt.** Til sammenligning: `handball` har
  95 eksplisitte treff i hele Norge, altså færre enn antall `multi`-anlegg i
  Oslo alene. Mesteparten av håndball, innebandy, turn og volleyball ligger
  skjult der.
- Små nærmiljøanlegg — to ramper ved Engebråten skole, og mange tilsvarende.
  Utagget eller del av skolegård.

Bredde løses av denne listen. Dybde løses av bidragsmekanismen, og 1307 er nå
det målte omfanget av den oppgaven.
