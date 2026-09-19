# Spill og moro: kandidater for runde én

**Status:** kandidatliste (19.09.2026), bygget på målingen i
[spill-og-aktivitet-maling.md](spill-og-aktivitet-maling.md) (a5c097d). Ingen
kode er endret, og ingenting er skrevet til basen. Basen er bare lest
(rad-id-ene i del 6). OSM er lest fra Overpass med Togedoo-identiteten. Ingen
andre tredjepartskall: nettsidene er **ikke** åpnet.

Beslutningene fra Frederik som lista bygger på:

- Kategorien heter **Spill og moro**.
- Fasetter: `bowling`, `lasertag`, `escaperom`, `spillehall`, `minigolf`.
  Escape room og steder av typen «Fangene på fortet» er med.
- Minigolf: faste anlegg med navn som er åpne for alle, er med nå. Navnløse
  baner ved camping og hotell venter til runde to.
- Biljard, dart, shuffleboard og bingo er ikke med.

## Kort svar

| Fasett | Kandidater | Klare | Sjekk | Droppes |
|---|---|---|---|---|
| Bowling | 76 (66 fra taggene, 10 bare på navn) | 30 | 29 | 17 |
| Lasertag | 3 | 3 | 0 | 0 |
| Escape room | 14 | 8 | 5 | 1 |
| Spillehall | 12 (11 + VR Games Zone, flyttet fra escape room) | 3 | 4 | 5 |
| Minigolf | 37 (33 med navn fra taggene, 4 bare på navn) | 16 | 8 | 13 |
| **Til sammen** | **142** | **60** | **46** | **36** |

- **Klar:** Det er et fast sted med navn, det står ikke noe i OSM som tyder på
  alkohol eller aldersgrense, og jeg har ikke funnet en dublett.
- **Sjekk:** Stedet kan være riktig, men noe må avklares for hånd før det
  seedes. Det kan være skjenking, aldersgrense på kveldstid, om stedet er åpent
  for alle, eller hva stedet egentlig er.
- **Dropp:** Dublett, bar, del av et sted vi allerede har kuratert, privat,
  navnløst ved camping, eller ikke den typen sted.

Av stedene Frederik kjenner til, finnes **Oslo Camping**, **Underground
(Majorstua)** og **Fangene på fortet** (Oslo, Bergen, Stavanger) i OSM.
**Lucky Duck** og **minigolfen på Veierland** mangler og må legges inn for hånd.

Det finnes **ikke noe felt for alder** i datamodellen i dag (del 5).

## Slik er flaggene og statusen satt

Flaggene er de samme som i målingen, regnet ut for hver rad:

| Flagg | Regel |
|---|---|
| `selv pub`/`bar` | Objektet har selv `amenity=pub`, `bar`, `nightclub` eller `biergarten` |
| utested ≤ 30 m | Et annet objekt med en slik tagg ligger innen 30 m, målt i luftlinje. **Grovt:** i en bykjerne treffer det også naboen |
| overnatting ≤ 250 m | Nærmeste `tourism=camp_site`, `caravan_site`, `hotel`, `guest_house`, `hostel`, `chalet`, `motel` eller `resort`. **Grovt:** i byer er det nesten alltid et hotell innen 250 m. Flagget betyr bare noe når stedet ligger *på* campingplassen eller hotellet |
| åpent til midnatt eller senere | `opening_hours` har en sluttid på 24:00 eller mellom 00:00 og 05:59. Det tyder på skjenking. Alle slike rader er satt til «sjekk» |
| `access=…` | `access=private` eller `customers` |
| bare funnet på navn | Ikke fanget av taggene, bare av navnesøket i målingen |

Nettadressen er `website`, eller `contact:website` der `website` mangler.
Kommunen er slått opp i Overpass (`is_in`, `admin_level=7`). Koordinaten er
punktet, eller midtpunktet for flater.

**Viktig:** «Klar» betyr klar *ut fra OSM*. Ingen nettsider er åpnet. Jeg vet
ikke om stedene er i drift, og jeg vet ikke om de har aldersgrense. En
bowlinghall uten sen åpningstid kan fortsatt ha 18-årsgrense etter kl. 20.

## 1–2. Kandidatlistene

### Bowling (76: 30 klare, 29 til sjekk, 17 droppes)

