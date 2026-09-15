# Dubletter: kjørebok

**Status:** koden står på grenen `claude/dedup-opprydding`. **Ingenting er
kjørt** — ikke importen, ikke oppryddingen, ikke SQL-en.

## Hva problemet er

**191 par i basen under 5 m, 263 under 10** (målt sep. 2026: fire byer,
publiserte rader, samme kategori, haversine). Det er like mange steder der en
forelder ser to kort for samme sted.

De to tallene ble en stund lest som «72 par forsvant mellom to tellinger».
Det gjorde de ikke — spørringene brukte ulik radius, og differansen ER båndet
5–10 m.

**Terskelen er 5 m.** Se «Hvorfor 5 og ikke 10» under.

**Nesten alle er fra samme kjøring.** Av parene under 5 m: 182 skrevet
innenfor samme time, 0 samme døgn, 9 fra ulike kjøringer. Oppryddingen er i
hovedsak en ENGANGSJOBB — dedupen i importen ville stoppet nesten alle. De 9
viser at OSM får nye dubletter over tid, men raten er lav nok til at dette
ikke trenger å være en fast jobb.

Problemet har to halvdeler, og begge må gjøres:

| | Hva den gjør | Hvor |
|---|---|---|
| **Dedup i importen** | slutter å lage nye | `dedupDubletter` på kategorien |
| **Oppryddingen** | tar ned de 263 som ligger der | `scripts/dedup-opprydding.ts` |

**Importen kan ikke rydde.** Den har ingen slettevei — det finnes ikke en
`.delete()` eller `delete from` mot `activities` noe sted i kodebasen.
Slutter den å produsere en rad, står raden publisert til noen gjør noe.

**Regelen er ÉN funksjon**, `dedupPairs` i `lib/dedup.ts`, brukt begge steder.
Var den kopiert, kunne de to blitt uenige — og da tar oppryddingen ned rad A
mens neste import bygger A og fjerner B. En test kjører samme scenario
gjennom begge kodeveiene og krever samme svar
(`scripts/dedup-kallere.test.ts`).

## Hvorfor 5 og ikke 10

| ≤ 5 m | ≤ 10 m | i båndet 5–10 |
|---|---|---|
| 191 par | 263 par | **72 par (27 %)** |

Feilen er ikke symmetrisk:

- **for stor radius** → to ekte nabosteder slås sammen, og det ene forsvinner
  fra appen. Stille, og raden blir `locked` slik at importen ikke henter den
  tilbake.
- **for liten radius** → en dublett blir stående. Synlig for brukeren, og
  rettes med én kjøring til.

27 % i båndet er for stort til å avfeie som utsmøring rundt terskelen — det er
en egen bestand, og ingenting i dataene sier hvor mange av dem som er ekte
naboer. Under 5 m er to objekter i samme kategori i praksis samme sted tegnet
to ganger: alle de 50 nærmeste parene i basen ligger under 4 m.

**`PLACES_DEDUP_M=10` gir den andre oppførselen**, og skriptet skriver ut hvor
mange par til det ville funnet — så valget kan etterprøves fra hver kjøring i
stedet for å hvile på dette avsnittet.

## Hvem vinner

| Paret | Vinner | Hvorfor |
|---|---|---|
| node mot flate | **flaten** | har utstrekning; senteret er utledet av geometri, ikke ett håndplassert punkt |
| node mot node | **laveste OSM-id** | uforanderlig. Flest tagger og nyeste id kan begge SNU når noen redigerer OSM, og `external_id` er upsert-nøkkelen |
| flate mot flate | **ingen** | se under |

Navnereglene gjelder oppå, og «navn» betyr `isUsablePlaceName` — samme
definisjon som tittelgeneratoren, ikke en egen:

| Taperen | Vinneren | Utfall |
|---|---|---|
| uten navn | hva som helst | taperen tas ned |
| med navn | samme navn | taperen tas ned |
| med navn | **uten** navn | **begge beholdes** |
| med navn | **annet** navn | **begge beholdes** |

To ulike navn motsier premisset om at det er samme sted. Da er det OSM som
skal rettes, ikke raden som skal forsvinne.

## ⚠ Etter oppryddingen er basen IKKE ren

**Dette er det viktigste avsnittet i dokumentet.** Regelen løser tre av fire
typekombinasjoner. Det som blir igjen:

**Flate mot flate løses ikke.** To flater med sammenfallende bboks-senter er
ikke nødvendigvis samme sted. Konsentriske flater er et ekte OSM-mønster — en
bane inne i et idrettsområde, et basseng inne i et badeanlegg — og begge blir
samme kategori hos oss. Standardhentingen bruker `out center tags` og gir
ingen ring, så de kan ikke skilles fra en ekte dublett. Å slå dem sammen på
senteravstand ville fjernet ekte steder.

