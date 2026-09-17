# Å koble 115 delflater til anlegget de hører til

**Status: koblingen er IKKE kjørt.** Utviklingsmiljøet når ikke Overpass —
proxyen svarer 403 på CONNECT for alle fire speil — og det finnes ingen
Supabase-nøkler her. Spørsmål 1, 2 og 5 krever begge deler og kan ikke
besvares herfra.

Spørsmål 3 og 4 kan derimot besvares **nå**, fra koden, og svaret på 4 endrer
premisset for hele oppgaven.

---

## 4. Nei — `lib/flatemaal.ts` slo IKKE sammen løypesegmenter

Det gjorde den ikke, og det betyr at **«89 med tre eller flere løyper» er et
tak, ikke et tall**.

Slik telte den før (`maalFlater`):

```ts
if (l.points.some((p) => punktIBoks(p, f.bounds!))) kryssende += 1;
```

`linjer` var ett element per OSM-way. En nedfart som er splittet i fem ways —
fordi den krysser en vei, skifter `piste:difficulty` halvveis, eller bare er
redigert i biter — ble talt som **fem løyper**.

Det er nøyaktig samme feil som Korketrekkeren i Aking: 14 objekter, 1 bakke.
Kodebasen har allerede en kur for den (`akingClusters`), og den ble ikke brukt
her.

### Hvor mange av de 89 er én løype i flere biter?

**Ukjent til målingen kjøres på nytt.** Tallet finnes ikke i noe som er
produsert så langt — det gamle skriptet skrev bare segmentantallet.

Sammenslåingen er nå implementert og testet. Rapporten skriver begge tall:

```
    av de N: M har løyper tegnet i flere biter (X segmenter → Y løyper)
```

### Hvordan segmenter slås sammen

To regler, og begge må til:

**Endepunkt mot endepunkt.** En way som splittes i OSM etterlater seg to deler
som deler nøyaktig én node. Mellompunkter brukes **ikke** som lim: to ulike
nedfarter som *krysser* hverandre deler også en node, og de skal forbli to.
Brukte vi alle punkter, ville hele anlegget blitt én løype og «tre eller
flere» aldri slått ut.

**Samme navn.** Segmenter som ikke henger fysisk sammen — et hull i taggingen,
en flat seksjon uten `piste:type` — bindes av navnet. Tomt navn binder
ingenting; ellers ville alle navnløse segmenter i Norge blitt én løype.

Enkeltlenke, som `akingClusters`: henger A sammen med B og B med C, er alle tre
samme løype.

---

## 3. De 6 uten utforløype — to kandidatforklaringer, og den ene er min feil

Importen krever `piste:type=downhill` for at en flate skal bli rad
(`skiVerdict` + `if (verdict !== 'alpint') continue`). Alle 115 har altså
bestått den testen. At 6 kom tilbake med null løyper i boksen er derfor et
avvik som må forklares, ikke noteres.

### Kandidat A: beviset ligger i 50-metersmarginen

Importens test er `insideOrNear`, og den måler **mot boksen, ikke mot kanten**:

```ts
if (pointInRing(p, ring)) return true;
const b = boundsOf(ring);
return pointInBounds(p, padBounds(b, toleranceMeters));
```

Altså godtas alt innenfor flatas bbox **pluss 50 m**. Målingens `kryssende`
teller bare punkter *inne i* boksen. En løype som bare er innom marginen gir
bevis i importen og null i målingen.

### Kandidat B: `around.f:100` hadde et hull — det var en feil i instrumentet

Den første versjonen hentet løyper med:

```
way(around.f:100)["piste:type"~"downhill"];
```

`around` måler avstand til flatas **ring**. En nedfart midt inne i en stor
flate kan ligge mer enn 100 m fra enhver kant, og ble da ikke hentet i det
hele tatt. Det rammer systematisk de **største** flatene — altså nettopp dem
som skulle hatt flest løyper.

Det er rettet: løypene hentes nå per flate med flatas **paddede boks**, som
ikke har det hullet.

```
way["piste:type"~"downhill"](61.27820,12.25626,61.29180,12.27374);
```

