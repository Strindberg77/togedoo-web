# Bidragsmekanisme for Togedoo — forslag

*8. september 2026. Tenkedokument. Ingen kode, ingen migrasjoner, ingen skjemaendringer.
Forutsetter `docs/flerbruk-analyse.md` (grenen `claude/handball-halls-data-assessment-5vxtu4`).*

---

## 0. Tre ting jeg vil utfordre før vi begynner

Oppdraget ba meg utfordre premissene. Her er de tre jeg mener ikke holder.

### 0.1 Waze-øyeblikket finnes ikke for oss

Waze spør om veien du kjører på, i et øyeblikk der du **allerede stirrer på appen for nøyaktig det formålet**. Navigasjonen er grunnen til at telefonen er i hånda.

Togedoo-brukeren i Bjølsenhallen er på håndballtrening med barnet sitt. Telefonen ligger i lomma. Hun åpner ikke Togedoo — hun *er* allerede der hun skulle. Skal vi fange det øyeblikket, må vi enten ha bakgrunnsposisjon (forbudt av ramme 2) eller håpe på et sammentreff som nesten aldri inntreffer.

**Men vi trenger ikke øyeblikket.** «Det er håndballmål i Bjølsenhallen» er like sant fra sofaen som fra hallen. Foreldre kan hallen barnet trener i, utenat, hele sesongen. Nærhet er ikke nødvendig for å *svare* — den er bare ett av flere bevis som kan *vekte* svaret.

Dette er den viktigste omleggingen i dokumentet: **ikke spør *ved* stedet, spør *om* stedet.** Da forsvinner hele sporingsproblemet, og rekrutteringsflaten blir mye større enn de sekundene noen tilfeldigvis står i en hall med appen åpen.

### 0.2 Dette er ikke en datastrøm. Det er en sjekkliste på ~200 punkter.

Frederik peker selv på at Waze-hendelser utløper mens våre fakta står i ti år. Konsekvensen er større enn den ser ut:

- Oslo har 209 relevante anlegg (137 Aktivitetssal + 72 Idrettshall).
- Hvert trenger **ett** godt svar.
- Fire byer: kanskje 500. Hele Norge: kanskje 2 500.

Et crowdsourcing-system som skal løse 209 punkter er feil verktøy. 209 punkter er en ettermiddag for tjue engasjerte mennesker, eller noen kvelder for fem klubber.

**Anbefaling: ikke bygg en innsamlingsmotor for å komme i gang. Så dataene direkte, og bygg bidragsmekanismen for å VEDLIKEHOLDE og UTVIDE.** Kaldstart er et seedingproblem, ikke et produktproblem. Det endrer hva som skal bygges først (§6).

### 0.3 Sjekk at dataene ikke allerede finnes — det er én dag, og det kan gjøre halve dokumentet unødvendig

> **Erstattet av §15 (8. september 2026).** Beslutningen er å ikke integrere kommunale bookingsystemer. Vurderingen under står som dokumentasjon.

Rapporten min slo fast at ingen åpen kilde beskriver *tilbud*. Det står jeg ved for **registre**. Men jeg sjekket ikke **booking­systemene**, og det er der tilbudet faktisk bor:

- Oslo kommune tildeler halltid gjennom et bookingsystem (Aktiv kommune / tilsvarende). Tildelingslistene viser hvilken klubb som har hvilken hall, hvilke dager. En håndballklubb med tirsdager 17–19 i Bjølsenhallen **er** svaret på «foregår det håndball her».
- Tildelinger av offentlig halltid er kommunale vedtak. Mye slikt er offentlig etter innsynsretten, og flere kommuner publiserer det allerede.
- Idrettskretsene og NIFs Anleggsatlas kan ha koblinger klubb→anlegg.

Jeg har **ikke** verifisert noe av dette — nettverkspolicyen i analysemiljøet blokkerer alt. Men å bygge en sosial mekanisme for å skaffe data som kan lastes ned er den dyreste feilen i dette prosjektet.

**Bruk én dag på dette før noe bygges.** Utfallet endrer ikke mekanismen under — den trengs uansett for vedlikehold, for de stedene registrene ikke dekker, og for Sverige og Danmark. Men det kan endre hvor mye av kaldstarten som er et menneskeproblem.

---

## 1. Det viktigste funnet: mekanismen finnes allerede, halvferdig

Før jeg foreslår noe nytt — dette står i repoet i dag, og det er nesten nøyaktig det oppdraget etterspør:

| Finnes | Hvor | Hva det gjør |
|---|---|---|
| Pseudonym bidragsidentitet | `lib/reports.ts:33` `reporterHash()` | Saltet SHA-256 av appens anonyme device-ID. Ingen konto, ingen profil. |
| Rate-limiting uten å telle personer | `lib/reports.ts:41` `ipHash()` | Eksplisitt kommentert: *aldri* til unikhets-telling, «familier på samme wifi deler IP». |
| Nærhets-attestering uten sporing | `place_reports.reported_from_distance_m` (0007) | **Ett heltall** — avstand bidragsyter→sted, regnet ut i innsendingsøyeblikket. Ingen koordinater lagres. Kan ikke rekonstrueres til en posisjon. |
| Mengdebasert selvbekreftelse | `lib/reports.ts:15-17` + `maybeAutoReject()` | 3 unike bidragsytere, 60 dagers vindu, innenfor 5 km → automatisk handling. |
| Én stemme per person | `place_reports_unique_reporter` (0007) | `unique (activity_id, reason, reporter_hash)`. |
| Uavhengig bekreftelse løfter i kø | `activities.high_trust` + `submit/route.ts:71-95` | To uavhengige tips innen 75 m, samme kategori → flagges, løftes øverst. **Aldri autopublisering.** |
| Menneskelig kø | `/api/admin/pending` + `/api/admin/moderate` | Sortert `high_trust desc, created_at asc`. Publiser eller avvis. |
| Kilde for brukerdata | `sources`-raden `bruker-tips` (0006) | Allerede registrert. |

Den som skrev 0007 hadde allerede løst de vanskeligste delene av ramme 1 og 2. **Forslaget under er derfor ikke et nytt system — det er den samme mekanikken brukt på et nytt spørsmål.** Det halverer omtrent hva som må bygges, og det betyr at mønsteret allerede er gjennomtenkt én gang av noen som kjenner produktet.

En ærlig anmerkning på veien: `/tips`-skjemaet har i dag et **fritekstfelt på 2 000 tegn** (`description` i `validatePlaceTip`) og samler inn **kontakt-e-post**. Det er ikke i strid med ramme 1 slik det står, fordi ingenting publiseres uten at Frederik har lest det — men det er den eneste fritekst-flaten i produktet, og den bør vurderes for seg. Forslaget under **legger ikke til én eneste ny fritekstflate.**

---

## 2. Anbefalingen

> **Bygg «Stemmer dette?» — en verifiseringsstrøm, ikke en innsamlingsstrøm.**
>
> Brukeren blir aldri bedt om å *fortelle* hva som finnes. Hun blir presentert et **påstandsforslag** vi allerede har grunn til å tro, og svarer med ett trykk: **Ja / Nei / Vet ikke.**

Hele designet følger av denne ene beslutningen.

### 2.1 Hvorfor ikke avkryssing i en lang liste

Frederiks skisse var avkryssing i en liste med søkefelt. Det er bedre enn fritekst, men det er fortsatt en **åpen oppgave**: brukeren må selv finne ut hva som er relevant, skanne en liste på tredve idretter, og avgjøre hva hun er sikker nok på. Det er tretti sekunder og en beslutning per punkt.

Tre spørsmål med ett trykk hver er fem sekunder og null beslutninger. Forskjellen i svarprosent mellom «fem sekunder» og «tretti sekunder» er ikke marginal — den avgjør om mekanismen virker i det hele tatt.

Og viktigere for ramme 3: **en lukket ja/nei-påstand er et mye renere datapunkt enn et kryss.** Et manglende kryss er tvetydig — betyr det «nei» eller «orket ikke»? Et eksplisitt «Nei» er informasjon. Et «Vet ikke» er også informasjon. Avkryssing kaster begge deler.

Søkefeltet og den lange lista beholdes — men som **den avanserte veien**, for ildsjelen som vil legge til noe vi ikke tenkte på å spørre om. Ikke som hovedflaten.

### 2.2 Hvor spørsmålene kommer fra

Aldri fra en modell som gjetter (§7). Fra en **statisk oppslagstabell**: anleggstype → aktiviteter det er verdt å spørre om.

```
Idrettshall            → håndball, futsal, basket, volleyball, innebandy, badminton
Aktivitetssal          → dans, kampsport, turn, yoga/trening, korps/øving
Turnhall               → turn, cheerleading
Kampidrettsanlegg      → judo, karate, taekwondo, bryting, boksing
Danse-/cheerleadingssal→ dans, cheerleading
```

