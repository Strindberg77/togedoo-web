# Arrangementer og betalende aktører

**Status:** vurdering, ingen beslutning tatt. Ingen kode endret.
**Skrevet:** sep. 2026, som svar på spørsmålet om tidsbundne tilbud fra
arrangører som betaler for plassen.

Alt under er verifisert mot koden i `togedoo-web` og `togedoo-modern` slik
den står på `main`. Der jeg ikke har kunnet verifisere noe, står det
eksplisitt — basen selv er ikke tilgjengelig herfra, så alle radtall er
gjengitt fra oppdraget og ikke etterprøvd.

---

## Sammendrag

Arrangementssporet er **vesentlig mer bygget enn antatt**. Gjentakelse,
sluttidspunkt, moderasjon, arrangørkontoer, lenketolkning og en kjørende
cron finnes alle i produksjonskoden i dag.

Det som mangler er ikke datamodellen. Det er tre små defekter som gjør at
et betalt tilbud ikke kan vises ærlig, og én produktavklaring: **du kan
ikke selge plassering før plassering kan garanteres**, og i dag kan den
ikke det i noen av appens to henteveier.

Begge deler løses billigere enn det ser ut — ikke ved å fikse
utvalgsmekanikken, men ved å gi arrangementer sin egen flate.

---

## Del 1: Korreksjoner til premissene

Fem av punktene under «hva som mangler» viste seg å finnes. Det flytter
kostnadsbildet betydelig, så de står først.

### Gjentakelse FINNES

`lib/organizer.ts` har `expandOccurrences()`: ukentlig, annenhver uke og
månedlig, styrt enten av antall ganger eller en til-dato, med klamping av
måneds­skift (31. jan + 1 mnd = 28./29. feb) og et tak på 25 forekomster.
Modellen er én rad per forekomst, ikke RRULE — bevisst valgt fordi det er
enklere å moderere og filtrere.

`app/arranger/page.tsx` har UI for det, med et levende sammendrag
(«Dette vil opprette N aktiviteter, fra … til …»).
`app/api/organizer/submit/route.ts` ekspanderer ved innsending og gir hver
forekomst sin egen `external_id` (`innsending-<uuid>-<n>`).

En forestilling som spilles fem lørdager er altså allerede løst.

### `ends_at` FINNES

Kolonnen er i grunnskjemaet (`0001_datahub_foundation.sql`), leses av
`/api/activities` (`endsAt` i `toApiShape`), settes av arrangørflyten, og
plukkes opp av lenketolkningen fra både `schema.org`-JSON-LD og
`__NEXT_DATA__`.

### Moderasjon FINNES

- `activities.status` defaulter til `pending` for anonyme innsendinger
- `GET /api/admin/pending` lister dem, `high_trust` først
- `POST /api/admin/moderate` publiserer eller avviser
- `organizers.verified = true` gir auto-publisering uten moderasjon
- Anonyme innsendinger er rate-limitet (5/time per IP, per instans)
- `PATCH /api/admin/reports` med `action='fjern_sted'` tar ned en
  publisert rad og setter `locked=true`

### Cron FINNES, og kjeden er hel

`vercel.json` → `0 5 * * *` → `GET /api/sync` (Bearer `CRON_SECRET`) →
`runFullSync()` → `expireOldEvents()`.

`expireOldEvents()` setter `status='expired'` på alle `kind='event'` med
`starts_at` eldre enn 24 timer. Det er mekanismen som har produsert de 928
utløpte bibliotekradene.

### Arrangørsiden er ikke «halvt bygget»

`/arranger` har lenketolkning (JSON-LD → `__NEXT_DATA__` → OpenGraph, med
SSRF-sperre), full skjemaflyt, gjentakelses-UI, og `/arranger/konto` med
magic-link-innlogging og «mine aktiviteter». Innsendingsveien er komplett.

### Kultur-kollisjonen finnes ikke ennå

`CategoryTheme.forCategory('Kultur')` faller i dag til `standard` — grå
nål, `standard.png`, ingen tagline. En arrangementsrad med
`category='Kultur'` arver altså **ikke** museumstemaet i dag.

