# Kategoripotensial — nasjonal telling av `sport=*`

**Målt:** 9. september 2026
**Kilde:** Geofabrik `norway-260908.osm.pbf` (replikeringstidsstempel 2026-09-08T20:21:01Z)
**Metode:** `osmium tags-count <fil> "sport=*"` — hele Norge, ikke bybegrenset
**Totalvolum:** 23 517 objekter med `sport`-tagg

## Hvorfor lokal fil og ikke Overpass

Overpass ga 504 på fire strake forsøk for to ulike prober 9. september, og
`probe-sparkesykkel.ts` produserte falskt 0 for både `skatepark` og
`pump_track` i alle fire byer. Skriptets egen kontrollspørring flagget dette
selv (`⚠ speilet svarer ikke / mangler data`). Falskt 0 er samme feilklasse
som v1 av `probe-parkour-klatre.ts` hadde.

Geofabrik-utdraget er et **midlertidig arbeidsverktøy** mens kategoritilbudet
bygges opp. Det fjerner ventetid og rate limits for prober. Det fjerner *ikke*
dekningsproblemet — datagrunnlaget er identisk med Overpass.
`import-places.ts` skal fortsatt bruke Overpass.

Filen ligger utenfor begge repoene og skal ikke committes.

## Viktig forbehold

Tallene under er fra de 60 øverste linjene i utskriften. Halen under 13 treff
er ikke gjennomgått. `parkour` forekom ikke i det vi så — enten ligger den i
halen, eller så er den knapt tagget i Norge. Må verifiseres før parkour
eventuelt vurderes.

---

## Lag 1 — byggbart nå

| Verdi | Antall | Merknad |
|---|---|---|
| `climbing` | 1253 | Fjerde største i Norge |
| `climbing_adventure` | 122 | Klatrepark i trær — egen opplevelse |
| `trampoline` | 590 | Høyere enn svømming. Ikke vurdert tidligere |
| `table_tennis` | 403 | |
| `skateboard` | 376 | |
| `disc_golf` | 123 | Gratis, utendørs, familievennlig |
| `chess` | 119 | |
| `bmx` + `bmx;cycling` + `cycling;bmx` | 54 + 50 + 63 = 167 | Se note om sammensatte verdier |
| `gymnastics` | 62 | Lavt, men reelt |
| `ice_skating` | 27 | Sesongavhengig |

**Klatring er bekreftet med god margin.** 1253 nasjonalt mot de 43 treffene
kontrollspørringen ga i Oslo-bbox. Fase C-klatring har solid grunnlag.

**Trampoline er det største uoppdagede funnet.** 590 treff, utpreget
barneaktivitet, aldri vurdert i noen fase.

### Note: sammensatte verdier

BMX fordeler seg på tre skrivemåter, og to av dem er sammensatte
(`bmx;cycling`, `cycling;bmx`). Sammensatte verdier utgjør **113 av 167** —
to tredjedeler. En selektor med eksakt likhet mister flertallet.

Samme mønster finnes bredt i dataene: `soccer;basketball` (75),
`multi;athletics` (29), `soccer;athletics` (18),
`soccer;basketball;volleyball` (17), `basketball;soccer` (14). Merk at
rekkefølgen varierer — `soccer;basketball` og `basketball;soccer` er samme
anlegg tagget ulikt.

**Konsekvens:** alle nye selektorer må matche med substring/regex, ikke
eksakt likhet. Dette gjelder også eksisterende selektorer og bør etterprøves.

---

## Lag 2 — krever beslutning fra produkteier

| Verdi | Antall | Hvorfor det ikke er automatisk |
|---|---|---|
| `shooting` | 431 | Reelle barnepartier i norske klubber, men våpen i barneapp er en bevisst avgjørelse |
| `archery` | 27 | Samme spørsmål, lavere volum |
| `equestrian` | 453 | Ridesentre — barneaktivitet. Skiller seg fra `horse_racing` |
| `motocross` | 194 | Barneklasser finnes, men motorsport har egne vurderinger |
| `karting` | 58 | Aldersgrenser varierer per bane |
| `model_aerodrome` | 30 | Modellfly/drone — bekrefter taggen. Se eget avsnitt |

---

## Lag 3 — skal ikke med

| Verdi | Antall | Hvorfor |
|---|---|---|
| `free_flying` | 2367 | Paragliding/hanggliding. Nest størst i Norge, men er startpunkter i fjellsider — ikke et sted en familie drar |
| `BASE` | 29 | BASE-hopping |
| `cliff_diving` | 25 | Klippestup |
| `horse_racing` | 95 | Travbaner — publikumsanlegg, ikke deltakelse |

`free_flying` er verdt å merke seg spesielt: den ville dominert enhver
udifferensiert import og gitt 2367 feilaktige treff.

---

## Det største strukturelle funnet: `sport=multi` = 1307

