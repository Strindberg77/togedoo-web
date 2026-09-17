# Hvor møter man opp? Adkomstpunkt for Voss, Trysil og Geilo

**Status:** bare lesing. Ingenting er skrevet til basen, og ingen seed er kjørt.
Titler og koordinater står som `TODO` i `scripts/seed-storanlegg.ts` til
Frederik har valgt.

Målt 17. sep. 2026 mot ekte Overpass, Kartverkets høydedata og
produksjonsbasen (kun `select`). Kjør på nytt:

```bash
set -a && source .env.local && set +a
npx --yes tsx scripts/skianlegg-adkomst.ts          # full kandidatliste → .flatemaal-ut/adkomst.md
npx --yes tsx scripts/seed-storanlegg.ts --dry-run   # forslaget, med navnekontroll mot OSM
```

Den fulle lista (alle heiser, alle parkeringer, alle rader i polygonet) står i
`.flatemaal-ut/adkomst.md`. Den committes ikke. Tabellene under er et utdrag.

---

## Dagens punkt er feil for alle tre

| anlegg | dagens punkt | moh | terreng (Kartverket) | forhold til polygonet |
|---|---|---|---|---|
| Voss Resort Fjellheisar | 60.65444, 6.39324 | 658 | Skog | inne, midt i fjellsiden |
| Trysil | 61.31214, 12.19846 | 861 | Åpent område | inne, midt i fjellet |
| Ski Geilo | 60.53081, 8.20198 | 772 | Åpent område | **430 m utenfor**, mellom de to ringene |

Geilo-punktet er feil av en annen grunn enn de to andre. Relasjonen har én
ring på hver side av dalen, og bbox-senteret havner i dalbunnen mellom dem. Det
ligger nærmere sentrum enn de to andre punktene ligger til noe som helst, men
det er ikke en adkomst.

## Slik ble kandidatene funnet

- **Heiser:** alle `aerialway`-ways i polygonets boks + 3 km som har et punkt
  inne i polygonet eller innenfor 300 m av kanten. Den store marginen trengs
  fordi Voss-gondolen starter 1,1 km utenfor polygonet.
- **Bunn eller topp:** avgjøres av høyden fra Kartverket for begge ender, ikke av
  hvilken vei heisen er tegnet. Alle 70 heiser fikk høyde på begge ender.
- **Dalstasjon:** bunnen av en heis som *ikke* ligger innen 150 m fra toppen av
  en annen heis med minst 100 m løft. Grensen på løftet kom etter første
  kjøring. Uten den ble hele Turistsenteret i Trysil (gondolen på 415 moh.)
  merket som mellomstasjon, fordi rullebånd og barnetrekk har toppen sin ved
  bunnen av de store heisene.
- **Dalstasjon betyr ikke bilvei.** Horgaletten på Voss er dalstasjon etter
  regelen, men ligger på 791 moh. uten parkering. Det er parkeringskolonnen som
  skiller en base fra en heis midt i fjellet.
- **Base:** dalstasjoner innenfor 400 m av hverandre (enkeltlenke).
- **Parkering og billettsalg:** `amenity=parking`, `shop=ticket`,
  `vending=admission_tickets`, turistinformasjon, jernbane- og busstasjon.

Ingen `aerialway=station`-node i noen av de tre anleggene har navn. Basenavnene
under er derfor hentet fra anleggenes egne nettsider og heisnavnene, ikke fra
OSM.

---

## 1–2. Kandidater og flere adkomster

### Voss: tre adkomster

| base | punkt | moh | hva er det i OSM | parkering ≤ 400 m | til dagens punkt |
|---|---|---|---|---|---|
| **Gondolen, Voss sentrum** | 60.62919, 6.41115 | 58 | dalstasjon Voss Gondol `way/675982736` (58→805 moh.) | 11, bl.a. Voss Stasjon (99 pl., avgift), Tinghusplassen (86), Holbergsplassen (37) | 3,0 km |
| **Bavallen** | 60.65732, 6.41646 | 283 | dalstasjon Bavallsekspressheisen `way/30743028` (283→815) | 11, bl.a. P4 og `way/1348059062` 76 m | 1,3 km |
| **Tråstølen** | 60.65529, 6.40048 | 564 | dalstasjon Tråstølheisen `way/52265018` (564→810) | P6 `way/209279918`, gratis, 130 m | 406 m |