Kollisjonen oppstår i nøyaktig det øyeblikket `Museum` døpes om til
`Kultur`. Den er selvpåført av omdøpingen, ikke et eksisterende problem.
Det er en presisering som gjør argumentet mot omdøping sterkere, ikke
svakere. Se punkt h.

---

## Del 2: Tre defekter som blokkerer første betalende kunde

Dette er hele listen over ting som må rettes før noen kan betale uten at
noe er usant. Alle tre er små.

### Defekt 1 — utløp ignorerer `ends_at`

```ts
// lib/ingest.ts:175
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
… .eq('kind', 'event').eq('status', 'published').lt('starts_at', cutoff)
```

Utløpet ser kun på `starts_at`. For et bibliotekarrangement på én time er
det riktig. For en utstilling som varer tre uker, en festival over en helg,
eller en teateroppsetning med spilleperiode, er det **direkte feil**:
tilbudet forsvinner ett døgn etter åpningsdagen mens det fortsatt pågår.

En betalende arrangør som kjøper synlighet for en spilleperiode, får
synlighet for dag én. Det er den eneste defekten på denne lista som gjør
noe usant overfor en kunde som allerede har betalt.

Retting: utløp på `coalesce(ends_at, starts_at)` i stedet for `starts_at`.

Samme skjevhet finnes i RPC-ens tidsfilter
(`a.starts_at > now() - interval '2 hours'`, migrasjon 0013) og bør
rettes i samme omgang.

### Defekt 2 — by-modus har ikke noe tidsfilter i det hele tatt

`activities_nearby` filtrerer bort gamle arrangementer. By-modus-grenen i
`route.ts` gjør det ikke — der er `status='published'` eneste vern.

Et arrangement som gikk i går kl. 10 er fortsatt `published` til cron
kjører 05:00 UTC (07:00 norsk). I by-modus vises det i inntil ~21 timer
etter at det er over.

Kravet ditt — «tilbud som har gått ut på dato må forsvinne av seg selv» —
holder i radius-modus og holder ikke i by-modus.

### Defekt 3 — by-modus sorterer på `starts_at`, og det er en tikkende bombe

```ts
// route.ts, by-modus
.eq('status', 'published')
.order('starts_at', { ascending: true, nullsFirst: false })
.limit(limit)   // appen sender 100
```

`seed-backlog.md` beskriver dette som «vilkårlig utvalg», og det er riktig
**så lenge alle rader er steder med `starts_at = null`**.

I det øyeblikket klienten slutter å sende `kind: 'place'`, blir
sorteringen ikke lenger virkningsløs — den blir styrende. `nullsFirst:
false` gjør at **alle arrangementer kommer først, eldste øverst**, og
stedene etterpå. De 100 radene fylles ovenfra.

Konsekvensen i Oslo, med ~935 bibliotekrader i basen: er mer enn hundre av
dem `published` samtidig, forsvinner **samtlige 3996 lekeplasser og alle
andre steder** fra by-modus. Ikke nederst — borte.

Dette er en annen og verre feilklasse enn funn 1 i `nasjonal-dekning.md`.
Der er skjevheten gjenopprettelig: brukeren kan fravelge Lekeplass og finne
museet. Her er den ikke det, fordi det ikke er kategorien som sorterer —
det finnes ingen handling i appen som henter stedene tilbake.

**Dette er den bindende skranken for arrangementer, ikke `limit: 100`.**

---

## Del 3: En fjerde defekt som gjelder Deichman-sporet

`lib/ingest.ts` upserter med `status: 'published'` hardkodet, og sjekker
ikke `locked`.

`locked`-mønsteret finnes og fungerer — `scripts/import-places.ts:789`
slår opp låste rader og hopper over dem, så en brukerrapport som tar ned et
sted overlever re-import. **Arrangementsingesten mangler den sjekken.**

Følgen: avviser du manuelt en Deichman-rad, er den publisert igjen neste
morgen kl. 07. Manuell moderasjon av bibliotekarrangementer overlever ikke
natten.