| Status | Navn | Kommune | OSM | Koordinat | Nettadresse | Flagg | Begrunnelse |
|---|---|---|---|---|---|---|---|
| Sjekk | Sletterkulo Bowling | Alstahaug | `way/547492908` | 66.02169, 12.63354 | – | overnatting ≤ 250 m: hotel «Scandic Syv Søstre» 221 m | Tagget som parkeringshus. Sjekk at hallen finnes |
| Sjekk | Alta Bowling og Sportspub | Alta | `node/2180077935` | 69.96391, 23.27226 | – | utested ≤ 30 m: pub «Alta Bowling og Sportspub» 5 m; overnatting ≤ 250 m: hotel «Thon Hotel Alta» 139 m; åpent til midnatt eller senere | Bowling og sportspub i ett. Sjekk skjenking og aldersgrense |
| Dropp | Alta Bowling og Sportspub | Alta | `node/3649751057` | 69.96389, 23.27215 | – | bare funnet på navn; selv pub; overnatting ≤ 250 m: hotel «Thon Hotel Alta» 140 m; åpent til midnatt eller senere | Dublett av raden over (samme sted, 5 m), tagget som pub |
| **Klar** | Arendal Bowling | Arendal | `node/7434439452` | 58.45859, 8.76629 | <https://www.bowlinga.no/> | overnatting ≤ 250 m: hotel «Thon Hotel Arendal» 30 m | – |
| Dropp | Arendal Bowling | Arendal | `node/13948657223` | 58.45867, 8.76607 | – | bare funnet på navn; overnatting ≤ 250 m: hotel «Thon Hotel Arendal» 36 m; åpent til midnatt eller senere | Dublett av Arendal Bowling (16 m), uten tagger |
| **Klar** | Bergen Bowling | Bergen | `node/4184113169` | 60.29263, 5.28397 | – | – | – |
| **Klar** | Bowling 1 Vestkanten | Bergen | `node/4183728790` | 60.36263, 5.2356 | – | – | – |
| **Klar** | Lucky Bowl Kokstad | Bergen | `node/5794164454` | 60.2941, 5.2539 | – | – | – |
| Sjekk | Musikkhallen | Bjørnafjorden | `way/844035814` | 60.16842, 5.30748 | – | – | Heter «Musikkhallen». Uklart om det er en bowlinghall |
| Sjekk | Royal Bowling & Biljard | Bodø | `node/2160774670` | 67.2822, 14.37469 | – | utested ≤ 30 m: bar «Top 13» 14 m; overnatting ≤ 250 m: hotel «Radisson Blu Hotel Bodø» 17 m; åpent til midnatt eller senere | Bar 14 m unna, har biljard og er åpen til 01 |
| Sjekk | Sandvika Bowling | Bærum | `node/13356275399` | 59.89255, 10.52719 | <https://www.sandvikabowling.no/> | åpent til midnatt eller senere | Åpen til midnatt eller senere. Sjekk aldersgrense på kveldstid |
| Sjekk | Bowling1 Megazone | Drammen | `node/3493097117` | 59.7331, 10.20936 | <https://bowling1.no/drammen/kontakt/> | åpent til midnatt eller senere | Åpen til 01 fredag og lørdag. Sjekk aldersgrense på kveldstid |
| **Klar** | Lucky bowl | Drammen | `node/3802731702` | 59.75226, 10.12905 | <https://www.luckybowl-drammen.no/> | – | – |
| Sjekk | O'learys Drammen | Drammen | `node/10168873125` | 59.74417, 10.20329 | <https://olearys.no/drammen/> | åpent til midnatt eller senere | O'Learys er et restaurant- og sportsbarkonsept. Sjekk skjenking og aldersgrense |
| **Klar** | Elverum Bowling | Elverum | `node/3402830062` | 60.87817, 11.57664 | – | – | – |
| **Klar** | Evje Bowling | Evje og Hornnes | `node/12042021855` | 58.58402, 7.79948 | – | – | – |
| **Klar** | Route 8 Bowling | Farsund | `node/1791718331` | 58.08794, 6.70042 | – | – | – |
| Sjekk | Kulå Bowling | Fjord | `node/1295799167` | 62.2984, 7.25593 | <https://www.kula.no/> | bare funnet på navn; utested ≤ 30 m: pub «Kulå Bowling» 10 m; overnatting ≤ 250 m: camp_site «Muri Hytteutleige og camping» 121 m | Samme sted som puben under. Sjekk skjenking og aldersgrense |
| Dropp | Kulå Bowling | Fjord | `node/1295799169` | 62.29841, 7.25574 | – | bare funnet på navn; selv pub; overnatting ≤ 250 m: camp_site «Muri Hytteutleige og camping» 113 m | Dublett (10 m), tagget som pub |
| Sjekk | Bowling1 Gjøvik | Gjøvik | `node/488515651` | 60.80892, 10.68201 | – | åpent til midnatt eller senere | Åpen til midnatt fredag og lørdag. Sjekk aldersgrense på kveldstid |
| Sjekk | Lucky Bowl Halden | Halden | `node/11971402445` | 59.1212, 11.3751 | <https://luckybowl.no/halden/> | overnatting ≤ 250 m: caravan_site «uten navn» 242 m; åpent til midnatt eller senere | Åpen til midnatt eller senere. Sjekk aldersgrense på kveldstid |
| **Klar** | Hammerfest Bowling | Hammerfest | `node/5826870229` | 70.6645, 23.67905 | – | overnatting ≤ 250 m: caravan_site «Hammerfest havn» 184 m | – |
| **Klar** | Sheiken Bowling | Haugesund | `node/2116848331` | 59.40239, 5.29271 | – | – | – |
| Dropp | (uten navn) | Hemsedal | `node/1721143012` | 60.86251, 8.52143 | – | – | Uten navn, 138 m fra Flyn’ Duck. Trolig samme anlegg |
| Sjekk | Flyn’ Duck Bowling | Hemsedal | `node/13716221975` | 60.86256, 8.51888 | – | – | Drives av O'Learys Hemsedal. Sjekk skjenking og aldersgrense |
| Sjekk | (uten navn) | Hitra | `node/11408422041` | 63.60236, 8.97873 | – | overnatting ≤ 250 m: hotel «Hjorten hotell Hitra» 126 m | Uten navn, 126 m fra et hotell. Sjekk om den er åpen for alle |
| Dropp | Bowling | Hol | `node/4872064324` | 60.52209, 8.19606 | – | bare funnet på navn; overnatting ≤ 250 m: hotel «Vestlia Hotel» 53 m | Dublett av Vestlia-raden (77 m), uten tagger |
| Sjekk | Bowling - Vestlia Hotel | Hol | `node/8956376392` | 60.52168, 8.19719 | – | overnatting ≤ 250 m: hotel «Vestlia Hotel» 83 m | Hotellbowling. Sjekk om den er åpen for alle |
| Dropp | Kongsberghallen | Kongsberg | `way/123813502` | 59.68047, 9.63194 | <https://kongsberghallen.no/> | – | Flerbrukshall (multi), riktig som Idrettshall. Bowlingen er Lucky Bowl Kongsberg, 38 m unna |
| **Klar** | Lucky Bowl Kongsberg | Kongsberg | `node/13406772533` | 59.68061, 9.63132 | <https://luckybowl.no/kongsberg/> | – | – |
| **Klar** | Bowling 1 Kongsvinger | Kongsvinger | `node/12057597717` | 60.1928, 12.00131 | – | – | – |
| Dropp | (uten navn) | Kristiansand | `way/177552732` | 58.15781, 8.02596 | – | overnatting ≤ 250 m: guest_house «Rogligheten» 116 m | Uten navn, 24 m fra Lucky Bowl Kristiansand. Samme sted |
| **Klar** | Hannevika Bowling | Kristiansand | `node/5896693187` | 58.13621, 7.95984 | <http://www.hannevikabowling.no/> | – | – |
| **Klar** | Lucky Bowl Kristiansand | Kristiansand | `node/6434471914` | 58.15792, 8.02561 | – | overnatting ≤ 250 m: guest_house «Rogligheten» 140 m | – |
| **Klar** | Mester'n Bowling | Larvik | `node/6484453025` | 59.04464, 10.07623 | <https://www.mesternbowling.no/> | – | – |
| **Klar** | Levanger Bowling | Levanger | `way/179849104` | 63.73984, 11.27936 | – | overnatting ≤ 250 m: caravan_site «Levanger Camping & Fritidspark Moan AS» 55 m | – |
| Sjekk | Bowling1 Strømmen | Lillestrøm | `node/3163001945` | 59.94803, 11.00564 | <http://www.bowling1.no/strømmen> | åpent til midnatt eller senere | Åpen til 02 fredag og lørdag. Sjekk aldersgrense på kveldstid |
| **Klar** | Lucky Strike Bowlingsenter | Lyngdal | `way/542927531` | 58.13809, 7.03499 | – | – | – |
| Dropp | Lucky Strike Bowlingsenter AS | Lyngdal | `node/13812187821` | 58.13801, 7.03458 | – | bare funnet på navn; åpent til midnatt eller senere | Dublett av Lucky Strike (26 m), uten tagger |
| Sjekk | Metro Bowling | Lørenskog | `node/2724280947` | 59.92712, 10.95615 | <http://www.metrobowling.no/vaare-haller/lorenskog/kom-i-gang-om-oss> | overnatting ≤ 250 m: guest_house «uten navn» 227 m; åpent til midnatt eller senere | Åpen til midnatt eller senere. Sjekk aldersgrense på kveldstid |
| Sjekk | (uten navn) | Midt-Telemark | `node/13439603328` | 59.41403, 9.06413 | <https://olearys.com/no-no/boe/activities/bowling/> | overnatting ≤ 250 m: hotel «Bø Vertshus» 71 m | Uten navn. Nettadressen er O'Learys Bø. Sjekk skjenking og aldersgrense |
| Sjekk | Bryggeslottet Bowling | Modalen | `node/10054626402` | 60.81369, 5.80351 | – | – | Uklart hva Bryggeslottet er. Sjekk at stedet er åpent for alle |
| **Klar** | Panorama Bowling | Molde | `node/9937316082` | 62.73871, 7.19543 | <https://panoramabowling.no/> | – | – |
| Sjekk | Bowling1 Moss | Moss | `node/11386502351` | 59.41471, 10.68338 | <https://bowling1.no/> | åpent til midnatt eller senere | Åpen til midnatt eller senere. Sjekk aldersgrense på kveldstid |
| Sjekk | Narvik Bowling | Narvik | `node/2353469917` | 68.44006, 17.42156 | <http://www.narvikbowling.no/> | selv pub; overnatting ≤ 250 m: guest_house «Spor 1 Gjestegård» 163 m; åpent til midnatt eller senere | Tagget som pub, åpen til 01. Sjekk skjenking og aldersgrense |
| **Klar** | Bowlingen Orkla AS | Orkland | `node/5274467811` | 63.29587, 9.84986 | – | – | – |
| Dropp | Billi Bob's | Oslo | `node/4739354645` | 59.91678, 10.75267 | <https://billybobs.no> | selv bar; utested ≤ 30 m: pub «Oche» 19 m; overnatting ≤ 250 m: hotel «Comfort Hotel Xpress» 180 m | Tagget som bar, med en dartpub 19 m unna |
| Sjekk | Oslo bar & bowling | Oslo | `node/5505509239` | 59.91581, 10.75064 | <https://www.oslobowling.no/> | utested ≤ 30 m: bar «Oslo Bar & Bowling» 5 m; overnatting ≤ 250 m: hotel «Comfort Hotel Xpress» 93 m; åpent til midnatt eller senere | Heter «bar & bowling», og samme sted er tagget som bar. Trolig dropp |
| Dropp | Oslo Bar & Bowling | Oslo | `node/4157612842` | 59.91578, 10.7507 | – | bare funnet på navn; selv bar; overnatting ≤ 250 m: hotel «Comfort Hotel Xpress» 97 m | Dublett av raden over (5 m), tagget som bar |
| Sjekk | Solli Bowling | Oslo | `node/9439871453` | 59.91403, 10.71882 | <https://www.sollibowling.no> | overnatting ≤ 250 m: hotel «Scandic Solli» 147 m; åpent til midnatt eller senere | Åpen til midnatt eller senere. Sjekk aldersgrense på kveldstid |
| **Klar** | Veitvet Bowling | Oslo | `node/2980082478` | 59.94409, 10.84747 | – | – | – |
| **Klar** | Hønefoss Bowling | Ringerike | `node/13348563150` | 60.17479, 10.25933 | <https://honefossbowling.no/> | – | – |
| Sjekk | bowling | Sandefjord | `node/845163697` | 59.13335, 10.1778 | – | bare funnet på navn | Bare navnet «bowling», ingen tagger. Sjekk om stedet finnes |
| **Klar** | Lucky Bowl Sandnes | Sandnes | `node/7184185384` | 58.85448, 5.7516 | – | – | – |
| **Klar** | Sarpsborg Bowlingsenter | Sarpsborg | `node/3336878606` | 59.27743, 11.09605 | – | – | – |
| Dropp | (uten navn) | Stavanger | `way/1249273457` | 58.91528, 5.73516 | – | – | Uten navn, leisure=pitch i en park. Trolig kulespill ute |
| Dropp | (uten navn) | Stavanger | `way/1249273458` | 58.91529, 5.73516 | – | – | Som over |
| Dropp | (uten navn) | Stavanger | `way/1249273459` | 58.91533, 5.73515 | – | – | Som over |
| Dropp | (uten navn) | Stavanger | `way/1249273460` | 58.91534, 5.73515 | – | – | Som over |
| Sjekk | Harbour Bowl | Stavanger | `node/449399614` | 58.97144, 5.73143 | – | utested ≤ 30 m: bar «HoT Open Mind» 27 m, nightclub «Hexagon» 9 m, pub «Cardinal» 18 m; overnatting ≤ 250 m: hotel «Home Hotel Skagen Brygge» 100 m | På Skagen, 9 m fra en nattklubb og 18 m fra en pub. Sjekk skjenking og aldersgrense |
| **Klar** | Lucky Bowl Mariero AS | Stavanger | `node/506025410` | 58.93561, 5.74272 | – | – | To Lucky Bowl i Stavanger, 1,4 km fra hverandre. Sjekk at begge er i drift |
| **Klar** | Lucky bowl, Stavanger | Stavanger | `node/1474258925` | 58.9444, 5.72733 | <https://www.luckybowl.no/stavanger-luckybowl> | – | – |
| **Klar** | Bowl it | Stord | `node/10228589203` | 59.76486, 5.46328 | – | – | – |
| **Klar** | Strand Bowling & Cafè | Strand | `node/809251906` | 59.01874, 6.04267 | – | overnatting ≤ 250 m: caravan_site «uten navn» 172 m | – |
| Sjekk | Stadion Bowling | Time | `node/11099712296` | 58.72978, 5.64888 | <https://www.stadion-bowling.no> | åpent til midnatt eller senere | Åpen til midnatt eller senere. Sjekk aldersgrense på kveldstid |
| Dropp | (uten navn) | Trondheim | `node/3370641794` | 63.33039, 10.3491 | – | – | Uten navn, 20 m fra Bowling1 & Gocart. Samme sted |
| Sjekk | Bowling1 & Gocart | Trondheim | `node/807246866` | 63.33057, 10.34911 | <https://www.bowling1.no/trondheim> | åpent til midnatt eller senere | Åpen til 01 fredag og lørdag. Sjekk aldersgrense på kveldstid. Har også gokart |
| Dropp | Bowling1 Trondheim | Trondheim | `way/87984993` | 63.33058, 10.34899 | – | bare funnet på navn | Bygningen til Bowling1 & Gocart (6 m) |
| Sjekk | Centrum Bowling | Trondheim | `way/686919139` | 63.42973, 10.39385 | <https://centrumbowling.no/> | overnatting ≤ 250 m: hotel «Thon Hotel Trondheim» 82 m; åpent til midnatt eller senere | Åpen til 02 fredag og lørdag. Sjekk skjenking og aldersgrense |
| Sjekk | Dora 1 Bowling & Biljard | Trondheim | `node/1826453701` | 63.44001, 10.42067 | – | overnatting ≤ 250 m: caravan_site «Dora bobilplass» 229 m | Har biljard. Sjekk skjenking |
| **Klar** | Kilden Bowling | Tønsberg | `node/6370806782` | 59.27396, 10.43597 | – | – | – |
| **Klar** | Vallø Bowling | Tønsberg | `node/5283500330` | 59.26064, 10.49117 | – | – | – |
| Sjekk | Gravdal Bowlingsenter | Vestvågøy | `node/5741870259` | 68.12447, 13.54009 | <http://www.gravdalbowlingsenter.no/> | utested ≤ 30 m: bar «uten navn» 10 m; åpent til midnatt eller senere | Bar 10 m unna, har biljard og er åpen til 01. Sjekk skjenking |
| Sjekk | Voss Bowling | Voss | `node/9937478172` | 60.62794, 6.42565 | <https://www.vossbowling.no/> | åpent til midnatt eller senere | Åpen til midnatt eller senere. Sjekk aldersgrense på kveldstid |
| **Klar** | Svolvaer Bowling Center | Vågan | `node/12115400760` | 68.23208, 14.55834 | – | overnatting ≤ 250 m: hotel «Fast Hotel Svolvær» 220 m | – |
| Dropp | Bowling | Ås | `node/1360442046` | 59.74888, 10.77804 | – | bare funnet på navn | Inne i Tusenfryd, som er kuratert og claimet |

