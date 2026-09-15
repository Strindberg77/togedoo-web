# Node over flate: kjørebok

**Status:** koden står på grenen `claude/node-flate-dedup`. **Ingenting er
kjørt** — ikke importen, ikke SQL-en under.

## Hva regelen gjør

Et PUNKT og en FLATE i samme kategori, nærmere hverandre enn 10 m, er samme
sted kartlagt to ganger. Punktet blir ikke en rad.

Regelen er det eneste som ble stående etter at tre andre filtre ble målt mot
Geofabrik-fila (`norway-260908`) og forkastet:

| Filter | Måling | Dom |
|---|---|---|
| Utstyrstagg på lekeplass | 428 av 11 901 (3,6 %) | ville fjernet 96 % av kategorien |
| `surface=grass` på pitch | 79 av 12 799 med sport (0,6 %) | marginalt — og banen som utløste saken hadde ingen `surface` i det hele tatt |
| Avstandsterskel, flate mot flate | 3,7 → 8,4 → 13,0 → 21,7 % ved 10/30/50/100 m | ingen knekk, altså ingen naturlig terskel |

## Hvem vinner

«Navn» betyr `isUsablePlaceName` — samme definisjon som tittelgeneratoren
bruker. Én definisjon, ikke to.

| Punktet | Flaten | Utfall |
|---|---|---|
| uten navn | uten navn | **flaten**, punktet droppes |
| uten navn | med navn | **flaten**, punktet droppes |
| med navn | samme navn | **flaten**, punktet droppes |
| med navn | uten navn | **begge beholdes**, rapporteres |
| med navn | annet navn | **begge beholdes**, rapporteres |

To av fem utfall beholder begge. Premisset for regelen er at de to beskriver
samme sted; et navn bare på det ene, eller to ulike navn, motsier premisset.
Da er det OSM som skal rettes, ikke raden som skal forsvinne her.

## Rekkefølgen

### 1. Tørrkjør, og LES rapporten

```bash
npx --yes tsx scripts/import-places.ts --dry-run --national \
  --category=lekeplass --work=.import-work | tee kjoring.log
```

Rapporten har to deler. Den første står per kategori:

```
  Norge/lekeplass     1 punkt droppet — samme sted som en flate innen 10 m
      node/1095094457      → way/650069798        4.2 m
```

Den andre står til slutt, og er **den som krever en handling** — se steg 2.

**Se etter `BEGGE BEHOLDT`.** De avkortes aldri, fordi de er de eneste som
krever et menneske:

```
      BEGGE BEHOLDT  node/123 og way/456, 6.1 m — ulike navn («Sandkassen» / «Torshovparken lekeplass»)
```

Er det mange av dem, er terskelen eller navneregelen feil — ikke dataene.

### 2. Ta ned radene som allerede finnes

**Importen gjør det ikke selv**, og det er et valg med tre grunner:

1. Regelen har aldri kjørt mot ekte data. Første gang er mot ~800 rader.
2. `docs/runbooks/oslo-alpin.md` gjør nøyaktig det samme for de to
   erstattede OSM-radene: importen bygger dem ikke lenger, et menneske tar
   dem ned. Én mekanisme, ikke to.
3. En `--dry-run` som avpubliserer rader er ikke tørr.

Rapporten skriver ut ferdig SQL med id-ene fylt inn — kontrollspørringen
først, så oppdateringen. `rejected + locked` er nøyaktig det `unpublish` i
`lib/moderation.ts` gjør: raden beholder id-en, forsvinner fra API-et, og
låsen hindrer at importen skriver den igjen. `publish` angrer alt.

**Kjør kontrollspørringen først.** Er svaret tomt, fantes radene aldri, og
steg 2 er ferdig.

### 3. Kjør importen

Uendret. Punktene bygges ikke lenger.

## Hva du bør vite før du stoler på tallene

**«440 lekeplasser + 373 pitcher» er IKKE hvor mange rader regelen fjerner.**
Det er antall objekter med en nabo i samme kategori innen 10 m — uansett om
naboen er et punkt, en flate eller en relasjon. Regelen fjerner bare
node↔flate-parene, som er en delmengde.

`scripts/osm-kvalitet.py` skriver nå ut fordelingen:

```
      10 m      440    3.7 %  …
           par: flate↔flate N  node↔flate M  node↔node K
```

**Kjør den på nytt før den nasjonale importen.** `M` er tallet som sier hvor
mange rader som faktisk forsvinner.

**Terskelen er ikke eksakt under centimeternivå.** Målingen bruker haversine
(111 195 m per breddegrad), importen en plan tilnærming (111 320). De to er
0,11 % fra hverandre — 1,1 cm ved 10 m. Antallet par kan derfor avvike med
noen få.

**Avstanden måles til flatens BBOKS-SENTER**, ikke til kanten:
standardhentingen (`out center tags`) gir ikke ringen. For en stor, avlang
flate ligger senteret lenger unna enn kanten, og regelen slår da MINDRE ofte
til. Feilen går i retningen som lar en rad stå.

## Det som IKKE er gjort

- **Flate mot flate.** Kurven viser at terskelen ikke finnes. De tre
  fortløpende way-id-ene i Kjelsås (39–67 m fra hverandre, samme
  redigeringsøkt) kan bare skilles fra ekte naboer på GEOMETRI — om ringene
  grenser til hverandre — og det krever `out geom` for 11 901 lekeplasser.
- **Titlene.** Seks rader het fortsatt «Lekeplass ved Gunnar Schjelderups
  vei» etter dedupen; bare den ene dubletten forsvant. Husnummeret ligger
  allerede i `geocode_cache` (`addressText`), så det koster ingen nye
  geokodingskall — men det er en egen endring.
- **Aking og Skianlegg.** De har hvert sitt bedre svar på samme spørsmål:
  `verifyPointFacilities` gjør en ekte punkt-i-polygon-test, `akingClusters`
  samler på relasjon og navnegruppe. En test låser at ingen kategori har
  begge mekanismene.