### Hvordan de skilles

Rapporten avgjør det selv, per flate, og skriver en av to linjer:

```
    way/12345   Trysil   bevis i 50-m-marginen — forklart
    way/67890   Hol      INGEN løype i margin heller — OSM er endret, eller en annen årsak
```

Faller de 6 bort helt etter omhentingen, var det kandidat B. Blir de stående
med «bevis i marginen», var det kandidat A. Blir noen stående med den siste
linja, er OSM endret siden importen — og da er de kandidater for nedtaking av
en helt annen grunn.

**Begge tallene fra forrige kjøring må regnes om.** Både «89 med tre eller
flere» og «10 korridorer» er målt med `around`-hullet og uten
segmentsammenslåing. De to feilene trekker i hver sin retning: hullet gir for
få løyper, manglende sammenslåing gir for mange.

---

## 1, 2 og 5 — instrumentet er klart, tallene mangler

```bash
# id-lista fra basen (SQL under), én rad per flate: way/123,Trysil
npx --yes tsx scripts/skianlegg-flatemaal.ts --ids=flater.txt
```

### Spørringene

Fire typer, alle små nok for dagtid:

| | spørring | deling |
|---|---|---|
| A | `way(id:…); .f out tags bb;` | biter à 25 |
| B | `rel(bw.f); rel(br.f); out body;` | biter à 25 |
| C | `way["piste:type"~"downhill"](boks);` én boks per flate | biter à 25 |
| D | `SKI_AREA_SELECTOR` + `["name"]` i unionsboksen, `out geom` | én |

**Hvorfor D ikke kan deles.** Et moranlegg som *omslutter* en delflate kan ha
kanten kilometer unna. Hverken `around` eller flatas egen boks finner det —
Overpass sitt bbox-filter returnerer et way bare når det har en node i boksen
eller krysser den. Unionsboksen over alle flatene, med 5 km margin, er den
minste avgrensningen som ikke kan miste en mor. Navngitte
winter_sports-polygoner er et lite sett: 254 i **hele** Norge (målt).

**Hvorfor D gjenbruker `SKI_AREA_SELECTOR`.** Endres selektoren i importen,
endres denne. Ellers ville «navngitt Skianlegg-polygon» betydd to ulike ting
to steder.

### Mellomlagring

Hver bit lagres til `--cache` med én gang den er hentet. En feilet bit kaster
ikke dem som gikk bra: kjør på nytt, og de ferdige leses fra disk uten å røre
nettet.

**Nøkkelen er spørringens fingeravtrykk, ikke bitnummeret.** Endres
spørringen, endres nøkkelen, og cachen gjenbrukes ikke — samme regel som
hentestegets fingeravtrykk i importen, og av samme grunn: «rett spørringen og
kjør på nytt» skal ikke gi gårsdagens svar i stillhet. Skrivingen går via
`.tmp` + `rename`, så en avbrutt kjøring ikke etterlater en halv JSON som neste
kjøring leser som ferdig.

### Koblingsregelen

**Punkt i ring, ikke nærhet.** Senteret er bboks-senteret — nøyaktig det
punktet raden har i basen, så koblingen gjelder det appen faktisk viser.

`insideOrNear` ville vært feil verktøy: den godtar alt innenfor polygonets
**boks** pluss en toleranse, og en boks rundt et fjellanlegg dekker halve
dalen. `pointInRing` er testet mot et konkavt anlegg der de to gir ulikt svar.

Tre utfall, og bare det første fører til nedtaking:

| utfall | betydning | havner på |
|---|---|---|
| **entydig** | nøyaktig én navngitt mor inneholder senteret | `nedtak.csv` |
| **flere** | to eller flere mødre overlapper | `uavklart.csv` |
| **ingen** | ingen mor inneholder senteret | `uavklart.csv` |

**Ingen nærhetsbasert klynging.** En flate uten omsluttende anlegg går på
uavklart-lista, ikke til nærmeste nabo.