### Lasertag (3: 3 klare, 0 til sjekk, 0 droppes)

| Status | Navn | Kommune | OSM | Koordinat | Nettadresse | Flagg | Begrunnelse |
|---|---|---|---|---|---|---|---|
| **Klar** | Megazone | Bergen | `node/7197772245` | 60.3814, 5.31763 | – | – | Erstatter OSM-raden i Idrettshall |
| **Klar** | Megazone | Oslo | `node/4736654480` | 59.91612, 10.74927 | <https://www.megazone.no/> | overnatting ≤ 250 m: hotel «Comfort Hotel Xpress» 36 m | Erstatter OSM-raden i Idrettshall |
| **Klar** | Lykkeland Lekepark | Steinkjer | `node/12078177859` | 64.00766, 11.49541 | <https://lykkelandsteinkjer.no/> | – | Lekepark med bowling og lasertag. Hovedkategori bør vurderes (Innendørs lekeland med fasetter?) |

### Escape room (14: 8 klare, 5 til sjekk, 1 droppes)

| Status | Navn | Kommune | OSM | Koordinat | Nettadresse | Flagg | Begrunnelse |
|---|---|---|---|---|---|---|---|
| Dropp | Escape Bryggen | Bergen | `node/14162383790` | 60.39406, 5.32365 | – | overnatting ≤ 250 m: hotel «Scandic Torget Bergen» 26 m | Dublett av Escape Bryggen (Skuteviksbodene), uten nettadresse |
| **Klar** | Escape Bryggen Skuteviksbodene 13 | Bergen | `node/3963345607` | 60.40324, 5.32104 | <https://www.escapebryggen.no/> | overnatting ≤ 250 m: guest_house «uten navn» 116 m | – |
| **Klar** | Fangene på fortet | Bergen | `node/7197772246` | 60.38145, 5.31766 | – | – | Samme adresse som Megazone Bergen |
| **Klar** | We Escape | Molde | `node/6961667940` | 62.73741, 7.16021 | <https://weescape.no/> | overnatting ≤ 250 m: hotel «Hotell Molde» 195 m | – |
| **Klar** | Fangene på fortet | Oslo | `node/9724313095` | 59.94963, 10.76358 | <https://oslo.fangenepafortet.no/> | overnatting ≤ 250 m: hotel «Radisson Blu Hotel Nydalen» 155 m | – |
| **Klar** | Perfect Escape | Oslo | `node/11971724862` | 59.91069, 10.73871 | – | overnatting ≤ 250 m: hotel «Radisson RED Oslo City Centre, A Verified Net Zero Hotel» 122 m | – |
| Sjekk | The Escape games | Oslo | `node/2785920355` | 59.91078, 10.74444 | – | utested ≤ 30 m: pub «Ostara bar» 3 m; overnatting ≤ 250 m: hotel «Bob W. ZSentralen» 88 m | Pub 3 m unna. Sjekk om det er samme lokale |
| Sjekk | Ibsen Escape | Skien | `node/10606960210` | 59.23968, 9.57758 | <https://www.telemarkmuseum.no/utstillinger/ibsen-escape-room/> | – | Del av Telemark Museum. Sjekk om den er permanent |
| **Klar** | Fangene på Fortet | Stavanger | `node/14143229452` | 58.96014, 5.73827 | – | – | – |
| Sjekk | Reality Adventures | Trondheim | `node/8936904783` | 63.43399, 10.39806 | <https://realityadventures.no/> | utested ≤ 30 m: pub «Lille London» 7 m; overnatting ≤ 250 m: hotel «Astoria» 62 m | Pub 7 m unna. Tre noder med samme navn i Trondheim. Sjekk hvilke adresser som er i drift |
| Sjekk | Reality Adventures | Trondheim | `node/9469113040` | 63.42848, 10.39246 | <https://realityadventures.no> | overnatting ≤ 250 m: hotel «Comfort Hotel Park» 92 m | Se raden over |
| Sjekk | Reality Adventures | Trondheim | `node/9469113041` | 63.43192, 10.38648 | <https://realityadventures.no> | overnatting ≤ 250 m: guest_house «Pensjonat Jarlen» 193 m | Se raden over |
| **Klar** | The Escape Room Tønsberg | Tønsberg | `node/10594078978` | 59.27624, 10.39817 | <https://www.theescaperoom.no/> | overnatting ≤ 250 m: caravan_site «Korten Bobilparkering» 118 m | – |
| **Klar** | Lofoten Escape & Adventures | Vågan | `node/10255475748` | 68.23421, 14.56086 | <https://www.lofotenescape.no> | – | – |