Billettsalg og informasjon:

| navn | tagger | punkt | nærmeste base |
|---|---|---|---|
| Varmestovo `way/902144209` | `amenity=restaurant shop=ticket` | 60.65633, 6.41641 | Bavallen, 110 m |
| Voss turistinformasjon `node/3684012642` | `tourism=information` | 60.62908, 6.41135 | gondolen, 20 m |
| Voss stasjon (tog `node/5720559128`, buss `node/7078192448`) | | 60.62910, 6.41011 | gondolen, 60–65 m |

Punktet oppdraget nevner (ca. 60.6292, 6.4112) er gondolens dalstasjon, og det
stemmer med OSM på 3 m.

Dalstasjoner uten parkering (man kommer dit på ski): Badnakrokjen og Slettafjell
1/2 (619–638 moh.), Hangurstrekket (650) og Horgaletten (791).

### Trysil: fire adkomster, som på skistar.com

| base (skistar.com) | punkt | moh | hva er det i OSM | parkering ≤ 400 m | til dagens punkt |
|---|---|---|---|---|---|
| **Turistsenteret** | 61.31111, 12.24674 | 415 | dalstasjon Trysilgondolen `way/1385891650` (415→807); billettsalg `node/1177505919` 90 m | 20 | 2,6 km |
| **Høyfjellsenteret** | 61.32333, 12.15439 | 821 | «Ski Tickets» `node/698846811` ved resepsjonen `node/698846884`; F12 Familietrekket 190 m | 9, bl.a. P1 110 m, P2/P4/P5 | 2,7 km |
| **Skihytta** | 61.30307, 12.19953 | 800 | dalstasjon S1 Skihytta Ekspress `way/507848254` (800→1088) | 1: `way/444035312`, 290 m | 1,0 km |
| **Høgegga** | 61.32810, 12.22220 | 407 | dalstasjon H1 Høgekspressen `way/23274411` (407→856) | **ingen i OSM** | 2,2 km |

`shop=ticket` finnes også ved F1 Brynebekken (`node/346371424`, 665 moh.), men
uten parkering i OSM. Liekspressen og Fjellekspressen (466–482 moh.) ligger i
samme klynge som Turistsenteret.

At Høgegga mangler parkering, sier noe om OSM, ikke nødvendigvis om stedet.
Velges Høgegga, må punktet kontrolleres mot et flyfoto.

### Geilo: fem adkomster, som på skigeilo.no/parkering

| base (skigeilo.no) | punkt | moh | hva er det i OSM | parkering ≤ 400 m | til dagens punkt |
|---|---|---|---|---|---|
| **Geiloheisen, sentrum** | 60.53463, 8.19813 | 826 | dalstasjon Geiloheisen Express `way/31468685` | 2, bl.a. `node/1152953487` (gratis) 110 m, som tilsvarer «Geiloheisen, ved Hegnavegen» | 474 m |
| **Slaatta** | 60.53724, 8.21079 | 815 | Slaattaheisene / rullebånd `way/261992762` | 8; Geilo stasjon 390 m | 863 m |
| **Vestlia** | 60.52117, 8.19849 | 779 | dalstasjon Vestliheisen Express `way/31468693` | 4, bl.a. `way/968089912` 130 m | 1,1 km |
| **Kikut** | 60.51589, 8.20891 | 921 | dalstasjon Kikutheisen Express `way/31468696` | **ingen i OSM**; nettsiden har Kikut A, B og C | 1,7 km |
| **Havsdalen** | 60.54625, 8.19690 | 968 | dalstasjon Fjellheisen `way/31468690` | 3, bl.a. `way/1182563338` (avgift) 110 m | 1,7 km |

Halstensgårdheisen (832 moh., 801 m fra dagens punkt) er også dalstasjon, men
har ingen parkering i OSM og står ikke på parkeringssiden.

### Hvordan én rad håndterer flere adkomster

**Forslag: ett punkt pluss tekst i `description`.** Punktet er der en familie
uten lokalkunnskap bør kjøre eller gå. Teksten nevner de andre basene med navn,
slik at de kan søkes opp. Et utkast står i seed-fila, merket `TODO`.

