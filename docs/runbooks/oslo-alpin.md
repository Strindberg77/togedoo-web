# Oslo-alpint: kjørebok

**Status:** koden står på grenen `claude/oslo-alpin-seed`. **Ingenting er
kjørt** — ikke seeden, ikke importen, ikke SQL-en under.

## Hva dette er

Importen ga to rader for Oslo, hver med bbox-senteret til en OSM-relasjon som
dekker flere anlegg:

| OSM | Navn i OSM | Punkt importen ga |
|---|---|---|
| `relation/2259942` | Skimore Oslo | 59.9915, 10.6510 |
| `relation/1762278` | Oslo Skisenter | 59.9567, 10.8097 |

OSM har én relasjon per **driftsselskap**. Anleggene har hvert sitt startpunkt:
Tryvann og Wyller er 30 minutters kjøretur fra hverandre, Trollvannskleiva og
Grefsenkleiva har parkering i hver sin ende av Grefsenåsen. Bakkene henger
sammen i toppen og deler heiskort, men en forelder må velge hvor hun parkerer,
og ett kartpunkt for to anlegg kan sende henne feil.

Fem kuraterte rader erstatter de to, med manuelt verifiserte koordinater.

| Rad | Koordinat | Drift |
|---|---|---|
| Tryvann | 59.98870, 10.66812 | oslo.skimore.no |
| Wyller | 59.9909, 10.6304 | oslo.skimore.no |
| Tommkleiva | 59.983264, 10.669012 | oslo.skimore.no |
| Trollvannskleiva | 59.96172, 10.80608 | oslo-skisenter.no |
| Grefsenkleiva | 59.951768, 10.814618 | oslo-skisenter.no |

## Rekkefølgen

**Radene skal tas ned ETTER at seeden er kjørt, ikke før** — ellers står Oslo
uten alpinanlegg i mellomtiden.

### 1. Tørrkjør seeden

```
npx --yes tsx scripts/seed-vintertilbud.ts --dry-run
```

Skal vise 30 rader og ingen advarsler. Alle fem nye har `manualCoord`, så de
geokodes ikke og skal stå som «manuelt verifisert».

`assertClaimsResolve` kjører først i `main()` og kaster hardt hvis en claim
peker på en seed-rad som ikke finnes. Fem claims vokter fem rader.

### 2. Kjør seeden

```
npx --yes tsx scripts/seed-vintertilbud.ts
```

Etter dette finnes de fem radene som `published`. **Oslo har nå ni
alpinrader** — de fem nye og de to gamle importrader (pluss SNØ Lørenskog og
Varingskollen/Kirkerudbakken, som er utenbys). Det er tilsiktet og midlertidig.

### 3. Kontroller før nedtaking

```sql
select a.id, a.external_id, a.title, a.status, a.locked, a.lat, a.lng
from public.activities a
join public.sources s on s.id = a.source_id
where s.slug = 'osm-steder'
  and a.external_id in ('relation/2259942', 'relation/1762278');
```

Forventet: to rader, `status = 'published'`, `locked = false`. Er det færre enn
to, er de allerede tatt ned (eller aldri skrevet) — da hopper du over steg 4.

### 4. Ta ned de to importradene

**Ikke slett dem.** `status='rejected' + locked=true` er nøyaktig det
`unpublish` gjør i `lib/moderation.ts`. Radene beholder `id`-ene sine,
forsvinner fra API-et (som kun serverer `published`), og låsen hindrer at
importen skriver dem igjen.

Via admin-ruten, én rad om gangen — foretrukket, fordi den er den samme
kodestien appen bruker:

```
POST /api/admin/moderate
{ "id": "<uuid fra steg 3>", "action": "unpublish" }
```

Eller som SQL, hvis begge skal tas ned i én operasjon:

```sql
update public.activities a
set status = 'rejected',
    locked  = true
from public.sources s
where a.source_id = s.id
  and s.slug = 'osm-steder'
  and a.external_id in ('relation/2259942', 'relation/1762278')
  and a.status = 'published';
```

`and a.status = 'published'` speiler `from: ['published']` i
`MODERATION_TRANSITIONS.unpublish`, så SQL-en aldri gjør noe overgangen ikke
ville gjort. `updated_at` settes av triggeren i migrasjon 0001.

Forventet: `UPDATE 2`.

### 5. Kontroller etterpå

Kjør spørringen fra steg 3 på nytt. Forventet: `status = 'rejected'`,
`locked = true` på begge.

### Å angre

```
POST /api/admin/moderate
{ "id": "<uuid>", "action": "publish" }
```

`publish` godtar `rejected` som kilde og setter `locked = false`. Ingen
`id` er tapt, så de gamle radene kan hentes tilbake nøyaktig som de var.

## Hva som skjer ved neste import hvis noe glemmes

| Glemt | Følge |
|---|---|
| **Claimene** (steg 0, allerede i koden) | Importen lager `relation/2259942` og `relation/1762278` på nytt, ved siden av de fem kuraterte. Ni rader, to av dem med feil kartpunkt. |
| **Nedtakingen** (steg 4) | De to gamle radene blir stående publisert. Importen rører dem ikke — claimen gjør at den ikke bygger dem — men de forsvinner heller ikke av seg selv. Importen sletter aldri noe. |
| **Seeden** (steg 2), men claimene er merget | Verst: Oslo mister alpinanleggene helt. Claimen undertrykker OSM-objektene, og de kuraterte radene finnes ikke ennå. Derfor denne rekkefølgen, og derfor `assertClaimsResolve`. |
| **Nedtakingen gjøres FØR seeden** | Oslo står uten alpinanlegg til seeden kjøres. |

Etter steg 4 vil en importkjøring for Oslo/skianlegg skrive to linjer om
eierskap i rapporten:

```
claim relation/2259942 «Skimore Oslo» → ingen rad, eies av
  kuratert-vintertilbud/tryvann + kuratert-vintertilbud/wyller +
  kuratert-vintertilbud/tommkleiva (3 kuraterte rader, én relasjon)
```

## Kommunen — etterprøvd, ikke antatt

Alle fem koordinatene er kjørt gjennom punkt-i-polygon mot **Kartverkets
kommunegrenser** (`robhop/fylker-og-kommuner`, Kommuner-L, 2024, CC BY 4.0),
med repoets egen `pointInRing` fra `lib/geo-polygon.ts`:

```
Tryvann           59.9887,   10.66812   →  Oslo (0301)
Wyller            59.9909,   10.6304    →  Oslo (0301)
Tommkleiva        59.983264, 10.669012  →  Oslo (0301)
Trollvannskleiva  59.96172,  10.80608   →  Oslo (0301)
Grefsenkleiva     59.951768, 10.814618  →  Oslo (0301)

KONTROLL Oslo S            59.9106, 10.7522  →  Oslo (0301)
KONTROLL Sandvika (Bærum)  59.8916, 10.5261  →  Bærum (3201)
```

**Wyller ligger i Oslo**, ~1,9 km innenfor grensen mot Bærum. Ingen av de fem
får `nearCity` — seedens regel er at `nearCity` knytter et *utenbys* sted til
en hjemby.

Forbehold: L-kvaliteten er en forenklet grense (Oslo-polygonet har 400
punkter). 1,9 km margin er komfortabelt mer enn forenklingsfeilen, men dette
er en kartfil, ikke et grunnboksoppslag.