### Spillehall (12: 3 klare, 4 til sjekk, 5 droppes)

| Status | Navn | Kommune | OSM | Koordinat | Nettadresse | Flagg | Begrunnelse |
|---|---|---|---|---|---|---|---|
| Sjekk | HITZONE FUNCENTER | Bjørnafjorden | `node/9235183594` | 60.20171, 5.45682 | – | – | Ingen nettadresse eller åpningstid. Sjekk hva stedet er |
| **Klar** | Bodø Actionhall | Bodø | `node/6968694304` | 67.28346, 14.37881 | – | overnatting ≤ 250 m: hotel «Clarion Collection Hotel Grand Bodø» 64 m | – |
| Dropp | Barkaden Drammen | Drammen | `node/10114982994` | 59.74323, 10.19289 | <https://www.barkaden.no/> | overnatting ≤ 250 m: hotel «Comfort Hotel Union Brygge» 93 m | Barkonsept («Barkaden») |
| Dropp | (uten navn) | Kinn | `node/13404021579` | 61.59311, 5.07063 | – | overnatting ≤ 250 m: camp_site «Krokane Camping» 18 m | Uten navn, på Krokane Camping. Venter til runde to |
| Sjekk | Skjærgårdsgaming | Lurøy | `way/1007209868` | 66.3616, 12.58732 | – | – | Tagget på et boligbygg. Sjekk at stedet finnes |
| Dropp | Chiruto | Oslo | `node/13041246025` | 59.91713, 10.73995 | – | utested ≤ 30 m: bar «Chiruto San» 28 m; overnatting ≤ 250 m: hotel «Clarion Collection Hotel Savoy» 106 m; åpent til midnatt eller senere | Bar 28 m unna med samme navn («Chiruto San»), åpen til 01 |
| Sjekk | House of Nerds | Oslo | `node/10204324977` | 59.92186, 10.75146 | <https://houseofnerds.no> | utested ≤ 30 m: bar «Søvnløs Bar» 11 m; overnatting ≤ 250 m: hotel «Scandic Hotel» 49 m | Bar 11 m unna, stengt mandag til onsdag. Sjekk om det er en spillbar |
| **Klar** | VR Games Zone | Oslo | `node/13672664109` | 59.92538, 10.77464 | <https://www.vrgames.no/no/> | – | Er VR-spill, ikke escape room. Fasett spillehall, ikke escaperom |
| Sjekk | Skyland | Sandnes | `node/9376960970` | 58.84116, 5.73348 | – | – | Ingen nettadresse. Sjekk hva stedet er |
| Dropp | Pizzabakeren Stord | Stord | `node/10233273357` | 59.78194, 5.49855 | – | overnatting ≤ 250 m: hotel «Gamle Fengselet Kulturhotell» 109 m | Pizzarestaurant, ikke spillehall |
| **Klar** | Trondheim Bilbane Center | Trondheim | `node/6126494740` | 63.42077, 10.46664 | <https://www.tbbc.no/> | – | – |
| Dropp | Work-Work | Trondheim | `node/3985714096` | 63.43285, 10.39328 | <https://work-work.no/> | utested ≤ 30 m: bar «Work-Work» 3 m; overnatting ≤ 250 m: hotel «City Living Schøller hotel» 146 m; åpent til midnatt eller senere | Bar med spill (bar 3 m unna, samme navn) |