28 anleggskategorier og 159 anleggstyper er en håndterlig tabell. Den er deterministisk, gratis, reviderbar, og virker uten nett. Vi vet allerede hvilken anleggstype hvert anlegg har for de 67 % som er matchet mot Anleggsregisteret.

For de resterende, og for Sverige/Danmark der vi ikke har et register: fall tilbake på **kategorien** (`Idrettshall` → samme spørsmålsliste). Dårligere prior, samme mekanikk.

### 2.3 Kontrollspørsmålet — det som gjør svarene målbare

Ett av spørsmålene i hver bolk er et **kontrollspørsmål**: en påstand vi er trygge på er *usann* for dette stedet. «Curling i Bjølsenhallen?»

Dette løser problemet ingen andre deler av designet løser: **føyelighet.** Folk trykker «Ja» for å være hjelpsomme. Uten en måler er den skjevheten usynlig og forgifter alt.

Med kontrollspørsmål får vi:
- en per-bidragsyter treffprosent, som er råstoffet et tillitssystem trenger (§5),
- en global måling av hvor stor føyeligheten er, som avgjør om tersklene våre er riktige,
- en billig filtrering: den som svarer ja på curling får svarene sine vektet ned, uten at noen må vurdere dem manuelt.

«Vet ikke» må ha nøyaktig samme visuelle vekt som «Ja» og «Nei». Det skal ikke koste noe å innrømme at man ikke vet.

### 2.4 Hva som vises, og når

Tre tilstander per (sted, aktivitet) — ikke to. Ramme 3 krever det:

| Tilstand | Vises som | Filtrerbar? |
|---|---|---|
| **Bekreftet** | Vanlig aktivitets-pille, som OSM-/registerdata | Ja |
| **Oppgitt** | Dempet pille med merket «Oppgitt av besøkende» | Ja, men med markør i treffet |
| **Under vurdering** | Vises ikke for andre enn Frederik | Nei |

«Oppgitt» er nøkkelen til at bidrag ikke svekker troverdigheten. En forelder som ser «Håndball — oppgitt av besøkende» vet nøyaktig hva hun har. «Tomt betyr finnes ikke» holder fortsatt, fordi det som er usikkert er *merket* usikkert, ikke *skjult* og ikke *utgitt for å være fakta*.

Om «Oppgitt» skal telle i filtrering er en reell avveining. Teller den ikke, får forelderen fortsatt 3 treff på håndball og mekanismen føles nytteløs. Teller den, kan hun kjøre til en hall som ikke har håndball. **Jeg lander på: den teller, men treffet er merket, og filterchipen sier «inkluder usikre» som på som standard.** Frederik kan overprøve — dette er en produktbeslutning, ikke en teknisk.

---

## 3. Datamodellen

Bygger på `place_activities` fra flerbruk-analysen §4.2, og lar den stå som den er.

### 3.1 Rå svar i egen tabell — ikke i `place_activities`

`place_activities` har primærnøkkel `(activity_id, activity_key, source)`. Med `source='user'` finnes det da **én** brukerrad per sted/aktivitet — men vi trenger mange enkeltsvar. Løsningen er to lag:

```sql
-- LAG 1: rå svar. Leses ALDRI av /api/activities.
create table public.place_activity_answers (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  activity_key text not null references public.activity_keys(key),

  -- Lukket svar. Ingen fritekst noe sted i denne tabellen.
  answer       text not null check (answer in ('ja', 'nei', 'vet_ikke')),

  -- Samme pseudonyme identitet som place_reports (lib/reports.ts:33).
  reporter_hash text,
  ip_hash       text not null,        -- KUN rate-limiting, slettes etter 24 t

  -- Nøyaktig samme personvernform som place_reports: ETT heltall, regnet ut
  -- i svarøyeblikket. Ingen koordinater lagres, ingen historikk, ingen
  -- bakgrunnsposisjon. Null når appen ikke hadde posisjon — svaret teller
  -- da fortsatt, bare med lavere vekt.
  answered_from_distance_m integer,

  -- Selvoppgitt tilknytning, strukturert valg (ikke fritekst).
  relation     text check (relation in ('barn_trener_her','bor_i_naerheten','har_vaert_der','vet_ikke')),

  is_control   boolean not null default false,   -- kontrollspørsmål (§2.3)
  created_at   timestamptz not null default now(),

  -- Én stemme per person per påstand. Samme mønster som
  -- place_reports_unique_reporter i 0007.
  unique (activity_id, activity_key, reporter_hash)
);

create index place_activity_answers_agg_idx
  on public.place_activity_answers (activity_id, activity_key);
```