Det rammer ikke arrangør-innsendinger (de har ingen adapter i `ADAPTERS`),
så det blokkerer ikke betalingssporet. Men det blokkerer punkt g.

---

## Svar på spørsmålene

### a) Minste versjon som fungerer for en betalende arrangør

Skjemaet trenger ingenting nytt. Det som skiller dagens tilstand fra et
salgbart produkt er fire ting, og den fjerde er den viktigste:

1. Defekt 1 rettet (tilbudet lever ut spilleperioden)
2. Klienten henter arrangementer i det hele tatt
   (`datahub_service.dart:45` sender alltid `kind: 'place'`)
3. `DatahubPlace` bærer `startsAt`/`endsAt`
4. **En flate der plasseringen er garantert**

Punkt 4 er produktavklaringen, ikke et teknisk krav. Selger du «plassen»,
selger du noe appen i dag ikke kan love:

| Modus | Hva arrangøren faktisk kjøper |
|---|---|
| Radius | En plass i konkurranse med 3996 lekeplasser om 100 rader |
| By | Et utvalg som er vilkårlig (defekt 3) |

Én kunde betaler for at teatret skal *vises*. Det kan du ikke garantere i
Utforsk. Du kan garantere det på en egen flate som henter arrangementer
med sitt eget kall og sitt eget tak — se punkt d og e.

**Betalingen selv hører ikke til v1.** Faktura til én kunde er en avtale,
ikke et produkt. Bygg ikke Stripe, abonnementslogikk eller selvbetjent
kjøp før kunde nummer tre. Ingenting i koden peker mot betaling i dag, og
det er riktig så lenge.

### b) Datamodellen

**Nødvendig nå: ingenting.** `starts_at`, `ends_at`, `url` (billettlenke),
`image_url`, `price_text`, `target_audience` og `contact_email` finnes
alle, og arrangørflyten fyller dem.

**Nødvendig når det er penger i det — én kolonne:**

Et flagg som skiller betalt plassering fra vanlig innsending. Uten det kan
du verken prioritere raden, rapportere til kunden hva den fikk, eller
skille kommersielt innhold fra redaksjonelt.

Det siste er ikke bare ryddighet. Markedsføringsloven § 3 krever at
markedsføring skal framstå tydelig som markedsføring. Et betalt teatertilbud
vist side om side med gratis biblioteksarrangementer, uten merking, er
sannsynligvis skjult reklame — og i en app rettet mot barnefamilier er det
et dårlig sted å ta sjanser. **Dette bør du få bekreftet av noen som kan
feltet før første faktura, ikke av meg.** Kolonnen koster ingenting å
legge inn; merkingen i appen er en etikett.

**Kan vente:**

- *Aldersintervall som tall.* `target_audience` (Barn/Ungdom/Familie/For
  alle) er for grov for «fra 4 år», men fri tekst i beskrivelsen holder
  til det finnes et aldersfilter å filtrere med. Numerisk `min_age`/
  `max_age` er billig senere og gir null verdi før filteret finnes.
- *Relasjon arrangement → sted.* `venue_name` + geokoding plasserer
  allerede raden på kartet. En ekte fremmednøkkel gir «hva skjer her» på
  stedets detaljark — reell verdi, men ikke på veien til første kunde.
- *Gjentakelse.* Finnes.

### c) Utløp

**Hvem kjører den:** Vercel Cron, `0 5 * * *` (05:00 UTC / 07:00 norsk),
mot `/api/sync`. Kjeden er verifisert hele veien. Det skjer ikke ved
import — `expireOldEvents()` kalles av `runFullSync()` etter at kildene er
hentet.

**Defektene:** se defekt 1 og 2 over.

**Hva brukeren skal se:** stille forsvinning.

«Avsluttet» er bare nyttig hvis det finnes noe å gjøre videre. Et
arrangement som var i går, og som ikke gjentas, er støy i en liste en
forelder skanner på ti sekunder. Og for en betalende arrangør er «utløpt»
dårligere enn ingenting — det er kjøpt plass brukt på noe som ikke kan
kjøpes.

