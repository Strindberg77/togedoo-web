# Datahub-oppsett (oppgave 2.2)

Datahubben lagrer geokodede aktiviteter i Supabase/Postgres under
ThinkB8-organisasjonen og serverer dem til Flutter-appen via
`/api/activities`. Ingestion kjører daglig via Vercel Cron.

## Arkitektur

```
Kilder (crawl/feed/arrangør)
        |
        v
lib/ingest.ts  -- normaliser -> geokod (lib/geocode.ts) -> upsert
        |
        v
Supabase/Postgres (activities + PostGIS)
        |
        v
/api/activities  -- radius-søk eller filtre, alltid med lat/lng
        |
        v
Flutter-appen (togedoo-modern)
```

- Geokoding skjer ved innsamling, aldri i appen. Rekkefølge: cache ->
  Kartverket adresse-API -> Kartverket stedsnavn -> Nominatim (siste utvei).
  Negative treff caches også.
- Events og statiske steder (lekeplasser osv.) ligger i samme tabell,
  skilt med `kind = 'event' | 'place'`.
- Arrangørflyten (oppgave 2.9) er forberedt i skjemaet:
  `sources.kind = 'organizer'` og `activities.status = 'pending'`.

## Engangsoppsett (gjøres av eier)

1. Opprett nytt Supabase-prosjekt i ThinkB8-organisasjonen (region EU).
2. Kjør `supabase/migrations/0001_datahub_foundation.sql` i SQL-editoren.
3. Sett miljøvariabler i Vercel-prosjektet togedoo-web (Production):
   - `SUPABASE_URL` — prosjektets URL
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key (kun server-side)
   - `CRON_SECRET` — langt tilfeldig token, f.eks. `openssl rand -hex 32`.
     Vercel Cron sender det automatisk som `Authorization: Bearer <verdi>`.
4. Deploy. `vercel.json` registrerer cron-jobben (daglig 05:00 UTC).
5. Kjør første synk manuelt og verifiser:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://togedoo-web.vercel.app/api/sync

curl "https://togedoo-web.vercel.app/api/activities?lat=59.9139&lng=10.7522&radius=5000"
```

Svaret fra `/api/activities` skal ha `"mode": "datahub"` og rader med
`lat`/`lng`. Uten miljøvariablene svarer ruten `"mode": "legacy"`
(gammel live-scraping uten koordinater), så ingenting knekker før
oppsettet er gjort.

## API

`GET /api/activities` — parametre, alle valgfrie:

| Parameter | Beskrivelse |
|---|---|
| `lat`, `lng` | Radius-søk fra punktet (PostGIS, nærmest først) |
| `radius` | Meter, default 10000, maks 100000 |
| `kind` | `event` eller `place` |
| `category` | F.eks. `Kultur`, `Læring`, `Kreativt` |
| `municipality` | F.eks. `Oslo` (uten lat/lng) |
| `targetAudience` | F.eks. `Barn`, `Familie` |
| `limit` | Default 200, maks 500 |

Steder (kind='place') har i tillegg feltene `surface` og `lit` — utvalgte
OSM-tagger fra `osm_tags`-kolonnen (migrasjon 0008; alle rå tagger lagres
ved import, men bare felter med reell dekning eksponeres: tag-proben
jul. 2026 viste surface 63,7 % / lit 27,2 % på Ballbane, alt annet under
terskelen). Feltene fylles først ved neste kjøring av
`scripts/import-places.ts`.

`GET|POST /api/sync` — full ingestion, krever `Authorization: Bearer CRON_SECRET`.

## Arrangørflyt (oppgave 2.9)

Arrangører legger inn events selv på `/arranger`: skjema som gulv, med
lenketolkning oppå (lim inn URL → schema.org JSON-LD eller OpenGraph
foreslår feltverdier). Alt lander som `status = 'pending'` på kilden
`arrangor-innsending` og er usynlig til det publiseres.

Engangsoppsett: kjør `supabase/migrations/0003_organizer_flow.sql` og sett
`ADMIN_SECRET` i Vercel (samme mønster som `CRON_SECRET`).

| Endepunkt | Auth | Beskrivelse |
|---|---|---|
| `POST /api/organizer/parse` | ingen | `{ url }` → foreslåtte feltverdier |
| `POST /api/organizer/submit` | ingen (rate-limited) | Validerer, geokoder, lagrer som pending |
| `GET /api/admin/pending` | `Bearer ADMIN_SECRET` | Lister innsendinger som venter |
| `POST /api/admin/moderate` | `Bearer ADMIN_SECRET` | `{ id, action: "publish"\|"reject" }` |

### Arrangørkontoer

Faste arrangører logger inn med magic link (Supabase Auth) på
`/arranger/konto`: profil, "mine aktiviteter" med status, og dupliser-knapp
som gjenbruker et tidligere arrangement. Hver konto får sin egen kilde-rad
(`sources.organizer_id`); anonym innsending bruker fortsatt den delte
kilden. Verifiserte kontoer (`organizers.verified`, settes via admin-API-et)
auto-publiserer innsendingene sine. Bekreftelses-e-post (Resend) er opt-in
per konto og default av.

Engangsoppsett: kjør `supabase/migrations/0004_organizer_accounts.sql`,
skru på e-post-innlogging i Supabase Auth (på som standard) og legg
`https://togedoo-web.vercel.app/arranger/konto` i Auth → URL Configuration
→ Redirect URLs. Miljøvariabler i Vercel:

| Variabel | Type | Verdi |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | offentlig, bygges inn | samme som `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | offentlig, bygges inn | `sb_publishable_…` (IKKE secret-nøkkelen) |
| `RESEND_API_KEY` | hemmelig, kun server | `re_…` fra Resend |
| `EMAIL_FROM` | konfig | f.eks. `Togedoo <ikkesvar@togedoo.com>` |

`NEXT_PUBLIC_*` leses ved **bygging**, ikke ved kjøring — de krever en ny
deploy med nytt bygg for å tre i kraft. Uten dem skjules kontofunksjonen
og skjemaet fungerer som før. Uten `RESEND_API_KEY`/`EMAIL_FROM` sendes
ingen e-post (stille av), selv om arrangører har slått på varsling.

| Endepunkt | Auth | Beskrivelse |
|---|---|---|
| `GET/PATCH /api/organizer/me` | Bearer (brukersesjon) | Profil: navn, varslingsvalg |
| `GET /api/organizer/activities` | Bearer (brukersesjon) | Mine aktiviteter, alle statuser |
| `GET/PATCH /api/admin/organizers` | `Bearer ADMIN_SECRET` | Liste kontoer; `{ id, verified }` |

### Brukertips og feilrapporter for steder

Tips om nye steder sendes inn på `/tips` og lander som `kind='place'`,
`status='pending'` på kilden `bruker-tips` — modereres med samme
admin-API som arrangementer. To uavhengige pending-tips innen ~75 m med
samme kategori flagges `high_trust` og løftes øverst i pending-køen
(ingen autopublisering — brukergenerert innhold ses fortsatt av et
menneske). Feilrapporter («finnes ikke», «feil lokasjon», «feil info»)
lagres i `place_reports`; medhold i «finnes ikke» setter
`rejected + locked`, som OSM-re-importen aldri rører. Krever migrasjon
0006 + 0007. «Meld feil»-knappen i Flutter-appen POSTer til
`/api/places/report` (lib/services/place_report_service.dart).

Mengde-basert selvbekreftelse (migrasjon 0007): appen sender en anonym,
stabil device-ID som saltes og hashes server-side (`REPORT_HASH_SALT` i
Vercel, f.eks. `openssl rand -hex 32`) til `reporter_hash` — IP brukes
aldri til unikhets-telling (familier deler wifi), kun saltet til
rate-limiting i databasen. Klientposisjon gir
`reported_from_distance_m`; rapporter uten posisjon/fingerprint teller i
admin-køen, men aldri mot auto-terskelen. Når 3 unike rapportører har
meldt «finnes ikke» på samme sted innen 60 dager, alle innenfor 5 km fra
stedet, settes stedet automatisk `rejected + locked` og rapportene
lukkes med status `auto_behandlet` (skilles fra manuell `behandlet` i
loggen). `feil_lokasjon`/`feil_info` har ingen auto-handling — de
sorteres bare øverst i `GET /api/admin/reports` når flere unike
rapportører har meldt det samme (`bekreftelser`-feltet). Tersklene
ligger i `lib/reports.ts`.

| Endepunkt | Auth | Beskrivelse |
|---|---|---|
| `POST /api/places/submit` | ingen (rate-limited) | Tips om nytt sted → pending (+ high_trust ved 75 m-duplikat) |
| `POST /api/places/report` | ingen (rate-limited i DB) | `{ activityId, reason, comment?, deviceId?, lat?, lng? }` |
| `GET /api/admin/reports` | `Bearer ADMIN_SECRET` | Åpne rapporter med stedsinfo, sortert på `bekreftelser` |
| `PATCH /api/admin/reports` | `Bearer ADMIN_SECRET` | `{ id, action: "fjern_sted"\|"lukk" }` |

Moderering fra terminalen:

```bash
curl -H "Authorization: Bearer $ADMIN_SECRET" \
  https://togedoo-web.vercel.app/api/admin/pending

curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"id":"<uuid>","action":"publish"}' \
  https://togedoo-web.vercel.app/api/admin/moderate
```

## Kildestrategi per kategori (oppgave 2.2)

| Kategori | Strategi | Vedlikehold |
|---|---|---|
| Bibliotek-events (Deichman, Bergen) | Crawl/feed, implementert | Lav; overvåk `sources.last_sync_status` |
| Ungfritid | PÅ PAUSE (jul. 2026): internt søk (`POST /api/search`) er ikke-deterministisk — fullstendig uttrekk umulig uten endring hos Ungfritid. Fremtidig lavterskel-mulighet: lite nærhets-kall (~20 treff nær brukerens posisjon) der fullstendighet ikke kreves; body-kontrakt og probe-skript ligger i `scripts/ungfritid-probe*.mjs` | — |
| Kommunale events | Per-kommune adapter, start med Oslo | Middels; én adapter per kommune |
| Faste steder (lekeplasser, ballbinger, parker, idrettshaller, badeplasser, museer) | Månedlig batch-import fra OpenStreetMap Overpass: `npx tsx scripts/import-places.ts` (dry-run først). Titler fra OSM-navn eller revers-geokodet «Lekeplass ved <gate>» (`lib/places.ts`). Rader med `locked=true` røres aldri. Krever migrasjon 0005. ODbL-KRAV: «© OpenStreetMap contributors» synlig der stedene vises. Museer (tourism=museum) tatt inn jul. 2026 etter tag-probe: 132 steder i Oslo/Bergen/Stavanger, 97 % navn, fee 62,1 %, charge med kronebeløp 12,9 % (→ price_text). Utsatt til senere vurdering (for tynn OSM-dekning nå): svømmehall/badeland, ishall, akebakke, fornøyelsespark, minigolf, klatrepark | Lav; månedlig kjøring |
| Strender, badeplasser | Kartverket stedsnavn + OSM, manuell kuratering | Lav |
| Teatre, kinoer | Statisk liste (få objekter), manuelt vedlikeholdt | Svært lav |
| Arrangør-events | Oppgave 2.9: skjema + lenketolkning + feed | Selvbetjent |

Prinsipp: dynamiske kilder crawles/synkes automatisk, statiske steder
importeres én gang og kurateres, arrangører registrerer selv. Alt ender i
samme normaliserte `activities`-tabell.

## Kjente forenklinger

- Tidssone: events lagres med fast +02:00-offset (CEST). En time feil
  visningstid vinterstid til tidssonebibliotek legges inn.
- Bergen-RSS bruker `pubDate` som event-dato (arv fra scraperen); bør
  verifiseres mot faktisk feed-innhold.
- `expireOldEvents` bruker `starts_at` + 24 t; events uten dato beholdes.