### 3.2 Aggregatet skrives til `place_activities` med `source='user'`

Ja — `'user'` passer inn i §4.2-modellen uten endringer i tabellstrukturen, kun i CHECK-en:

```sql
-- source: 'osm' | 'anleggsregisteret' | 'manual' | 'user'
-- confidence bærer den beregnede skåren (§4), ikke en fast verdi.
-- source_ref: 'answers:<antall>' — sporbarhet tilbake til lag 1.
```

Det gir tre gevinster gratis:
- **Lisens holdes atskilt** (flerbruk-analysen §4.4). Brukersvar er verken ODbL eller NLOD; de er sitt eget opphav, i sin egen rad, med sin egen kilde. Ingenting skrives til `osm_tags`.
- **API-et trenger ingen ny form.** `activities: [{key, label, source, confidence}]` finnes allerede i forslaget. Klienten ser `source='user'` og `confidence` og velger visning (§2.4).
- **Én terskel styrer alt.** RPC-filteret `confidence >= 60` avgjør hva som er filtrerbart, uavhengig av kilde.

### 3.3 Ingen tredje tabell for uenighet

Frederiks kø er en **spørring**, ikke en tabell: grupper `place_activity_answers` på (sted, aktivitet), regn ut skår, vis alt som er omstridt eller under terskel. Ingenting å vedlikeholde, ingen tilstand som kan bli inkonsistent.

---

## 4. Uenighet ved lave tall

Frederiks spørsmål: to sier håndball, én sier nei.

**Svaret er at flertall er feil verktøy, og at vi ikke skal avgjøre det maskinelt.**

### 4.1 Skåren

Hvert svar får en vekt `w`, startende på 1,0:

| Signal | Effekt på w |
|---|---|
| `answered_from_distance_m` < 300 m | × 1,5 |
| `relation = 'barn_trener_her'` | × 1,5 |
| `relation = 'vet_ikke'` og ingen posisjon | × 0,6 |
| Bidragsyter har bommet på kontrollspørsmål | × 0,3 |
| Tillitsvekt fra ildsjelsystemet (§5), når det finnes | × vekt |

```
skår = Σ(w for «ja») − Σ(w for «nei»)
```

«Vet ikke» bidrar 0 til skåren, men teller i `n_asked` — det er informasjon om at påstanden ikke er åpenbart sann.

### 4.2 Terskler (forslag — Frederik justerer)

| Utfall | Krav |
|---|---|
| **Bekreftet** (`confidence` 80) | skår ≥ 3,0 · minst 3 unike bidragsytere · ingen «nei» med w ≥ 1,0 |
| **Oppgitt** (`confidence` 50) | skår ≥ 1,5 · minst 2 unike bidragsytere · ingen «nei» med w ≥ 1,0 |
| **Omstridt** → Frederiks kø | både «ja» og «nei» har samlet vekt ≥ 1,0 |
| **Under vurdering** | alt annet |

**«2 ja, 1 nei» med like vekter gir skår 1,0 og er omstridt → det går til et menneske.** Det er riktig svar. Ved N=3 finnes det ingen statistisk sannhet å hente, og et system som later som det gjør det, bryter ramme 3.

Én nyanse som er verdt å tenke på, men som jeg **ikke** anbefaler å bygge inn nå: «nei» er ofte en svakere påstand enn «ja». Håndballmålene kan stå bortsatt i et sidrom. En som sier «ja, jeg har sett dem» har sett noe; en som sier «nei» har unnlatt å se noe. Å vekte «nei» ned ville imidlertid gjøre systemet lettere å forgifte, og det er ikke verdt det før vi har målt om det faktisk er et problem.

### 4.3 Ingenting er permanent

Alle utfall er reversible. En omstridt påstand som senere får tre samstemte «ja» går til bekreftet. En bekreftet påstand som får to «nei» fra folk som er i hallen faller tilbake til omstridt. Fakta er stabile over år, men *vår tro på dem* skal kunne endres av nye svar — uten at noen må rydde manuelt.

---