Det krever ingen migrasjon og ingen endring i appen, og det er samme form som
Oslo-radene har i dag. Prisen er at de andre basene ikke er klikkbare.

**Forkastet: flere rader per anlegg.** Utenfor oppdraget. I Oslo er det riktig,
fordi Tryvann og Wyller er ulike anlegg med ulike navn. I Trysil er det samme
anlegg og samme heiskort. Fire rader ville sett ut som fire steder i en liste.

**Senere, hvis det trengs:** et strukturert felt (f.eks. `access_points jsonb`
med navn og koordinat) som appen viser som valg under «veibeskrivelse». Det
krever migrasjon og Flutter-endring, og hører ikke til denne runden.

`address` bør også settes til basen som er valgt (f.eks. «Voss stasjon, Voss»).
Den er `null` på alle tre radene i dag.

---

## 3. Tittel

| anlegg | OSM `name` | OSM `operator` | egen nettside | forslag |
|---|---|---|---|---|
| Voss | Voss Resort Fjellheisar | Voss Resort Fjellheisar | «Voss Resort» | **Voss Resort** |
| Trysil | Trysil | — | «Trysil skisenter», også «SkiStar Trysil» | **Trysil skisenter** / SkiStar Trysil / Trysilfjellet |
| Geilo | Ski Geilo | — | «SkiGeilo», også «Skisenteret på Geilo» | **SkiGeilo** / Ski Geilo / Geilo skisenter |

Ingen av polygonene har `official_name`, `alt_name` eller `brand`. Heisene i
de tre anleggene har ingen `operator`- eller `website`-tagger. Alphapark er det
eneste objektet som har en annen operator: «Voss Skiresort».

«Skimore»-presedensen (radene heter Tryvann og Wyller, ikke «Skimore Oslo»)
peker mot stedsnavn framfor driftsselskap. Etter den regelen er «Trysil
skisenter» bedre enn «SkiStar Trysil». For Voss og Geilo er merkenavnet og
stedsnavnet det samme ordet, så valget spiller mindre rolle der.

## 4. Nettside

| anlegg | OSM `website` | i basen i dag | merknad |
|---|---|---|---|
| Voss | https://vossresort.no/no/vinter/ | samme | vinterside, riktig |
| Trysil | https://www.skistar.com/no/vare-skisteder/trysil/vinter-i-trysil/ | samme | vinterside, riktig |
| Geilo | https://www.skigeilo.no/ | samme | forsiden; ingen egen vinterside i OSM |

Alle tre lenker allerede til anleggets egen side. Det er bare Alphapark og
«child ski area» som lenker til osm.org, og de skal ned.

---

## 5. «child ski area» (way/55606470, Trysil)

**Ja, den er en delflate.** Bbox-senteret (61.32334, 12.15907) ligger inne i
way/1210019615, og det gjør alle 6 nodene. Flata er 37 × 103 m, med taggene
`landuse=recreation_ground`, `leisure=playground`, `sport=skiing` og
`name=child ski area`. Den ligger ved Høyfjellsenteret, 250 m fra resepsjonen.

Den kom ikke med blant de 115, fordi id-lista krevde `name is null`. Den skal på
nedtakslista.

### Hvor den slipper gjennom

`lib/places.ts` på HEAD, `isUsablePlaceName`:

```ts
if (!trimmed || trimmed.length < 3) return false;   // 14 tegn
if (TRUSTED_WORDS.test(trimmed)) return true;        // ingen tillitsord
return !SUSPICIOUS_PATTERNS.some((re) => re.test(trimmed));  // linje 48: ingen treff → true
```

Deretter blir navnet brukt som tittel i `makePlaceTitleDetailed` (linje 382 på
HEAD):
`if (isUsablePlaceName(osmName)) return { title: osmName!.trim(), source: 'osm-navn' }`.

### Regelen (lagt inn på grenen, med test)

`isEnglishTypeLabel` i `lib/places.ts` kjører **før** tillitsordene, og har to
krav:

1. **Hvert** ord i navnet er et typeord: `child children kids kid area zone
   slope beginner(s) training sledding sled playground parking lot the`, eller
   et delt ord: `ski park lift piste`.
2. **Minst ett** av ordene er rent engelsk, altså ikke et delt ord.