Unntaket er gjentakelse, og der er svaret bedre enn «avsluttet»: siden hver
forekomst er sin egen rad, er «neste lørdag 14:00» en billig spørring. Vis
neste forekomst i stedet for å markere den forrige som over.

### d) Forsiden — henger den sammen med per-kategori-grensen?

**Ja, men motsatt av det `nasjonal-dekning.md` konkluderer med.**

Det dokumentet sier at per-kategori-grensen «blir et krav i det øyeblikket
appen selv setter sammen utvalget». Premisset er at forsiden henter ÉN
liste og deler den opp.

Bygger du forsiden som **separate kall per seksjon** — ett for «skjer
nå» (`kind=event`, eget tak), ett for «i nærheten» (`kind=place`) —
finnes problemet ikke. Hver seksjon har sitt eget utvalg, og ingen
kategori kan fortrenge en annen fordi de aldri deler tak.

Det er dessuten flere HTTP-kall, men de er små og uavhengige, og de kan
kjøres parallelt. For én person som bygger på kvelder er det billigere
enn en RPC-migrasjon med `row_number() over (partition by category)`.

**Konklusjon: per-kategori-grensen er ikke en forutsetning for forsiden.
Den er en forutsetning for én bestemt implementasjon av forsiden, og det
er ikke den du bør velge.**

Defekt 3 må derimot rettes uansett, eller unngås ved at
arrangementsseksjonen aldri går gjennom by-modus-grenen.

### e) Blandingen sted + arrangement

**Egen flate.** Fire uavhengige grunner:

1. **Kortet er en annen ting.** «Lørdag 14:00, fra 4 år, 180 kr» og
   «1,2 km unna, gratis, utendørs» svarer på ulike spørsmål. Et kort som
   må gjøre begge deler gjør ingen av dem godt.
2. **Utvalget er en annen ting.** Steder rangeres på nærhet, arrangementer
   på tid. Slår du dem sammen må én akse vinne, og den taperen blir
   vilkårlig plassert.
3. **Defekt 3 forsvinner av seg selv** hvis arrangementer aldri deler
   utvalg med steder.
4. **Utforsk er en kartflate.** Et arrangement uten tid på et kart er en
   påstand om at noe skjer der nå.

Det er ett sted blandingen er riktig: på et **steds** detaljark, som «hva
skjer her». Men det krever relasjonen som ikke finnes (punkt b), og
`venue_name`-matching er for upålitelig til å bygge en betalt plassering
på. La det vente.

### f) Moderasjon — hva er minimum?

Mekanismen finnes. To hull gjenstår, og det andre er et reelt problem for
en betalende kunde:

**Hull 1 — ingen admin-flate.** Moderering skjer i dag med `curl` og
`ADMIN_SECRET`. Endepunktene er ferdige; en enkel `/admin`-side som lister
pending og har to knapper er noen timers arbeid og gjenbruker alt.

**Hull 2 — en publisert rad kan ikke tas ned uten at noen har rapportert
den.** `/api/admin/moderate` har `.eq('status', 'pending')` i update-en, så
den treffer aldri en publisert rad. Den eneste veien til nedtaking er
`PATCH /api/admin/reports` med `action='fjern_sted'`, og den krever en
eksisterende rad i `place_reports`.

Ringer teatret kl. 20 fordi forestillingen er avlyst, må du inn i
SQL-editoren. **Dette er minimumskravet** — enten en `action='unpublish'`
på moderate-ruten, eller at `.eq('status','pending')` fjernes derfra.

**Hull 3, som hører til samme sak:** arrangøren kan se sine egne
innsendinger (`GET /api/organizer/activities`) men ikke endre eller avlyse
dem. Ruten er GET-only. En betalende kunde som oppdager en skrivefeil har
ingen vei videre enn å sende e-post til deg.

For én kunde er det kanskje akseptabelt. For fem er det ikke det, og en
`PATCH`-rute på samme kilde-eierskap er en liten utvidelse av kode som
allerede finnes.

