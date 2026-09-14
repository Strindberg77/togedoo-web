# Hvem eier raden — kuratert seed eller OSM-import

**Status:** mekanismen står (gren `claude/seed-osm-eierskap`). Ingen seed-
eller importkjøring er gjort. Oslo-seeden for alpint er ikke skrevet.

## Problemet, kort

Upserten er `(source_id, external_id)` — unique-constrainten i migrasjon 0001.
En seed-rad under `kuratert-vintertilbud` og en import-rad under `osm-steder`
kolliderer derfor **aldri**. Importen lager en ny rad ved siden av seed-raden,
hver kjøring.

Det har skjedd: Korketrekkeren ble importert som `relation/1459739` med punktet
midt i løypa, ved siden av seed-raden med verifisert startpunkt ved
Frognerseteren. Import-raden ble slettet for hånd og ville kommet tilbake ved
neste kjøring av Aking for Oslo.

**Låsing løser det ikke.** Begge skriverne slår opp låste rader med
`.eq('source_id', source.id)` (`scripts/import-places.ts`, `lib/ingest.ts`,
`scripts/seed-*.ts`) — altså kun innenfor sin egen kilde. Å låse en seed-rad
sier ingenting til importen.

## Mekanismen

En **claim** (`lib/osm-claims.ts`) er en påstand om at et OSM-objekt allerede er
dekket av en kuratert rad. Importen bygger da ingen rad for det objektet.

Ingen rad flyttes mellom kilder. Seed-raden blir stående med sin egen `id`, sin
egen `external_id` og sin egen kilde, og redigeres fortsatt i seed-fila.

```ts
{
    osmId: 'relation/1459739',        // = external_id importen ville brukt
    source: 'kuratert-vintertilbud',
    externalId: 'korketrekkeren-aking',
    expectName: 'Korketrekkeren',      // kontrollpunkt, null = uten navn i OSM
    note: '…',
}
```

`osmId` er en **external_id**, ikke et vilkårlig OSM-objekt. For Aking er det
klyngens *anker* — en claim på ett av Korketrekkerens 14 segmenter ville aldri
truffet noe.

## To uavhengige lag

| Lag | Hva | Hvor |
|---|---|---|
| 1 | `applyOsmClaims` fjerner objektet før det blir en rad | `scripts/import-places.ts`, kalt fra `buildRows` |
| 2 | `writableRows` filtrerer bort låste rader før upsert | samme fil, kalt fra upsert-blokka |

Lag 2 er backstop: fjernes en claim ved et uhell, stopper låsen fortsatt
skrivingen. Lag 2 alene holder ikke — låsen slås opp per kilde.

## Å ta ned en OSM-rad som allerede finnes

**Ikke slett, og ikke sett `status='expired'`.** Importen sletter aldri noe, og
`expired` betyr «arrangementet er over» (`lib/event-window.ts`) — et sted
utløper ikke.

Riktig er `status='rejected' + locked=true`, som er nøyaktig det eksisterende
`unpublish` gjør (`lib/moderation.ts`):

```
POST /api/admin/moderate
{ "id": "<uuid>", "action": "unpublish" }
```

Raden forsvinner fra API-et (som kun serverer `published`), beholder sin id, og
låsen blir lag 2. Angres med `action: "publish"`, som setter `locked=false`
igjen. Ingen ny mekanisme, ingen migrasjon, ingen SQL-editor.

Rekkefølge når et sted skal flyttes fra import til seed:

1. Skriv seed-entryet.
2. Skriv claimen i `lib/osm-claims.ts`.
3. Kjør `seed-*.ts --dry-run` — `assertClaimsResolve` feiler hardt hvis claimen
   peker på et entry som ikke finnes.
4. Kjør `import-places.ts --dry-run` — rapporten viser `claim … → ingen rad` og
   advarer ved navneavvik.
5. `unpublish` den gamle OSM-raden.
6. Kjør seeden.

## Å angre

Slett claimen. Importen lager OSM-raden igjen ved neste kjøring. Seed-raden har
vært urørt hele veien, så ingen rad-id er tapt. Er den gamle OSM-raden tatt ned,
gir `action: "publish"` den tilbake med samme id.

## Vedlikehold i nasjonal skala

Lista er **manuelt vedlikeholdt**, ikke utledet. En utledet matching (navn +
avstand) ville vært nettopp feilkilden vi verner mot: norske alpinanlegg har
nesten like navn og deler daler.

To kontroller holder lista i live:

- **Navneavvik** per kjøring: OSM-navnet må inneholde `expectName`. Fanger den
  realistiske feilen — feil id limt inn.
- **Døde claims** til slutt: claims som ikke traff noe. Rapporten skriver alltid
  ut rekkevidden til kjøringen, fordi tallet er meningsløst uten: en kjøring for
  Oslo henter ikke Kirkerudbakken i Bærum. Først når kjøringen dekket alle byer
  og alle kategorier er «traff ingenting» et dødt-claim-varsel.

## Kjente tilfeller

| Sted | Seed | OSM | Status |
|---|---|---|---|
| Korketrekkeren | `korketrekkeren-aking` | `relation/1459739` | **claimet** |
| Tryvann + Wyller | (ikke skrevet) | `relation/2259942` | venter på Oslo-seeden |
| Trollvannskleiva + Grefsenkleiva | (ikke skrevet) | `relation/1762278` | venter på Oslo-seeden |
| Kirkerudbakken | `kirkerudbakken-skisenter` | `recreation_ground`, id ikke slått opp | utenfor de fire byene |
| Varingskollen | `varingskollen-alpinsenter` | `recreation_ground`, id ikke slått opp | utenfor de fire byene |

SNØ Lørenskog, Eikedalen og Vassfjellet er ikke bekreftet i OSM.

De to relasjonene som venter er hele grunnen til at én-til-mange er et krav og
ikke et tankeeksperiment: OSM har **én** relasjon der vi vil ha **to** rader,
fordi anleggene har hvert sitt startpunkt en halvtimes kjøretur fra hverandre.
Ett bbox-senter er feil for begge.

Kirkerudbakken og Varingskollen ligger i Bærum og Nittedal. Importen kjører
per kommune for de fire byene, så OSM-objektene hentes ikke i dag og
kollisjonen kan ikke oppstå ennå. Den oppstår den dagen nasjonal modus finnes.