**Relasjon mot flate er trolig medlemskap.** I utvalget på 50 sto
`relation/16794871` og `way/72443369` på 0 m for Badeplass. Et multipolygon
med én ytre ring har nøyaktig samme bboks-senter som ringen, altså er way-en
sannsynligvis medlem av relasjonen. Det kan bare avgjøres ved å se
medlemslista, og `out center tags` undertrykker `members` — samme felle som
`out geom tags` var for Korketrekkeren. **Det er en hentingsendring, ikke en
terskelendring**, og en egen sak.

**Navnetilfellene beholdes med vilje.** De er OSM-data som bør rettes, ikke
rader som bør fjernes.

Skriptet teller alle tre, og tallet står i utskriften:

```
  ETTER NEDTAKINGEN STÅR 14 PAR IGJEN:
    9 flate mot flate — to flater med sammenfallende senter kan ikke skilles
      …
    3 der bare den ene har navn — vinneren ville mistet navnet.
    2 med ulike navn — to navn motsier at det er samme sted.
```

**Tallene over er et EKSEMPEL på formen, ikke en måling.** Det ekte tallet
kommer av å kjøre skriptet. Fra utvalget på 50 par vet vi bare at det finnes
minst ett flate-mot-flate-par og minst tre relasjon-mot-flate.

**Skriv tallet ned når du har kjørt.** Ellers tror neste person at
duplikatene er borte.

## Rekkefølgen

### 1. Se hva som finnes

```bash
npx --yes tsx scripts/dedup-opprydding.ts | tee dubletter.log
```

Skriptet **skriver ikke**, og kan ikke skrive: det åpner databasen med
`select` og har ingen annen kodevei. En test feiler hvis noen legger til en
`.insert(`, `.update(`, `.upsert(`, `.delete(` eller `.rpc(`.

Utskriften er en tabell per kategori med de ti første parene:

```
  Lekeplass  —  41 par, 38 kan tas ned
    TAS NED  node/1095094457      way/650069798          4.2 m  droppet
    ULØST    way/1044252661       way/1044252659         0.0 m  to-flater
    BEHOLDT  node/5000            way/5001               2.1 m  navn-bare-pa-taper
```

Flere med `--vis=25`, én kategori med `--category=Lekeplass`.

**Les de ti første per kategori.** 263 par er for mange til å lese hver
linje, men ti er nok til å se om regelen oppfører seg: er `TAS NED`-radene
noder som taper mot flater og nye id-er som taper mot gamle, virker den.

### 2. Kjør SQL-en

Skriptet skriver den ut med id-ene fylt inn — kontrollspørringen først, så
oppdateringen. `rejected + locked` er nøyaktig det `unpublish` i
`lib/moderation.ts` gjør: raden beholder id-en, forsvinner fra API-et (som
kun serverer `published`), og låsen hindrer at importen skriver den igjen.

**Kjør kontrollspørringen først.** Er svaret tomt, fantes radene aldri.

Utskriften viser også hvor mange par en løsere terskel ville funnet:

```
  Ved 10 m ville 72 par TIL blitt funnet. De tas IKKE ned nå.
```

Angre: `POST /api/admin/moderate {"id": "<uuid>", "action": "publish"}`.

### 3. Kjør importen, så de ikke kommer tilbake

```bash
npx --yes tsx scripts/import-places.ts --dry-run --city=Oslo --work=.import-work
```

Dedupen står på for **Lekeplass, Ballbane og Rullesport** — de kategoriene
fenomenet er målt for. Av for Aking og Skianlegg: de har allerede hvert sitt,
bedre svar (`verifyPointFacilities` gjør en ekte punkt-i-polygon-test,
`akingClusters` samler på relasjon og navnegruppe). En test låser at ingen
kategori har begge mekanismene.

Importen skriver ut den samme SQL-en for rader den slutter å produsere, fra
`nedtakingsSql` — samme funksjon som oppryddingen bruker, så de to kan ikke
ta ned ulike rader.

## Hva du bør vite om tallene

**Terskelen er målt, ikke valgt** — se «Hvorfor 5 og ikke 10» over. **Begge
kallerne leser `DEDUP_RADIUS_M`**, så importen og oppryddingen kan ikke komme
i utakt. `PLACES_DEDUP_M=10` prøver det andre tallet uten en kodeendring, og
skriptet viser differansen i hver kjøring.

**Avstanden måles ulikt i basen og i koden.** Tellingen som ga 263 bruker
PostGIS-geografi; `distanceMeters` er en plan tilnærming. De er ~0,1 % fra
hverandre — 1 cm ved 10 m — så antallet par kan avvike med noen få.

**Senterpunktet for en flate er bboks-senteret**, ikke tyngdepunktet:
`out center` i Overpass gir nøyaktig det, og basen lagrer det. For en stor,
avlang flate ligger senteret lenger unna enn kanten, og regelen slår da
MINDRE ofte til. Feilen går i retningen som lar en rad stå.

**Kuraterte rader røres aldri.** Seed-rader har `external_id` som «tryvann»,
ikke «way/123». De eies av `lib/osm-claims.ts`, og en avstandsregel her ville
vært en tredje mekanisme på samme sted.