### g) Deichman-radene

**Ikke som første arrangementskilde. Ikke arkiver dem heller.**

Innvendingen må nyanseres på ett punkt og skjerpes på et annet:

**Nyansering:** `event.cancelled` **er** et statusfelt, og
`lib/deichman.ts:73` filtrerer på det allerede. Påstanden om at avlysning
bare er kodet med stjerner i tittelen stemmer ikke med koden. Om basen
faktisk inneholder slike titler kan jeg ikke avkrefte — jeg har ikke
tilgang til den — men kilden leverer et strukturert felt, og vi leser det.

**Skjerping:** det reelle problemet er verre enn både stjernene og
voksen-innholdet. **Avlysning etter import fanges ikke.** Raden ble
upsertet da arrangementet fantes; blir det avlyst dagen etter, filtreres
det bort fra skrapet — og dermed oppdateres raden aldri. Den blir stående
`published` til utløpet tar den. Appen viser et arrangement som er avlyst.

For et gratis biblioteksarrangement er det irriterende. For en familie som
har kledd på to barn og tatt trikken, er det verre enn at tilbudet aldri
var der.

**Voksen-innholdet** er derimot det letteste å løse av alt her:
`target_audience` ligger på raden og sendes allerede i API-et
(`toApiShape` har `targetAudience`) — `DatahubPlace` leser det bare ikke.
Et filter på Barn/Familie er nesten gratis.

Men det forutsetter at Deichmans egne verdier er til å stole på, og det
vet vi ikke. «Filmvisning for voksne» kan godt ligge som «For alle» i
kilden. **Det må måles på faktiske rader før man bygger på det** — det er
én spørring mot basen, og den bør kjøres før beslutningen tas, ikke etter.

**Er «betalende arrangør = redaksjonell kontroll» riktig lest?**

I hovedsak ja. Et teater som betaler står ansvarlig for eget innhold, har
egeninteresse i at det stemmer, og har en konto vi kan nå. Det er en helt
annen kvalitetsgaranti enn et ufiltrert skrap.

Men **én forskjell overses**: betaling løser innholdskvaliteten, ikke
livssyklusen. Teatret som avlyser lørdagsforestillingen fordi skuespilleren
er syk, har i dag **ingen måte å ta den ned på** (hull 2 og 3 i punkt f).
Avlysningsproblemet forsvinner ikke med betalende aktører — det flytter
fra skraperen til arrangørflyten, der det er lettere å løse, men bare hvis
det faktisk løses.

**Rekkefølge for Deichman:** etter første betalende kunde, og først når
(1) avlysning-etter-import håndteres, (2) `target_audience`-kvaliteten er
målt, (3) `locked` respekteres i `lib/ingest.ts`. Radene er verdt å
beholde imens — bibliotekets barneprogram er gratis og ekte, og det er et
godt supplement til betalt innhold, ikke en erstatning.

### h) Kultur som kategori eller paraply

**Behold Museum som Museum. Omdøpingen løser ikke problemet den skal
løse.**

Argumentet i oppdraget er at Kultur ikke lenger er «en kategori som venter
på innhold» hvis teatre skal betale for plass. Det er riktig at innholdet
kommer. Men det kommer som `kind='event'`, ikke som `kind='place'`.

Et teater som selger «Karius og Baktus, lørdag 14:00» selger et
arrangement. Det trenger ikke en **stedskategori** som heter Kultur — det
trenger en arrangementsakse, og der finnes «Kultur» allerede, med 130
rader og en plass i `CATEGORIES` i `lib/organizer.ts`.

De to «Kultur»-ene skal altså ikke slås sammen. De er ulike ting i samme
kolonne: én stedstype (bygningen du besøker) og én arrangementstype (det
som skjer). `Museum` er en ærlig stedskategori med 159 rader og en
illustrasjon som stemmer.

**Hva som må skje med de fire arrangementsstrengene først:**

Hvis Museum ikke døpes om — **ingenting for Kulturs del**. Konflikten er
selvpåført av omdøpingen.