Krav 2 verner norske navn: «Ski» (kommunen), «Park» og «Lift» slår ikke ut
alene. Krav 1 verner merkenavn: i «Kids Arena» og «Skiarea Hafjell» står ett
ord utenfor lista, og de slipper gjennom.

**Målt mot basen:** regelen treffer 2 av 1 798 importrader med OSM-navn.

| rad | navn | status |
|---|---|---|
| `way/55606470` | child ski area | published |
| `node/9150717106` | Playground | published, får «Lekeplass ved …» ved neste import |

**Hvorfor ikke «bare små bokstaver»:** 6 av de 1 798 navnene er skrevet med
bare små bokstaver, og «voll», «bas» og «trafo» er norske ord. Den regelen
ville truffet dem, og ikke truffet «Child Ski Area».

Testene står i `lib/places-typeord.test.ts` og dekker blant annet «Ski», «Voll»,
«Geilolia», «Ski Geilo», «Kids Arena», «Skiarea Hafjell» og
«22. juli-senteret».

**Følge for importen:** endringen virker ved neste import. Vil du ha den ut av
denne runden, er det én linje i `isUsablePlaceName` og én testfil.
`UGYLDIGE_MORNAVN` i `lib/flatemaal.ts` er fortsatt en eksakt liste. Den kan
senere bruke `isEnglishTypeLabel`, men er ikke endret.

## 6. Alphapark (way/1348055350, Voss)

**Den er en del av Voss Resort, ikke et eget sted.** Alle 5 nodene ligger inne
i relation/4107373 (etter at ringen er sydd sammen). Flata er 70 × 133 m.

Taggene:

- `landuse=winter_sports`
- `name=Alphapark` og `name:no=Alphaparken`
- `operator=Voss Skiresort`
- `fixme`: «General area of the "Alfaparken" area, only built up when there is
  enough snow/seasonal. Based loosely on Voss Skiresort piste map 2024.»

Det er altså en sesongbygget terrengpark, tegnet omtrentlig etter løypekartet.
Raden ligger i dag 440 m fra dagens Voss-punkt og lenker til osm.org. Forslaget
er claim og nedtak.

---

## Claims: forslaget

**Én kuratert rad per anlegg, og den eier både anleggspolygonet og de navngitte
delene inni.** En claim er et par (OSM-objekt, rad), så én rad kan eie flere
objekter. Da kan Alphapark og «child ski area» aldri bli rader igjen, selv om
låsen på den gamle raden skulle forsvinne.

| rad (`kuratert-vintertilbud`) | eier | `expectName` | OSM-kontroll i dag |
|---|---|---|---|
| `voss-resort` | relation/4107373 | Voss Resort Fjellheisar | ok |
| `voss-resort` | way/1348055350 | Alphapark | ok |
| `trysil-skisenter` | way/1210019615 | Trysil | ok |
| `trysil-skisenter` | way/55606470 | child ski area | ok |
| `skigeilo` | relation/17004845 | Ski Geilo | ok |
| `skigeilo` | relation/10859554 | Geilolia | ok, **krever ditt ja** |
| `skigeilo` | way/1238316509 | (uten navn) | ok, **krever ditt ja** |
| `skigeilo` | way/1238316510 | (uten navn) | ok, **krever ditt ja** |

### Geilo er ikke én rad i dag

Tre andre `published` rader har punkt inne i Ski Geilo:

| rad-id | external_id | tittel |
|---|---|---|
| `7c269cb2-1f50-40e9-a44d-0aa7290f3edd` | relation/10859554 | Geilolia (`recreation_ground`, sørsiden) |
| `c66ececb-919d-45f2-beb0-6d15cef8d871` | way/1238316509 | Skianlegg i Geilolie |
| `b923a453-9a8d-494d-81fd-0ce9bff1a3cb` | way/1238316510 | Skianlegg ved Vesleåne 68 |

De to siste er selve ytterringene i Ski Geilo-relasjonen. De er
`landuse=winter_sports` uten navn, og ble derfor egne rader. De var ikke med
blant de 115, fordi den lista krevde `recreation_ground`. Oppdraget sa «ingen
andre anlegg enn de tre», så disse tre claimene står i forslaget merket
**krever ditt ja**, og ingen av dem er skrevet.