### Minigolf (37: 16 klare, 8 til sjekk, 13 droppes)

| Status | Navn | Kommune | OSM | Koordinat | Nettadresse | Flagg | Begrunnelse |
|---|---|---|---|---|---|---|---|
| Sjekk | Hønshuset | Minigolf | Alstahaug | `way/947340054` | 65.98071, 12.57255 | – | – | Uklart om det er et fast, åpent anlegg |
| Dropp | Alltid Opplett | Bergen | `node/2710063385` | 60.39533, 5.31842 | – | selv bar; overnatting ≤ 250 m: hotel «Hotel Heimen» 54 m | Tagget som bar |
| **Klar** | Bratten Aktivitetspark | Bodø | `way/613783702` | 67.30823, 14.41117 | – | – | Kommunal aktivitetspark |
| **Klar** | Majorens golf | Fredrikstad | `node/7724422073` | 59.20088, 10.96241 | – | overnatting ≤ 250 m: camp_site «Fredrikstad Motel & Camping» 159 m | – |
| **Klar** | Grimstad minigolf | Grimstad | `way/715569884` | 58.34156, 8.59559 | <https://www.facebook.com/grimstadminigolf/> | overnatting ≤ 250 m: hotel «Clarion Collection Grimstad» 179 m | – |
| **Klar** | Byparken Minigolf | Halden | `node/14084347823` | 59.11943, 11.38436 | – | overnatting ≤ 250 m: hotel «Grand Hotell» 115 m | – |
| Sjekk | Out of Bounds minigolf | Hamar | `node/4818743965` | 60.79516, 11.07028 | <http://hamarminigolf.no> | utested ≤ 30 m: bar «Ballroom» 21 m; åpent til midnatt eller senere | Bar 21 m unna. Sjekk skjenking |
| Dropp | Minigolf | Larvik | `way/696667335` | 59.00395, 9.97023 | – | access=customers | Inne i Foldvik Familiepark (access=customers), som er kuratert og claimet |
| Dropp | Omlidstranda Camping | Larvik | `way/433019993` | 58.98457, 9.84503 | – | overnatting ≤ 250 m: camp_site «Omlidstranda Camping» 74 m | På campingplass. Venter til runde to |
| **Klar** | Folkeparken minigolf | Lier | `way/1209721864` | 59.78432, 10.24304 | – | – | – |
| Dropp | Minigolf Hunderfossen | Lillehammer | `way/274826415` | 61.22684, 10.43609 | – | – | Inne i Hunderfossen, som er kuratert og claimet |
| Dropp | Biljardgolfa | Lillesand | `node/7716543835` | 58.2148, 8.38403 | – | overnatting ≤ 250 m: camp_site «Justøyfamiliens Bibelcamping» 67 m | På en bibelcamping. Venter til runde to |
| Dropp | Skottevik feriesenter | Lillesand | `way/1167623034` | 58.12504, 8.2309 | – | overnatting ≤ 250 m: camp_site «Skottevik Feriesenter» 67 m | Feriesenter. Venter til runde to |
| Dropp | Klubben camping og minigolf | Lund | `relation/12162346` | 58.43992, 6.60047 | <https://www.facebook.com/klubbenminigolf> | bare funnet på navn; overnatting ≤ 250 m: camp_site «Klubben camping og minigolf» 0 m | Campingplassen. Minigolfen er egen rad under |
| **Klar** | Klubben minigolf | Lund | `way/566201626` | 58.43993, 6.5988 | <http://www.lund.kommune.no/klubben-minigolf-aapnet-paa-loerdag.4894473-172069.html> | overnatting ≤ 250 m: camp_site «Klubben camping og minigolf» 97 m | Kommunen omtaler den som åpen for alle |
| **Klar** | Golfen | Oslo | `way/845593306` | 59.89012, 10.70985 | <https://www.facebook.com/people/Lindøen-Golfclub-minigolfen-på-Lindøya/100068159491976/> | – | På Lindøya. Sesong og båt |
| **Klar** | Grünerløkka Minigolf park | Oslo | `way/44044598` | 59.91844, 10.75879 | – | overnatting ≤ 250 m: hotel «Anker Hotel» 103 m | Hotellet 103 m unna er uten betydning |
| **Klar** | Marienlyst minigolfbane | Oslo | `way/183864424` | 59.93251, 10.72267 | <https://www.aktivioslo.no/presentasjon/marienlyst-minigolf-club/> | – | – |
| Sjekk | Oslo Camping | Oslo | `node/4958723297` | 59.91456, 10.74733 | <https://www.campingen.no/oslo> | selv pub; overnatting ≤ 250 m: hotel «Home Hotel Folketeateret» 193 m; åpent til midnatt eller senere | Tagget som pub. Innendørs minigolf i et barkonsept (campingen.no). Trolig aldersgrense. Trolig dropp |
| **Klar** | Søylehuset cafe og minigolf | Oslo | `way/546585178` | 59.89133, 10.77587 | <https://www.minigolf.no/> | – | – |
| Dropp | Søylehuset Café og Minigolf | Oslo | `way/119156613` | 59.89159, 10.77511 | – | bare funnet på navn | Dublett av Søylehuset (51 m), tagget som kafé |
| **Klar** | Torshov minigolfpark | Oslo | `way/72563100` | 59.93397, 10.76881 | <http://minigolfparken.no/> | – | – |
| Dropp | Torshov Minigolfpark | Oslo | `way/801539736` | 59.93407, 10.76852 | – | bare funnet på navn | Kiosken på Torshov minigolfpark (20 m) |
| Sjekk | Underground Golf Club Majorstua | Oslo | `node/12966945763` | 59.92606, 10.71976 | – | overnatting ≤ 250 m: hotel «Saga Apartments Oslo» 159 m | Innendørs. Uklart om det er et barkonsept. Sjekk skjenking og aldersgrense |
| Sjekk | Glowing Golf | Sandnes | `node/11158901641` | 58.87727, 5.72363 | <https://www.glowinggolf.no/> | overnatting ≤ 250 m: hotel «Smarthotel Forus» 179 m | Innendørs. Sjekk skjenking og aldersgrense |
| **Klar** | Sporty Aktivitetssenter Minigolf | Sarpsborg | `way/110063546` | 59.18917, 11.1899 | – | overnatting ≤ 250 m: camp_site «Høysand Camping» 146 m | Aktivitetssenter, ikke bare for campinggjester |
| Dropp | Norse Oilfield Services minigolf & CountryClub | Sola | `node/380515648` | 58.91904, 5.60102 | – | access=private | access=private |
| Sjekk | Stavanger Camping | Stavanger | `node/9197760282` | 58.97158, 5.73095 | <https://www.campingen.no/stavanger> | utested ≤ 30 m: bar «HoT Open Mind» 10 m; overnatting ≤ 250 m: hotel «Home Hotel Skagen Brygge» 70 m; åpent til midnatt eller senere | Samme barkonsept som Oslo Camping (campingen.no), bar 10 m unna. Trolig dropp |
| Dropp | Stord Minigolf | Stord | `node/10226978635` | 59.80813, 5.51449 | – | – | Dublett av Stord Minigolf (5 m) |
| **Klar** | Stord Minigolf | Stord | `way/840607823` | 59.80815, 5.51457 | – | – | I Stord Golfpark |
| Sjekk | Sandviken Minigolf | Tinn | `way/1170501566` | 59.98955, 8.81662 | – | overnatting ≤ 250 m: camp_site «Sandviken Camping» 121 m | Ved Sandviken Camping. Sjekk om den er åpen for alle |
| Sjekk | Storgata Camping | Tromsø | `node/3110900872` | 69.6456, 18.94963 | – | utested ≤ 30 m: bar «Storgata Camping» 7 m; overnatting ≤ 250 m: hotel «Skaret by Vander» 113 m | Bar med samme navn 7 m unna. Trolig barkonsept. Trolig dropp |
| **Klar** | Minigolfbanen | Trondheim | `way/24165960` | 63.39446, 10.43546 | – | – | – |
| Dropp | Mini golf | Tysvær | `way/490473861` | 59.43425, 5.48225 | – | overnatting ≤ 250 m: chalet «Nr.9» 130 m | På Grindafjord Feriesenter. Venter til runde to |
| **Klar** | Saunes Minigolf | Ulstein | `way/390490856` | 62.34029, 5.84841 | – | overnatting ≤ 250 m: hotel «Quality Hotel Ulstein» 55 m | – |
| **Klar** | Minigolfen | Voss | `way/28441135` | 60.62752, 6.41543 | – | overnatting ≤ 250 m: hotel «Park Hotel» 129 m | – |
| Dropp | Minigolfen | Voss | `node/6143535182` | 60.62771, 6.41524 | – | bare funnet på navn; overnatting ≤ 250 m: hotel «Park Hotel» 105 m | Dublett av Minigolfen Voss (24 m), uten tagger |

