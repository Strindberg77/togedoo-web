# Spill og moro: pulje 1

**Status:** forslag (19.09.2026), bygget på [spill-og-moro-kandidater.md](spill-og-moro-kandidater.md) (f5ddea9) og målingen
før den. Ingen kode er endret, ingenting er skrevet til basen, og ingen seed er kjørt.

**Hva jeg har lest:**
- OSM, via Overpass med Togedoo-identiteten.
- Stedenes **egne** nettsider, hentet med `User-Agent: Togedoo datahub (hello@togedoo.com)`, alle 19.09.2026. Ingen aggregatorer og ingen søkemotor. Ingen tekst fra sidene er kopiert inn her. Det som står, er min oppsummering.

Beslutningene fra Frederik som dette bygger på:
- Kategoriene bygges for hele landet. Puljene deles etter type, og hver pulje er landsdekkende for sine fasetter.
- Gokart er med, foreløpig under Spill og moro med fasetten `gokart`.
- Innendørs lekeland og Spill og moro er to kategorier. Hovedkategorien følger det stedet kaller seg. Den andre kategorien nås gjennom en fasett.
- Alder: foreldrene bestemmer. Steder der barn ikke slipper inn, droppes, med mindre de har familietid. Da sier raden det.

## Kort svar

- **Rekkefølgen:** Jeg ville tatt **bowling som pulje 2**, før escape room og spillehall, og gitt appen flisa etter bowling. Bowling gir 60 av de 118 stedene og finnes i alle fylker unntatt Troms. Bowlingkjedene har dessuten lasertag, gokart og spillhaller i samme hus. Pulje 1 bør bare ha stedene som kan kontrolleres nå. Resten settes på venteliste til vi har en nettadresse (del 1).
- **Gokart:** OSM har 59 gokartobjekter. Slått sammen blir det **24 baner**: 3 klare, 9 til sjekk og 12 droppes.
  - Av de 12 er 8 uten navn (én av dem er banen til Lucky Bowl Trondheim), 3 ligger inne i parker vi allerede har kuratert, og 1 krever lisens.
  - Nesten alle med navn er motorklubber. Bare noen av dem leier ut til alle.
- **Dekning:** 118 steder med status klar eller sjekk. Alle fylker har minst ett.
  - Troms har ingen bowling.
  - Akershus har bare 3 steder, og alle er bowling.
  - **30 av 68 kommuner over 20 000 innbyggere har ingen kandidat.** De største er Asker (100 492), Nordre Follo og Ullensaker. Innbyggertallene er OSM-taggen `population` på kommunegrensene, datert 01.01.2025. Taggen er hentet fra SSB.
- **Enhetsregisteret** kan finne bowlinghaller og gokartbaner som OSM mangler. Det må i så fall være underenheter med beliggenhetsadresse, filtrert på både næringskode og navn. Næringskoden alene er for bred (del 3).
- **Pulje 1 er kontrollert mot egne nettsider:**
  - 11 steder består kontrollen.
  - 2 må sjekkes videre (Grong Karting og NMK Lister).
  - 10 kan ikke kontrolleres fordi jeg ikke har nettadressen. Det gjelder Lucky Duck, minigolfen på Veierland og Underground, som du la til selv, og 7 gokartbaner, blant dem Harald Huysman Karting.
- **Megazone Bergen og Fangene på Fortet Bergen** har samme adresse ifølge begge nettsidene, Michael Krohns gate 86. Jeg foreslår samme punkt for begge og ingen oppdiktet forskyvning (del 5).
- **Fritekstsøket (q) treffer ikke fasetter.** Den raskeste løsningen er at ordet står i beskrivelsen. Det gjør det i alle seed-radene nedenfor.
- **En merknad som fasett** går uten migrasjon. Den krever et nytt token i togedoo-web og en ny rad i detaljarket i appen (del 7).

## 1. Rekkefølge og størrelse

### Hva radene viser

