# Flerbruks-aktiviteter i Togedoo — beslutningsgrunnlag

*Utarbeidet 6. september 2026. Kun analyse — ingen migrasjoner, import eller app-endringer er gjort.*

---

## 0. Les dette først: hva som er verifisert og hva som ikke er det

Analysen ble kjørt fra et miljø der nettverkspolicyen **blokkerer** anleggsregisteret.no (alle underdomener), data.norge.no, overpass-api.de, taginfo, Nominatim, Vercel-API-et vårt og Supabase. Bare websøk og `raw.githubusercontent.com` var åpne. Det setter en hard grense for hvilke tall som kan oppgis.

| Spørsmål | Status | Grunnlag |
|---|---|---|
| 1a. Hvordan hentes Anleggsregisteret programmatisk | **Verifisert** | Kildekoden til OSM-miljøets uttrekk (leisure2osm) — se §1 |
| 1b. Felter i datasettet | **Verifisert** (de feltene uttrekket bruker) | Samme kilde + data.norge.no-beskrivelsen |
| 1c. Verdiområde anleggskategori/anleggstype | **Verifisert** (28 kategorier, 159 typer) | Taksonomi-fila `anleggsregister_kategorier.json` |
| 1d. **KRITISK:** skiller registeret bruksområder? | **Verifisert: NEI** | Taksonomien — én `typeDescription` per rad |
| 1e. Radantall Oslo/Bergen/Trondheim/Stavanger | **IKKE verifisert** | Endepunktet er blokkert herfra |
| 1f. Koordinatkvalitet i vårt utvalg | **IKKE målt** — nasjonale tall finnes | OSM-forum + uttrekkets egen feilhåndtering |
| 2. OSM-volum per aktivitet | **IKKE målt** | Overpass blokkert. Eksakte spørringer ligger i vedlegg A |
| 3. Matching Idrettshall ↔ Anleggsregisteret | **IKKE målt** — metode og nøkkel er identifisert | Se §3 |
| 4. Arkitektur | **Besvart** fra koden | Se §4 |

Alt som står under «Slik måles det» er kjørbart på en maskin med vanlig nett. Ingen tall i denne rapporten er anslått der de kunne vært målt — de er utelatt i stedet.

---

## 1. Anleggsregisteret — hva inneholder det egentlig?

### 1a. Slik hentes det programmatisk

