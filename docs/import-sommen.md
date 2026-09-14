# Import-sømmen: hent → berik → skriv

**Status:** fase 1 av planen i skalavurderingen. Implementert på grenen
`claude/import-sommen`. Ingen kildebytte, ingen municipality-utledning, ingen
importkjøring uten `--dry-run`.

## Hvorfor

Importen hentet, beriket og skrev i én operasjon per by, og skrev først når
hele byen var ferdig. En kjøring som feilet halvveis måtte kjøres om.
Nasjonalt er det ~39 500 objekter over sju kategorier (osmium mot
Geofabrik-fila, sep. 2026), og geokodingen alene er timer — da er «kjør om
alt» ikke et alternativ.

## De tre stegene

| Steg | Hva | Dyrt fordi |
|---|---|---|
| **hent** | Én Overpass-spørring per kategori. Rå elementer, ingen tolkning. | Overpass 504-er, rategrense |
| **berik** | Klynging, romlig verifisering, deduplisering, claims, `--limit`, geokoding, titler | ~1,1 s per sted uten brukbart OSM-navn |
| **skriv** | Upsert i bolker på 500 | Nettverk mot Supabase |

Berikelsen er stedet alt som TOLKER data bor. Klyngingen i Aking (14
veisegmenter → én rad) og den romlige testen i Skianlegg lå tidligere i
henterne; de er flyttet, fordi de er tolkning av data vi allerede har og
derfor skal overleve at kilden byttes i fase 3.

## Arbeidsenheten

`ImportChunk` (`lib/import-chunks.ts`) har fire felt: `id`, `label`,
`cityAnchor` og `overpassArea`. Ikke mer. En by i dag; en flis, et fylke eller
et land senere.

`cityAnchor` er det som blir `activities.municipality`. Blir enheten en flis,
er den `null`, og `rowsMissingCityAnchor()` kaster hardt før upsert — det er
fase 2 sin oppgave, og guarden nekter å la den bli glemt.

`overpassArea` er det ENESTE kildespesifikke feltet, og er navngitt etter
kilden med vilje. Fase 3 bytter henteren og det feltet.

## Mellomleddet

NDJSON-filer i en arbeidskatalog, én fil per chunk per steg. **Opt-in** med
`--work[=dir]` (standard `.import-work/`, gitignore-et). Uten flagget skrives
ingenting noe sted, og en tørrkjøring rører fortsatt ingenting.

Ikke en tabell i Supabase: da måtte `--dry-run` enten bryte regelen om å ikke
skrive, eller bruke en annen transportvei enn den ekte kjøringen — og da
tester tørrkjøringen ikke lenger koden som faktisk kjører.

Ikke ett JSON-array: et array må være helt for å kunne parses, så en kjøring
som dør under skrivingen etterlater en uleselig fil. NDJSON mister bare den
siste, halve linja.

**Prisen:** katalogen er lokal. En kjøring startet på én maskin kan ikke
gjenopptas på en annen.

## Manifestet

`manifest.ndjson` i arbeidskatalogen, append-only, én linje per fullført
(chunk, steg):

```json
{"chunkId":"by-oslo","stage":"enrich","fingerprint":"95d2b149","count":2,
 "at":"2026-09-14T16:12:26.225Z","seenClaims":[]}
```

**Ferdig, ikke påbegynt.** Hvert steg skriver til `.tmp` og gjør et atomisk
`rename`. FØRST etterpå legges manifestlinja til. Rekkefølgen gjør at det
aldri kan finnes en manifestlinje uten en komplett fil.

**Fingeravtrykket** er en hash over det som bestemmer stegets utdata —
områdeklausul, selektortekst, kategoriliste, `--limit`, claim-lista. Uten den
ville «rett en selektor og kjør med `--resume`» gitt gårsdagens data uten en
eneste advarsel. `--limit` påvirker bare berikelsen, så en kjøring med og uten
limit deler hentesteg.