**«child ski area» kan aldri være mor.** Det er en engelsk typebetegnelse som
har havnet i `name`, ikke et anleggsnavn; brukt som mor ville delflatene fått
tittelen «child ski area» i appen. Lista er eksakt og ikke et mønster — en
delstrengregel på «child» ville truffet et ekte anlegg som het noe med det
ordet, og feilen ville vært usynlig til noen leste rapporten.

### Id-lista

```sql
select external_id || ',' || coalesce(municipality, '')
from activities
where category = 'Skianlegg'
  and status = 'published'
  and osm_tags->>'landuse' = 'recreation_ground'
  and osm_tags->>'sport' = 'skiing'
  and osm_tags->>'name' is null
order by external_id;
```

Skriptet stopper på duplikater og på id-er med uventet form — begge ville gitt
en nedtaksliste som ikke stemmer med fingeravtrykket.

---

## Skrivingen: `--approve`, og hvorfor den ikke er nok alene

Tørrkjøringen regner ut et fingeravtrykk over **parene**, ikke over antallet:

```ts
fingerprint({ v: 1, par: nedtak.map((n) => [n.external_id, n.mor]).sort() })
```

og skriver ut kommandoen et senere skrivesteg må kjøres med:

```
npx tsx scripts/skianlegg-nedtak.ts --inn=.flatemaal-ut/nedtak.csv --approve=a1b2c3d4
```

Endres ett eneste par (flate, mor), endres avtrykket og kommandoen slutter å
virke. Det er beskyttelsen `--approve` gir: **lista kan ikke drive mellom
tørrkjøringen og skrivingen.** Den driver av seg selv her, fordi den er utledet
av OSM-data som endres.

### Men første kjøring bør ikke skrive i det hele tatt

Kodebasen har allerede tatt stilling til dette, i `lib/dedup.ts`:

> *Fristelsen er å la skriptet sette `status='rejected'` selv. Tre grunner til
> at det ikke gjør det: (1) regelen har aldri kjørt mot ekte data … (2)
> presedensen … koden bygger dem ikke lenger, et menneske tar dem ned. Én
> mekanisme, ikke to. (3) `--dry-run` ville blitt en løgn.*

Alle tre gjelder her, og den første gjelder ekstra: **koblingsregelen har aldri
kjørt mot ekte data**, og den første kjøringen er mot ~100 rader.

Derfor skriver tørrkjøringen ut SQL-en i stedet, og den gjenbruker
`nedtakingsSql` fra `lib/dedup.ts` — samme `rejected + locked` som `unpublish`
i `lib/moderation.ts`, samme angrevei (`publish`), én form i hele kodebasen og
ikke to.

**Anbefaling:** kjør de første ~100 nedtakene som SQL, og bygg
`skianlegg-nedtak.ts` med `--approve` først når regelen har vist seg å være
riktig mot ekte data. Fingeravtrykket regnes ut allerede nå, så tørrkjøringen
og et senere skrivesteg kan knyttes sammen uten at noe må gjøres om.

En ting SQL-en ikke gir, og som `--approve` ville gitt: **moren lagres
ingensteds.** SQL-en tar ned delflatene, men forholdet «way/123 hørte til
Trysilfjellet» finnes bare i `nedtak.csv`. Skal det kunne etterprøves senere,
må skrivesteget skrive det — og det er et argument for å bygge det, ikke for å
skrive nå.

---

## Hva som gjenstår, i rekkefølge

1. **Hent id-lista** med SQL-en over.
2. **Kjør skriptet.** Fire spørringstyper, biter à 25, pause imellom,
   mellomlagret. En feilet bit koster bare den biten.
3. **Les de tre tallene** i seksjon 1 (entydig / flere / ingen) og
   segmentlinja i seksjon 2. Segmentlinja avgjør om «89 delområder» holder.
4. **Les seksjon 3.** Er de 6 forklart, er premisset intakt.
5. **Kjør SQL-en** for de entydige, hvis tallene holder.

Ingen rader er rørt. `nedtak.csv`, `uavklart.csv`, cachen og `flater.txt` er i
`.gitignore` og committes ikke.
