# Nasjonal ski og aking

**Status:** grenen `claude/nasjonal-chunk`, bygget på
`claude/nasjonal-forberedelse`. Den nasjonale chunken er skrevet.
**Ingen nasjonal kjøring er gjort** — tørrkjøringen er Frederiks.

---

## Målingen som ligger til grunn

Kjørt mot `overpass-api.de` **ved midnatt**, bbox `(57.5,4.0,71.5,31.5)`:

| Spørring | Objekter | Tid | Størrelse |
|---|---|---|---|
| `nwr[landuse=winter_sports]` | 445 | 5,5 s | 3,2 MB |
| `nwr[piste:type~downhill\|sled\|playground]` | 7 555 | 35 s | 11,3 MB |
| *(til sammenligning)* `leisure=playground`, `out center tags` | 55 593 | 106 s | 9,3 MB |

Ingen `remark`, begge på første forsøk. **Én nasjonal chunk overlever.**

### Tre ting målingen faktisk viste

**1. `curl` trenger `-A`.** Uten en User-Agent svarer Apache **406 Not
Acceptable**, uansett hvor liten spørringen er. Kommandoene under har flagget;
den forrige utgaven av denne kjøreboka manglet det og ville feilet for neste
person. Importen selv har alltid sendt UA.

**2. Tidspunktet betyr mer enn størrelsen.** Oslo ALENE feilet med 504 i hver
eneste kjøring på dagtid. Hele Norge gikk gjennom ved midnatt. Den ufiltrerte
bevisspørringen feilet med «server is probably too busy» — altså **belastning,
ikke volum**.

> **Verdifilteret kan derfor ikke krediteres for at nasjonal henting ble
> mulig.** Sammenligningen filtrert/ufiltrert er ikke målt, fordi den
> ufiltrerte kjøringen aldri kom gjennom. Filteret sparer data uansett, siden
> `nordic` ikke leses av noen — men det er en annen påstand.

**3. Bboksen dekker Sverige, Danmark og Finland.** 445 polygoner mot 254 i
Geofabrik-fila, og 55 593 lekeplasser mot 11 901. Nesten 80 % av
lekeplasstreffene er utenfor Norge.

---

## Avgrensningen til Norge skjer på KOORDINATET

Objekter utenfor landet blir aldri rader: `buildRows` slår opp kommunen i
`data/kommuner.geojson`, og et punkt som ikke faller i noen norsk kommune
utelates med en linje i loggen.

```
  2 objekter utelatt — punktet ligger utenfor norske kommunegrenser (f.eks. way/201)
```

**Alternativet — et `area`-filter i spørringen — ble forkastet.** Begrunnelsen
er kostnadene, ikke eleganse:

| | Sent (grensefil) | Tidlig (`area[ISO3166-1=NO]`) |
|---|---|---|
| Målt? | **Ja** — 445 og 7 555 objekter, 40 s | **Nei** |
| Overføring | 14,5 MB i stedet for ~6 MB | ~6 MB |
| Geokoding av utenlandske rader | **null** — de utelates før geokodingsbehovet regnes ut | null |
| Romlig test | 0,1 s uansett (se under) | 0,1 s |
| Ny feilmodus | ingen | området løser seg ikke → tomt svar, som ser ut som et tomt land |

Norges grenseobjekt er blant de tyngste i OSM (lang kystlinje, tusenvis av
øyer). Å bytte en **målt** mekanisme mot en **umålt** for å spare 8 MB er feil
handel. Prisen for å filtrere sent er båndbredde og minne — ikke tid, fordi
den dyre ressursen (~1,1 s per navnløs rad) aldri brukes på utenlandske rader.

**Sjekk «utelatt»-linjene i loggen.** I bboks-modus (`PLACES_NATIONAL_SCOPE=bbox`)
forventes ~40 % utelatt for ski (445 → ~254); er tallet null, virker ikke
grensefila. I områdemodus — standarden fra okt. 2026 — er forventningen den
motsatte: tallet skal være **lavt**, fordi avgrensningen allerede har skjedd i
spørringen. Et høyt tall der betyr at området har truffet noe annet enn staten
Norge.

> **UTDATERT FRA OKT. 2026 — MÅLINGEN SNUDDE DEN.** Tabellen over beskriver
> hvorfor `area[ISO3166-1=NO]` ble frarådet. Variant D ble målt i okt. 2026 og
> vant: bevisspørringen gikk fra 7 555 til 4 536 objekter (−40 %), aking fra
> 313 til 91 (−71 %), begge uten remark og på første forsøk. «Ny feilmodus»-raden
> var det eneste argumentet som overlevde, og den er dekket av ADVARSEL-linja
> for 0 elementer. Se «Byttet til område» nederst.
>
> Det argumentet som IKKE ble motbevist: `area` kan ikke ha margin mot
> riksgrensa. Det står fortsatt, og er den ene kjente kostnaden ved byttet.

---

## Den romlige testen: 281 s → 0,1 s

Med hele landet i én chunk er alle 7 555 bevisobjekter kandidater for alle
445 polygoner — 3,4 millioner par. Målt på syntetiske data med de samme
antallene:

| | Tid | Dommer |
|---|---|---|
| Uten forkastningsfilter | **281,4 s** | 12 verifisert |
| Med forkastningsfilter | **0,1 s** | 12 verifisert |

Samme data, samme svar. Den gamle varianten var rent kvadratisk — målt på tre
punkter: 28 k par 2,3 s, 112 k par 9,4 s, 448 k par 37,2 s.

Filteret er boks-mot-boks før den ekte testen, og er et **oversett** av det
`anyInsideOrNearAny` godtar: et punkt inne i en ring ligger også inne i
ringens boks, så et objekt som ikke rører den utvidede boksen kan umulig
treffe. Egenskapstesten i `scripts/nasjonal-chunk.test.ts` kjører filtrert og
ufiltrert mot hverandre på 3 000 tilfeldige par.

**Minne:** 77 MB heap ved full skala. Målingen brukte ~693 000 geometripunkter;
de 14,5 MB ekte rådata tilsvarer ~320 000, altså rundt halvparten. Tallet er
konservativt.

**Lekeplass er et annet regnestykke** og er ikke i scope: 55 593 objekter, og
de har ingen romlig test — der er geokodingen flaskehalsen.

---

## Klyngingen nasjonalt

Med hele landet som én chunk kan to anlegg med samme navn i hver sin ende av
landet havne i samme navnegruppe. Taket er 1 000 m, så det skal ikke skje.
**Vist med tester, ikke med et resonnement:**

- Fem akebakker som alle heter «Marikollen skisenter», spredt fra Agder til
  Finnmark → **fem rader**.
- To med samme navn 900 m fra hverandre → **én rad**. Uten denne ville testen
  over bare bevist at grupperingen ikke virker.
- Fem *alpinanlegg* med samme navn → fem rader. **Skianlegg grupperer aldri på
  navn** — «klyngingen» der er den romlige bevistesten per polygon. Bare Aking
  navnegrupperer.
- Et bevis i Finnmark verifiserer ikke et polygon i Agder.

---

## Hva Frederik skal kjøre

### 1. Bekreft at spørringene fortsatt går gjennom

**Kjør om natten.** Merk `-A` — uten den svarer Apache 406.

```bash
UA='Togedoo datahub (hello@togedoo.com)'

time curl -sS -A "$UA" --max-time 300 -o /tmp/ski-omrade.json \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
[out:json][timeout:300];
(
  nwr["landuse"="winter_sports"]["disused"!~"."]["abandoned"!~"."](57.5,4.0,71.5,31.5);
);
out geom;'
jq '.elements | length' /tmp/ski-omrade.json     # forventet ~445
jq -r '.remark // "ingen remark"' /tmp/ski-omrade.json

time curl -sS -A "$UA" --max-time 300 -o /tmp/ski-bevis.json \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
[out:json][timeout:300];
(
  nwr["piste:type"~"downhill|sled|playground"]["disused"!~"."]["abandoned"!~"."](57.5,4.0,71.5,31.5);
);
out geom;'
jq '.elements | length' /tmp/ski-bevis.json      # forventet ~7555
jq -r '.remark // "ingen remark"' /tmp/ski-bevis.json
```

### 2. Nasjonal tørrkjøring

```bash
npx --yes tsx scripts/import-places.ts --national --dry-run --work --category=skianlegg,aking
```

Tre Overpass-spørringer (ski-område, ski-bevis, aking), så berikelse og
godkjenningsoppsummering. **Ingenting skrives.**

Det skal stå i utskriften:

| Linje | Forventet |
|---|---|
| `hent Norge/skianlegg` | ~445 omrade, ~7555 bevis |
| `hent Norge/aking` | ~700 objekter (89 i Norge + naboland) |
| `objekter utelatt — utenfor norske kommunegrenser` | **ikke null** — ellers virker ikke grensefila |
| `skianlegg` i tabellen | rundt 254, andel rundt 100 % |
| `aking` i tabellen | rundt 89 |
| Claims | **6 objekter undertrykt** — Korketrekkeren + de to Oslo-relasjonene |
| Duplikatkandidater | 0 forventet |

### 3. Les oppsummeringen, så skriv

Skrivekommandoen står ferdig utfylt nederst, med fingeravtrykket. Den nekter
hvis noe har endret seg siden godkjenningen.

```bash
npx --yes tsx scripts/import-places.ts --national --work --resume --category=skianlegg,aking --approve=<fingeravtrykk>
```

---

## Første nasjonale tørrkjøring (sep. 2026) — og hva den avdekket

```
Skianlegg  305 steder — 148 OSM-navn, 44 «ved gate», 62 «i område», 51 kun kategori
Aking       13 steder — 13 OSM-navn
=== STOPP (geokodingsfeil) === 51 av 157 (32 %, terskel 20 %)
```

**Stoppvilkåret utløste, og diagnosen var feil.** Alle 51 «feilene» var
`ingen adresse innen 200 m` — Kartverket som svarer korrekt at det ikke finnes
en adresse der. Et alpinanlegg i fjellet har ingen adresse innen 200 m.

Rettet: `GeocodeFailureKind` skiller nå `'feil'` (tjenesten svarte ikke:
nettverk, timeout, 5xx) fra `'tomt'` (tjenesten svarte «ingenting her»). Bare
den første teller mot terskelen. Den andre rapporteres på egen linje:

```
  UTEN ADRESSE (51 steder) — Kartverket svarte at det ikke finnes en adresse
  innen 200 m. Ikke en feil; tittelen kommer fra områdenavn eller bare kategorien.
```

**305 skianlegg er ikke nødvendigvis for mange.** 254 er `landuse=winter_sports`
alene, men selektoren har seks mønstre — også `recreation_ground` med
`piste:*` eller `sport~ski`, og `sports_centre` med `sport~ski`. For denne
kategorien er 254 et **gulv**, ikke et tak. Spørsmålet om duplikater må
avgjøres på geometri.

**Duplikatene er ekte, men av en annen type enn ventet.** `way/55097596`,
`55097597` og `55097598` het alle «Skianlegg i Fageråsen» — det er ikke et
OSM-navn, men tre NAVNLØSE polygoner som fikk samme områdenavn fra Nominatim.
`duplicateCandidates` så dem ikke (den sammenligner bare ekte OSM-navn, for at
to «Lekeplass ved Storgata» ikke skal bli støy). `generatedTitleCollisions`
fanger dem nå, med et strammere tak på 2 km.

---

## De tre funnene fra work-report (sep. 2026)

### Funn 1 — bboksen er for stor, men ikke der det ble antatt

`GEOGRAFI` viste hvor mye av hentingen som ikke er vår:

| kategori | i Norge | utenfor | andel utenfor |
|---|---|---|---|
| aking | 91 | 222 | 71 % |
| skianlegg | 4 951 | 8 280 | 63 % |

**Det kostet IKKE geokoding.** Det er lest i koden og etterregnet i tallene,
og det er verdt å slå fast fordi antakelsen om det motsatte ville pekt på feil
løsning:

```
Skianlegg 305 rader = 148 OSM-navn + 44 «ved gate» + 62 «i område» + 51 kategori
uten OSM-navn, altså geokodet                = 44 + 62 + 51 = 157
Aking 13 rader, alle med OSM-navn            =               0
                                               sum          157
kjøringen rapporterte                                       157
```

`buildRows` utelater rader utenfor norske kommunegrenser **før**
`needGeocoding` regnes ut. Alle 157 forsøkene var derfor på norske rader, og
en strammere boks ville ikke fjernet ett eneste av dem.

**Filteret kom likevel for sent — for `--limit`.** Kvoten per kategori ble
talt før Norge-filteret, så utenlandske objekter spiste den:
`--limit=25` mot aking ville gitt ~7 norske rader i stedet for 25, uten et
varsel. Med standardkjøringens `--limit=Infinity` var feilen usynlig. Rettet:
Norge-filteret ligger nå inne i utvelgelsesløkka, før kvoten telles.

**Det bboksen faktisk koster** er overføring (14,5 MB mot ~6 MB), minne, og
støy i rapporten. Ikke tid: den romlige testen er 0,1 s uansett, og
geokodingen rører aldri en utenlandsk rad.

#### Målingen som er gjort — og den som mangler

Regnet ut mot `data/kommuner.geojson` (357 kommuner, 266 619 punkter), med
2 km margin på hver boks:

| kandidat | bokser | samlet areal | mot dagens | dekker alle kommuner |
|---|---|---|---|---|
| dagens | 1 | 2 053 958 km² | 100 % | ja |
| 1 bånd | 1 | 1 887 683 km² | 92 % | ja |
| 2 bånd | 2 | 937 008 km² | 46 % | ja |
| 3 bånd | 3 | 730 864 km² | 36 % | ja |
| **4 bånd** | 4 | **664 477 km²** | **32 %** | ja |
| 5 bånd | 5 | 635 010 km² | 31 % | ja |
| 6 bånd | 6 | 610 955 km² | 30 % | ja |
| 8 bånd | 8 | 571 374 km² | 28 % | ja |

Båndene er **regnet ut**, ikke valgt: `optimalBands` i `lib/norway-boxes.ts`
finner ved dynamisk programmering de k båndene som gir minst samlet areal.
Boksene ved k=4:

```
(57.94,4.46,63.98,12.91)    (63.94,8.77,66.13,14.67)
(66.09,11.64,68.33,18.20)   (68.29,13.60,71.20,31.22)
```

> **AREAL ER EN PROXY.** Objekter i OSM er ikke jevnt fordelt over areal, og
> mye av det som forsvinner er hav. Tabellen kan hverken bekrefte eller
> avkrefte en gevinst i objekter. Den sier bare hvor mye mindre boksen er.

Grunnen til at gevinsten likevel bør bli stor er formen: dagens boks går til
31,5°Ø på ALLE breddegrader, også på 58–60°N. Der ligger Stockholm,
Sør-Finland, Baltikum og St. Petersburg. Sørboksen stopper på 12,9°Ø.
**Men Sveriges Värmland og Dalarna, og finsk Lappland, ligger fortsatt inne**
— en strammere boks fjerner volum, ikke behovet for å filtrere på koordinatet.

#### Hvorfor margin, og hvorfor ikke `area[ISO3166-1=NO]`