## 5. Hva mekanismen trenger fra ildsjel-/poengsystemet

Jeg designer det ikke. Men grensesnittet det må tilby:

**Lese:** `trustWeight(reporter_hash) → number` i `[0,1]`, med **1,0 som standard hvis systemet ikke finnes**. Mekanismen må virke uendret uten det.

**Skrive:** tre signaler, når de oppstår:
- `control_correct` / `control_wrong` — kontrollspørsmål (§2.3), det reneste signalet vi har
- `agreed_with_consensus` — svaret endte på samme side som utfallet
- `overturned` — svaret ble senere motbevist

**Krav:** systemet må ikke kreve identitet. Alt over virker på en device-hash. I det øyeblikket tillit krever konto, mister vi de fleste bidragene.

---

## 6. Minste mulige førsteskritt

Vi vet ikke det viktigste: **vil noen svare i det hele tatt, og er svarene noe verdt?** Alt annet i dette dokumentet er bortkastet hvis svaret er nei. Så det er det eneste som skal bygges først.

### Steg 1 — samle, ikke publiser

**Én tabell** (`place_activity_answers`, §3.1). **Én API-rute** (`POST /api/places/activity-answer`, en nesten ordrett kopi av `places/report/route.ts` — samme rate-limiting, samme hashing, samme avstandsberegning). **Én seksjon i detaljarket** for steder med kategori `Idrettshall`: «Vet du hva som foregår her?» og tre spørsmål med Ja/Nei/Vet ikke, hvorav ett er kontrollspørsmål.

**Ingen** aggregering. **Ingen** publisering. **Ingen** `place_activities`-skriving. **Ingen** AI. **Ingen** prompts. **Ingen** nabolagsseksjon. Ingenting av dette vises til noen andre enn Frederik.

Spørsmålslista er en hardkodet tabell for de fem anleggstypene som betyr noe (§2.2). Ikke 159.

### Hva vi lærer på to uker

1. **Svarrate.** Hvor mange svar, fra hvor mange unike `reporter_hash`? Under ~20 svar er hele premisset dødt, og vi har brukt noen dager, ikke noen uker.
2. **Nøyaktighet.** Frederik velger ti haller han *vet* sannheten om, før innsamlingen starter. Etterpå måles svarene mot fasit. Det gir en **målt feilrate** før noe går live — som er nøyaktig kulturen i dette prosjektet: vi bygger ikke kategorier for data vi ikke har målt volumet på.
3. **Føyelighet.** Hvor mange svarer «ja» på kontrollspørsmålet? Det tallet avgjør om tersklene i §4.2 er nær riktige eller helt feil.
4. **Fordeling av «Vet ikke».** Hvis nesten alle svarer «vet ikke», spør vi om feil ting.

Først når de fire tallene finnes, bygges aggregering og publisering. Rekkefølgen etterpå: skår og terskler → «Oppgitt»-visning → melde manglende sted → nabolagsseksjon.

---

## 7. AI — hvor den hører hjemme, og hvor den ikke gjør det

**Anbefaling: ikke bruk AI i steg 1. Sannsynligvis ikke i steg 2 heller.**

Friksjonen skisseoppdraget vil fjerne med AI, fjernes bedre av en statisk tabell (§2.2). 159 anleggstyper er ikke et maskinlæringsproblem — det er et regneark. Tabellen er deterministisk, koster ingenting, kan revideres av et menneske, virker offline og gir samme svar hver gang. En modell gir ingen av delene.

Når AI *kan* forsvares, senere:

| Bruk | Hvorfor forsvarlig |
|---|---|
| **Dublettsøk ved nytt sted** — «mente du Bjølsenhallen?» | Utdata er et *forslag brukeren bekrefter*, valgt fra rader som allerede finnes. Modellen kan ikke finne på et sted. |
| **Navnenormalisering** — «bjølsen hallen» → «Bjølsenhallen» | Samme: matching mot et lukket sett. |
| **Prioritering av Frederiks kø** | Rangering, ikke avgjørelse. Feil rekkefølge koster tid, ikke sannhet. |

Og den harde regelen, som følger direkte av ramme 3:

> **AI-utdata skal alltid være et spørsmål eller et forslag som et menneske bekrefter, og skal alltid være begrenset til et lukket vokabular (`activity_keys`, eksisterende `activities`-rader). Kan utdataene ikke tvinges inn i en enum, skal AI ikke brukes der.**