### Venter til runde to

Disse er ikke med i tabellene over:

- **58 minigolfbaner uten navn.** 42 av dem ligger innen 250 m fra camping,
  hotell eller annen overnatting.
- **Fire minigolfbaner med navn som ligger på camping eller feriesenter** står
  som «dropp» over: Omlidstranda Camping, Biljardgolfa, Skottevik feriesenter
  og Mini golf på Grindafjord.
- **Én spillehall uten navn** på Krokane Camping.

## 3. Steder Frederik kjenner til

Søkt på navn i Overpass: i Oslo (utsnittet 10.55–10.98, 59.80–60.02), i hele
Norge for Lucky Duck og «Fangene på fortet», og på Veierland (10.30–10.45,
59.10–59.20).

| Sted | I OSM? | OSM | Merknad |
|---|---|---|---|
| Oslo Camping (innendørs minigolf) | **Ja** | `node/4958723297`, 59.91456, 10.74733 | Tagget `amenity=pub` + `leisure=miniature_golf` + `indoor=yes`. Nettadresse campingen.no/oslo. Samme konsept som Stavanger Camping og Storgata Camping (Tromsø). Alle tre står som «sjekk, trolig dropp» |
| Lucky Duck (innendørs minigolf, Oslo) | **Nei** | – | **Mangler i OSM, må legges inn for hånd.** Det eneste treffet i Norge på «Lucky Duck» er `way/121546930`, en `tourism=attraction` inne i Tusenfryd. Det er ikke minigolfen |
| Underground (innendørs minigolf, Oslo) | **Ja** | `node/12966945763`, 59.92606, 10.71976 | «Underground Golf Club Majorstua», bare `leisure=miniature_golf`. Ingen nettadresse eller åpningstid |
| Minigolf på Veierland | **Nei** | – | **Mangler i OSM, må legges inn for hånd.** Det finnes verken `leisure=miniature_golf` eller et navn med «golf» på øya. Nærmeste golf er Tjøme golfklubb, som er en vanlig golfbane |
| Fangene på fortet, Oslo | **Ja** | `node/9724313095`, 59.94963, 10.76358 | Nydalen. `leisure=escape_game`, nettadresse oslo.fangenepafortet.no |
| Fangene på fortet, Bergen | **Ja** | `node/7197772246`, 60.38145, 5.31766 | Samme punkt som Megazone Bergen (`node/7197772245`) |
| Fangene på Fortet, Stavanger | **Ja** | `node/14143229452`, 58.96014, 5.73827 | `leisure=escape_game` |
| Andre «fortet»-konsepter | Ikke funnet | – | Søket på `fangene`, `fort boyard` og `boyard` ga bare de tre over. Andre merkenavn i samme sjanger har jeg ikke søkt på, fordi jeg ikke kjenner navnene. Er det flere, trengs navnene |

