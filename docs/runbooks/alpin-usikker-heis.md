# Alpint med heis, uten utforløype: kjørebok

**Status:** koden står på grenen `claude/alpin-usikker-heis`. **Ingenting er
kjørt** — ikke seeden, ikke importen.

## Hva dette er

Den nasjonale tørrkjøringen (sep. 2026) ga fire ekte norske alpinanlegg
dommen `usikker-heis`. De har heis i OSM, men ingen `piste:type=downhill`
tagget innenfor polygonet, og [`skiVerdict`](../../scripts/import-places.ts)
krever en nedfart.

**Kravet skal ikke mykes opp.** Uten det kommer Holmenkollen, Granåsen
skistadion og Linderudkollen hoppbakke inn som alpinanlegg — de har også heis
og ingen utforløype. Kostnaden er disse fire, og den betales med fire
kuraterte rader.

**Et tredje signal finnes ikke i dataene.** Kolsås ble slått opp i OSM: den har
bare `landuse=recreation_ground`, `lit=yes`, `name` og `sport=skiing`. Hverken
`piste:difficulty` eller `piste:lit`. Og `sport=skiing` alene er nøyaktig det
Varingskollen **skistadion** (langrenn) har — altså kan ikke den taggen skille
alpint fra langrenn.

## De fire radene

Koordinatene er manuelt verifisert i kart av Frederik, ved parkering eller
bunnstasjon.

| Rad | Koordinat | OSM-objekt |
|---|---|---|
| Kolsås Skisenter | 59.936150, 10.522875 | `way/43656613` |
| Finse Skisenter | 60.603992, 7.503743 | `way/544124493` |
| Ringkollen | 60.166439, 10.387994 | `relation/16471584` |
| Gråkallparken | 63.415211, 10.266573 | `way/1489390372` |

Alle fire: kategori **Skianlegg**, fasett `alpint`, `is_indoor=false`,
`is_free=false`, **ingen lenke**.

`url` er nå valgfri i `VinterSeed` og skrives som `null`, ikke tom streng.
Kolonnen er `url text` (nullbar, migrasjon 0001). En rad uten lenke er
ærligere enn en lenke til feil sted — jf. `akeforeningen.no` på
Korketrekkeren, som er en interesseorganisasjon og ikke bakken.

**Beskrivelsene er bevisst tynne.** De sier bare hvor stedet er og at det er
en alpinbakke. Antall nedfarter, barnebakke, heiskortpris og åpningstider er
ikke slått opp, og er ikke gjettet. Skal de fylles ut, er det en egen jobb med
web-verifiserte kilder.

## Kommunen — etterprøvd, ikke antatt

Punkt-i-polygon mot Kartverkets kommunegrenser (`robhop/fylker-og-kommuner`,
Kommuner-L, 2024, CC BY 4.0), med repoets egen `pointInRing`:

```
Kolsås Skisenter   59.936150, 10.522875  →  Bærum       nabogrense 5 808 m unna (Oslo)
Finse Skisenter    60.603992,  7.503743  →  Ulvik       nabogrense 6 384 m unna (Hol)
Ringkollen         60.166439, 10.387994  →  Ringerike   nabogrense 4 539 m unna (Jevnaker)
Gråkallparken      63.415211, 10.266573  →  Trondheim   nabogrense 8 314 m unna (Melhus)
```

Ingen av dem ligger nærmere en nabogrense enn **4,1 km**, altså langt utenfor
forenklingsfeilen i L-kvaliteten. (Til sammenligning: Wyller i Oslo-seeden
hadde 1,9 km margin, og det ble regnet som komfortabelt.)

## near_city — to av fire trenger den

> **Dette avviker fra oppgaveteksten,** som sa at ingen av de fire trenger
> `nearCity`. Det stemmer for Gråkallparken og Finse, men ikke for Kolsås og
> Ringkollen.

By-modus i `/api/activities` matcher
`municipality ILIKE X OR near_city ILIKE X`, og appen har **fire** by-chiper
(`lib/cities.ts`: oslo, bergen, trondheim, stavanger). En rad i Bærum eller
Ringerike uten `near_city` er derfor usynlig i alle fire.

Avstand til nærmeste bysentrum, målt med `distanceKm`:

| Rad | Kommune | Avstand | near_city | Presedens |
|---|---|---|---|---|
| Kolsås Skisenter | Bærum | 13 km til Oslo | **Oslo** | Kirkerudbakken, Bærum, 16 km → Oslo |
| Ringkollen | Ringerike | 35 km til Oslo | **Oslo** | Jessheimbadet 35 km → Oslo; Eikedalen 35 km → Bergen |
| Gråkallparken | Trondheim | 7 km | — | ligger i byen selv, som Pirbadet |
| Finse Skisenter | Ulvik | 122 km til Bergen, 195 km til Oslo | — | ingen |

Kolsås er **nærmere Oslo enn noen eksisterende `near_city`-rad**. Ringkollen
ligger nøyaktig på den lengste som finnes. Finse er langt utenfor enhver
presedens, og har dessuten **ingen veiforbindelse** — atkomst er med
Bergensbanen. Å kalle den en «nærliggende utflukt» fra Bergen ville vært feil.

**Følgen for Finse er ekte og akseptert:** raden er ikke synlig i noen by-chip.
Den finnes i radius-modus, og i en kommune-filtrering appen ikke har ennå. Det
er det samme som vil gjelde de tusenvis av importerte radene utenfor de fire
byene etter en nasjonal kjøring — `near_city` er et kuratorverktøy for en
håndfull rader, ikke en mekanisme som skalerer til 39 500.

Vil du heller ha Finse under Bergen, er det ett ord i `scripts/seed-vintertilbud.ts`.

## Rekkefølgen

**Ingenting skal tas ned.** Til forskjell fra Oslo-seeden finnes ikke disse
fire i basen i dag — de har aldri blitt rader, fordi dommen `usikker-heis`
stopper dem i berikelsen. Det er ingen `unpublish`, ingen SQL og ingen
rekkefølgefelle.

### 1. Tørrkjør seeden

```bash
npx --yes tsx scripts/seed-vintertilbud.ts --dry-run
```

Forventet: **34 rader** (30 før + 4). Alle fire nye har `manualCoord`, så de
geokodes ikke og skal stå som «manuelt verifisert». Linjene ser slik ut:

```
  [PUBLISHED] Bærum      →Oslo Kolsås Skisenter                     59.93615, 10.52288  (manuelt verifisert)
  [PUBLISHED] Ulvik          Finse Skisenter                      60.60399, 7.50374  (manuelt verifisert)
  [PUBLISHED] Ringerike  →Oslo Ringkollen                           60.16644, 10.38799  (manuelt verifisert)
  [PUBLISHED] Trondheim      Gråkallparken                        63.41521, 10.26657  (manuelt verifisert)
```

`assertClaimsResolve` kjører først i `main()` og kaster hardt hvis en claim
peker på en seed-rad som ikke finnes. Ti claims vokter nå ti rader.

### 2. Kjør seeden

```bash
npx --yes tsx scripts/seed-vintertilbud.ts
```

Etter dette finnes de fire som `published`. **Ferdig.** Ingen steg 3.

### 3. (valgfritt) Kontroller

```sql
select external_id, title, municipality, near_city, category, facets, url, status
from public.activities a
join public.sources s on s.id = a.source_id
where s.slug = 'kuratert-vintertilbud'
  and a.external_id in ('kolsas-skisenter','finse-skisenter','ringkollen','grakallparken');
```

Forventet: fire rader, `status='published'`, `url` er `null`, `near_city` er
`'Oslo'` på to og `null` på to.

## Claimene er FOREBYGGENDE — og det har en konsekvens

De fire OSM-objektene claimes, selv om importen ikke lager rader for dem i dag.

**Hvorfor:** dommen er en egenskap ved OSM-DATAENE, ikke ved anlegget. Tegnes
det en `piste:type=downhill` inn i Kolsås i morgen, blir polygonet «alpint»,
når `buildRows`, og importen lager en rad ved siden av seed-raden — nøyaktig
det som skjedde med Korketrekkeren. Claimen er vaksinen, og den koster
ingenting så lenge dommen står.

**Konsekvensen:** `applyOsmClaims` kjører på de BERIKEDE elementene, og et
polygon berikelsen forkaster når aldri dit. Uten et flagg ville disse fire
stått i `CLAIMS SOM IKKE TRAFF NOE` ved hver eneste nasjonale kjøring — og en
rapport med fire faste falske treff er en rapport ingen leser.

Derfor har `OsmClaim` feltet `expectNoHit`, og rapporten har fått et motstykke:

```
FOREBYGGENDE CLAIMS SOM TRAFF (1) — OSM har fått dataene som manglet:
  way/43656613         → kuratert-vintertilbud/kolsas-skisenter
```

Den linja er **ikke en feil**. Den betyr at noen har tagget en nedfart, og at
spørsmålet nå er om den kuraterte raden fortsatt er bedre enn importens.

**Prisen, og den er ekte:** flagget slår av dødt-claim-varselet for disse fire.
Blir `way/43656613` slettet i OSM, sier ingenting fra. Seed-siden er fortsatt
voktet av `assertClaimsResolve`.

## «usikker-heis» som egen liste i rapporten

Dette var spørsmålet i oppgaven, og svaret er **ja**.

I den nasjonale tørrkjøringen lå de fire spredt blant **815 rapportlinjer** for
Skianlegg, og `scripts/work-report.ts` viser 40 av dem. De var i praksis bare
synlige med `--lines=815`, og da måtte noen lese 815 linjer for å finne fire.

`EnrichOutput` har derfor fått feltet `merknader`: en kort liste som **aldri
avkortes**, skrevet ut både av importen og av `work-report`. Den inneholder
bare de tilfellene et menneske må se på — ikke en gjentakelse av dommene.

Slik ser den ut (kjørt mot konstruerte data — Kolsås-iden er ekte, den andre
er fingert, og koordinatene er avrundet til polygonets senter):

```
  HEIS UTEN UTFORLØYPE (2) — hvert av disse er ENTEN et
  ekte alpinanlegg som mangler piste:type=downhill i OSM og må SEEDES,
  ELLER et hoppanlegg som skal forbli utenfor. Nedfartskravet skilles
  ikke automatisk; se docs/runbooks/alpin-usikker-heis.md.
    way/43656613       Kolsås Skisenter (Kolsåsbakken)  59.93620,10.52290   drag_lift×2
      https://www.openstreetmap.org/way/43656613
    way/111111         Linderudkollen hoppbakke         59.98000,10.79000   chair_lift  ⚠ HOPPANLEGG — skal trolig IKKE seedes
      https://www.openstreetmap.org/way/111111
```

Tre valg i formatet, hvert med en grunn:

- **Heistypene står i linja.** En `rope_tow` er som regel en liten lokal bakke;
  en `chair_lift` ved et hoppanlegg er noe annet. Det avgjør ofte saken uten
  et oppslag.
- **`⚠ HOPPANLEGG`-merket.** Holmenkollen, Granåsen og Linderudkollen får
  NØYAKTIG samme dom som Kolsås — det er hele grunnen til at nedfartskravet
  ikke kan mykes opp. Merket skiller de to gruppene på ett blikk.
- **Lenka til osm.org.** Det er uansett neste handling.

**Forbehold:** lista er ikke avgrenset til Norge. Berikelsen er ren og kjenner
ikke grensefila, så en nasjonal kjøring med dagens bboks vil ha utenlandske
anlegg i lista også. De kjennes igjen på koordinatet. Det forsvinner når
bboksen strammes (egen oppgave — `scripts/bbox-candidates.ts`).

## Siljan skisenter er utenfor, og det er riktig

`relation/8359960` sto på samme liste, men ser nedlagt ut. Den er **hverken
seedet eller claimet**.

Importen kan ikke vite om et anlegg er i drift. Selektoren filtrerer
`disused=*` og `abandoned=*`, men et anlegg som er lagt ned **uten** å bli
omtagget ser helt levende ut i dataene. Så lenge dommen er `usikker-heis` blir
Siljan ingen rad, og det er riktig utfall. Blir den tagget med en utforløype
senere, kommer den inn som alpinanlegg — og da er det OSM-dataene som må
rettes, ikke denne lista.

## Hva som skjer hvis noe glemmes

| Glemt | Følge |
|---|---|
| **Seeden** (steg 2) | De fire anleggene finnes ikke i appen. Ingen skade utover det — claimene undertrykker ingenting i dag, fordi objektene uansett forkastes i berikelsen. |
| **Claimene** (allerede i koden) | Ingen følge før OSM får en `piste:type=downhill` på et av objektene. Da lager importen en rad ved siden av seed-raden, med bbox-senteret som kartpunkt. |
| **`near_city` på Kolsås/Ringkollen** | Radene finnes, men er usynlige i alle fire by-chiper. Den vanskeligste feilen å oppdage av dem alle — ingenting feiler, stedet er bare borte. |
