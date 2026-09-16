# Stedstitler for navnløse steder

**Status:** grenen `claude/stedstitler`. Ingenting er kjørt — ikke importen,
ikke målingene i `del 1`.

## Problemet

Tørrkjøring av Lekeplass mot Oslo, etter dedupen:

```
1423 steder — titler: 34 OSM-navn, 1384 «ved gate», 5 «i område», 0 kun kategori
```

**97 % av lekeplassene i Oslo har ikke et brukbart navn i OSM.** Tittelen
kommer fra nærmeste adresse via Kartverkets punktsøk, og husnummeret ble
strippet — så alle lekeplassene langs én gate fikk samme tittel. Fire ulike
lekeplasser het «Gunnar Schjelderups vei», tre het «Betzy Kjelsbergs vei».
Kapellveien og Gunnar Schjelderups vei er lange gater.

Dette er ikke dubletter. Dedupen tok 58 rader; disse er ekte, ulike steder
som ikke kunne skilles fra hverandre.

**Merk hva brukeren faktisk ser.** `DatahubPlace.displayTitle` i appen
stripper prefikset «<kategori> ved » fra konstruerte titler, så kortet viser
«Gunnar Schjelderups vei», ikke hele setningen. Det er den strippede formen
som kolliderer.

## Endringen

**Husnummeret blir med: «Lekeplass ved Kapellveien 12».**

Det koster ingenting. `addressText` («Kapellveien 12») hentes allerede i
samme Kartverket-svar som gatenavnet og lagres i `geocode_cache` —
`stripHouseNumber` kastet det bort ved tittelbyggingen. Ingen ny tjeneste,
ingen nye oppslag, ingen ny datakilde.

I tillegg lagres adressen i `activities.address` når OSM ikke har en egen.
Se «Flerspråkligheten» under.

Og et matrikkelnummer er ikke lenger et gatenavn: raden
**«Tennisbane ved 77/442-1»** står i basen i dag. Kartverket svarer med
gårds- og bruksnummer der det ikke finnes en gateadresse, og
tittelgeneratoren brukte det som om det var en gate. Nå faller slike gjennom
til bydel-laget, som er hva de skal.

## Den sterkeste innvendingen

**Adressen er den NÆRMESTE, ikke lekeplassens egen.** Kartverkets punktsøk
har 200 m radius, så «Kapellveien 12» kan være huset på andre siden av veien.
Med bare gatenavnet var påstanden vag nok til å være ufarlig; et husnummer
ser ut som en adresse.

Tre grunner til at den ikke velter valget:

1. **«Ved» bærer forbeholdet, og gjorde det allerede.** Gatenavnet var også
   den nærmeste gata. Husnummeret gjør den samme påstanden mer presis — det
   gjør den ikke til en annen påstand.
2. **Tittelen er ikke navigasjonen.** Appen har koordinatet og et kart.
3. **Feilen er aldri verre enn i dag.** Får to lekeplasser samme nærmeste
   adresse, er tittelen like lik som før. Endringen kan bare skille flere,
   aldri færre.

Innvendingen er likevel ekte, og den er grunnen til at målingen i `del 1 c`
betyr noe: par som ligger under 30 m fra hverandre kan ha samme nærmeste
adresse, og for dem hjelper ingenting av dette.

## Alternativene som ble forkastet

**Bydel/grend — «Lekeplass på Kjelsås».** Feil retning: bydel er GROVERE enn
gate, så den skiller færre steder, ikke flere. Fire lekeplasser i Kjelsås
ville alle hett det samme.

Og den er dyr. `reverseAreaDetailed` kalles i dag KUN når adresseoppslaget
ikke ga en gate — så for de 1 384 «ved gate»-radene er bydelen aldri slått
opp og ligger ikke i cachen. Nominatim tåler ≤ 1 request/sekund (står i
fila). Oslos lekeplasser alene er da ~23 minutter, og 11 901 nasjonalt er
over tre timer — for én kategori, og for et resultat som skiller dårligere.

**Ingen tittel — bare «Lekeplass», la avstanden skille dem.** Faller på at
avstanden ikke alltid finnes. `_distanceLabelFor` i appen returnerer null i
by-modus (`_userPosition` er null der), og by-modus er nettopp modusen uten
posisjon. Da ville fire kort stått med samme ord og ingenting annet — verre
enn i dag.

**En bedre navnekilde.** Finnes ikke, og er utenfor scope.

## Flerspråkligheten

Den er ikke løst her, men den er verdt å se i øynene, for den blir dyrere jo
lenger man venter.

Tittelen for en generert rad er en **norsk setning**: «Lekeplass ved
Kapellveien 12». Appen tar den fra hverandre igjen — `displayTitle` leter
etter « ved » og « i » for å strippe kategoriprefikset. Det er altså allerede
en klient som PARSER norsk for å få tak i delene.