En modell skal aldri svare på «foregår det håndball her». Det er nøyaktig usikkerheten ramme 3 forbyr, og den ville vært usynlig i dataene etterpå.

---

## 8. Manglende steder — en annen mekanisme

Nei, det er ikke samme mekanisme, og det bør ikke være det.

Å svare «ja» på en påstand om et sted som finnes er et **lukket** bidrag: ett felt, tre valg, ingen identitet skapt. Å melde inn et nytt sted er et **åpent** bidrag: navn, posisjon, kategori — brukeren skaper en rad andre skal stole på. Ulik risiko, ulik moderering.

### 8.1 Det viktigste: de fleste «manglende» steder mangler ikke

Vi har hentet 54 821 anlegg fra Anleggsregisteret. Bare 67 % av våre idrettshaller er matchet. **Resten av registeret er steder vi ikke har importert ennå — ikke steder som mangler.**

Derfor: søkefeltet i «meld inn et sted» må søke i **både** våre publiserte steder **og** de uimporterte registerradene. Finner brukeren stedet i registeret, er bidraget hennes ett trykk — «ja, dette stedet burde være i appen» — og raden fødes fra NLOD-data med Anleggsregisteret som kilde, ikke fra brukerens tastatur.

Det gjør «meld inn nytt sted» til siste utvei i stedet for første valg, og fjerner mesteparten av modereringsbyrden (§9).

### 8.2 Lisens og kildeangivelse for ekte nye steder

Et sted som verken finnes i OSM eller Anleggsregisteret er **født hos oss**:

- Kilde `bruker-tips` (finnes allerede, 0006). Ikke ODbL, ikke NLOD.
- **Må fødes rent.** Innsendings-UI-et skal ikke forhåndsfylle fra OSM, Google Maps eller noen annen kilde med egne vilkår. Skriver brukeren av et Google-treff, arver vi et problem. Feltene er tomme, og posisjonen settes på kart eller fra egen posisjon.
- Vilkår ved innsending: bidragsyteren gir Togedoo rett til å bruke og videreformidle opplysningen. Kort, på norsk, ett avkryssingsfelt.
- Attribusjon utad: **«Meldt inn av en bruker»** — aldri navn, aldri brukernavn, aldri lenke til en profil. Ramme 1.
- Bidraget forblir i vår database. Vi eksporterer det ikke til OSM uten en egen beslutning — det er en annen lisens og et annet samtykke.

---

## 9. Godkjenning — hvor veggen står

Frederik modererer i starten. Her er tallene som avgjør når det tar slutt.

| Type | Tid per sak | Kan auto-behandles? |
|---|---|---|
| Samstemt aktivitetssvar | — | **Ja, fra dag én.** Reversibelt, lukket vokabular, ingen tekst å lese. |
| Omstridt aktivitetssvar | ~30 sek | Nei — det er hele poenget (§4.2). |
| «Nytt sted» som matcher en registerrad | ~15 sek | **Ja, etter at mekanismen er målt.** Brukeren peker på et offentlig register, ikke på egen tekst. |
| Ekte nytt sted (ingen registertreff) | 2–3 min | Nei. Navn, posisjon, kategori, eventuelt bilde. |

**Veggen er ikke aktivitetssvarene — det er ekte nye steder.** 209 haller × 8 påstander gir ~1 700 par i Oslo; er 10 % omstridt er det 170 avgjørelser, altså under to timer, én gang. Det er håndterbart.

Ekte nye steder er derimot en **strøm** som ikke tar slutt. Ved 2–3 minutter per sak og 30 minutter tilgjengelig per dag går grensen ved **omtrent ti nye steder per dag**. Over det hoper køen seg opp for alltid.

Derfor: dedupliseringen i §8.1 er ikke en bekvemmelighet, den er det som holder køen levelig. Og når volumet nærmer seg ti per dag, er valget enten flere moderatorer (ildsjelrollen — egen samtale) eller å slutte å ta imot ekte nye steder i den byen. Det siste er et helt legitimt valg.

---

## 10. Hvem spør vi, og når?

Uten sporing, og uten mas.

**Aldri en modal. Aldri et varsel. Aldri mer enn ett spørsmål per økt.**

Tre flater, i prioritert rekkefølge:

1. **I detaljarket for et sted, alltid tilgjengelig.** En rolig seksjon nederst: «Vet du hva som foregår her? — 3 spørsmål». Ingen tidsstyring, ingen betingelser. Den som er nysgjerrig nok til å åpne arket er den beste bidragsyteren vi har.