Lucky Duck og Veierland må få punkt og adresse for hånd. I seeden betyr det
`manualCoord` med `coordVerified: false` til noen har kontrollert punktet,
slik som for Mikkelparken.

## 4. Oppsummert: klar, sjekk, dropp

Begrunnelsen står per rad i tabellene. Mønstrene:

- **Klare (60):** faste bowlinghaller i kjeder og kjøpesentre uten sen
  åpningstid, de tre lasertag-stedene, escape rooms med egen adresse,
  kommunale og frittstående minigolfparker i byene, og Trondheim Bilbane
  Center og Bodø Actionhall.
- **Sjekk for alkohol eller aldersgrense:** alle med åpent til midnatt eller
  senere (Bowling1-kjeden, Solli, Metro, Stadion, Voss, Centrum og flere),
  O'Learys-stedene (Drammen, Bø, Hemsedal), steder som er tagget som pub eller
  ligger ved en (Narvik, Alta, Kulå, Harbour Bowl, Gravdal, Royal Bowling), og
  de innendørs minigolfkonseptene i byene (Oslo Camping, Stavanger Camping,
  Storgata Camping, Underground, Glowing Golf).
- **Sjekk for annet:** om hotellbowling og campingminigolf er åpne for alle
  (Vestlia, Hitra, Sandviken), og hva stedet er (Musikkhallen, Bryggeslottet,
  HITZONE, Skyland, Skjærgårdsgaming, «bowling» i Sandefjord).
- **Dropp (36):** 16 dubletter (samme sted med flere noder, eller en
  kiosk, kafé, bygning eller campingplass ved siden av), 5 barer, 3 steder
  inne i parker vi allerede har kuratert (Tusenfryd, Foldvik og Hunderfossen),
  4 minigolfbaner og 1 spillehall ved camping som venter til runde to, de 4
  navnløse kulebanene i Jåttåvågen, Kongsberghallen (en ekte flerbrukshall),
  en pizzarestaurant og et privat anlegg.

**VR Games Zone** er flyttet fra escape room til spillehall. Det er VR-spill,
ikke et escape room.

**Lykkeland Lekepark** (Steinkjer) har både lekeland, bowling og lasertag. Den
kan få hovedkategori Innendørs lekeland med fasettene `bowling` og `lasertag`.
Da må de to stå i `FASETT_SOM_KATEGORI` for at stedet skal komme opp under
Spill og moro. Alternativt får den Spill og moro som hovedkategori. Frederik
bestemmer.

## 5. Alder i datamodellen

**Det finnes ikke noe felt for aldersanbefaling eller aldersgrense i dag.**
Jeg har gått gjennom kolonnene i `activities` i alle migrasjonene (0001–0022):

| Felt | Hva det er | Egner det seg for alder? |
|---|---|---|
| `target_audience` | Tekst: `Barn`, `For alle` og lignende. API-et filtrerer på eksakt verdi (`targetAudience`) | **Nei.** En verdi som «Barn fra 10 år» ville gjort filteret ubrukelig |
| `osm_tags` | Rå OSM-tagger. Kan ha `min_age` | **Nei.** Finnes bare på OSM-rader, og ingen av de 195 i målingen har aldersgrense tagget |
| `description` | Fritekst | **Nei.** Regelen for beskrivelser forbyr tall og tider, og «fra 10 år» eller «18 år etter kl. 20» er begge deler |

**Forslag:** egne, strukturerte felt, samme løsning som `opening_hours`, som
står i egen kolonne i stedet for i beskrivelsen. For eksempel:

- `min_age smallint null`: anbefalt alder fra, for eksempel 10 for et escape
  room. `null` betyr ingen anbefaling.
- `age_limit smallint null` sammen med en markering av at grensen bare gjelder
  deler av dagen, for eksempel 18 for en bowlinghall med skjenking om kvelden.

Dette krever en migrasjon, endring i `ROW_COLUMNS` i API-et og i SQL-funksjonene
som lister kolonnene (`activities_search`, `activities_map`), og støtte i appen.
Det er ikke skrevet noe av dette. Blir det en migrasjon, kommer den som egen
oppgave, og da vises hele SQL-fila før den kjøres.

Til feltet finnes, er det tryggeste å **la være å seede steder med
aldersgrense**. Det gjelder «sjekk»-radene der kontrollen viser 18-årsgrense.

## 6. Idrettshall-regelen og claims (bare beskrevet, ikke gjort)

### Endringen i Idrettshall-regelen

I dag, i `scripts/import-places.ts`:

```ts
matches: (t: OsmTags) => t.leisure === 'sports_centre',
```

Forslag: et `sports_centre` som bare driver med noe som ikke er idrett i
hallforstand, skal ikke bli Idrettshall. Samme presedens som Klatring og
`GENERIC_CENTRE_SPORTS`: har hallen `multi`, er den fortsatt en flerbrukshall.

```ts
/** sport-tokens som gjør et sports_centre til noe annet enn en idrettshall. */
const IKKE_IDRETTSHALL_SPORTS = new Set(['laser_tag', '10pin', '9pin', 'bowling', 'karting']);

matches: (t: OsmTags) =>
    t.leisure === 'sports_centre' &&
    !(
        sportTokens(t.sport).some((s) => IKKE_IDRETTSHALL_SPORTS.has(s)) &&
        !sportTokens(t.sport).some((s) => GENERIC_CENTRE_SPORTS.has(s))
    ),
```

Tester i `scripts/import-places.test.ts`, ved siden av testen for
`climbing;multi`:

- `sport=laser_tag`, `10pin`, `bowling` og `karting` er **ikke** Idrettshall.
- `sport=multi;10pin;hockey;…` (Kongsberghallen) **er** Idrettshall.
- `leisure=sports_centre` uten `sport` er fortsatt Idrettshall.

Objektene som faller ut, blir ingen rad, fordi ingen importkategori tar dem.
Spill og moro er kuratert og har ingen selektor.

**Regelen fjerner ikke radene som allerede finnes.** Importen sletter aldri
noe. De gamle radene må tas ned for hånd (se under).

Regelen og claimene gjør hver sin jobb. Claimene er nok for Megazone i dag,
fordi de fjerner akkurat de to objektene. Regelen hindrer at neste
lasertag-, bowling- eller gokartsted blir Idrettshall. Det blir aktuelt når
importen går nasjonalt, der Metro Bowling, Sarpsborg Bowlingsenter og Sheiken
Bowling ville blitt Idrettshall.

### Claims

Alle mot kilden `kuratert-vintertilbud`, der de kuraterte radene bor (`scripts/seed-vintertilbud.ts`).