Hver boks utvides med 2 km (`BOX_MARGIN_M`). Bevisspørringen skal finne
heiser og nedfarter inntil 50 m **utenfor** et polygon; klipper boksen på
riksgrensa, mister et grenseanlegg beviset sitt og faller stille fra «alpint»
til «ikke-alpint».

Det var også et argument mot områdefilteret: **et `area`-filter kan ikke ha
margin.** Det klipper nøyaktig på grensa, per definisjon.

> **Dette argumentet står fortsatt etter byttet i okt. 2026.** Det er den ene
> kjente kostnaden, og den er ikke målt. Se «Byttet til område» under for
> hvordan den måles etter kjøringen.

#### Anbefaling — OMGJORT OKT. 2026

Den opprinnelige anbefalingen var **fire bånd, etter at tellingen er gjort**.
Tellingen ble gjort, og båndene tapte mot variant D. De er tatt ut av
`lib/import-chunks.ts`; `optimalBands` regner dem fortsatt ut på kommando.

> Fingeravtrykket hashet tidligere bare `overpassArea`, som er **tom streng**
> for den nasjonale chunken i bboks-modus. Bboksen lå altså ikke i det i det
> hele tatt, og «bytt boks og kjør med `--resume`» ville stille gjenbrukt
> gamle data. Rettet; versjonen er hevet til 2, så alle lagrede hentesteg
> hentes én gang til.

#### Hva Frederik skal kjøre

```bash
npx --yes tsx scripts/bbox-candidates.ts            # tabellen + spørringene
npx --yes tsx scripts/bbox-candidates.ts --queries  # bare spørringene
```

Skriptet skriver ut ferdige `curl`-kommandoer for fire varianter —
**A** bboks (nå reserve), **B** fire bånd, **C** fem bånd, **D**
`area[ISO3166-1=NO]` (nå i produksjon) — for områdesettet, bevissettet og
aking. Det er disse kommandoene som produserte målingen under.

Hver spørring ender på `out count;`. Den returnerer **ett** objekt:

```json
{"type":"count","tags":{"total":"7555","nodes":"6102","ways":"1398","relations":"55"}}
```

Altså både totalen og node-andelen, som er nøyaktig det funn 2 handler om.
Ingen geometri, noen hundre byte, sekunder per kandidat.

**Kjør alle på samme tidspunkt av døgnet.** Ellers måler du speilets
belastning og ikke boksen — Oslo alene ga 504 på dagtid og hele Norge gikk
gjennom ved midnatt.

Er B eller C under halvparten av A, er byttet verdt det. Er forskjellen liten,
er dagens boks god nok, og da er det målingen som sier det og ikke jeg.

---

### «usikker-heis» har fått sin egen liste

Fire norske alpinanlegg fikk dommen `usikker-heis` i denne kjøringen og lå
spredt blant 815 rapportlinjer. `EnrichOutput.merknader` er nå en kort liste
som aldri avkortes, og de fire seedes i stedet. Se
[alpin-usikker-heis.md](alpin-usikker-heis.md).

---

### Funn 2 — noder skal få en dom, ikke hoppes over

#### Først: tallet 774 er lest feil

`work-report` skrev `… 774 linjer til` etter de 40 første rapportlinjene.
**774 var antallet SKJULTE linjer av 814, ikke antallet hoppet over.** At de
40 synlige alle var noder uten geometri følger av at Overpass svarer noder
før ways og relasjoner — de kom bare først.

Regnestykket bak: 814 objekter gir 814 rapportlinjer, 814 − 40 = 774.
Og 774 hoppet over lar seg ikke forene med 476 verifiserte alpinanlegg av
814. Det ekte tallet er ukjent, men ligger mellom 40 og 338.

Rettet på to steder: linja sier nå `… N av M linjer skjult — --lines=M viser
alle`, og **oppsummeringen teller punktobjektene selv**, så neste kjøring gir
tallet i stedet for et anslag:

```
skianlegg: 814 objekter, 12417 bevisobjekter → 476 alpinanlegg
           punktobjekter: 231 (18 alpint, 12 i en flate, 201 ikke-alpint)
```

#### Valget: noder får bevistesten, med radius

En node kan ikke få «heis eller nedfart **innenfor** polygonet» — den har
ingen ring. Den kan få «bevis innen X meter fra punktet», og deretter
**nøyaktig samme `skiVerdict`**: bare en utforløype eller en heis gjør
objektet til et alpinanlegg.

Det er hele forskjellen fra i dag. Hovden Langrennsarena og Skaret Skistadion
faller fortsatt ut — men nå fordi det ikke er en utforløype der, som er
regelen flatene dømmes etter, og ikke fordi den som kartla dem satte en node i
stedet for et polygon. Surnadal alpinsenter kommer inn.

Tre utfall, hvert med sitt tall i oppsummeringen:

| utfall | betyr |
|---|---|
| `dublett` | punktet ligger i en flate som allerede er vurdert |
| `alpint` | utforløype eller heis innen radiusen |
| `ikke-alpint` | ingen bevis, eller bare bevis som ikke er alpint |

**Dublettsjekken er ikke pynt.** Et anlegg kartlagt både som node og som
polygon ville ellers gitt to rader med hver sin `external_id` — altså ikke
fanget av upsert-nøkkelen `(source_id, external_id)`, og ikke av
`duplicateCandidates` heller når navnene er like.