2. **Det tomme søketreffet — den sterkeste flaten vi har.** Filtrerer en forelder på «håndball» i Oslo og får 3 treff, er det *nøyaktig* der vi skal si det som er sant: «Vi vet om håndball i 3 haller, men Oslo har 209 idrettsanlegg vi ikke har data om ennå. Kjenner du noen av dem?»

   Dette er den eneste rekrutteringsflaten som treffer en motivert bruker i det øyeblikket mangelen faktisk koster henne noe. Den er også ærlig på en måte ramme 3 krever: den forklarer hvorfor resultatet er tynt, i stedet for å la brukeren tro at det ikke finnes håndball i Oslo.

3. **Etter gjentatt interesse for et sted.** Har brukeren åpnet samme sted to ganger, eller lagret det, er det et signal vi allerede har — ingen ny innsamling. Én forsiktig forespørsel, maks én per bruker per dag.

Og posisjon: **bare hvis appen allerede har den, i forgrunnen, i svarøyeblikket.** Har den den ikke, spør vi ikke om den — svaret teller uansett, bare med lavere vekt (§4.1). Ingen posisjonsdialog utløses av et bidragsspørsmål. Det er forskjellen mellom å bruke en posisjon vi har, og å skaffe en vi ikke trenger.

---

## 11. Nabolagsseksjonen — begge sider, og et svar

**For:** Ildsjeler trenger et sted som er deres. Bidrag blir en destinasjon, ikke et avbrudd. Bidragshistorikk, oversikt over hva nabolaget mangler, mulighet til å jobbe seg gjennom en liste. Den støtter identiteten «jeg gjør noe for nabolaget», som er en helt annen og sterkere motivasjon enn «jeg svarte på et spørsmål».

**Mot:** En seksjon bare ildsjeler besøker, får trafikk fra ~1 % av brukerne. Svarene vi trenger, kommer fra vanlige foreldre som aldri åpner den. Og en egen seksjon bygget før det finnes ildsjeler å fylle den med, er et tomt rom i navigasjonen — det verste et lite produkt kan ha.

**Svaret: begge, men i rekkefølge. Innebygd først, seksjon senere.**

Selve *svaringen* hører hjemme der vanlige brukere allerede er (§10) — det er der volumet kommer fra, og det er billig å bygge. Seksjonen bygges først når vi har målt at det finnes mennesker som svarer på mer enn fem steder hver. Da har den et publikum, og da er jobben dens en annen: bulkarbeid, egen historikk, kanskje kø. Å bygge seksjonen først er den klassiske feilen — vi ville bygget hjemmet før beboerne fantes.

---

## 12. Hva jeg ikke vet

Ærlig liste. Ingenting av dette kunne verifiseres herfra — analysemiljøet har ingen nettilgang, og jeg har ikke brukerdata.

- **Om noen svarer.** Hele forslaget hviler på det. Steg 1 (§6) er utformet for å svare på det billigst mulig.
- **Hvor stor føyeligheten er.** Kontrollspørsmålet måler den, men jeg har ikke noe grunnlag for å anslå den på forhånd. Er den svært høy, må vektene i §4.1 skrives om.
- **Om booking-/tildelingsdata er åpne** (§0.3). Uverifisert. Kan endre kaldstarten vesentlig.
- **Tallene i §4.2.** Terskel 3,0 og 1,5, vektene 1,5 og 0,6 — de er begrunnede gjetninger, ikke målt. De må justeres mot de ti fasit-hallene.
- **Om «Aktivitetssal» i det hele tatt er et sted en forelder vil finne.** 137 av Oslos 209 er aktivitetssaler. Er de i praksis kjellerlokaler uten offentlig tilgang, jager vi et tall som ikke betyr noe for brukeren. Det bør sjekkes på ti av dem før mekanismen skaleres.
- **Personvernstatusen til `reporter_hash` + avstand.** Et saltet device-hash er pseudonymt, ikke anonymt, og kan etter GDPR regnes som personopplysning. Dagens `place_reports` har allerede samme eksponering. Det trenger en vurdering og en personvernerklæring — men det er ikke ny risiko innført av dette forslaget.
- **Én ting som bør ryddes uansett:** `place_reports.ip_hash` lagres i dag permanent, selv om den kun brukes til rate-limiting i et én-times vindu. Den bør slettes etter et døgn. Det gjelder eksisterende kode og er utenfor dette oppdraget, men det hører hjemme i samme personvernvurdering.