| OSM (claimet) | Kuratert rad (`externalId`) | `expectName` | `expectNoHit` | Hvorfor |
|---|---|---|---|---|
| `node/4736654480` | `megazone-oslo` (**ny**) | `Megazone` | `true` | Etter regelendringen blir objektet ingen rad, så claimen er forebyggende, som for fornøyelsesparkene |
| `node/7197772245` | `megazone-bergen` (**ny**) | `Megazone` | `true` | Som over |
| `node/13716750101` | `rush-trampolinepark-bergen` (finnes) | `Rush` | – | Har ingen `sport`, så regelen fanger den ikke. Er Idrettshall i dag, og claimen treffer |
| `node/5549490417` | `rush-trampolinepark-trondheim` (finnes) | `Rush` | – | Er Lekeplass (`leisure=playground`) i dag |
| `node/12181644169` | `leos-lekeland-oslo` (finnes) | `Leo` | – | Er Lekeplass i dag |
| `node/5793918551` | `leos-lekeland-bergen` (finnes) | `Leo` | – | Er Lekeplass i dag |
| `node/4394667412` | `leos-lekeland-trondheim` (finnes) | `Leo` | – | Er Lekeplass i dag |

To som krever en beslutning først:

- **Gokartbanen** (`way/1030656428`, Harald Huysman Karting). Det er ikke
  bestemt om gokart hører til Spill og moro.
  - **Hvis ja:** Stedet får en kuratert rad (for eksempel
    `harald-huysman-karting`) og en claim med `expectName: 'Karting'` og
    `expectNoHit: true`.
  - **Hvis nei:** Da trengs ingen claim. Regelen hindrer at raden lages på
    nytt, og den gamle raden tas ned. En claim uten kuratert rad er ikke lov,
    fordi `assertClaimsResolve` feiler.
- **Leos Lekeland Forus** (`node/2984187381`, Stavanger). Det finnes ingen
  kuratert rad for Forus. Enten lages `leos-lekeland-forus` med claim, eller
  så blir OSM-raden stående som Lekeplass. Den ligger ikke i dag i
  `lib/osm-claims.ts`, og ikke i seeden.

### Radene som må tas ned

Med `unpublish` i `lib/moderation.ts` (`rejected` + `locked`), ikke slettes og
ikke `expired`. Låsen er lag 2 bak claimen.

| Rad-id | Tittel | Kategori i dag | Kommune |
|---|---|---|---|
| `1390579e-14aa-419b-9471-54deb9f64e6e` | Megazone | Idrettshall | Oslo |
| `c8b31a07-967a-4ca5-b78b-6ab1eefe5c51` | Megazone | Idrettshall | Bergen |
| `51c4bff0-137b-424c-be08-ddbbc696d602` | Rush trampolinepark | Idrettshall | Bergen |
| `08050ce2-4a5a-41e7-99b1-aa8d588da4cb` | Rush Trampolinepark | Lekeplass | Trondheim |
| `7975f15c-961d-47e0-980d-08a2f94acb28` | Leo's lekeland | Lekeplass | Oslo |
| `bda3698d-c8c5-43db-8094-c55bda334c1e` | Leo's Lekeland | Lekeplass | Bergen |
| `c423be99-3076-4058-b332-d8dc3526fc2c` | Leo's lekeland | Lekeplass | Trondheim |
| `1cf3b57c-40b2-4197-91be-c7098b09837e` | Harald Huysman Karting | Idrettshall | Oslo, avhenger av gokart-beslutningen |
| `7fb67bc2-7b56-4ff9-850d-f9248380f9c3` | Leos Lekeland Forus | Lekeplass | Stavanger, bare hvis det lages en kuratert rad |

Alle er `published` og ikke låst i dag (lest 19.09.2026).

### Rekkefølgen, alt i samme runde

1. **Kode, én gren:**
   - `lib/facets.ts`: de fem tokenene i `FACET_TOKENS` og `SEED_ONLY_FACETS`. Eventuelt `bowling`/`lasertag` i `FASETT_SOM_KATEGORI`, hvis Lykkeland får en annen hovedkategori.
   - `scripts/seed-vintertilbud.ts`: seed-radene for Spill og moro, inkludert `megazone-oslo` og `megazone-bergen`.
   - `lib/osm-claims.ts`: claimene over.
   - `scripts/import-places.ts`: Idrettshall-regelen, med tester.
2. **Seed:** tørrkjøring med `--only=` for de nye radene. `assertClaimsResolve`
   stopper tørrkjøringen hvis en claim peker på en rad som mangler. Vis radene,
   og vent på «kjør».
3. **Nedtak:** tørrkjøring av listen over, vent på «kjør», og ta ned radene med
   `unpublish`. Nedtaket kommer **etter** seeden, så stedene aldri er borte fra
   appen.
4. **Kontroll:** tørrkjøring av importen for de fire byene. Claimene skal stå
   som hoppet over, og ingen ny rad skal komme for disse objektene.
5. **Appen (togedoo-modern):** kategorien og de fem fasettene i
   `CategoryTheme` og filteret. Uten dem vises radene med standardtemaet.

## Ikke gjort, og ting jeg ikke vet

- **Ikke gjort:** ingen kode, ingen seed, ingen claim, ingen migrasjon, ingen
  skriving til basen.
- **Nettsidene er ikke åpnet.** Jeg vet ikke om stedene er i drift, om de
  skjenker, eller om de har aldersgrense. Hver «klar» bør likevel sjekkes
  raskt før seeden.
- **Beskrivelse, målgruppe og `isIndoor`** er ikke skrevet. De skrives i seed-runden.
- **Punktene er OSM-punktene** (node eller flatens midtpunkt), ikke
  kontrollerte innganger. For fornøyelsesparkene brukte vi hovedinngangen. For
  disse stedene, som stort sett er innendørs, er punktet trolig godt nok, men
  det er ikke kontrollert.
- **Tre noder heter Reality Adventures i Trondheim**, og to Lucky Bowl ligger i
  Stavanger. Jeg vet ikke om alle er i drift.
- **Andre steder i sjangeren til «Fangene på fortet»** er ikke søkt etter under
  andre navn.
- **Kommunenavnet** er `name:no`, eller `name` på kommunegrensen i OSM. Det er
  ikke kjørt gjennom `lib/municipality.ts`. For de 64 kommunene her er
  navnene norske og enspråklige, men det bør gjøres i seeden.

## Slik ble det laget

- Kandidatene er de mellomlagrede Overpass-svarene fra målingen (datastand
  19.09.2026 kl. 12:52 UTC), med flaggene regnet ut på nytt per rad.
- **Nye Overpass-kall** (`overpass-api.de`, `User-Agent: Togedoo datahub
  (hello@togedoo.com)`, pause mellom kallene, nytt forsøk ved 504):
  - navnesøk i Oslo, på Veierland, for «Fangene på fortet» og for Lucky Duck
  - kommune med `is_in` for alle 142 kandidatene, 30 punkter per kall
- **Basen:** bare lest. Rad-id-ene for de ni OSM-radene i del 6 er hentet med
  service-nøkkelen (`GET`).
- **Vurderingen** er gjort for hånd per rad, ut fra taggene, flaggene og
  avstanden til andre kandidater (dubletter innen 150 m i samme fasett).