Det holder så lenge appen er norsk. Skal den til Sverige, må «Lekplats vid
Kapellveien 12» bygges av noen, og å oversette ved å lete etter ordet «ved» i
en lagret streng er ikke en vei videre.

**Derfor lagres adressen også i `activities.address`.** Etter denne
endringen er en generert tittel utledbar av `category` + `address`, så en
klient på et annet språk kan SETTE DEN SAMMEN i stedet for å ta den fra
hverandre. Det løser ingenting i dag — det slutter bare å grave hullet
dypere, og det koster ingenting fordi adressen allerede er hentet.

Den ekte løsningen er å slutte å lagre en setning i `title` i det hele tatt:
`title` = det ekte navnet eller null, og delene i felt. Det er en migrasjon
pluss en API- og klientendring, og hører til den dagen et andre språk er en
beslutning og ikke en mulighet.

## Hva som skjer med de 1 423 Oslo-radene

Upserten er `(source_id, external_id)`, og `external_id` endres ikke av
dette. **Alle 1 423 radene oppdateres, ingen dupliseres, ingen blir
foreldreløse.**

| Radene | Antall i Oslo | Hva som skjer |
|---|---|---|
| OSM-navn | 34 | **uendret** — geokodes aldri |
| «ved gate» | 1 384 | tittelen får husnummer der adressen har et, og `address` fylles |
| «i område» | 5 | **uendret** |
| kun kategori | 0 | — |

**Ingenting må ryddes.** Ingen rad tas ned, ingen `locked` settes, ingen
`external_id` bytter. Det eneste som endrer seg er `title` og `address`, og
`updated_at` via triggeren.

**Kjøringen koster ingen geokoding.** Adressene ligger i `geocode_cache`, og
`reverseGeocodeDetailed` leser cachen først. Det gjør også at endringen kan
tørrkjøres mange ganger uten å belaste Kartverket.

**Nøyaktig hvilke titler som endres kan ikke sies på forhånd herfra** — det
avhenger av om den cachede adressen har et husnummer. `del 1 d` måler det
uten å skrive noe.

## Rulle tilbake

Én commit. `title` bygges på nytt ved neste import, og faller tilbake til
gatenavnet uten husnummer. `address` blir stående med den geokodede verdien
til noen fjerner den — den er ikke gal, bare mer enn før.

## «13 ≠ 151» — hva kollisjonstallet faktisk teller

Tørrkjøringen for Lekeplass i Oslo viste `8 kun kategori` og `5 uten adresse`
i tittelkilde-linjene, men `151 med delt GENERERT tittel` i oppsummeringen.
Det er ikke et avvik. De to tallene teller ulike ting, og begge er riktige.

**Lest i koden, ikke gjettet** (`lib/import-approval.ts`):

1. **Populasjonen er ikke de 8.** `generatedTitlePairs` filtrerer på
   `!r.osmNavn` — altså *alle* rader uten ekte OSM-navn. For Oslo/Lekeplass er
   det 1 423 − 34 = **1 389 rader**: 1 384 «ved gate», 5 «i område», og det som
   måtte være «kun kategori». «Kun kategori» er en tittelkilde blant fire, ikke
   populasjonen.

2. **Utdataene er PAR, ikke rader.** Løkka er `for i … for j = i+1`, så en
   gruppe på *n* rader med byte-identisk tittel gir *n·(n−1)/2* linjer. Den
   verste Lekeplass-gruppa i spørring B var 17 rader — **136 par alene**.
   Rent aritmetisk kan 13 rader gi høyst C(13,2) = 78 par, så 151 *kan ikke*
   komme fra 13 rader uansett hvordan de fordeler seg.

3. **Overvekten er «ved gate», ikke «kun kategori».** Før husnummeret kom inn
   i tittelen var «Lekeplass ved Kapellveien» felles for hver lekeplass langs
   Kapellveien. Det er kollisjonene endringen i denne grenen fjerner.

### De 555 kilometerne er ikke blant de 151

`generatedTitlePairs` har et tak på **2 000 m** (`meters = 2000`), og par over
taket forkastes (`if (d > meters) continue`). Spørring C hadde ikke noe tak, og
det er der max 555 km for Lekeplass, 561 km for Park og 558 km for Bibliotek
kommer fra. De parene har aldri vært med i de 151 — antakelsen om at de 151 er
de landsdekkende generiske titlene stemmer altså ikke.

Landsdekkende par med samme generiske tittel er et ekte problem for
*visningen* (to «Lekeplass» i hver sin ende av landet ser like ut i en liste),
men de er ikke et duplikatproblem, og tørrkjøringens duplikatlinje er ikke
stedet de dukker opp.

### Rapportlinja er rettet

Linja sa `151 med delt GENERERT tittel`, som leses som 151 steder. Den sier nå
`151 par mellom N rader`, med begge tallene, fordi det ene ikke lar seg utlede
av det andre. Formatet på eksempellinjene under er uendret.