#### X = 250 m er en VURDERING, ikke en måling

Jeg har ikke datagrunnlag til å utlede den. Avstanden fra en anleggs-node til
nærmeste heis eller nedfart er ikke målt, og kan ikke måles uten å hente
dataene på nytt. Tallet er fem ganger polygontolleransen, ut fra to antakelser
som begge kan være feil:

- en anleggs-node settes ofte ved parkeringen eller bunnstasjonen, og
  **nærmeste punkt** på en heis er da nær selv om anlegget er en kilometer
  langt — 50 m ville vært for stramt;
- et langrennsstadion og et alpinanlegg i samme dal ligger sjelden nærmere
  enn 250 m — 1 000 m ville begynt å blande dem.

**Derfor måler rapporten avstanden.** Hvert punktobjekt får
`nærmeste NNN m` uansett dom, også de som faller utenfor radiusen (de får
`> 250 m`, fordi forkastningsfilteret ikke regner ut avstander utenfor
boksen). Én tørrkjøring gir dermed fordelingen, og tallet kan velges på data:

```bash
PLACES_SKI_NODE_RADIUS_M=120 npx --yes tsx scripts/work-report.ts --work=.import-work
PLACES_SKI_NODE_RADIUS_M=500 npx --yes tsx scripts/work-report.ts --work=.import-work
```

Ingen henting, ingen kodeendring imellom — berikelsen er ren.

---

### Funn 3 — navnløse akebakker: vurdert, ikke bygd

203 av 313 hentede akeobjekter ble avvist som `uten-navn`.

#### Hvor mye er det egentlig?

**Ikke 203.** Av de 313 lå bare 91 i Norge. De 14 radene som kom ut, kom alle
fra navngitte objekter. Taket for hva en romlig klynging kunne lagt til er
derfor **91 − (de norske navngitte) ≈ 77 objekter**, og en klynging ville
slått flere av dem sammen — anslagsvis 30–60 rader.

Det eksakte tallet er ikke utledbart av rapporten slik den var. Den skriver
det nå:

```
    uten navn, i Norge .... N objekter (taket for romlig klynging — se funn 3)
```

Kjør `npx --yes tsx scripts/work-report.ts --work=.import-work` på nytt for å
få N. **Vurderingen under bør gjøres om igjen hvis N er lavt.**

#### Hva det ville koste

Mekanismen finnes allerede. `akingClusters` grupperer på navn innenfor
`AKING_NAME_GROUP_M`; en avstandsgruppering uten navn er den samme løkka uten
navnetesten, og Skianlegg henter allerede tittel fra områdenavn. Anslagsvis
40–60 linjer kode og noen tester.

Geokodingen er ikke flaskehalsen her: 30–60 nye navnløse rader er ~1 minutt
ekstra ved ~1,1 s per rad.

#### Feilklassen det åpner

Den er ikke ny, den er **kjent og allerede observert i denne kodebasen**:

1. **Fageråsen-problemet, flyttet inn i Aking.** `way/55097596`, `-97` og
   `-98` het alle «Skianlegg i Fageråsen» — tre navnløse polygoner som fikk
   samme områdenavn. For navnløse akebakker ville «Akebakke i X» gjentatt
   blitt det NORMALE, ikke et avvik. `generatedTitleCollisions` fanger dem, men
   som en rapportlinje — ikke som en sperre.
2. **Avstand alene kan ikke skille to bakker som deler skråning.** Det er
   allerede begrunnelsen for at navnegruppering ble valgt (Sollibakken og
   Bjartbakken). For navnløse objekter finnes det ingen navn å falle tilbake
   på, så feilen går fra «mulig» til «uunngåelig».
3. **Begge retninger er stille.** For mye klynging gir én nål der det er to
   bakker; for lite gir fem nåler i samme li. Dagens regel gir null nåler —
   et synlig fravær er lettere å oppdage enn en gal nål.
4. **Ankeret er mer flyktig uten navn.** `external_id` er ankerets `type/id`.
   Deles en way i OSM, kan ankeret bytte id og gi en ny rad ved siden av den
   gamle (importen sletter aldri). For en navngitt klynge kan navnet
   gjenopprette gruppa; for en navnløs finnes det ingenting å gjenkjenne den på.

#### Anbefaling

**Vent.** Ikke fordi det er vanskelig, men fordi rekkefølgen er feil:

1. tell N (kommandoen over) — er N under ~30, er hele saken for liten;
2. stram bboksen først, så tallene handler om norske objekter;
3. og gjør `generatedTitleCollisions` til en **sperre** før den blir
   normaltilfellet, ikke etter.

En kvalitetsregel bør uansett høre med om det bygges: en klynge må ha en
minste utstrekning eller et minste antall objekter. En navnløs
`piste:type=sled` på 30 meter gjennom en park er ikke et sted en familie
reiser til.

---

## Å lese en kjøring som allerede er gjort

Mellomleddet lagrer **dataene**, ikke **loggen**. Har utskriften rullet forbi,
kan alt den sa regnes ut på nytt — berikelsen er ren, så verken klyngingen,
den romlige testen eller kommuneoppslaget trenger nettverk.