For Voss og Trysil er alle andre rader i polygonet allerede `rejected`, bortsett
fra Alphapark og «child ski area».

### Hvorfor claim, og ikke å rette importraden og låse den

Å rette `lat`/`lng`/`title` direkte på importraden og sette `locked=true` ville
også virket, fordi låsen gjelder innenfor samme kilde. Det er forkastet av tre
grunner:

- Rettingen ville bare ligge i basen. Den kan ikke leses i git eller
  gjennomgås, og ingen `--dry-run` fanger den.
- Den løser ikke delflatene. Alphapark og «child ski area» trenger uansett et
  eget nedtak.
- Oslo-alpint gikk seed + claim-veien. Én mekanisme for samme problem.

### Hvorfor claimene ikke står i `OSM_CLAIMS` ennå

En claim virker så snart den ligger i lista. Neste import ville hoppet over
anleggene uten at noen seed-rad fantes, og da hadde de forsvunnet fra appen.
`assertClaimsResolve` i `seed-vintertilbud.ts` ville dessuten kastet. Derfor
står de i `FORESLATTE_CLAIMS` i `scripts/seed-storanlegg.ts`, og en test sjekker
at ingen av dem er aktive.

### Fasetter

Seed-rader utleder ikke fasetter fra OSM. Dagens importrader har:

- Trysil: `alpint, aking, terrengsykling, downhill`
- Geilo: `alpint, skileik, aking`
- Voss: `alpint`

De er kopiert inn i forslaget. Uten dem ville Trysil forsvunnet fra
aking-filteret den dagen seed-raden tok over.

---

## Rekkefølge når valgene er gjort

1. Fyll inn `title`, `valgtBase` og `description` i `scripts/seed-storanlegg.ts`.
   `--dry-run` teller åpne TODO og sier «klar» når de er borte.
2. Flytt entryene til `SEED` og `SPLIT` i `seed-vintertilbud.ts` (`manualCoord`
   = valgt base, `facets` som over), og claimene til `OSM_CLAIMS`.
3. `npx --yes tsx scripts/seed-vintertilbud.ts --dry-run`
4. `npx --yes tsx scripts/import-places.ts --dry-run …`: rapporten skal vise
   `claim … → ingen rad` for alle claimede objekter.
5. Kjør seeden.
6. Ta ned de gamle radene med `unpublish` (`rejected + locked`), **etter**
   seeden:

| rad-id | external_id | tittel |
|---|---|---|
| `c812f06a-8a87-4368-b46e-92067686e838` | relation/4107373 | Voss Resort Fjellheisar |
| `a07c8b53-98db-4d3f-a434-04df824ae12b` | way/1348055350 | Alphapark |
| `119b1ec8-08c6-41cd-a126-15b1d42c8da2` | way/1210019615 | Trysil |
| `37b53bc9-a75f-4c99-b092-b5265c254866` | way/55606470 | child ski area |
| `a0002ae0-c1c4-4ef8-b8c1-1e34d557e0d5` | relation/17004845 | Ski Geilo |
| + de tre Geilo-radene over | | hvis ja |

---

## Funnet underveis: `ringerAv` syr ikke sammen relasjoner

`ringerAv` i `scripts/skianlegg-flatemaal.ts` (linje 220) returnerer hvert
ytre medlem som sin egen ring. Voss-relasjonens ytterkant er to **åpne** ways,
og `pointInRing` lukker hver av dem med en rett strek. Svaret blir da
vilkårlig. `assembleRings` i `lib/geo-polygon.ts` finnes for nettopp dette,
og brukes nå i `skianlegg-adkomst.ts`.

28 av mødrene i cachen har åpne medlemmer. Målingen fra 17. september er regnet
om fra cachen med sammensydde ringer:

- **Ingen av de 107 entydige endret seg.** Nedtakslista som ble kjørt var
  riktig.
- **4 av de 8 «ingen mor» får en mor:** 3 × Furedalen alpin (relation/5206230)
  og 1 × Eikedalen skisenter (relation/5225810). Resultatet blir 111 entydig /
  0 flere / 4 ingen.

Forklaringen på «ingen mor» for Furedalen ser altså ut til å være denne feilen.
Furedalen er utenfor denne runden, og skriptet er ikke rettet.