1307 anlegg nasjonalt tagget «flere sporter» uten å oppgi hvilke. Dette er
håndball-problemet fra `flerbruk-analyse.md` i nasjonal skala — der Oslo
alene hadde 67 haller som `sport=multi`.

Sammenlign med hva som er eksplisitt tagget:

- `handball` — 95 nasjonalt
- `volleyball` — 277
- `gymnastics` — 62

Håndball har 95 eksplisitte treff i hele Norge. Det er lavere enn antall
`multi`-anlegg i Oslo alene. Mesteparten av håndball, innebandy, turn og
volleyball ligger med all sannsynlighet skjult inne i de 1307.

**Dette er ikke løsbart med bedre selektorer.** Taggen inneholder ikke
informasjonen. Det er nøyaktig det bidragsmekanismen ble tenkt for, og 1307
er nå det målte omfanget av oppgaven.

---

## Drone og RC

`model_aerodrome` finnes med 30 treff. Det bekrefter taggen, som tidligere
var usikker.

RC-bil og drone har **ingen egen tagg** i det vi har sett. De 30 treffene er
modellflyklubbfelt, som i praksis også brukes til droner.

Vurdering: OSM er trolig ikke rett kilde for disse. Modellfly- og
droneaktivitet i Norge organiseres gjennom NLF modellflyseksjonen med
klubbfelt, og droneflyging reguleres av Luftfartstilsynet. Det er aktør- og
myndighetsdata, ikke kartdata — altså tredje kilde i §15
(brukere/aktører selv).

---

## Det OSM uansett ikke ser

Skateanlegg i Oslo, Bergen, Trondheim og Stavanger fordeler seg på tre lag:

1. **Dedikerte uteparker** — Gamlebyen, Tasta, Regnbueparken, Finalebanen,
   Rockheim. Kommer ut av importen.
2. **Haller inne i flerbruksbygg** — Fysak Slettebakken/Åsane/Melkeplassen,
   Skur 13, Oslo Skatehall. Bygget er tagget som bygg. Ingen `sport`-selektor
   finner dem pålitelig.
3. **Små nærmiljøanlegg** — to ramper ved Engebråten skole, og mange
   tilsvarende. Utagget eller del av skolegård uten egen tagging.

Lag 2 og 3 er størst i antall og usynlige for alle eksterne kilder. Dette
bekrefter konklusjonen fra forrige økt: registrene beskriver bygg, ikke
tilbud.

### Sammenslåing skate + sparkesykkel er bekreftet

Ikke av `pump_track`-tellingen — den var ugyldig. Men av hvordan anleggene
faktisk brukes:

- **Skur 13** har egne tider for skateboard, sparkesykkel og rulleskøyter.
- **Fysak Melkeplassen** deler åpningstid mellom skateboard, sparkesykkel,
  BMX og inlines.

Samme fysiske anlegg, delt i tid mellom brukergrupper.
`skate-sparkesykkel.png` er riktig avgjørelse.

---

## Seeding-kandidater for bidragsmekanismen

Tretten skateanlegg med kjent fasit, fordelt på fire byer:

**Oslo:** Oslo Skatehall (Voldsløkka, inne), Voldsløkka uteområde,
Skur 13 (Tjuvholmen, inne), Gamlebyen skatepark
**Bergen:** Fysak Slettebakken, Fysak Åsane, Fysak Melkeplassen (alle inne)
**Trondheim:** Trikkestallen (inne), Regnbueparken (Stavne),
Finalebanen (Øya), Rockheim skatepark (Brattøra)
**Stavanger:** Tasta skatepark (ute), Paradis skatehall (inne)

Disse er bedre seeding enn de ti hallene overleveringen foreslo, fordi flere
av dem har **dokumentert delt bruk mellom aktiviteter** — nettopp det
registrene ikke ser og brukerne kan bekrefte.

---

## Anbefalt rekkefølge

1. **Fase C som planlagt** — Klatring + Skate & sparkesykkel. Volum bekreftet,
   illustrasjoner i main. Husk substring-matching for BMX-variantene.
2. **Trampoline** — 590 treff, ny oppdagelse, ren barneaktivitet, ingen
   avgrensningsproblemer.
3. **Bordtennis, disc golf, sjakk** — alle over volumet som stoppet dans/turn.
4. **Bidragsmekanismen steg 1** — seed med de tretten skateanleggene.
5. **Lag 2-beslutninger** — skyting, ridning, motorsport. Krever produkteier.

## Åpne punkter

- Halen under 13 treff er ikke gjennomgått. Kjør
  `sort -rn sport-verdier.txt | tail -n +60` for resten.
- `parkour` er ikke funnet. Må verifiseres mot halen.
- Eksisterende selektorer bør etterprøves for sammensatte verdier.
- `leisure=*` er ikke talt. Skateparker, klatrehaller og pumptracks ligger
  delvis der (`leisure=skatepark`, `leisure=pump_track`), ikke bare under
  `sport`. Bør telles på samme måte.
