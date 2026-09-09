# Kategorigruppering — forslag til fullstendig liste

**Grunnlag:** `norway-260908.osm.pbf`, nasjonal telling av `sport=*` og
`leisure=*` (se `kategoripotensial-sport.md`)
**Status:** forslag til beslutning, ikke vedtatt

## Forbehold

Denne listen er laget uten innsyn i de 16 eksisterende kategoriene i
`category_patterns.dart`. Overlapp er sannsynlig. Sjekk mot eksisterende
kategorier før noe bygges.

## Prinsipp for gruppering

Sekkepost-mekanismen finnes allerede: Ballbane dekker seks sporter via
`sport~"soccer|basketball|multi|tennis|volleyball|handball"` med
`ballTitleLabel()` som gir riktig navn per kort. Gruppene under følger samme
mønster.

Tre kriterier for å slå sammen:

1. **Samme fysiske anlegg** — Skur 13 har egne tider for skateboard,
   sparkesykkel og rulleskøyter
2. **Samme utstyr og ferdighet** — barnet som sykler BMX bruker samme
   pumptrack som løpehjulet
3. **For lite alene** — `rc_car` (11) blir aldri egen kategori, men hører
   naturlig hjemme et sted

---

## Foreslåtte grupper

### 1. Klatring
| Tagg | Antall |
|---|---|
| `sport=climbing` | 1253 |
| `sport=climbing_adventure` | 122 |
| `leisure=high_ropes_course` | 1 |

**Merknad:** `climbing_adventure` er klatrepark i trær — en annen opplevelse
enn vegg. Vurder om tittel-etiketten skal skille dem, slik `ballTitleLabel()`
gjør. Utendørs klatrefelt bør sannsynligvis skilles fra innendørs sentre;
krever inspeksjon av faktiske objekter.

### 2. Rullesport
| Tagg | Antall |
|---|---|
| `sport=skateboard` | 376 |
| `sport=bmx` + `bmx;cycling` + `cycling;bmx` | 167 |
| `sport=pumptrack` + `cycling;pumptrack` | 15 |
| `sport=roller_skiing` + `roller_skiing;cycling` | 39 |
| `leisure=bike_park` | 1 |

**Kritisk:** `leisure=skatepark` finnes IKKE i norsk OSM — null treff i hele
landet. Selektoren må bygges på `sport`. Sammensatte verdier utgjør to
tredjedeler av BMX-volumet, og rekkefølgen varierer — regex, ikke eksakt
likhet.

### 3. Bordtennis
| Tagg | Antall |
|---|---|
| `sport=table_tennis` | 403 |

Står alene på volum. Kan alternativt inn i Ball- og racketsport, som allerede
er en sekkepost — men den har ikke `table_tennis` i selektoren i dag.

### 4. Isaktivitet
| Tagg | Antall |
|---|---|
| `leisure=ice_rink` | 92 |
| `sport=ice_hockey` | 55 |
| `sport=ice_skating` | 27 |
| `sport=ice_skating;speed_skating` | 12 |
| `sport=curling` | 13 |
| kombinasjoner (`pitch;ice_rink`, `ice_hockey;ice_skating` m.fl.) | ~20 |

**Merknad:** sesongavhengig. Mange baner er fotballbaner om sommeren —
`soccer;ice_skating` (9) og `pitch;ice_rink` (6) viser det direkte. Vurder om
appen skal vise sesong.

### 5. Innendørs lek
| Tagg | Antall |
|---|---|
| `leisure=bowling_alley` | 47 |
| `sport=10pin` + `bowling` | 29 |
| `leisure=water_park` | 37 |
| `leisure=escape_game` | 15 |
| `leisure=trampoline_park` | 14 |
| `leisure=indoor_play` | 12 |
| `leisure=water_slide` | 4 |
| `leisure=maze` | 1 |

Ingen av disse bærer egen kategori. Samlet er de en av de mest treffsikre
barnekategoriene i listen — dette er «hva gjør vi på en regnværsdag».

**MERK trampoline:** `sport=trampoline` har 590 treff, men er sannsynligvis
dominert av hagetrampoliner. Bare `leisure=trampoline_park` (14) er
kommersielle anlegg. Må verifiseres mot faktiske objekter før 590-tallet
brukes. Test om `["access"!="private"]` filtrerer hagetrampoliner.

### 6. Frisbeegolf
| Tagg | Antall |
|---|---|
| `sport=disc_golf` | 123 |
| `leisure=disc_golf_course` | 110 |
| `leisure=disc_golf` | 1 |

**Dedupliseringskrav:** de to store tallene er stort sett SAMME anlegg tagget
på to nøkler. Uten dedup får du dobbeltoppføringer systematisk, ikke
tilfeldig som i Fase E.

### 7. Minigolf
| Tagg | Antall |
|---|---|
| `leisure=miniature_golf` | 88 |
| `sport=miniature_golf` | 7 |