```bash
npx --yes tsx scripts/work-report.ts --work=.import-work
npx --yes tsx scripts/work-report.ts --work=.import-work --chunk=norge --near=500
```

Den skriver ut:

| Blokk | Svarer på |
|---|---|
| `HENT` | hent-linjene: objekter per kategori og sett |
| `GEOGRAFI` | hvor mange av de hentede som ligger utenfor Norge |
| `BERIKELSE` | per-polygon-rapporten fra Skianlegg, klyngerapporten fra Aking |
| `AKING` | hele domstellingen: godkjent, alpint-blandet, lekeplass, uten navn |
| `RADER` | tittelkilder, ekte geokodingsfeil, uten adresse |
| `DUPLIKATANALYSE` | delte titler (med kilde) og romlige klynger |

**Neste gang: `| tee kjoring.log`.** Verktøyet er for kjøringen som allerede
er gjort.

---

## Stoppvilkårene er ikke utløst mot ekte data ennå

Terskelen på 20 % geokodingsfeil og 20 % utbyttekollaps er **valgt, ikke
målt**. Utbyttesjekken er den eneste som er sett virke, og bare mot
mock-data i test.

**Det er forutsetningen for neste steg** (nattjobb/automatisering): et
stoppvilkår som aldri er utløst mot ekte data, er en påstand og ikke en vakt.

Geokodingsvilkåret er nå utløst én gang, og det tok feil. Det er ikke en
innvending mot vakter — det er nettopp derfor de skal utløses mot ekte data
før de får lov til å kjøre om natten uten tilsyn. Utbyttevilkåret og
claim-vilkåret er fortsatt bare sett mot mock-data.

---

## Det som IKKE er gjort

- Ingen nasjonal kjøring, ingen skriving.
- Ingen lekeplass eller ballbane nasjonalt. 55 593 objekter, ~80 % utenfor
  Norge, og geokoding som flaskehals — de hører til kildebyttet.
- Ingen områdeakse. Med én nasjonal chunk trengs den ikke, og spørsmålet om
  `admin_level` er fortsatt ubesvart for de kategoriene som må deles opp.
- Ingen nattjobb. Se over.
- Ingen telling av bbox-kandidatene. `scripts/bbox-candidates.ts` skriver ut
  spørringene; `out count;` er ikke kjørt herfra, og `nationalChunk()` står
  derfor fortsatt på den ene målte boksen.
- Ingen romlig klynging av navnløse akebakker. Se funn 3.
- Ingen seeding av de fire anleggene med «heis uten utforløype». Radene og
  claimene finnes i koden, men seeden er ikke kjørt — se
  [alpin-usikker-heis.md](alpin-usikker-heis.md).

---

## Byttet til område (okt. 2026)

`nationalChunk()` bruker fra nå `area["ISO3166-1"="NO"]["admin_level"="2"]`
i stedet for bboksen. Reserven er `PLACES_NATIONAL_SCOPE=bbox`.

### Målingen

Kjørt mot overpass-api.de, kveld, alle på første forsøk, ingen remark:

| selektor | A bboks | D area | |
|---|---|---|---|
| `skianlegg:bevis` | 7 555 objekter | 4 536 objekter | −40 % |
| `aking` | 313 objekter | 91 objekter | −71 % |

**91 er det avgjørende tallet.** Det stemmer eksakt med work-report fra
tørrkjøringen dagen før — «aking 91 i Norge, 222 utenfor» — og
`NATIONAL_EXPECTATION.aking` er 89, målt mot `piste:type=sled` i
Geofabrik-fila. Tre uavhengige kilder på samme størrelse. Området henter
nøyaktig det Norge-filteret ellers måtte kaste.

`admin_level=2` er ikke pynt: uten den kan `ISO3166-1=NO` også sitte på
underordnede grenser i OSM, og da avgjør det Overpass tilfeldigvis finner
først hvilket område spørringen bruker.

### Det som IKKE er målt — og som må sjekkes etter første kjøring

**Marginen er borte.** Bboksen hadde `BOX_MARGIN_M` = 2 km, fordi
bevisspørringen skal finne heiser og nedfarter inntil
`SKI_EVIDENCE_TOLERANCE_M` (50 m) utenfor et polygon. Området klipper
nøyaktig på riksgrensa. Et bevisobjekt som ligger **helt** i Sverige, men
betjener et norsk anlegg, hentes ikke lenger.

Ingenting i de 3 019 objektene som forsvant fra bevissettet sier hvor mange
— om noen — som var slike. Det kan ikke avgjøres uten en kjøring.

**Sjekken er billig og finnes allerede:** kjør `skianlegg:omrade` under
variant D og se på tallet.

```bash
npx --yes tsx scripts/bbox-candidates.ts --category=skianlegg --queries
```

| resultat | betydning |
|---|---|
| ~254 polygoner | riktig — det er Geofabrik-tallet for Norge |
| 0 | området løste seg ikke; bruk `PLACES_NATIONAL_SCOPE=bbox` |
| ~445 | området traff ikke Norge, men noe større |

Og etter tørrkjøringen: **antall anlegg med alpin-dom skal være minst like
høyt som i bboks-kjøringen.** Faller det, er marginen årsaken, og da er
reserven veien tilbake mens det utredes.