Men noe må skje uansett, og det er en forutsetning for *hele* arrangements-
sporet, ikke for Kultur spesielt: `CategoryTheme.labelFor`,
`CategoryTheme.forCategory`, `ExploreFilter.indoorPlaceCategories`,
`outdoorPlaceCategories` og `placeCategoryTagline` slår alle opp på
kategoristrengen alene. De er skrevet for stedsverdier og antar
stedssemantikk.

I dag er det harmløst: `forCategory('Kultur')` faller til `standard`, og
klienten ser aldri arrangementer. Så snart den gjør det, trenger
oppslagene å vite hva slags rad de ser på. Det er den ekte kostnaden, den
er moderat (fem oppslagssteder pluss tester), og den kommer med
arrangementer uansett hvilket navn Museum har.

`test/category_theme_dekning_test.dart` er allerede vakten mot at en
kategori glemmes ett sted. Den bør utvides til å dekke arrangements-
kategoriene når de kommer.

### i) Rekkefølge og kostnad

**Steg 0 — før noen kan ta betalt (små, uavhengige, ingen migrasjon):**

1. Utløp på `coalesce(ends_at, starts_at)` (defekt 1). Én linje i
   `lib/ingest.ts`, én i RPC-en, pluss tester.
2. Samme tidsfilter i by-modus som RPC-en har (defekt 2).
3. Nedtaking av en publisert rad uten omveien om en rapport (hull 2).

Uten disse tre kan du ikke selge ærlig: en spilleperiode overlever ikke
dag to, et avsluttet tilbud henger i 21 timer, og en feil kan ikke rettes
uten SQL-editoren.

**Steg 1 — klienten ser arrangementer (én kveld hver):**

4. `startsAt`/`endsAt`/`targetAudience` inn i `DatahubPlace`
   — eller, bedre, i en egen `DatahubEvent`. Se merknaden under.
5. `fetchEvents()` i `datahub_service.dart` med `kind: 'event'`, som egen
   metode ved siden av `fetchPlaces()`.
6. Kind-bevisste kategorioppslag (punkt h).

**Steg 2 — flaten:**

7. «Skjer nå» på forsiden: eget kall, eget tak, ingen konkurranse med
   steder. Se punkt d og e.

**Steg 3 — når det faktisk er penger:**

8. Sponsor-/betalt-flagg og synlig merking (punkt b).
9. Redigering og avlysning for arrangøren selv (hull 3).

**Ikke nå:** relasjon arrangement↔sted, per-kategori-grense, Deichman-
aksen, Kultur-omdøping, defekt 4 (`locked` i `lib/ingest.ts` — den følger
Deichman-sporet).

**Merknad til punkt 4:** `DatahubPlace` er dokumentert som «bevisst atskilt
fra Activity — steder har ingen tid». Å legge tid inn der river ned et
skille som er begrunnet i kommentaren. En egen `DatahubEvent` med samme
`fromJson`-mønster koster kanskje to timer mer og holder modellen ærlig.
Anbefalt, men det er en avveining du kan ta motsatt uten at noe går galt.

---

## Er dette større enn det ser ut?

**Nei — mindre, på seks av ni punkter.** Gjentakelse, `ends_at`,
moderasjon, cron, arrangørflyt og Kultur-kollisjonen var alle antatt å
være arbeid som ikke er det.

**Ja, på ett punkt, og det er ikke teknisk.** «Betale for plassen»
forutsetter at plassen finnes som noe du kan love. I Utforsk gjør den ikke
det, og å få den dit krever enten per-kategori-grensen eller en garantert
plassering — begge større enn resten av lista til sammen.

Svaret er å ikke prøve. En egen arrangementsflate gir garantert plassering
per konstruksjon, og er dessuten det riktige produktet: et kort med
klokkeslett hører ikke hjemme i en liste sortert på avstand.

**Og én ting bør på plass først:** de tre punktene i steg 0. De er små nok
til én kveld til sammen, og uten dem er den første kundesamtalen bygget på
noe som ikke holder.