Samme dedupliseringsproblem i mindre skala.

### 8. Ridning
| Tagg | Antall |
|---|---|
| `sport=equestrian` | 453 |
| `leisure=horse_riding` | 89 |
| `sport=horse_riding` | 13 |

**Skal ikke med:** `sport=horse_racing` (95) er travbaner — publikumsanlegg,
ikke deltakelse.

### 9. Motorsport
| Tagg | Antall |
|---|---|
| `sport=motocross` | 194 |
| `sport=karting` | 58 |
| `sport=enduro` | 15 |
| `sport=rc_car` | 11 |
| `sport=speedway` | 6 |
| `sport=model_aerodrome` | 30 |

**Beslutning kreves.** Barneklasser finnes i norsk motorsport, men
aldersgrenser varierer per anlegg. `rc_car` og `model_aerodrome` er
lavterskel og passer barn direkte — vurder om de heller hører i en egen
«Modell og radiostyrt»-gruppe sammen med `leisure=flightsimulator` (1).

Drone har ingen egen OSM-tagg. Modellflyfelt brukes i praksis til droner,
men presis dronedata må komme fra NLF/Luftfartstilsynet, altså §15 tredje
kilde.

### 10. Sjakk og brettspill
| Tagg | Antall |
|---|---|
| `sport=chess` | 119 |

Overraskende høyt — over dobbelt så mye som gymnastikk. Sannsynligvis
utendørs sjakkbrett i parker. Verifiser hva objektene faktisk er før
kategorien bygges; et betongbrett i en park er noe annet enn en sjakklubb.

### 11. Parkour
| Tagg | Antall |
|---|---|
| `sport=parkour` | 7 |

For lite alene. Vurder inn i Rullesport (delvis samme anlegg) eller la stå.

---

## Krever produkteierbeslutning

| Gruppe | Volum | Spørsmål |
|---|---|---|
| Skyting | `shooting` 431, `shooting_range` 14, `leisure=shooting_ground` 15, `archery` 27 | Reelle barnepartier i norske klubber, men våpen i barneapp er en bevisst avgjørelse |
| Spillehaller | `amusement_arcade` 11, `adult_gaming_centre` 8 | Aldersgrense varierer |
| Paintball | `sport=paintball` 15 | Aldersgrense, og våpenlikhet |

---

## Skal ikke med

| Tagg | Antall | Hvorfor |
|---|---|---|
| `sport=free_flying` | 2367 | Paragliding-startpunkter i fjellsider. Nest størst i Norge — ville dominert enhver udifferensiert import |
| `sport=BASE` | 29 | BASE-hopping |
| `sport=cliff_diving` | 25 | Klippestup |
| `sport=horse_racing` | 95 | Travbaner, publikum |
| `sport=parachuting` | 8 | |
| `leisure=tanning_salon` | 28 | |
| `leisure=adult_gaming_centre` | 8 | Se over |

**Søppel som må filtreres:** `leisure=yes` (6), `leisure=*` (3, bokstavelig
asterisk), `sport=yes` (7), `paddoc` (skrivefeil), `ski piste` (mellomrom
i stedet for understrek), `grass`, `outdoor`, `nature`, `skotthyll` (10,
lokalt særtilfelle), `dødball` (6).

---

## Ikke kategorier, men verdt et blikk

`leisure=playground` har **11 901** treff — nest størst etter `pitch`.
Lekeplass er antakelig allerede dekket, men tallet viser at den er den
desidert største barnekategorien i Norge.

`leisure=swimming_pool` har 1862, `sport=swimming` 453,
`leisure=swimming_area` 234, `bathing_place` 175, `lake_bath` 2. Samme
hagetrampolin-problem gjelder trolig her: mange av de 1862 er private
bassenger. Bør verifiseres.

`leisure=summer_camp` (6) og `leisure=schoolyard` (26) er små, men begge er
utpreget barnerelaterte og kan være verdt en titt på hva objektene er.

---

## Praktiske krav som gjelder alle grupper

1. **Regex, ikke eksakt likhet.** Sammensatte verdier med varierende
   rekkefølge finnes gjennom hele datasettet.
2. **Deduplisering på tvers av `sport` og `leisure`.** Disc golf og minigolf
   er dokumenterte tilfeller; det finnes trolig flere.
3. **`["access"!="private"]`** er allerede i ballbane-selektoren. Test om den
   løser hagetrampoliner og private bassenger.
4. **Verifiser objekttype før bygging** der tallet er mistenkelig høyt:
   trampoline, sjakk, svømmebasseng.

## Det gruppene ikke løser

Ingen av disse kategoriene fanger:

- Aktiviteter inne i flerbruksbygg (Fysak-hallene, Skur 13, Oslo Skatehall)
- De 1307 `sport=multi`-anleggene nasjonalt
- Små nærmiljøanlegg som rampene ved Engebråten skole

Bredde løses av denne listen. Dybde løses av bidragsmekanismen.