| Pulje (forslaget) | Kandidater | Klare / sjekk etter OSM | Lar seg kontrollere nå |
|---|---|---|---|
| 1: lasertag, Fangene, gokart, steder lagt til for hånd | 3 + 3 + 24 + 4 | se del 4 | 11 av 23 består. 2 må sjekkes videre, og 10 mangler nettadresse |
| 2: escape room og spillehall | 14 + 12 | 8 + 3 klare, 5 + 4 til sjekk | Nesten bare i Oslo, Bergen, Trondheim og Stavanger |
| 3: bowling | 76 | 30 klare, 29 til sjekk | Kjedene (Lucky Bowl, Bowling1, O'Learys) har felles nettsider, så én side dekker mange rader |
| 4: minigolf med navn | 37 | 16 klare, 8 til sjekk | Mange er sesongbaner med lite på nett |
| 5: minigolf uten navn | 58 | – | – |

### Anbefaling

1. **Pulje 1 bør bare ha det som kan kontrolleres nå.**
   - Det er de 11 stedene som består i del 4.
   - Lucky Duck, Veierland, Underground og gokartbanene uten nettadresse kommer på en **venteliste**. De går inn med én gang du gir meg nettadressene.
   - Ellers blir pulje 1 stående og vente på ti steder vi ikke kan kontrollere.
2. **Bowling bør være pulje 2**, og flisa i appen bør komme etter den:
   - Bowling er ryggraden: 60 av de 118 stedene, og finnes i alle fylker unntatt Troms. Escape room og spillehall har til sammen 21 steder, nesten bare i de fire største byene. En flis etter escape room og spillehall ville vært en byflis.
   - Kjedene har flere fasetter i samme hus. Lucky Bowl Trondheim har bowling, lasertag, gokart, arkadespill og lekeland. Lucky Bowl Ålesund har lasertag, og det står ikke i OSM. Bowlingkontrollen finner altså lasertag og spillehall som OSM ikke har. Det bør skje før lasertag og spillehall regnes som ferdige.
   - Kontrollen går raskt. Én kjedeside dekker mange rader, og aldersgrensen er ofte felles regel for hele kjeden.
3. **Escape room og spillehall blir pulje 3.** Den blir liten, 20–25 rader.
   - Megazone lenker selv til «The Cube» i Oslo, Bergen og Stavanger. Det er samme type sted som Fangene på Fortet, og ingen av dem er i OSM-kandidatene.
   - Jeg har ikke åpnet The Cube-sidene. De bør med her.
4. **Minigolf med navn og minigolf uten navn** som pulje 4 og 5, som foreslått.

**Størrelse:** Bowling med 76 kandidater er den eneste puljen som er stor. Den trenger ikke deles. Etter at dublettene er fjernet, gjenstår rundt 60 steder, og kjedesidene dekker en stor del av dem.

### Gokart: kandidatene

Hentet fra målingen: `sport=karting` i hele Norge, 59 objekter. Objekter innen 400 m av hverandre er slått sammen til én bane.
- Punktet er det navngitte objektet der det finnes. Ellers er det snittet av banens objekter.
- Flaggene er de samme som for de andre fasettene.
- Et navn med \* er hentet fra et navngitt objekt innen 500 m, for eksempel «Kongsberg motorsenter».
- **Bowlingsenteret i Trondheim har også gokart.** Det står under bowling som Bowling1 & Gocart, og heter nå Lucky Bowl Trondheim. Gokartobjektet ved siden av er derfor droppet her og slått sammen med den raden.

| Status | Navn | Kommune | OSM | Koordinat | Objekter | Nettadresse | Flagg | Begrunnelse |
|---|---|---|---|---|---|---|---|---|
| Dropp | (uten navn) | Alver | `way/741741369` | 60.64892, 5.08797 | 1 | – | – | Uten navn. Venter |
| Sjekk | Evertmoen | Dyrøy | `node/1295245796` | 69.06781, 17.71868 | 1 | – | – | Ingen nettadresse i OSM. Ikke kontrollert |
| Dropp | (uten navn) | Elverum | `way/959072202` | 60.87573, 11.67804 | 4 | – | – | Uten navn, ett av fire baneobjekter er tagget nedlagt. Venter |
| Sjekk | NMK Lister | Farsund | `node/1786348298` | 58.11207, 6.61198 | 1 | <https://www.nmklister.no/> | – | Klubbane. Utleien går via «Lista Adrenalinpark», som bare lenker til Facebook. Ikke åpnet |
| Sjekk | Grong Karting | Grong | `way/1540002328` | 64.3906, 12.34219 | 1 | <https://grongkarting.no/> | – | Kontrollert, men drift i 2025–2026 er ikke bekreftet på siden |
| **Klar** | Halsa Motorsportsenter | Heim | `way/688146555` | 63.12361, 8.37625 | 1 | <https://www.nmkhalsa.no> | – | Kontrollert, se pulje 1 |
| **Klar** | Dagali Opplevelser * | Hol | `way/1110871267` | 60.41658, 8.50211 | 1 | <https://www.dagaliopplevelser.no> | navnet er fra et nabobjekt | Kontrollert, se pulje 1 |
| Sjekk | Trøgstad motorsenter * | Indre Østfold | `way/228524056` | 59.64654, 11.31617 | 4 | – | navnet er fra et nabobjekt | Navnet er fra et nabobjekt. Ingen nettadresse i OSM. Ikke kontrollert |
| Sjekk | Kongsberg motorsenter * | Kongsberg | `node/1291379779` | 59.66818, 9.6957 | 4 | – | navnet er fra et nabobjekt | Navnet er fra et nabobjekt. Ingen nettadresse i OSM. Ikke kontrollert |
| **Klar** | Kragerø Action Park | Kragerø | `node/12873546691` | 58.88011, 9.26858 | 2 | <https://www.krap.no> | – | Kontrollert, se pulje 1 |
| Sjekk | Vamoen | Kristiansand | `relation/16372941` | 58.30577, 7.58699 | 1 | – | – | Ingen nettadresse i OSM. Ikke kontrollert |
| Dropp | (uten navn) | Lillehammer | `way/620119997` | 61.22807, 10.43478 | 12 | – | – | Inne i Hunderfossen, som er kuratert og claimet |
| Dropp | (uten navn) | Oslo | `way/154229409` | 59.8296, 10.7721 | 1 | – | – | Uten navn, ved Hvervenbukta. Venter |
| Sjekk | Harald Huysman Karting | Oslo | `way/1030656428` | 59.91913, 10.83587 | 2 | – | – | Ingen nettadresse i OSM. Ikke kontrollert |
| Dropp | (uten navn) | Porsanger | `way/326113187` | 69.96193, 24.96725 | 1 | – | – | Uten navn. Venter |
| Dropp | Arctic Circle Raceway * | Rana | `way/233133963` | 66.42261, 14.44096 | 1 | – | navnet er fra et nabobjekt | Motorsportanlegg. Siden krever lisenskurs og årslisens for å kjøre. Ingen utleie funnet |
| Sjekk | Rauma Gokart | Rauma | `relation/20204652` | 62.56164, 7.83587 | 2 | – | – | Ingen nettadresse i OSM. Ikke kontrollert |
| Dropp | (uten navn) | Sande | `way/392933507` | 62.2315, 5.73459 | 1 | – | – | Uten navn, ved en skytebane. Venter |
| Dropp | (uten navn) | Steinkjer | `way/509153663` | 64.01657, 11.70874 | 1 | – | – | Uten navn. Venter |
| Dropp | (uten navn) | Trondheim | `node/3370641796` | 63.33064, 10.3489 | 1 | – | – | Banen til Lucky Bowl Trondheim (20 m). Slås sammen med den raden |
| Dropp | (uten navn) | Ullensvang | `way/901775752` | 60.37833, 6.72704 | 7 | – | overnatting ≤ 250 m: camp_site «Bråvoll Camping» 95 m | Inne i Mikkelparken, som er kuratert og claimet |
| Dropp | (uten navn) | Øyer | `way/273798831` | 61.23818, 10.43854 | 5 | – | overnatting ≤ 250 m: hotel «Hafjell hotell» 171 m | Inne i Lilleputthammer, som er kuratert og claimet |
| Dropp | (uten navn) | Øystre Slidre | `way/658394023` | 61.25114, 8.90378 | 1 | – | – | Uten navn, på Beitostølen. Venter. Kan være et utleieanlegg |
| Sjekk | Gokartutleie Ålesund | Ålesund | `relation/6161697` | 62.48367, 6.38323 | 3 | – | access=customers | Ingen nettadresse i OSM. Ikke kontrollert. Lucky Bowl Ålesund har ikke gokart |

## 2. Dekning

Tellingen tar med alle kandidater med status **klar** eller **sjekk**:
- de 142 fra kandidatlisten, med «sjekk» for alle som har åpent til midnatt eller senere
- de 24 gokartbanene
- resultatet av kontrollen i pulje 1: Lucky Bowl Trondheim, Lykkeland og Oslo Camping er nå klare

Et sted med flere fasetter telles én gang per fasett. Lucky Bowl Trondheim teller for eksempel under bowling, lasertag, gokart og spillehall. «Steder» teller hvert sted én gang.

Fylket er de to første sifrene i kommunenummeret. Kommunenummeret er slått opp i Overpass (`is_in`, `admin_level=7`, taggen `ref`) for hver kandidat.

### Per fylke og fasett

| Fylke | bowling | lasertag | escaperom | spillehall | minigolf | gokart | Steder |
|---|---|---|---|---|---|---|---|
| Agder | 6 | **0** | **0** | **0** | 1 | 2 | 9 |
| Akershus | 3 | **0** | **0** | **0** | **0** | **0** | 3 |
| Buskerud | 7 | **0** | **0** | **0** | 1 | 2 | 10 |
| Finnmark | 2 | **0** | **0** | **0** | **0** | **0** | 2 |
| Innlandet | 3 | **0** | **0** | **0** | 1 | **0** | 4 |
| Møre og Romsdal | 2 | **0** | 1 | **0** | 1 | 2 | 6 |
| Nordland | 5 | **0** | 1 | 2 | 2 | **0** | 10 |
| Oslo | 3 | 1 | 3 | 2 | 7 | 1 | 17 |
| Rogaland | 7 | **0** | 1 | 1 | 3 | **0** | 12 |
| Telemark | 1 | **0** | 1 | **0** | 1 | 1 | 4 |
| Troms | **0** | **0** | **0** | **0** | 1 | 1 | 2 |
| Trøndelag | 7 | 2 | 3 | 2 | 1 | 3 | 14 |
| Vestfold | 4 | **0** | 1 | **0** | **0** | **0** | 5 |
| Vestland | 7 | 1 | 2 | 1 | 2 | **0** | 13 |
| Østfold | 3 | **0** | **0** | **0** | 3 | 1 | 7 |
| **Hele landet** | 60 | 4 | 13 | 8 | 24 | 13 | 118 |

- Fasettene er talt per sted, ikke per rad. Et sted som har både bowling og lasertag, teller én gang under hver.
- **Lasertag er tynnest:** bare 4 steder, i Oslo, Bergen og Trøndelag. Bowlingkontrollen vil trolig finne flere (se del 1).
- **Troms har ingen bowling.** Kandidatene der er Storgata Camping i Tromsø, som er en bar med minigolf, og gokartbanen Evertmoen i Dyrøy. Ingen av dem er kontrollert.
- **Akershus har bare tre bowlinghaller** (Sandvika, Strømmen og Lørenskog), selv om fylket har 740 680 innbyggere.

### Kommuner over 20 000 innbyggere uten en eneste kandidat

**30 av 68.** Ingen fylker er helt uten kandidater.


| Kommune | Fylke | Innbyggere (01.01.2025) |
|---|---|---|
| Asker | Akershus | 100 492 |
| Nordre Follo | Akershus | 64 668 |
| Ullensaker | Akershus | 45 066 |
| Karmøy | Rogaland | 43 723 |
| Øygarden | Vestland | 40 105 |
| Porsgrunn | Telemark | 37 289 |
| Ringsaker | Innlandet | 35 911 |
| Askøy | Vestland | 30 377 |
| Alver | Vestland | 30 169 |
| Sola | Rogaland | 29 153 |
| Lillehammer | Innlandet | 29 011 |
| Eidsvoll | Akershus | 28 352 |
| Horten | Vestfold | 28 039 |
| Færder | Vestfold | 27 569 |
| Holmestrand | Vestfold | 27 005 |
| Nittedal | Akershus | 26 023 |
| Rana | Nordland | 25 927 |
| Harstad | Troms | 25 167 |
| Stjørdal | Trøndelag | 24 927 |
| Nes | Akershus | 24 897 |
| Kristiansund | Møre og Romsdal | 24 578 |
| Lindesnes | Agder | 23 768 |
| Sunnfjord | Vestland | 22 662 |
| Ås | Akershus | 22 344 |
| Stange | Innlandet | 21 691 |
| Klepp | Rogaland | 21 186 |
| Øvre Eiker | Buskerud | 20 861 |
| Nesodden | Akershus | 20 698 |
| Rælingen | Akershus | 20 509 |
| Hå | Rogaland | 20 067 |

Flere av disse har steder rett over kommunegrensen. Asker og Nordre Follo ligger for eksempel ved Sandvika Bowling og Oslo.
- Et tomt felt her betyr **ingen kandidat innenfor kommunegrensen**. Det betyr ikke nødvendigvis at ingen har et tilbud i nærheten.
- **Ås og Lillehammer** har tilbud inne i Tusenfryd og Hunderfossen. Disse er droppet fordi parkene allerede er kuratert som Fornøyelsespark.
- **Færder** får en kandidat når minigolfen på Veierland legges inn.

### Hvor innbyggertallene kommer fra

Fra OSM: taggen `population` på kommunegrensene (`boundary=administrative`, `admin_level=7`), hentet i samme Overpass-kall som kommunenumrene.
- Alle 68 kommunene over 20 000 har `population:date=2025-01-01`.
- Tallene i OSM er lagt inn fra SSB, men jeg har **ikke** sammenlignet dem med SSB selv. Det ville vært et nytt tredjepartskall.
- Fylkestallene er også fra OSM. Oslo har ikke fylkestall der, bare kommunetall.

## 3. Steder som mangler i OSM: Enhetsregisteret og andre åpne kilder

Dette er en vurdering. Jeg har ikke gjort noen kall.

### Enhetsregisteret (Brønnøysundregistrene)

- **Hva det er:** Et åpent API (`data.brreg.no/enhetsregisteret/api`) uten nøkkel, under Norsk lisens for offentlige data (NLOD). Lisensen krever kreditering.
- **Underenheter:** Registeret har både **enheter** (selskapet) og **underenheter** (virksomheten på stedet). Underenhetene har *beliggenhetsadresse*. Det er den vi trenger. Selskapets forretningsadresse er ofte et regnskapskontor.

**Næringskoder (SN2007).** Kodene under er fra min kunnskap om standarden. **De må slås opp i SSBs klassifikasjonsdatabase (KLASS) før de brukes.** Det har jeg ikke gjort.

| Kode | Navn | Hva den trolig gir |
|---|---|---|
| 93.110 | Drift av idrettsanlegg | Etter NACE-forklaringen omfatter den både bowlingbaner og motorbaner. Den gir også tusenvis av haller, baner og stadioner. **For bred alene** |
| 93.290 | Andre fritidsaktiviteter | Spillhaller, lasertag, escape room og lignende. Men også mye annet, som diskotek og mange typer fritidsvirksomhet |
| 93.210 | Drift av fornøyelses- og temaparker | Få, og de fleste har vi allerede |
| 56.101 / 56.301 | Restaurant / pub | Som **utelukkelse**: har en «bowling»-underenhet bare restaurant- eller pubkode, er det et flagg |

**Presisjon:**
- Næringskoden settes av virksomheten selv. En bowlinghall kan like gjerne stå som restaurant (56.101).
- Uten filter på navn er treffene nesten bare støy. **Kode og navn sammen** gir trolig et brukbart utvalg: 93.110 og 93.290, med navn som inneholder bowling, gokart, karting, laser, escape, minigolf eller lignende. Hvor mange som faller mellom, vet jeg ikke før det er målt.
- Registeret har felt for **konkurs, avvikling og nedleggelse**. Det er en billig kontroll av om et sted er i drift. OSM mangler det helt.

**Hva det ville kreve:**
1. Ja fra Frederik til et nytt tredjepartskall.
2. Et leseskript som henter underenheter per kode og navneord, med Togedoo-identiteten. Kanskje noen hundre kall.
3. Geokoding av beliggenhetsadressen. Kartverkets adresse-API er allerede i bruk i `lib/geocode.ts`.
4. Sammenstilling med OSM-kandidatene (navn og avstand) for å finne dem OSM mangler.
5. Kontroll mot egne nettsider, som i del 4.

Registeret gir **ingen nettadresse** for de fleste virksomheter. Den må finnes på annen måte.

### Andre åpne kilder

- **Idrettsanleggsregisteret** (Kultur- og likestillingsdepartementet, anleggsregisteret.no). Det har anleggstyper for motorsport og trolig for bowling. Noen OSM-objekter har allerede `ref:anlegg`, som peker dit. Det gir **kommunale og klubbeide anlegg**, altså klubbanene for gokart, og neppe de kommersielle bowlinghallene. Lisens og API er ikke undersøkt.
- **Kjedenes egne lister over avdelinger.** Megazone lister The Cube, og Lucky Bowl lister byene sine. Det er de beste kildene for kjedesteder, og de fant nye steder allerede i denne runden. Det er stedets egen side, men å bruke den til å *finne* nye steder er mer enn kontroll. Bør avklares.
- **Kommunenes lister over skjenkebevillinger.** Ikke for å finne steder, men for å kontrollere alkohol. Formatet varierer fra kommune til kommune, så det er lite egnet i stor skala.

## 4. Pulje 1 kontrollert mot egne nettsider

Alle sidene er lest 19.09.2026 med Togedoo-identiteten.
- «Ikke funnet» betyr at det ikke står på sidene jeg leste. Det betyr ikke at det ikke finnes.
- Inngangen er det nettsiden sier. Der OSM har en inngangsnode som passer, står det i del 6.

### Består kontrollen (11)

| Sted | Lest | I drift | Åpent for alle | Barn | Alder | Skjenking | Adresse og inngang |
|---|---|---|---|---|---|---|---|
| **Megazone Oslo** | megazone.no/, /sporsmal-og-svar/, /kontakt/, /laserspill | Ja: stengte dager for 2026 står på kontaktsiden | Ja, drop-in (bestilling anbefales) | Ja, barnebursdager | Lasertag: ingen grense, anbefalt fra 6 år. Innendørs paintball: 13 år. Fjellstua (baren i samme hus): 20 år | **Ja.** Kaller seg utested med servering. Enkelte lørdager serveres det alkohol i hele huset | Mariboes gate 2, 0179 Oslo. Inngang rett overfor Rockefeller |
| **Megazone Bergen** | bergen.megazone.no/, /kontakt/, /sporsmalogsvar/ | Trolig: bestilling og stengte juledager står på siden, uten årstall | Ikke funnet om drop-in | Ja, barnebursdager | Lasertag: ingen grense, anbefalt fra 6 år | **Ja.** Baren serverer øl, cider og vin i hele åpningstiden | Michael Krohns gate 86, 5057 Bergen. Inngang ikke beskrevet |
| **Lykkeland** (Steinkjer) | lykkelandsteinkjer.no/, /lykkeland-lekepark/, /laserland/, /bowling/ | Ikke bekreftet med dato. Priser, åpningstider og bestilling står på siden | Ja, inngang til lekepark | Ja, lekepark for barn | Laserspill fra 8 år (3. trinn) | **Ja.** Bowlingdelen har bar og lounge | Sjøfartsgata 12, Steinkjer. Inngang ikke beskrevet |
| **Fangene på Fortet Oslo** | oslo.fangenepafortet.no/, /sporsmalogsvar/, /kontakt/ | Ikke bekreftet med dato | Ja, bestilling | Ja, barnebursdager | Ingen grense, anbefalt fra 8 år. Voksen på laget anbefales under 10 år. Foresatte vurderer selv | **Ja.** Baren serverer øl, cider og vin | Nydalsveien 28, 0484 Oslo. P-hus 50 m fra inngangen |
| **Fangene på Fortet Bergen** | bergen.fangenepafortet.no/, /kontakt/, /sporsmalogsvar/ | Ikke bekreftet med dato | Ja, bestilling | Ja, barnebursdager | Ingen grense, anbefalt fra 8 år. Voksen på laget anbefales under 10 år | **Ja**, samme ordlyd som Oslo | Michael Krohns gate 86, 5057 Bergen. **Samme adresse som Megazone Bergen** |
| **Fangene på Fortet Stavanger** | stavanger.fangenepafortet.no/, /kontakt/, /sporsmalogsvar/ | Ikke bekreftet med dato | Ja, bestilling | Ja. Barnebursdager, og aktiviteten beskrives som egnet for alle aldre | Ikke funnet. Spørsmål-og-svar-siden hadde ingen lesbar tekst | Ikke funnet | Lagårdsveien 61, 4010 Stavanger |
| **Lucky Bowl Trondheim** (i OSM: Bowling1 & Gocart) | bowling1.no/trondheim (sender videre til luckybowl.no/trondheim), /faq/, /om-oss/ | Ja: åpningstider per ukedag | Ja, drop-in | Ja: barnebursdager og lekeland | **18 år etter kl. 21 fredag og lørdag. Familietid resten av tiden.** Gokart fra 8 år (juniorkart), 15 år for voksenkart. Lasertag: ingen grense, anbefalt fra 6 år | **Ja.** Skjenkebevilling | Heggstadmoen 55, 7080 Trondheim |
| **Kragerø Actionpark** | krap.no/, /openbooking/, /gruppebooking/ | Ja: åpen bestilling og kontakttid. Sesong ikke funnet | Ja, åpen bestilling | Ja | Juniorkart fra fylte 8 år, seniorkart fra 15. Den som kjører dobbelkart, må være 18. Paintball under 18 krever samtykke fra foresatte | Ikke funnet. Siden ber gjestene være edru | Kjølebrøndsveien 210, 3766 Sannidal (Kragerø) |
| **Dagali Opplevelser**, gokart | dagaliopplevelser.no/, /sommeraktiviteter/gokart/, /kontakt-oss/ | Ja: drop-in om sommeren og i høstferien. Is-karting om vinteren | Ja, drop-in | Ja, egne barnekarter | Barnekarter for 8–12 år. Under 8 år får ikke kjøre | Ikke funnet | Bygdeveien 185, 3588 Dagali (Hol). Adressen finnes ikke i OSM |
| **NMK Halsa** | nmkhalsa.no | Ja: drop-in-utleie er annonsert i dag, 19.09.2026. Årsmøtet i 2026 har en sak om klubbens fremtid | **Bare på oppsatte drop-in-dager** | Ja | Fra 8 år. Noe for yngre barn nevnes, men jeg fant ikke hva | Ikke funnet | Klubbens lokaler: Glåmsmyrvegen 343, 6683 Vågland (Heim) |
| **Oslo Camping** (innendørs minigolf) | campingen.no/oslo, campingen.no/p/faq | Ja: priser og åpningstider på siden | Ja | **Ja, før kl. 19.** Egen pris for barn | **Legitimasjon og 20 år etter kl. 19 hver dag.** Ingen aldersgrense før det. **Familietid, og raden må si det** | **Ja.** Kaller seg minigolf og bar | Møllergata 12, Oslo, ved Youngstorget |

### Må sjekkes videre (2)

| Sted | Lest | Hva jeg fant | Hva som mangler |
|---|---|---|---|
| **Grong Karting** | grongkarting.no/, /about/, /contact/ | Privat bane, åpen for utleie til alle siden våren 2021. Leier ut både gokart og utstyr | Drift i 2025–2026 er ikke bekreftet: nyeste årstall på siden er © 2022. Alder og skjenking er ikke funnet. **To adresser:** Sanddøldalsvegen 10 og Næringsparkvegen 16, 7870 Grong |
| **NMK Lister** | nmklister.no/, /om-oss, /kontakt-oss, /kontakt-oss-1 | Klubbane ved Lista flystasjon. Siden gjelder trening med egen kart | Utleien går via «Lista Adrenalinpark». Den eneste lenken dit er en Facebook-side, som jeg ikke har åpnet |

### Droppet etter kontroll (1)

| Sted | Lest | Hvorfor |
|---|---|---|
| **Arctic Circle Raceway** (Rana) | acr.no/ | Siden krever lisenskurs og årslisens for å kjøre. Jeg fant ingen utleie. Adresse: Ørtfjellveien 26, 8630 Storforshei |

### Ikke kontrollert: mangler egen nettadresse (10)

Jeg har ikke brukt søkemotor, og jeg har ikke gjettet domener.

| Sted | Hva jeg har |
|---|---|
| Lucky Duck (innendørs minigolf, Oslo) | Ikke i OSM |
| Minigolfen på Veierland (Færder) | Ikke i OSM |
| Underground Golf Club Majorstua (Oslo) | OSM `node/12966945763`, uten nettadresse |
| Harald Huysman Karting (Oslo) | OSM `way/1030656428`, uten nettadresse. Er i dag Idrettshall |
| Evertmoen (Dyrøy) | OSM, uten nettadresse |
| Kongsberg motorsenter | Navnet er fra et nabobjekt |
| Trøgstad motorsenter (Indre Østfold) | Navnet er fra et nabobjekt |
| Gokartutleie Ålesund / Ålesund Kart Ring | OSM, `access=customers`. Lucky Bowl Ålesund har *ikke* gokart (luckybowl.no/alesund/om-oss/, lest i dag), så det er ikke dem |
| Vamoen (Kristiansand) | OSM, uten nettadresse |
| Rauma Gokart | OSM, uten nettadresse |

**Hvis du gir meg nettadressene, kontrollerer jeg disse på samme måte.**

## 5. Megazone Bergen og Fangene på Fortet Bergen: samme punkt

- **Adresse:** Begge nettsidene oppgir samme adresse, Michael Krohns gate 86, 5057 Bergen. Ingen av dem beskriver en egen inngang.
- **Drift:** Megazone lister Fangene på Fortet som en av sine avdelinger, så det er samme drivergruppe.
- **OSM:** Adressenoden `node/3126102168` ligger på 60.381463, 5.317511. De to POI-ene i OSM ligger 2–3 m fra hverandre og rundt 9 m fra adressen. Rundt bygget ligger det ni inngangsnoder (`entrance=main`, `yes`, `staircase`, `shop`), men ingen av dem er knyttet til et navn.

**Forslag:**
1. **Samme punkt for begge: adressenoden.** Da viser kartet det som er sant, nemlig to tilbud i samme hus. En forskyvning på noen meter ville vært en oppdiktet presisjon, og `coordVerified` kan ikke skille «anslått» fra «flyttet med vilje».
2. **Hold dem som to rader.** De har hver sin nettside, bestilling og aldersanbefaling (6 og 8 år), og en forelder søker etter navnet. Det er ikke samme situasjon som Dyreparken, der ett sted er to ting.
3. **Spør stedet** hvilken dør hver aktivitet bruker. Hvis de har hver sin inngang, er det den riktige måten å skille punktene på. Oppslaget er ikke gjort.

**Å vite før seeding:** Jeg har ikke sjekket hvordan appen tegner to steder med identisk punkt.
- `/api/kart` gir begge i samme tynne rute, og da tegnes to markører oppå hverandre.
- Skjuler den ene den andre, er det en appfeil. Den gjelder også andre steder i samme bygg, som kjøpesentre.
- Den må i så fall løses i appen, ikke med punktene.

## 6. Forslag til seed-rader (ikke kjørt)

Formen følger `VinterSeed` og `SPLIT` i `scripts/seed-vintertilbud.ts`, med kilden `kuratert-vintertilbud`.

**Tittelen** er skrevet slik stedet selv gjør det i sidetittelen eller i listen over avdelinger. Der OSM-navnet er annerledes, står det i kommentaren.

**Beskrivelsene** følger reglene: ingen priser, datoer, åpningstider, antall eller superlativer. Ordet for aktiviteten står i beskrivelsen, så fritekstsøket finner stedet (se del 7a).

**To setninger må du vurdere:**
- Lucky Bowl Trondheim: «Aldersgrense sent på kvelden i helgene.»
- Oslo Camping: «Barn er velkomne på dagtid. Om kvelden er det aldersgrense.»

De har verken tall eller klokkeslett, men de handler om tid på døgnet. Alternativet er merknadsfasetten i del 7b.

### Punktene

| Rad | Punkt | Kilde | `coordVerified` |
|---|---|---|---|
| Megazone Oslo | 59.91612, 10.74927 | OSM-POI `node/4736654480`. Siden sier at inngangen er overfor Rockefeller. Det finnes tre inngangsnoder i nærheten, men ingen er knyttet til Megazone | `false`, til inngangen er kontrollert |
| Megazone Bergen | 60.381463, 5.317511 | Adressenoden `node/3126102168` (Michael Krohns gate 86) | `true` for adressen |
| Fangene på Fortet Bergen | 60.381463, 5.317511 | Samme adressenode (del 5) | `true` for adressen |
| Fangene på Fortet Oslo | 59.949649, 10.764105 | Adressenoden `node/2789383634` (Nydalsveien 28). OSM-POI-en ligger rundt 30 m unna | `true` for adressen |
| Fangene på Fortet Stavanger | 58.960248, 5.738078 | Adressenoden `node/2840920768` (Lagårdsveien 61). En `entrance=main` 100 m unna er ikke knyttet til stedet | `true` for adressen |
| Lykkeland | 64.007495, 11.496098 | Adressenoden `node/3125272888` (Sjøfartsgata 12). OSM-POI-en ligger rundt 40 m unna | `true` for adressen |
| Lucky Bowl Trondheim | 63.330497, 10.34931 | `node/8543977715`, `entrance=main` og `access=customers`, ved adressenoden for Heggstadmoen 55 | `true` |
| Kragerø Actionpark | 58.880068, 9.269315 | Adressenoden `node/7725840079` (Kjølebrøndsveien 210) | `true` for adressen |
| Dagali Opplevelser | 60.41658, 8.50211 | Midten av banen, `way/1110871267`. Adressen (Bygdeveien 185) finnes ikke i OSM | `false` |
| NMK Halsa | 63.123292, 8.376962 | Adressenoden `node/3118631931` (klubblokalene, Glåmsmyrvegen 343), rundt 50 m fra banen | `true` for adressen |
| Oslo Camping | 59.914584, 10.747373 | Adressenoden `node/2785634860` (Møllergata 12) | `true` for adressen |

### Radene

```ts
// SPLIT (kategori, inne/ute, fasetter)
'megazone-oslo':               { category: 'Spill og moro', isIndoor: true,  facets: ['lasertag', 'escaperom'] },
'megazone-bergen':             { category: 'Spill og moro', isIndoor: true,  facets: ['lasertag'] },
'fangene-pa-fortet-oslo':      { category: 'Spill og moro', isIndoor: true,  facets: ['escaperom'] },
'fangene-pa-fortet-bergen':    { category: 'Spill og moro', isIndoor: true,  facets: ['escaperom'] },
'fangene-pa-fortet-stavanger': { category: 'Spill og moro', isIndoor: true,  facets: ['escaperom'] },
// Kaller seg lekepark: hovedkategori Innendørs lekeland, nås fra Spill og moro via fasettene.
'lykkeland-steinkjer':         { category: 'Innendørs lekeland', isIndoor: true, facets: ['lasertag', 'bowling'] },
// Bowlingsenter med gokart, lasertag og arkadespill. Om gokartbanen er inne, er ikke bekreftet.
'lucky-bowl-trondheim':        { category: 'Spill og moro', isIndoor: true,  facets: ['bowling', 'lasertag', 'gokart', 'spillehall'] },
'kragero-actionpark':          { category: 'Spill og moro', isIndoor: false, facets: ['gokart'] },
'dagali-opplevelser-gokart':   { category: 'Spill og moro', isIndoor: false, facets: ['gokart'] },
'nmk-halsa-gokart':            { category: 'Spill og moro', isIndoor: false, facets: ['gokart'] },
'oslo-camping-minigolf':       { category: 'Spill og moro', isIndoor: true,  facets: ['minigolf'] },
```

| externalId | Tittel | Kommune | Adresse | Beskrivelse | url |
|---|---|---|---|---|---|
| `megazone-oslo` | Megazone Oslo | Oslo | Mariboes gate 2, 0179 Oslo | Lasertag i mørke labyrinter midt i Oslo sentrum, med escape-spill i samme hus. | https://megazone.no/ |
| `megazone-bergen` | Megazone Bergen | Bergen | Michael Krohns gate 86, 5057 Bergen | Lasertag i Bergen, i samme hus som Fangene på Fortet. | https://bergen.megazone.no/ |
| `fangene-pa-fortet-oslo` | Fangene på Fortet Oslo | Oslo | Nydalsveien 28, 0484 Oslo | Escape room-inspirert lagaktivitet i Nydalen, der laget går fra celle til celle og løser oppgaver. | https://oslo.fangenepafortet.no/ |
| `fangene-pa-fortet-bergen` | Fangene på Fortet Bergen | Bergen | Michael Krohns gate 86, 5057 Bergen | Escape room-inspirert lagaktivitet i Bergen, der laget løser oppgaver i celle etter celle. I samme hus som Megazone. | https://bergen.fangenepafortet.no/ |
| `fangene-pa-fortet-stavanger` | Fangene på Fortet Stavanger | Stavanger | Lagårdsveien 61, 4010 Stavanger | Escape room-inspirert lagaktivitet i Stavanger, med celler for ulik form og alder. | https://stavanger.fangenepafortet.no/ |
| `lykkeland-steinkjer` | Lykkeland | Steinkjer | Sjøfartsgata 12, Steinkjer | Innendørs lekepark i Steinkjer, med laserspill og bowling i samme hus. | https://lykkelandsteinkjer.no/ |
| `lucky-bowl-trondheim` | Lucky Bowl Trondheim | Trondheim | Heggstadmoen 55, 7080 Trondheim | Bowling, gokart, lasertag og lekeland på Heggstadmoen. Aldersgrense sent på kvelden i helgene. | https://luckybowl.no/trondheim/ |
| `kragero-actionpark` | Kragerø Actionpark | Kragerø | Kjølebrøndsveien 210, 3766 Sannidal | Gokartbane ute med doserte svinger, egne karter for barn og paintball. | https://www.krap.no/ |
| `dagali-opplevelser-gokart` | Dagali Opplevelser | Hol | Bygdeveien 185, 3588 Dagali | Gokartbane i Dagali med egne barnekarter, og is-karting når det er vinter. | https://www.dagaliopplevelser.no/sommeraktiviteter/gokart/ |
| `nmk-halsa-gokart` | NMK Halsa | Heim | Glåmsmyrvegen 343, 6683 Vågland | Motorklubbens gokartbane i Halsa, med utleie på faste drop-in-dager. | https://www.nmkhalsa.no/ |
| `oslo-camping-minigolf` | Oslo Camping | Oslo | Møllergata 12, Oslo | Innendørs minigolf og bar ved Youngstorget. Barn er velkomne på dagtid. Om kvelden er det aldersgrense. | https://campingen.no/oslo |

Postnummeret for Lykkeland står ikke på sidene jeg leste. Det slås opp mot Kartverket i seed-runden.

Felles for alle radene:
- `targetAudience: 'For alle'`.
- `isFree: false` der sidene jeg leste viser at det koster penger: Megazone, Lykkeland, Oslo Camping og Kragerø. Ellers `isFree: null`, fordi jeg ikke har lest prissidene. Det gjelder også Dagali.
- Tittelen er tatt fra `<title>` eller listen over avdelinger på stedets egen side. OSM-navnene «Megazone», «Kragerø Action Park», «Halsa Motorsportsenter», «Bowling1 & Gocart» og «Lykkeland Lekepark» er ikke brukt.

### Følger av radene

- **`lib/facets.ts`:**
  - Legg `bowling`, `lasertag`, `escaperom`, `spillehall`, `minigolf` og `gokart` til `FACET_TOKENS` og `SEED_ONLY_FACETS`.
  - **`FASETT_SOM_KATEGORI`** trenger `lasertag` og `bowling` → `'Spill og moro'`, ellers kommer ikke Lykkeland opp under Spill og moro. Samme mekanisme som Dyreparken.
  - Enklest er at alle seks tokenene peker på Spill og moro. Da kommer også et fremtidig lekeland med gokart eller minigolf med.
- **Claims** i `lib/osm-claims.ts`, alle forebyggende (`expectNoHit: true`). Importen har ingen selektor som treffer disse i dag, bortsett fra Megazone og Idrettshall:

  | OSM | Rad |
  |---|---|
  | `node/4736654480`, `node/7197772245` | Megazone Oslo og Bergen (Idrettshall i dag, se kandidat-dokumentet del 6) |
  | `node/9724313095`, `node/7197772246`, `node/14143229452` | Fangene på Fortet |
  | `node/12078177859` | Lykkeland |
  | `node/807246866` | Lucky Bowl Trondheim |
  | `node/12873546691` | Kragerø Actionpark |
  | `way/1110871267` | Dagali |
  | `way/688146555` | NMK Halsa |
  | `node/4958723297` | Oslo Camping |

  `node/807246866` (bowlinghallen) og `node/3370641796` (banen) er to OSM-objekter for Lucky Bowl Trondheim. Begge claimes mot samme rad.
- **Nedtak:** De to Megazone-radene fra OSM (Idrettshall) tas ned med `unpublish` etter seeden, som beskrevet i kandidat-dokumentet.
- **Ikke med:** Harald Huysman Karting er ikke kontrollert. OSM-raden blir stående som Idrettshall til nettsiden er lest.

## 7. To spørsmål om koden

### a) Treffer fritekstsøket fasetter?

**Nei.** Fritekstsøket leser bare tekstfelter:

| Vei | Felt som søkes i | Hvor |
|---|---|---|
| `activities_search` (posisjon, `bbox`, `cursor`, eller `q` uten kommune) | `title`, `description`, `venue_name`, `address`, `category`, `municipality` | Migrasjon 0022, `ilike` |
| Den flate kommune-stien | `title`, `description`, `venue_name`, `address`, `category` | `app/api/activities/route.ts`, `.or(…ilike…)` |

Ingen av dem leser `facets`. Appens eget søk i `ExploreFilter.filterActivities` gjelder arrangementer og leser tittel, beskrivelse, sted og kategori.

**Slik kan «gokart» gi treff på en bane uten ordet i navnet:**

1. **Ordet i beskrivelsen.** Det fungerer i dag, uten kodeendring. Alle radene i Spill og moro er kuraterte, og alle beskrivelsene over har aktivitetsordet. **Dette anbefaler jeg for pulje 1.**
2. **Fasetten i SQL-søket.** Legg til `or array_to_string(a.facets, ' ') ilike '%' || p_q || '%'` i `activities_search`, og `facets` i den flate stien.
   - Signaturen er uendret. Etter arbeidsreglene lages endringen likevel under et kandidatnavn og måles før byttet.
   - Svakheten: tokenene er ASCII. «escape room» treffer ikke `escaperom`, og «rulleskøyter» treffer ikke `rulleskoyter`.
3. **Søkeord per fasett i API-et.** En liste i `lib/facets.ts`, for eksempel `gokart: ['gokart', 'go-kart', 'karting']`, gjør om `q` til fasett-tokens.
   - Tokenene sendes til SQL som en ny parameter. Det er ny signatur, altså drop og create i én transaksjon med rettigheter, og en migrasjon.
   - Denne varianten håndterer både bøyning og engelske ord. Den er riktig på sikt, men ikke nødvendig nå.

Et mulig mellomsteg uten migrasjon er å sende `p_categories = null` og bruke `p_category_facets`. Det virker ikke, fordi filteret er `p_categories is null OR …` og da slår fasettleddet aldri inn. Et ekstra kall med en kategori som ikke finnes, ville teknisk truffet bare fasetten, men da må to lister med hver sin markør flettes. Det frarår jeg.

### b) Kan «Kan ha aldersgrense. Sjekk med stedet.» løses som en fasett i detaljarket, uten migrasjon?

**Ja.** `facets` er `text[]` uten begrensning på verdiene (migrasjon 0016), og API-et sender kolonnen allerede i alle tre endepunktene. Ingen migrasjon trengs.

**I togedoo-web:**
- Et nytt token i `FACET_TOKENS` og `SEED_ONLY_FACETS`, for eksempel `aldersgrense`. Tokenet er ASCII og oversettes aldri, som de andre.
- Tokenet settes på seed-radene det gjelder.
- `scripts/facets.test.ts` krever at hvert seed-token brukes av minst én seed-rad. Det er oppfylt når raden finnes.
- Tokenet skal **ikke** stå i `FASETT_SOM_KATEGORI`. Det er ingen kategori.

**I appen (togedoo-modern, bare lest):**
- `DatahubPlace.facets` er allerede parset.
- Detaljarket (`lib/widgets/place_detail_sheet.dart`) viser i dag underlag og belysning fra OSM-taggene som egne `_InfoRow`-er, men viser ikke fasetter. Det trengs én ny `_InfoRow` når `place.facets.contains('aldersgrense')`, med teksten i appen.
- Teksten hører hjemme i appen, samme skille som mellom kategorinøkkel og etikett. Da kan den oversettes.
- Filterarket viser bare fasetter som står i `ExploreFilter.facetGroupsByCategory`. Tokenet blir derfor ingen filterpille, med mindre noen legger det inn der.

**Det du bør vite:**
- En fasett er i dag et svar på «hva er stedet, eller hva har det». En merknad er noe annet. Det virker teknisk, men blander to ting i samme kolonne.
- Merknaden kan heller ikke si *når*. «Familietid på dagtid» krever egne felt (kandidat-dokumentet del 5) eller en setning i beskrivelsen, slik som i del 6.
- Blir det flere merknader, er en egen kolonne ryddigere. Den krever migrasjon.

## Ikke gjort, og ting jeg ikke vet

- **Ikke gjort:** ingen kode, ingen seed, ingen claim, ingen migrasjon, ingen skriving til basen, ingen søkemotor og ingen Facebook.
- **Om stedene er i drift i 2026** er bare bekreftet for Megazone Oslo (stengte dager for 2026) og NMK Halsa (drop-in i dag). For de andre har sidene priser, bestilling og åpningstider, men uten dato.
- **Alder og skjenking i Stavanger** fant jeg ikke. Spørsmål-og-svar-siden der har ingen lesbar tekst. Jeg har ikke overført svarene fra Oslo og Bergen.
- **Inngangen** er bare beskrevet av Megazone Oslo, og den er ikke funnet i OSM. De andre punktene er adresser, ikke dører.
- **Næringskodene i del 3** er ikke slått opp i KLASS.
- **Innbyggertallene** er OSM sine, og ikke sammenlignet med SSB.
- **The Cube** (Oslo, Bergen, Stavanger) og **lasertag hos Lucky Bowl Ålesund** er funnet på egne nettsider, men ikke kontrollert. De hører til senere puljer.

## Slik ble det laget

- **Gokart:** `op/karting.json` fra målingen (datastand 19.09.2026 kl. 12:52 UTC), slått sammen innen 400 m. Navn på navnløse baner er slått opp innen 500 m i Overpass.
- **Kommune og fylke:** Overpass `is_in` for alle 166 kandidater. Kommuner og fylker med innbyggertall er hentet med `rel[boundary=administrative][admin_level~"^(4|7)$"]`, 382 relasjoner.
- **Adresser og innganger:** Overpass-oppslag på adressen fra nettsiden (`addr:street` og `addr:housenumber` innen 6 km), og `entrance=*` innen 120 m.
- **Nettsider:** hentet med `curl`, `User-Agent: Togedoo datahub (hello@togedoo.com)`, 2 s pause mellom sidene. I alt 42 sider fra 16 vertsnavn, alle 19.09.2026. bowling1.no/trondheim sendte videre til luckybowl.no. Teksten er lest lokalt. Bare mine egne oppsummeringer står i dokumentet.