## 13. Hva Frederik må bestemme

1. **Sjekkes booking-/tildelingsdata først?** (§0.3 — én dag, kan endre alt)
2. **Teller «Oppgitt» i filtrering?** (§2.4 — produktbeslutning, ikke teknisk)
3. **Tersklene** i §4.2 — mine tall er utgangspunkt, ikke fasit.
4. **De ti fasit-hallene** til §6 må velges av ham, før innsamlingen starter.
5. **Krever bidrag konto?** Min klare anbefaling: nei. Device-hash holder, og konto vil koste oss de fleste svarene.
6. **Hvor lenge lagres rå svar?** Forslag: så lenge stedet finnes; `ip_hash` slettes etter 24 timer.
7. **Vilkårsteksten** for brukerinnsendte steder (§8.2).
8. **Når stenges innmelding av ekte nye steder i en by** hvis køen renner over? (§9)

---

## 14. Togedoo Workplace — kort

To ting er gjenbrukbare, ett er det ikke.

**Gjenbrukbart, og verdt å skille ut allerede nå:** aggregeringskjernen — lukket spørsmål, vektet svar, uenighet til menneske, tre visningstilstander — er helt domenefri. Det samme gjelder `lib/reports.ts` (hashing, avstand, terskler), som allerede er skrevet generisk nok.

**Ikke gjenbrukbart:** vokabularet (`activity_keys`) og spørsmålstabellen. De er Togedoo-spesifikke.

**Praktisk konsekvens:** hold skåren og tersklene i en egen modul (`lib/consensus.ts`) uten import av aktivitetsbegreper, og la den ta vokabularet inn som parameter. Det koster ingenting nå og gjør flyttingen triviell senere.

Én advarsel om Workplace: der er bidragsyterne kolleger i en kjent, liten krets. Pseudonymitet fungerer dårlig — folk vet hvem som svarte, og «vet ikke» blir sosialt dyrt. Vektingen og kontrollspørsmålene ville trolig gjort mer skade enn nytte i den konteksten. Kjernen flytter; **tillitsmodellen gjør det ikke.**

---

## 15. Prinsipp: hvilke datakilder Togedoo bruker — og hvorfor ikke flere

*Beslutning tatt 8. september 2026. Erstatter anbefalingen i §0.3 om å
undersøke kommunale bookingsystemer.*

Togedoo henter data fra **tre kilder, og ikke flere**:

1. **OpenStreetMap** (ODbL) — steder og geografi. Grunnmuren.
2. **Anleggsregisteret** (NLOD) — idrettsanlegg, anleggstype, anleggsnummer.
   Bekrefter og utvider OSM.
3. **Brukere og aktører selv** — det de to andre ikke kan se: hvilke
   aktiviteter som faktisk foregår, og tilbud fra aktører som melder seg inn.

Kommunale bookingsystemer, tildelingslister, idrettskretsenes registre og
tilsvarende **skal ikke integreres**, selv der dataene er tilgjengelige.

### Begrunnelse

**Skalering.** Kommunale kilder finnes i Oslo, kanskje i Bergen, i annen form
i Trondheim, og ikke i det hele tatt i Sverige og Danmark. Bygger vi på dem,
må grunnlaget reforhandles i hver by og hvert land. Brukermekanismen virker
likt overalt fra dag én. Det er hele poenget med den.

**Vedlikeholdskostnad.** Hver ekstra kilde er et integrasjonspunkt som kan
endre seg, slutte å virke eller endre lisens. Én økt (8. september 2026) ga
tre eksempler: Datahotellet er nedlagt, OSM-miljøets taksonomispeil var
utdatert på anleggstypenavnene, og endepunktet vi faktisk bruker er
udokumentert.

**Datatype.** Bookingdata sier hvem som har leid halltid — ikke om det er et
barnetilbud, om det er åpent for nye, eller om det passer for en femåring.
Det er data av en annen art enn resten av biblioteket, med egen tolkning og
egne feilkilder.

### Hva dette betyr i praksis

Kaldstart løses ved seeding (§6), ikke ved en ny integrasjon. Der vi ikke vet,
sier vi at vi ikke vet, og spør brukerne. Tilliten bygges over tid gjennom
mennesker — ikke gjennom flere leverandører.