**Datahotellet er nedlagt.** data.norge.no-beskrivelsen sier at registeret «er gjort tilgjengelig på datahotellet». Digitaliseringsdirektoratet avviklet Datahotellet fra 1. oktober 2024, endelig stengt 11. februar 2025 ([hotell.difi.no/avvikling](https://hotell.difi.no/avvikling)). Den dokumenterte distribusjonen finnes altså ikke lenger, og det finnes ikke noe publisert API.

**Det finnes et udokumentert JSON-endepunkt** — det som driver «Finn anlegg»-siden. OSM Norge har brukt det siden 2019 i verktøyet [leisure2osm](https://github.com/NKAmapper/leisure2osm) (kildekode lest i sin helhet):

```
GET https://backoffice.anleggsregisteret.no/api/facilities?page=0&size=500
Header: X-Requested-With: XMLHttpRequest
```

Svaret er Spring-Data-paginert JSON: `{ "content": [ …anlegg… ], "last": false, … }`. Man itererer `page` til `last == true`. Eldre vertsnavn i samme kode: `fagsystem.anleggsregisteret.no/idrett/api/facilities`. Ingen autentisering.

To forbehold: (1) Jeg kunne **ikke** bekrefte at endepunktet fortsatt svarer — domenet er blokkert herfra. (2) Det er ikke et publisert API. Det kan endres uten varsel, så importen må lagre et råsnapshot og feile høylytt på skjemaendring, ikke stille.

Lisens: NLOD (verifisert av deg via data.norge.no, datasett-id `45e016b0-5fb2-4b6f-bd6a-84019de002cd`). Kulturdepartementet bekreftet i juni 2019 overfor OSM Norge at dataene er åpne offentlige data ([forum-tråd](https://community.openstreetmap.org/t/tillatelse-fra-kulturdepartementet-anleggsregisteret/87255)). Bruk av et udokumentert endepunkt er en *robusthets*-risiko, ikke en lisensrisiko.

Til orientering: Geodata Online tilbyr et ArcGIS-lag «Anleggsregisteret» ([dokumentasjon](https://dokumentasjon.geodataonline.no/servicename/?geomapanleggsregister=)). Det er en kommersiell abonnementstjeneste og ikke vurdert videre.

### 1b. Felter

Feltene uttrekket leser per rad (dette er det som er *bekreftet* å finnes i JSON-svaret):

| Felt | Innhold |
|---|---|
| `facilityId` | Anleggsnummer (unik nøkkel) |
| `name` | Anleggsnavn |
| `status` | `EXISTING` m.fl. — uttrekket filtrerer på EXISTING |
| `latitude`, `longitude` | WGS84 desimalgrader |
| `municipalityName`, `countyName` | Kommune, fylke |
| `ownerName`, `operatorName` | Eier, drifter |
| `categoryDescription` | Anleggskategori (én verdi) |
| `typeDescription` | Anleggstype (én verdi) |

data.norge.no-beskrivelsen nevner i tillegg anleggsklasse, byggeår og måldata. De finnes trolig i JSON-et, men uttrekket bruker dem ikke, så jeg har ikke sett feltnavnene. **Ikke verifisert.**

### 1c. Verdiområde for anleggskategori / anleggstype

Fra `anleggsregister_kategorier.json` (OSM Norges speil av registerets taksonomi; leisure2osm skriver ut en ny fil hver gang API-et viser nye typer, så lista er vedlikeholdt, men kan ligge noe bak): **28 anleggskategorier, 159 anleggstyper.** Hele lista er i vedlegg B. De kategoriene som angår spørsmålet vårt:

**«Idrettshaller og aktivitetssaler» — 7 typer:**

| Anleggstype | OSM-mapping brukt av leisure2osm |
|---|---|
| Fleridrettshall | `leisure=sports_centre` + `sport=multi` |
| Fleraktivitetssal | `leisure=sports_centre` + `sport=multi` |
| Turnhall | `leisure=sports_centre` + `sport=gymnastics` |
| Kampidrettsanlegg | `leisure=sports_centre` (uten sport) |
| Danse-/cheerleadingssal | `leisure=dance` |
| Biljardhall | `leisure=sports_centre` + `sport=billiards` |
| Bowlinghall | `leisure=bowling_alley` |

Andre relevante typer utenfor den kategorien: «Sandhåndballbane» (Mindre utendørsanlegg), «Bandybane (ute)» (Is- og skøyteanlegg), «Basketbane utendørs» (Basketballanlegg — **kun** utendørs), «Bordtennishall», «Squashanlegg», «Padeltennishall», «Tennishall» (Racketsportsanlegg), «Klatrehall», «Klatre/buldrevegg (inne)» (Klatreanlegg).

**Finnes ikke som anleggstype i denne versjonen av taksonomien:** volleyball innendørs, basketball innendørs, håndball innendørs, futsal, brettspill, gaming/e-sport. (Spillemiddelbestemmelsene for 2025, V-0732 B, nevner e-sport som støtteberettiget aktivitetsflate, så en nyere «e-sport»-type *kan* ha kommet til. Ikke verifisert.)

### 1d. KRITISK: skiller registeret bruksområder eller byggtype?

**Byggtype. Én verdi per anlegg. Registeret sier ikke hvilke idretter som drives i en flerbrukshall.**

En flerbrukshall er registrert som anleggstype «Fleridrettshall», punktum. Det finnes ikke noe felt for idrett/bruksområde i de feltene uttrekket leser, og taksonomien har ingen «Fleridrettshall (håndball)»-varianter. Registeret er bygd for spillemiddel-forvaltning: det beskriver *hva som er bygget*, ikke *hva som foregår der*.

Konsekvens, sagt rett ut: **Anleggsregisteret løser ikke håndball-problemet alene.** Det gir nøyaktig samme informasjon om en flerbrukshall som OSMs `sport=multi` gir i dag — bare med bedre dekning og et autoritativt anleggsnummer.

Det registeret *derimot* gir, som OSM ofte mangler, er **spesialiserte anlegg med egen type**: turnhaller, kampidrettsanlegg, danse-/cheerleadingsaler, klatrehaller, bordtennis-, squash- og padelhaller. For «turn», «kampsport» og «dans» er registeret derfor en reell, autoritativ kilde. For «håndball», «futsal», «basket inne», «volleyball inne» er det ikke det — der er svaret «flerbrukshall», og resten er en slutning.

Den slutningen («en norsk fleridrettshall har håndballmål») er sannsynligvis riktig for de aller fleste haller, men den er en *kapasitets*-påstand, ikke en *tilbuds*-påstand. Se §4.6 om hvordan det bør kommuniseres.

### 1e. Radantall per by

**Ikke verifisert** — endepunktet er blokkert herfra. Nasjonalt: «over 50 000 anlegg» (OSM-forum, 2019; Kulturdepartementets tall).

Slik måles det (henter alt, filtrerer lokalt — API-et har ikke noe kjent kommune-filter):

```bash
i=0; while :; do
  curl -s -H 'X-Requested-With: XMLHttpRequest' \
    "https://backoffice.anleggsregisteret.no/api/facilities?page=$i&size=500" > "ar_$i.json"
  jq -e '.last == true' "ar_$i.json" >/dev/null && break; i=$((i+1)); done
jq -s '[.[].content[]] | map(select(.status=="EXISTING"))
  | group_by(.municipalityName) | map({k: .[0].municipalityName, n: length})
  | map(select(.k | test("Oslo|Bergen|Trondheim|Stavanger"; "i")))' ar_*.json
```

Merk at kommunenavn i registeret varierer i skrivemåte (uttrekket normaliserer bl.a. store bokstaver og «… Kommune»-suffiks), så filtrer case-insensitivt.

### 1f. Koordinatkvalitet

Nasjonale tall fra OSM Norges kjøring av uttrekket (2019, [forum](https://forum.openstreetmap.org/viewtopic.php?id=66598)): **ca. 600 anlegg** med feil UTM-sone (rettes automatisk ved å teste ±6°, ±12°, ±18° lengdegrad mot kommunens bounding box), **ca. 500 anlegg** med koordinater utenfor kommunegrensen som ikke lot seg rette, pluss et ukjent antall **uten koordinater** i det hele tatt. Av >50 000 er det ~2 % flaggede.

**Én feilkilde treffer Oslo spesielt.** Uttrekket har en hardkodet sjekk: anlegg med koordinat nøyaktig `(59.917201, 10.727413)` eller `(59.917112, 10.727424)` merkes «Not exact coordinates (Oslo)». Det er to plassholder-punkter i Oslo sentrum som er brukt for Oslo-anlegg uten reell posisjon. Hvor mange rader det gjelder er **ikke målt**, men det er nettopp vår største by, og disse radene kan ikke koordinat-matches mot noe som helst.

Slik måles det i vårt utvalg: kjør de fire byenes rader gjennom (a) bounding-box-sjekk mot kommunen (Geonorge `kommuneinfo/v1/kommuner/{nr}` gir `avgrensningsboks`), (b) UTM-skift-testen, (c) telling av de to Oslo-plassholderpunktene, (d) telling av `latitude == null`. Uttrekkets `process_facility` gjør (a), (b) og (c) allerede og kan gjenbrukes som den er.

---

## 2. OSM-volum for aktivitetene vi mangler

**Ikke målt.** Overpass og taginfo er blokkert herfra. Tag-uttrykkene under er valgt etter OSM-wikiens `sport=*`-verdier og er klare til å kjøres; hver spørring gir ett rått tall.

| Aktivitet | Tag-uttrykk (Overpass, innenfor `area.a`) | Merknad |
|---|---|---|
| Dans | `nwr["leisure"="dance"]` ∪ `nwr["sport"~"dance"]` ∪ `nwr["amenity"="dancing_school"]` | Tre konkurrerende tagge-tradisjoner |
| Kampsport | `nwr["sport"~"judo\|karate\|taekwondo\|wrestling\|boxing\|kickboxing\|martial_arts\|aikido\|jiu"]` ∪ `nwr["amenity"="dojo"]` | `martial_arts` er samlebegrepet |
| Turn/gymnastikk | `nwr["sport"~"gymnastics"]` | |
| Cheerleading | `nwr["sport"~"cheerleading"]` | Forventet nær null |
| Bandy | `nwr["sport"~"bandy"]` | Nesten alltid utendørs |
| Volleyball inne | `nwr["sport"~"volleyball"]["leisure"="sports_centre"]` ∪ `nwr["sport"~"volleyball"]["indoor"="yes"]` | `beachvolleyball` ekskluderes ved regex-anker |
| Basket inne | `nwr["sport"~"basketball"]["leisure"="sports_centre"]` ∪ `…["indoor"="yes"]` | |
| Brettspill | `nwr["shop"="games"]` ∪ `nwr["leisure"="hackerspace"]` ∪ `nwr["club"="board_games"]` ∪ `nwr["amenity"="cafe"]["board_game"]` | Ingen etablert primærtag |
| Gaming/e-sport | `nwr["leisure"="amusement_arcade"]` ∪ `nwr["sport"~"esports"]` ∪ `nwr["amenity"="internet_cafe"]` | `esports` er sjelden |

Kjørbar mal og alle ni spørringer: **vedlegg A.** Rapporter tallene per by som «objekter per uttrykk», ikke sammenslått — samme objekt kan treffe flere uttrykk.

Én forventning som bør sjekkes eksplisitt: **turn og kampsport ligger sannsynligvis skjult inne i `sport=multi`-haller** i OSM, ikke som egne objekter. Kjør derfor også `nwr["leisure"="sports_centre"]["sport"~"multi"]` og sammenlign med Anleggsregisterets «Turnhall» + «Kampidrettsanlegg» for samme by. Er registeret høyere, har OSM ikke dataene — og da er det registeret som skal fylle fasetten.

---

## 3. Matching mot eksisterende data

### 3a. Det finnes en nøkkel — kanskje

leisure2osm skriver `ref:anlegg=<facilityId>` på hvert genererte OSM-objekt. **Hvis** Oslo-mappere har brukt uttrekkets fil, bærer noen av dagens `sports_centre`-objekter i OSM allerede Anleggsregisterets anleggsnummer — og da ligger det i `osm_tags` hos oss (migrasjon 0008 lagrer alle tagger). README-en sier imidlertid at «ingen organisert import var planlagt», så dekningen er trolig flekkvis.

Dette er **ett SQL-kall** å avgjøre, og det bør kjøres før noe annet:

```sql
select municipality,
       count(*)                                        as idrettshaller,
       count(*) filter (where osm_tags ? 'ref:anlegg') as med_anleggsnr,
       count(*) filter (where osm_tags ? 'sport')      as med_sport_tag,
       count(*) filter (where osm_tags->>'sport' ~ 'multi') as sport_multi
from activities
where kind = 'place' and category = 'Idrettshall' and status = 'published'
group by municipality order by municipality;
```

### 3b. Matchingsmetode når nøkkelen mangler

Tre nivåer, i rekkefølge, med fallende tillit:

1. **`ref:anlegg` = `facilityId`** — eksakt, tillit 100.
2. **Normalisert navn + avstand ≤ 150 m** — tillit 90. Normalisering som i den eksisterende `probe-handballhaller.ts` (småbokstaver, æøå→aoa, kun alfanumerisk). 150 m fordi registerets koordinater er «grove» (README) og OSM-objektet ofte er bygningspolygonets sentrum, ikke inngangen.
3. **Kun avstand ≤ 50 m, samme anleggskategori-familie** — tillit 60. Brukes bare for OSM-objekter uten navn.

Alt under 60 lagres ikke. Manuell gjennomgang av nivå 3 før det slås på i søk.

### 3c. Feilkilder, i antatt fallende betydning

- **Granularitet.** Én fysisk hall kan være flere rader i registeret (uttrekket behandler hver rad som ett punkt; en «anleggsenhet»-struktur med Fleridrettshall + Styrketreningsrom + Garderobebygg på samme koordinat er sannsynlig, men **ikke verifisert**). Match derfor mot *grupper* av registerrader innen 30 m av hverandre, ikke enkeltrader.
- **Oslo-plassholderkoordinatene** (§1f). Rader på de to punktene kan bare navnematches.
- **Skole vs. hall.** Registerets navn er ofte «Bjølsen skole — flerbrukshall», OSMs er «Bjølsenhallen». Delstreng-matching begge veier fanger noe; en liste over «skole»/«ungdomsskole» som strippes før sammenligning fanger mer (uttrekkets `transform_name` er et startpunkt).
- **UTM-feil** som ikke ble rettet (utenfor bbox etter skift) — små tall nasjonalt, men de gir *falske* nabo-treff hvis de havner nær et annet anlegg.
- **Duplikater på vår side** (AdO/Pirbadet/Sørmarka-typen) — utenfor scope her, men de gir dobbelt-match og må løses før tillitsterskelen tolkes.

### 3d. Treffrate

**Ikke målt.** Jeg gir ikke et anslag uten data. SQL-en i 3a pluss én Overpass-kjøring per by gir tallene på under en time.

---

## 4. Arkitektur-anbefaling

### 4.1 Én anbefaling

**Behold ÉN hovedkategori per sted. Legg aktiviteter i en egen many-to-many-tabell med kildeangivelse per rad. Ikke bygg videre på `sports[]` som modell.**

Begrunnelse fra koden, ikke fra smak:

- Hele presentasjonslaget er bygd per *kategori*: chip-lista (`explore_filter.dart`), farger og ikoner (`togedoo_colors.dart`), illustrasjoner (`place_category_art.dart`), taglines (`place_copy.dart`), server-filtrering (`_serverCategories` i `explore_screen.dart` → `p_categories` i RPC-en). Å gjøre kategori til many-to-many river opp alt dette for et problem som ikke er kategoriens: en flerbrukshall *er* én Idrettshall. Det som er mange, er aktivitetene i den.
- `sports[]` er i dag ikke en modell, det er en *lesning* av `osm_tags.sport` i `toApiShape` (`route.ts:113`). Den kan aldri bære data fra en annen kilde uten å bryte lisensskillet, og den kan ikke filtreres server-side (RPC-en ser bare `category`). Begge deler er nettopp det vi trenger.
- **Merk:** «Ball- og racketsport»-fasetten finnes ikke i Flutter-koden på `origin/main` (`DatahubPlace` har ikke noe `sports`-felt; strengen forekommer ingen steder; grep i begge repoer). Det som er i produksjon er API-feltet `sports`. Hvis appen viser en slik fasett, kommer den fra kode jeg ikke ser. Anbefalingen under er uansett additiv og rører ikke API-feltet.

### 4.2 Tabellstruktur

```sql
-- Kontrollert vokabular. Nøkler er engelske OSM-kompatible verdier
-- (handball, gymnastics, martial_arts, dance …), visningsnavn på norsk.
create table public.activity_keys (
  key        text primary key,
  label_nb   text not null,
  group_key  text        -- 'ball', 'racket', 'combat', 'dance', 'board', 'esport' …
);

-- Many-to-many, ÉN rad per (sted, aktivitet, kilde). Samme aktivitet fra to
-- kilder gir to rader — det er poenget: lisens og tillit følger raden.
create table public.place_activities (
  activity_id  uuid not null references public.activities(id) on delete cascade,
  activity_key text not null references public.activity_keys(key),
  source       text not null check (source in ('osm', 'anleggsregisteret', 'manual')),
  source_ref   text,                       -- 'node/123…' | facilityId | rapport-id
  confidence   smallint not null default 100 check (confidence between 0 and 100),
  created_at   timestamptz not null default now(),
  primary key (activity_id, activity_key, source)
);
create index place_activities_key_idx on public.place_activities (activity_key, activity_id);

-- Anleggsnummer som EGEN kolonne på stedet. Aldri inn i osm_tags.
alter table public.activities add column if not exists anlegg_ref text;
create index activities_anlegg_ref_idx on public.activities (anlegg_ref) where anlegg_ref is not null;

insert into public.sources (slug, name, kind, url) values
  ('anleggsregisteret', 'Anleggsregisteret (Kultur- og likestillingsdepartementet, NLOD)',
   'crawl', 'https://www.anleggsregisteret.no')
on conflict (slug) do nothing;
```

Anlegg som finnes i registeret men **ikke** i OSM (typisk en turnhall OSM mangler) blir en egen `activities`-rad med `source_id = anleggsregisteret`, `external_id = facilityId`, `osm_tags = null`. Da forteller `source_id` alene hvilken lisens raden har.

### 4.3 API

- Nytt spørreparameter `activity=handball,gymnastics` (kommaseparert, som `category` i dag).
- RPC: ny 9-argument-variant av `activities_nearby` med `p_activities text[] default null`, samme mønster som 0013 la til `p_categories` (gammel signatur droppes, ny har alle gamle argumenter i samme posisjon — ingen overload-tvetydighet). Filter: `and (p_activities is null or exists (select 1 from place_activities pa where pa.activity_id = a.id and pa.activity_key = any(p_activities) and pa.confidence >= 60))`.
- Svar: nytt felt `activities: [{key, label, source, confidence}]` per sted. **`sports` beholdes uendret** — samme lesning av `osm_tags.sport` som i dag.
- `attribution`-strengen blir en liste: ODbL-linja alltid for `kind='place'`; NLOD-linja («Anleggsdata © Kultur- og likestillingsdepartementet, NLOD») legges til når minst én returnert rad har `source_id = anleggsregisteret` eller en `place_activities`-rad med `source = 'anleggsregisteret'`.

### 4.4 Slik holdes lisensene atskilt

Tre regler, alle håndhevbare i skjemaet:

1. `osm_tags` skrives **bare** av `import-places.ts`, og bare med det Overpass returnerte. Anleggsregister-importen har ikke `osm_tags` i sin upsert-liste i det hele tatt.
2. Alt fra Anleggsregisteret havner i `anlegg_ref`, i `place_activities` med `source='anleggsregisteret'`, eller i egne `activities`-rader med `source_id = anleggsregisteret`. Ingen av delene rører en OSM-rads OSM-felter.
3. API-et sender aldri en rad ut uten at kilden er avledbar: `source_id` på stedet, `source` på hver aktivitet. Klienten kan dermed vise «Kilde: Anleggsregisteret» på en aktivitets-pille og «© OpenStreetMap contributors» på kartet, uavhengig av hverandre.

Beriking av en OSM-rad med en NLOD-aktivitet er da ikke en «blanding» — det er to rader i to tabeller med hver sin kilde, koblet på en UUID.

### 4.5 Migrasjonsvei — uten å røre det som er i produksjon

**Fase 1 (kun additiv):** migrasjon 0015 med tabellene over. Ingen eksisterende kolonne endres, ingen rad skrives om. `sports` i API-et er identisk før og etter. En engangsjobb kopierer dagens `osm_tags.sport`-tokens til `place_activities` med `source='osm'` og `source_ref = external_id` — det er *speiling*, ikke flytting; `osm_tags` beholdes.

**Fase 2:** Anleggsregister-import (nytt script `scripts/import-anlegg.ts`): henter via endepunktet i §1a, matcher per §3b, skriver `anlegg_ref` + `place_activities`-rader for treff, egne `activities`-rader for ikke-treff *innen de anleggstypene vi har målt volumet på*. Én aktivitet av gangen, hver med sitt målte tall — det er prinsippet ditt, og skjemaet tvinger det ikke, så scriptet må ha en eksplisitt allowlist.

**Fase 3 (valgfri, senere):** la `sports` i API-et lese fra `place_activities where source='osm'` i stedet for `osm_tags.sport`. Utdata er byte-identisk hvis speilingen i fase 1 er korrekt — og det kan verifiseres med én diff før byttet. Gjøres ikke før noen har en grunn.

Ingen fase krever endring i Flutter for at appen skal fortsette å virke. Flutter-endringen (4.3-feltet `activities` + fasett-UI) kan komme når som helst etter fase 1.

### 4.6 Flutter — hva som må endres når fasetten skal vises

| Fil | Endring | Risiko |
|---|---|---|
| `lib/models/datahub_place.dart` (134 l.) | Nytt felt `activities: List<PlaceActivity>` + `fromJson` | Lav |
| `lib/services/explore_filter.dart` (112 l.) + test (175 l.) | Aktivitetsfilter ortogonalt på kategori-chips (`AND`, ikke `OR`) | Lav — ren funksjon, godt testet |
| `lib/screens/explore_screen.dart` (1433 l.) | Send `activity=` til API-et, aktivitets-rad i filterarket | **Høy** — fila er stor og bærer all henting/limit-logikk |
| `lib/widgets/place_detail_sheet.dart` (741 l.) + test (297 l.) | Aktivitets-piller med kildemerke | Middels |
| ny `lib/utils/activity_labels.dart` | key → norsk label/ikon (speil av `activity_keys`) | Lav |

Kategorivelgeren endres **ikke** — Idrettshall forblir én chip. Fasetten er en ny, uavhengig rad.

Om formulering, fordi det følger direkte av §1d: for aktiviteter som er *avledet* av byggtype («Fleridrettshall» ⇒ håndball mulig), bør pillen si «Håndball (flerbrukshall)» og ha `confidence` 70, ikke 100. Da er «tomt» fortsatt «finnes ikke», og «flerbrukshall» er ærlig om at vi vet at hallen kan, ikke at noen tilbyr. Tilbud (hvilken klubb trener når) er en annen datakilde og et annet prosjekt.

### 4.7 Omfang

| Del | Filer | Nye/endrede linjer (anslag) | Risiko |
|---|---|---|---|
| Migrasjon 0015 (tabeller, kolonne, source, RPC-variant) | 1 ny | ~90 | Middels — RPC-signaturen er det ene som kan knekke prod; mønsteret fra 0013 er kjent |
| `app/api/activities/route.ts` | 1 endret | ~40 | Lav — additivt felt + param |
| `scripts/import-anlegg.ts` (henting, matching, allowlist, rapport) | 1 ny | ~350 | Middels — mest logikk, men kjøres manuelt og kan dry-runnes |
| Speilingsjobb `osm_tags.sport` → `place_activities` | 1 ny (eller flagg i import-places) | ~60 | Lav |
| Flutter (tabellen i 4.6) | 5 endret + 1 ny + 2 tester | ~250 | Én høy (explore_screen), resten lav |
| **Sum** | **~11 filer** | **~800 linjer** | Kan leveres i tre uavhengige PR-er (migrasjon+API / import / Flutter) |

Rekkefølgen som gjør hvert steg reverserbart: migrasjon+API først (verifiser at `sports` er uendret med en diff mot prod-svar), så import i dry-run med tallene fra §1e/§2/§3 på bordet, så Flutter.

---

## 5. Svaret på utfordringen

*Kan vi gi en forelder i Oslo et sant svar på «hvor kan barnet mitt drive med håndball / turn / dans / kampsport»?*

**Turn, dans, kampsport: ja, med Anleggsregisteret** — de har egne anleggstyper med koordinater og NLOD-lisens, og OSM-dekningen for dem kan måles i vedlegg A før noe bygges.

**Håndball (og futsal, basket inne, volleyball inne): bare som «her er en flerbrukshall».** Ingen åpen kilde vi har funnet — verken OSM eller Anleggsregisteret — sier hvilke idretter en flerbrukshall brukes til. Det sanne svaret er «disse hallene kan», merket slik, ikke «her tilbys håndball». Skal Togedoo si det siste, trengs tilbudsdata fra klubber, og det er ikke løst av noe i denne rapporten.

Arkitekturen i §4 gjør begge deler mulig uten å velge nå, og uten å røre det som er i produksjon.

---

## Vedlegg A — Overpass-spørringer for §2

Mal (Oslo ligger på `admin_level=4`, øvrige kommuner på 7; grense-relasjonen sjekkes først så «0» ikke forveksles med manglende area-støtte på speilet):

```
[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"~"^(4|7)$"]["name"="Oslo"]->.a;
( <UTTRYKK>(area.a); );
out count;
```

Sett inn ett uttrykk per kjøring. Kjør med `User-Agent`-header — overpass-api.de svarer 406 uten.

```
# dans
nwr["leisure"="dance"]
nwr["sport"~"dance"]
nwr["amenity"="dancing_school"]
# kampsport
nwr["sport"~"judo|karate|taekwondo|wrestling|boxing|kickboxing|martial_arts|aikido|jiu"]
nwr["amenity"="dojo"]
# turn
nwr["sport"~"gymnastics"]
# cheerleading
nwr["sport"~"cheerleading"]
# bandy
nwr["sport"~"bandy"]
# volleyball inne (anker så beachvolleyball ikke treffer)
nwr["sport"~"(^|;)volleyball(;|$)"]["leisure"="sports_centre"]
nwr["sport"~"(^|;)volleyball(;|$)"]["indoor"="yes"]
# basket inne
nwr["sport"~"basketball"]["leisure"="sports_centre"]
nwr["sport"~"basketball"]["indoor"="yes"]
# brettspill
nwr["shop"="games"]
nwr["club"="board_games"]
nwr["amenity"="cafe"]["board_game"]
# gaming / e-sport
nwr["leisure"="amusement_arcade"]
nwr["sport"~"esports"]
nwr["amenity"="internet_cafe"]
# kontroll: hvor mye ligger skjult i multi-haller
nwr["leisure"="sports_centre"]["sport"~"multi"]
nwr["leisure"="sports_centre"]
```

## Vedlegg B — Full anleggstype-taksonomi (28 kategorier, 159 typer)

Kilde: `anleggsregister_kategorier.json` i osmno/leisure2osm, hentet 6. september 2026. Typene innen hver kategori, med OSM-mappingen leisure2osm bruker (tom = ingen mapping):

- **Aktivitetspark:** Ballareal (aktivitetspark) → pitch; Fleraktivitetsområde (aktivitetspark) → recreation_ground
- **Anlegg for ballaktivitet:** Ballbinge/ballvegg → pitch+soccer; Minigolfbane → miniature_golf
- **Anlegg for vinteraktivitet:** Akebakke; Isflate; Mindre hoppbakke; Mindre isflate (ute); Skileikanlegg
- **Basketballanlegg:** Basketbane utendørs → pitch+basketball
- **Bueskytteranlegg:** Bueskytterbane (ute); Bueskytterhall → sports_centre+archery
- **Fotballanlegg:** Fotball treningsfelt; Fotballbane gress; Fotballbane grus; Fotballbane kunstgress; Fotballhall → sports_centre+soccer
- **Friidrettsanlegg:** Friidrett treningsanlegg (inne); Friidrett treningsanlegg (ute); Friidrettshall; Friidrettsstadion grus; Friidrettsstadion kunststoff; Friplassen
- **Friluftslivsanlegg (15):** Badeplass; Dagsturhytte; Friluftsområde; Gapahuk; Klatrerute fjellvegg; Lager- og garasjebygg for friluftslivsanlegg; Overnattingshytte; Sanitærbygg; Sikringshytte; Småbåthavn; Tur-/skiløype; Turløype/tursti/turvei; Turpadleanlegg; Tursti; Turvei
- **Golfanlegg:** Driving range; Golfbane; Golfhall; Korthullsbane
- **Hestesportanlegg:** Galoppbane; Ridebane; Ridehall; Ridesti; Stall; Travbane
- **Hundesportanlegg:** Agilityhall; Agilityområde; Hundekjøringsanlegg
- **Idrettshaller og aktivitetssaler (7):** Biljardhall; Bowlinghall; Danse-/cheerleadingssal → leisure=dance; Fleraktivitetssal → sports_centre+multi; Fleridrettshall → sports_centre+multi; Kampidrettsanlegg → sports_centre; Turnhall → sports_centre+gymnastics
- **Idrettshus og servicebygg:** Garderobebygg; Idrettshus; Lager- og garasjebygg; Sanitæranlegg (frittstående); Sanitæranlegg (integrert)
- **Is- og skøyteanlegg (8):** Bandybane (ute) → pitch+bandy; Bob-/skeleton-/akeanlegg; Curlingbane (ute); Curlinghall; Hurtigløpsbane (ute); Hurtigløpshall; Ishall; Ishockeybane (ute)
- **Kart:** Orienteringskart; Turkart
- **Klatreanlegg:** Klatre/buldrevegg (inne) → sports_centre+climbing; Klatrefører; Klatrehall → sports_centre+climbing
- **Kulturarena (10):** Bibliotek; Flerbrukslokale for kultur; Galleri; Kino; Konsertsal; Museum; Produksjons- og øvelokaler; Regionalt kulturbygg; Scenekunstlokale; Utendørs kulturarena
- **Luftsportanlegg:** Flyhangar; Modellflyanlegg; Start- og landingsanlegg
- **Mindre utendørsanlegg (21):** Anlegg for radiostyrt motorsport; Ballbinge; Baseballpitch; Cricketpitch; Discgolfbane; Diskgolfanlegg; Flerbruksflate; Flerbruksområde (ute); Hinderløype; Klatre/buldrevegg (ute); Liten balløkke/-bane; Nærmiljøkart; Parkouranlegg; Petanquebane; Rulleskøytebane; Sandhåndballbane → pitch+handball; Sandvolleyballbane; Sykkelanlegg; Trimpark; Trimpark/styrkeapparater; Utendørs treningsanlegg
- **Motorsportanlegg (7):** Baneracing/roadracingbane; Bilcross/rallycrossbane; Gokartbane; Motocrossbane; Snøscooterbane; Speedway/longtrackbane; Trial/enduroløype
- **Racketsportsanlegg (7):** Bordtennisbord (ute); Bordtennishall; Padeltennisbane (ute); Padeltennishall; Squashanlegg; Tennisbane (ute); Tennishall
- **Samiske idrettsanlegg:** Lassokastingsanlegg; Reinkappkjøringsanlegg
- **Skateanlegg:** Skateboard-/rulleanlegg; Skatehall; Skateområde (aktivitetspark); Skatepark
- **Ski- og alpinanlegg:** Alpinbakke; Freestyle- og snowboardanlegg; Hoppbakke; Langrennsanlegg; Skiskytteranlegg
- **Skyteanlegg (6):** Feltskytebane (ute); Lerduebane (ute); Pistolbane (ute); Riflebane (ute); Skytebane (inne); Viltmålbane (ute)
- **Svømme- og stupeanlegg (6):** Opplæringsbasseng (inne); Opplæringsbasseng (ute); Stupebasseng (inne); Stupebasseng (ute); Trenings-/konkurransebasseng (inne); Trenings-/konkurransebasseng (ute)
- **Sykkelanlegg (6):** BMX-anlegg; Downhillsykkelløype; Pumptrack; Terrengsykkelløype; Velodrom (inne); Velodrom (ute)
- **Vannsportanlegg (6):** Båthus; Båtsportanlegg; Castinganlegg; Ro-/padleanlegg; Seilanlegg; Vannskianlegg

## Kilder

- leisure2osm, kildekode og README: https://github.com/NKAmapper/leisure2osm (lest via raw.githubusercontent.com)
- Taksonomi: https://github.com/osmno/leisure2osm/blob/master/anleggsregister_kategorier.json
- OSM Norge, tillatelse fra Kulturdepartementet (2019): https://forum.openstreetmap.org/viewtopic.php?id=66598 og https://community.openstreetmap.org/t/tillatelse-fra-kulturdepartementet-anleggsregisteret/87255
- Datasettbeskrivelse: https://data.norge.no/nb/datasets/45e016b0-5fb2-4b6f-bd6a-84019de002cd
- Avvikling av Datahotellet: https://hotell.difi.no/avvikling
- Spillemiddelbestemmelser 2025 (V-0732 B): https://www.regjeringen.no/no/dokumenter/bestemmelser-om-tilskudd-til-anlegg-for-idrett-og-fysisk-aktivitet-2025-v-0732-b/id3109192/
- Gode idrettsanlegg, anleggstyper: https://www.godeidrettsanlegg.no/anleggstype/idrettshall
- Geodata Online, Anleggsregisteret-lag: https://dokumentasjon.geodataonline.no/servicename/?geomapanleggsregister=
- Egen kode: `scripts/import-places.ts`, `app/api/activities/route.ts`, migrasjonene 0001/0005/0008/0013 i togedoo-web; `lib/models/datahub_place.dart`, `lib/services/explore_filter.dart`, `lib/screens/explore_screen.dart` i togedoo-modern