### Norge-filteret er beholdt — som vakt

`buildRows` hopper fortsatt over rader uten treff i kommunefila. Det er ikke
lenger et filter i standardkjøringen, men det blir stående av fire grunner:

1. **Reserven.** I bboks-modus er det fortsatt et ekte filter som fjerner
   63–71 %.
2. **Oppslaget er ikke valgfritt.** `cityAnchor` er `null` nasjonalt, så hver
   rad må ha en kommune fra grensefila uansett — `rowsMissingCityAnchor`
   kaster ellers før upsert. «Filteret» er bare navnet på det som skjer når
   oppslaget ikke finner noen. De to alternativene er å kaste (velter hele
   chunken for én rad) eller å skrive tom `municipality` (bryter by-modus i
   `/api/activities`).
3. **To ulike grensedefinisjoner.** OSM sin `admin_level=2` og Kartverkets
   kommunefil er to kilder, og de er ikke identiske i strandsonen. Linja
   måler uenigheten.
4. **Svalbard og Jan Mayen.** Se under.

Linja i loggen endrer altså betydning: fra «så mange naboland vi hentet» til
«så mye er de to grensedefinisjonene uenige om». Et **høyt** tall i
områdemodus er et varsel.

### Svalbard og Jan Mayen

**Om `area["ISO3166-1"="NO"]` omfatter dem er ikke verifisert.** Det avhenger
av taggingen i OSM, og den kan ikke leses herfra — Overpass, Nominatim og
openstreetmap.org er utilgjengelige fra utviklingsmiljøet. ISO 3166-1 fører
Svalbard og Jan Mayen under en egen kode, `SJ`, men hvilken kode OSM sitt
grenseobjekt faktisk bærer er ikke lest.

**Spørsmålet påvirker ikke hva som havner i basen.** `data/kommuner.geojson`
har 357 fastlandskommuner (kommunenummer 03–56, nordligste punkt 71,19° N på
Nordkapp). Svalbard (2100) og Jan Mayen (2211) står ikke i den, så et punkt
der finner ingen kommune og faller ut i vakten — som en svensk park.
`scripts/nasjonal-chunk.test.ts` fester det med Longyearbyen og Olonkinbyen.

Det var også utenfor rekkevidde før byttet, av en annen grunn: bboksen
stopper på 71,5° N og 4,0° Ø, mens Longyearbyen ligger på 78,2° N og Jan
Mayen på 8,7° **vest**.

Vil du ha svaret, koster det én spørring:

```bash
curl -sS -A 'togedoo-import/1.0' https://overpass-api.de/api/interpreter \
  --data-urlencode 'data=[out:json][timeout:60];
area["ISO3166-1"="NO"]["admin_level"="2"]->.a;
node(area.a)(78.0,15.0,78.5,16.5);
out count;'
```

Svarer den 0, er Svalbard utenfor området. Svarer den noe annet, er det
vakten som holder det ute — og det er greit, men da bør det stå her.

### Fingeravtrykket

Byttet gir **nytt fingeravtrykk**, og gamle `.import-work`-kataloger fra
bboks-kjøringene kan ikke gjenbrukes med `--resume`. Begge feltene endrer seg
samtidig — `area` fra tom streng til områdesetningen, `scopes` fra boksen til
`(area.a)` — og begge ligger i `v: 2`-avtrykket.

Det er ønsket oppførsel, ikke en kostnad å unngå: en gjenopptagelse som
gjenbrukte bboks-objektene ville gitt nøyaktig de utenlandske radene byttet
skal fjerne. `scripts/bbox-og-noder.test.ts` regner det ut i stedet for å
påstå det.

### Det som ble fjernet

`NORWAY_BANDS_4`, `NORWAY_BANDS_5`, `nationalBoxes()` og
`PLACES_NATIONAL_BANDS`. Båndene var **regnet ut, ikke målt**, og deres egen
kommentar krevde en `out count;`-måling før bruk. Målingen ble gjort, og de
tapte på akkurat den aksen de skulle forbedre.

`lib/norway-boxes.ts` og `scripts/bbox-candidates.ts` er **beholdt**. Skriptet
er instrumentet som produserte variant D — spørringene det skriver ut er
ordrett de som ble kjørt. Slettes det, finnes ikke lenger oppskriften for å
reprodusere målingen hele avgjørelsen hviler på. Båndene kan fortsatt regnes
ut derfra; de står bare ikke i produksjonskoden, og grensefila kan dermed
oppdateres uten at et tallsett ingen kjører må limes inn på nytt.

**Én ting er nå uten kaller:** flerboks-grenen i `scopedSelector`. Ingen chunk
lager mer enn én avgrensning. Den er beholdt og testet med et litteralt
bokssett, fordi den er veien videre om en reservekjøring på bboks må deles
opp — og fordi å slette den i samme commit som bytter avgrensning ville gjort
en halvering vanskeligere å lese om den nasjonale kjøringen går galt. Skal
den bort, er det en egen, rent subtraktiv endring.

---

## Stoppvilkåret sammenlignet objekter med rader (okt. 2026)

Den første områdekjøringen ble stanset av utbyttevakten:

```
aking       13 rader mot 89 forventet (15 %)  → STOPP
skianlegg  307 rader mot 254 forventet (121 %)
```

**Begge tallene var meningsløse.** `NATIONAL_EXPECTATION` er målt med osmium
mot Geofabrik-fila og er i **objekter**; `yieldCollapseStop` sammenlignet dem
med **rader**.

| | aking | skianlegg |
|---|---|---|
| forventning | 89 `piste:type=sled`-objekter | 254 `landuse=winter_sports`-objekter |
| hentet | 91 objekter | 423 objekter (seks mønstre) |
| ble | 13 bakker | 307 rader |

Korketrekkeren alene er 14 objekter som blir 1 rad. Forholdet objekt→rad er
ikke 1:1 for noen kategori, og for aking er det ikke engang samme
størrelsesorden.

### Rettingen

Vakten sammenligner nå **objekter mot objekter**, i det settet forventningen
faktisk gjelder:

```ts
export interface NasjonalForventning {
    readonly objekter: number;  // 89
    readonly tag: string;       // 'piste:type=sled'
    readonly sett: string;      // 'main'
}
```

`sett` er ikke pynt. Skianlegg henter to sett: `omrade` (423 objekter, blir
rader) og `bevis` (4 536 objekter, blir **aldri** rader — de er inndata til den
romlige testen). Summerte vakten begge, ville forholdstallet vært ~1 950 % og
kategorien kunne aldri stanset, heller ikke om områdeselektoren sluttet å
treffe.

Rapporttabellen viser nå begge enheter, og bare den ene har et forholdstall:

```
  kategori        objekter   forventet   andel      rader   uten ekte navn
  skianlegg           423         254   167 %        307              157
  aking                91          89   102 %         13                8
  rullesport            —           —       —         12                3
  (forventning = objekter i Geofabrik-fila: skianlegg landuse=winter_sports i
   «omrade», aking piste:type=sled i «main»)
```

### Hvorfor radene IKKE fikk et forventningstall

Det er det egentlige spørsmålet, og svaret er at det ikke finnes noe å
forankre et radtall i.

**Objekter kommer fra OSM.** De kan telles utenfor koden vår, med osmium mot
et navngitt Geofabrik-uttrekk, deterministisk og uten nett. Tallet er
uavhengig av alt vi gjør med dataene etterpå.

**Rader er resultatet av våre egne regler** — navnegruppering,
relasjonsforankring, dedupen, claims, `--limit`. Et radtall som «fasit» ville
blitt feil av at *vi* forbedret noe. Endrer vi `PLACES_AKING_GROUP_M` fra 1000
til 800, går radtallet opp uten at en eneste ting i OSM har endret seg — og da
stopper vakten på vår egen forbedring. Det er nøyaktig den vakten man slutter
å tro på, og deretter slår av.

Så: **vakten stopper på objekter. Radene rapporteres ved siden av, uten
forholdstall.**

### Tallene fra denne kjøringen — observasjon, ikke fasit

De står i testfiksturet i `scripts/nasjonal.test.ts` og her, som **et
utgangspunkt for å se endring**, ikke som et krav:

| kategori | objekter | rader | uten ekte navn |
|---|---|---|---|
| skianlegg | 423 (`omrade`) | 307 | 157 |
| aking | 91 | 13 | — |

Byttet fra bboks til område, målt i samme kjøring:

| | bboks | område |
|---|---|---|
| skianlegg | 476 rader (med Sverige/Finland) | 307 rader |
| aking | 14 rader | 13 rader |

**Hvordan de forankres, hvis de noen gang skal bli mer enn en observasjon:**
et radtall er først en fasit når det er knyttet til en commit av
grupperingsreglene. Da hører det hjemme som et *regresjonstall* — «samme
inndata ga 307 rader på commit X» — og ikke som en nasjonal forventning. Den
formen krever at hentesteget lagres og kjøres om mot ny kode, altså at
`.import-work` fra en kjent kjøring tas vare på. Det finnes ikke i dag, og det
er en egen oppgave.

Inntil da: radtallene her er noe å sammenligne neste kjøring mot for hånd, og
en uventet endring er et spørsmål, ikke en feil.

### To ting til fra samme kjøring

**`deduped` ble tapt ved `--resume`.** Feltet sto i `Pick`-typen på
`store.write()`, så kalleren kunne sende det og typesjekken godtok det, men det
ble aldri spredt inn i manifestoppføringen. `entry?.deduped` var derfor alltid
`undefined` ved gjenopptagelse, og dedup-rapporten for en gjenopptatt chunk var
tom uten at noe feilet. Fanget fordi settellingen skulle inn på nøyaktig samme
sted. Rettet, med test.

**Titlene har samme problem som lekeplassene, men verre.** «Rauland skisenter»
× 3 og «Skianlegg» × 6 med 1,2–2,2 km mellom seg; 921 par mellom 102 rader med
delt generert tittel, og **157 av 307 rader mangler ekte navn** (mot 4,6 %
navnedekning for lekeplasser — her er det 49 %). Ikke rørt i denne omgangen.
Merk at 1,2–2,2 km er *innenfor* 2 km-taket i `generatedTitlePairs`, så de
telles; det er samme klasse som lekeplassene, ikke en ny.