**`write` er ikke i manifestet.** Upserten er idempotent, så å skrive om igjen
koster sekunder. Var steget merket ferdig, ville en kjøring som døde midt i
bolkeløkka etterlatt en halvskrevet chunk som så ferdig ut.

## Tomme hentesteg

**Tom er både et gyldig svar og det mest sannsynlige symptomet på en feil**, og
ingenting i svaret skiller de to.

Observert sep. 2026: Oslo/park fikk 504 på første forsøk og et helt ordinært
200 med `elements: []` og ingen remark på det andre. `fetchOverpass` hadde
ingen grunn til å mistenke noe. Sømmen skrev 0 linjer i begge steg og markerte
begge ferdig; neste `--resume` gjenopptok 0 rader uten å røre nettet, og
ADVARSEL-linja kom ikke fordi berikelsen ble hoppet over. Samme spørring ga 34
objekter både før og etter.

**Løsningen er en observasjon til, ikke en gjetning.** Kommer en kategori tomt
tilbake, stilles spørringen én gang til:

| Andre svar | Utfall |
|---|---|
| har data | dataene brukes, første svar var forbigående tomt |
| også tomt | `BEKREFTET TOM`, føres i manifestet som `emptySets` |

Bekreftet tom er et **endelig** svar: steget markeres ferdig og `--resume`
gjenbruker det. En legitimt tom chunk blir aldri en evig retry.

**Terskelen er hele kategorien, ikke det enkelte settet.** Ga ett av
Skianleggs to sett data, har området løst seg og Overpass har svart — det var
det som skulle verifiseres. At `omrade` er tom mens `bevis` har tusenvis av
langrennsløyper er normalt i en kommune uten alpinanlegg, og å kjøre den dyre
bevisspørringen om igjen for det ville vært å betale mest der signalet er
svakest. Slike sett rapporteres likevel.

Til slutt i kjøringen står alle tomme sett samlet, lest fra manifestet, enten
chunken kjørte denne gangen eller ble gjenopptatt. **Se etter mønster:** én tom
kategori i én kommune er geografi, den samme kategorien tom i tjue kommuner er
en selektor- eller tag-endring.

## Gjenopptagelse

**Eksplisitt**, med `--resume`. Å gjenbruke i stillhet er den klassiske fella:
man retter noe, kjører på nytt, og får gårsdagens data. Fingeravtrykket fanger
mye, men ikke en endring inne i `matches()` eller en klyngefunksjon.

Prisen er at man kan glemme flagget. Derfor sier kjøringen fra når det finnes
ferdige steg i katalogen uten at `--resume` er gitt.

```
npx tsx scripts/import-places.ts --dry-run --city=Oslo --work            # kjøring 1
npx tsx scripts/import-places.ts --dry-run --city=Oslo --work --resume   # gjenopptar
```

## Døde claims

Vilkåret var `cities.length === DEFAULT_CITIES.length && !catArg`, som sluttet
å bety noe når enheten ikke lenger er en by. `runCoversEverything(plan,
defaultPlan, …)` uttrykker det samme i planen og overlever at standardplanen
blir 353 fliser.

`seenClaims` leses også fra manifestet, ikke bare fra minnet: ved `--resume`
hoppes ferdige chunks over, og et minnebasert sett ville meldt levende claims
som døde.

## Hva fase 2 og 3 arver

- **Fase 2 (municipality):** sett `cityAnchor: null` på flis-chunkene og fyll
  municipality per rad i BERIKELSEN. Kartverket punktsøk returnerer
  kommunenavn og kommunenummer direkte (målt sep. 2026), og berikelsen kaller
  det allerede for hver rad uten brukbart OSM-navn — gratis for dem. Radene
  MED navn geokodes aldri og trenger en annen vei (grensepolygoner). Merk at
  svaret er «OSLO», ikke «Oslo».
- **Fase 3 (kildebytte):** bytt `fetchSets` og `overpassArea`. Berikelsen er
  ren og rører ikke nettverket; mellomleddet, manifestet og
  gjenopptagelsen er kildeuavhengige.
