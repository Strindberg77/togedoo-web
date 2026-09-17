# 115 navnløse Skianlegg-flater: hva målingen krever, og hva koden alt svarer

**Status: målingen er IKKE kjørt.** Utviklingsmiljøet når ikke Overpass —
proxyen svarer 403 på CONNECT for `overpass-api.de`, `overpass.kumi.systems`,
`overpass.osm.ch` og `maps.mail.ru`, altså en policy-avvisning og ikke en
nettverksfeil. Det finnes heller ingen Supabase-nøkler her og ingen lokalt
OSM-uttrekk. Spørsmål 1, 2, 3 og 5 kan derfor ikke besvares herfra.

Dette dokumentet inneholder i stedet tre ting som er ekte:

1. **Det koden alene avgjør** — og det er mer enn ventet, særlig for spørsmål 3.
2. **Et ferdig måleinstrument** for spørsmål 1–3, testet uten nett.
3. **SQL for spørsmål 4 og 5**, som ikke trenger Overpass i det hele tatt.

---

## Det koden alene avgjør

### Kombinasjonen er mønster 5 av 6 i områdeselektoren

`scripts/import-places.ts:603–610`:

```ts
export const SKI_AREA_SELECTOR = [
    `nwr["landuse"="winter_sports"]…`,                      // 1
    `nwr["landuse"="recreation_ground"]["piste:type"]…`,    // 2
    `nwr["landuse"="recreation_ground"]["piste:lit"]…`,     // 3
    `nwr["landuse"="recreation_ground"]["piste:difficulty"]…`, // 4
    `nwr["landuse"="recreation_ground"]["sport"~"ski",i]…`, // 5  ← denne
    `nwr["leisure"="sports_centre"]["sport"~"ski",i]…`,     // 6
];
```

**Merk `~"ski",i`.** Det er et delstreng-treff uten ankere, ikke `=skiing`.
Mønsteret treffer også `sport=ski_jumping`, `sport=waterski` og `skijoring`.
Det er ikke årsaken her — utfordringen sier at alle 115 har nøyaktig
`sport=skiing` — men det er verdt å vite før noen strammer mønsteret.

### Alle 115 har ALLEREDE en utforløype inntil seg. Det følger av koden.

Dette er svaret på spørsmål 3, og det trenger ingen måling.

`skiVerdict` (`scripts/import-places.ts:770`):

```ts
const alle = [polygonTags, ...memberTags];
if (hasDownhillPiste(alle)) return 'alpint';
if (hasSkiLift(alle)) return 'usikker-heis';
return 'ikke-alpint';
```

og i verifiseringsløkka (`:953`):

```ts
if (verdict !== 'alpint') continue;
```

**Bare `alpint` blir rad.** `memberTags` er taggene til bevisobjektene som
består `anyInsideOrNearAny(points, rings, SKI_EVIDENCE_TOLERANCE_M)` — altså
ligger inne i eller inntil 50 m fra ringen.

En flate med nøyaktig `landuse=recreation_ground` + `sport=skiing` bærer ingen
`piste:type` selv. Beviset må derfor ha kommet fra et **naboobjekt**. Med andre
ord:

> Hver eneste av de 115 flatene har en `piste:type=downhill`-linje i eller
> inntil 50 m fra seg. Ellers ville den ikke vært en rad.

**Det omformulerer spørsmål 3.** «Hvor mange har en downhill-linje i boksen?»
er ikke et spørsmål med informasjon i — svaret er 115 av 115, per konstruksjon.
Spørsmålet med informasjon i er:

> Hvor mange er korridoren til ÉN linje, og hvor mange inneholder flere?

Én linje som går hele lengden av flata ⇒ flata er den linjas areal, og raden er
en dublett av noe som allerede finnes. Fem linjer i samme flate ⇒ et ekte
delområde med fem nedfarter. Det er det målet instrumentet under regner ut, og
det er ikke det samme målet utfordringen ba om.

### Hva rader uten navn får som tittel

Tittelkjeden er `makePlaceTitleDetailed`: OSM-navn → «Skianlegg ved \<gate\>» →
«Skianlegg i \<bydel\>» → «Skianlegg i \<poststed\>» → «Skianlegg». For flater
langt til fjells finnes sjelden en adresse innen 200 m, så disse havner nederst
i kjeden. Det er mekanismen bak «Skianlegg» × 6.

---

## Instrumentet for spørsmål 1–3

`scripts/skianlegg-flatemaal.ts` med analysen i `lib/flatemaal.ts`.

```bash
# 1. hent id-lista (SQL under), én per linje
# 2. se spørringene uten å sende dem:
npx --yes tsx scripts/skianlegg-flatemaal.ts --ids=flater.txt --queries
# 3. eller kjør dem og få rapporten:
npx --yes tsx scripts/skianlegg-flatemaal.ts --ids=flater.txt
```

**Tre spørringer, alle på id — de tåler dagtid.** Ingen områdeavgrensning,
ingen nasjonal henting, og bare én av dem henter geometri:

| | spørring | hva den koster |
|---|---|---|
| 1 | `way(id:…); .f out tags bb;` | boks + tagger, **null geometri** |
| 2 | `rel(bw.f); rel(br.f); out body;` | relasjonene, med medlemsliste |
| 3 | `way(around.f:100)["piste:type"~"downhill"]; out geom;` | linjene, avgrenset til 100 m rundt flatene |

To detaljer som ville vært tause feil, og som er låst av tester:

- **`out body`, ikke `out tags`, på relasjonene.** `out tags` gir relasjonen
  uten medlemsliste, og da kan ingen flate knyttes til den. Svaret er 200 og ser
  riktig ut. Nøyaktig samme felle som `OUT_GEOM_TAGS`.
- **`bw` OG `br`.** `rel(bw)` finner bare relasjoner som har en *way* som
  medlem. Er flata selv en relasjon, er det `rel(br)` som finner forelderen.

### Dekningsmålet

«Er flata arealet til én løype?» kan ikke måles på areal. En nedfart tegnet
rett nord–sør har en boks med **null bredde**, så et arealforhold gir 0 —
«dekker ingenting» om en linje som går tvers gjennom hele flata. Det samme
gjelder «svakeste akse».

`langsdekning` måler derfor langs flatas **lengste** akse: hvor stor del av
lengden én enkeltlinje strekker seg over. Bredden rapporteres for seg, og
antall kryssende linjer ved siden av. Signalet er kombinasjonen:

| kryssende | langsdekning | tolkning |
|---|---|---|
| 1 | ≥ 0,8 | flata er én løypes korridor — raden er en dublett |
| ≥ 3 | — | ekte delområde med flere nedfarter |

### Hva instrumentet ikke er testet mot

Analysen er testet (`lib/flatemaal.test.ts`, 12 tester) og spørringene er
testet som strenger (`scripts/skianlegg-flatemaal.test.ts`, 8 tester). **Ingen
av dem er kjørt mot en ekte Overpass-tjener**, fordi det ikke er mulig herfra.
`bw`, `br` og `around.<sett>` er konstruksjoner denne kodebasen ikke har brukt
før. Kjør med `--queries` og lim inn i overpass-turbo først, så koster en
syntaksfeil ingenting.

---

## SQL for spørsmål 4 og 5 — ingen Overpass

`osm_tags` lagres per rad (`supabase/migrations/0008_osm_tags.sql`), så begge
spørsmålene er ren SQL og kan besvares nå.

### Id-lista instrumentet trenger

```sql
select external_id
from activities
where category = 'Skianlegg'
  and status = 'published'
  and osm_tags->>'landuse' = 'recreation_ground'
  and osm_tags->>'sport' = 'skiing'
  and osm_tags->>'name' is null
order by external_id;
```

### Spørsmål 4 — hele kategorien, samme kombinasjon

```sql
select
  count(*) as totalt,
  count(*) filter (where osm_tags->>'name' is not null) as med_osm_navn,
  count(*) filter (where osm_tags->>'name' is null)     as uten_osm_navn,
  -- «NØYAKTIG» kombinasjonen: ingen andre tagger enn de to
  count(*) filter (
    where (select count(*) from jsonb_object_keys(osm_tags)) = 2
  ) as kun_de_to_taggene
from activities
where category = 'Skianlegg'
  and status = 'published'
  and osm_tags->>'landuse' = 'recreation_ground'
  and osm_tags->>'sport' = 'skiing';
```

Og de tre navngitte:

```sql
select title, external_id, municipality,
       osm_tags->>'name'    as osm_navn,
       osm_tags->>'landuse' as landuse,
       osm_tags->>'sport'   as sport,
       (osm_tags is null)   as er_seed
from activities
where category = 'Skianlegg'
  and (title ilike '%Trysil%'
       or title ilike '%Geilo%'
       or osm_tags->>'name' ilike '%child ski area%')
order by municipality, title;
```

**`er_seed` er kolonnen som avgjør spørsmålet.** Seed-rader har `osm_tags =
null` (`0016_activities_facets.sql`), så en rad med `er_seed = true` kom ikke
via noen selektor i det hele tatt. Kommer «Trysil» tilbake med
`landuse=winter_sports`, kom den via mønster 1 og ikke via denne
kombinasjonen — og da rører ikke et navnekrav på mønster 5 den.

### Spørsmål 5 — de fem utenfor Trysil, Hol og Voss

```sql
with kombi as (
  select external_id, title, municipality
  from activities
  where category = 'Skianlegg'
    and status = 'published'
    and osm_tags->>'landuse' = 'recreation_ground'
    and osm_tags->>'sport' = 'skiing'
    and osm_tags->>'name' is null
),
per_kommune as (
  select municipality, count(*) as skianlegg_i_kommunen
  from activities
  where category = 'Skianlegg' and status = 'published'
  group by municipality
)
select k.external_id, k.title, k.municipality,
       p.skianlegg_i_kommunen,
       (p.skianlegg_i_kommunen = 1) as eneste_i_kommunen
from kombi k
join per_kommune p using (municipality)
where k.municipality not in ('Trysil', 'Hol', 'Voss')
order by p.skianlegg_i_kommunen, k.municipality;
```

---

## Anbefaling

### (a) «Kombinasjonen krever navn» — frarådes ALENE

Ikke fordi tallene sier det, men fordi mekanismen ikke kan skille de to
tilfellene den må skille. Et navnekrav på mønster 5 fjerner både
delområdet i Trysilfjellet **og** den lille kommunale bakken der noen har
tagget nedfarten men ikke navngitt polygonet. Tagget er ikke det som gjør de
115 uønskede — at de er delområder av et større anlegg er det.

Kodebasen har allerede en uttalt holdning til nettopp denne handelen.
`skiVerdict` godtar et recall-tap fra nedfartskravet, og begrunnelsen står i
kommentaren: *«den forsvinner ikke i stillhet»* — de faller ut i
`usikker-heis`-lista og kan seedes. Et navnekrav ville vært samme recall-tap
**uten** en slik liste.

Skal (a) brukes, må den ha en tilsvarende liste. Det er et krav, ikke en
detalj.

### (b) Klynging under navngitt anlegg — trolig riktig for de 110

**Dette er en hypotese, ikke et funn.** 110 av 115 i nøyaktig tre kommuner,
alle med den samme minimale taggkombinasjonen, er signaturen til én kartlegger
per destinasjon — ikke til 110 uavhengige anlegg. Trysil, Hol og Voss har hver
sitt store anlegg (Trysilfjellet, Geilo/Hallingskarvet, Voss Resort/Myrkdalen).

**Hva som falsifiserer den:** spørring 2. Ligger flatene *ikke* i en navngitt
relasjon, og spørring 3 viser tre eller flere nedfarter i hver, er de
selvstendige delanlegg og skal ikke klynges bort.

**Hva som bekrefter den:** høyt medlemskap i få navngitte relasjoner, eller
høy andel med `kryssende === 1` og `langsdekning ≥ 0,8` — det siste betyr at de
er enkeltnedfarter og hverken anlegg eller delområder.

### (c) Kuraterte claims — riktig for de 5, feil for de 110

Claims-mekanismen (`lib/osm-claims.ts`) er bygget for unntak, og 110 håndpleide
id-er er ikke et unntak — det er et mønster som har fått feil verktøy. For de 5
utenfor de tre kommunene er den derimot presis, og spørsmål 5 er grunnen: er en
av dem eneste Skianlegg-rad i kommunen sin, er det den ene raden som ikke må
forsvinne, og en claim er måten å si det på.

### Konklusjon

**(b) for de 110, (c) for de 5** — avhengig av at spørring 2 og 3 bekrefter
hypotesen over. (a) kommer i tillegg bare hvis den får en
`usikker-heis`-liknende liste, ikke i stedet for.

Rekkefølgen på arbeidet følger av hva som er billigst å svare på:

1. **SQL-ene** (minutter, ingen Overpass) → spørsmål 4 og 5. Spørsmål 5 avgjør
   alene om (c) trengs.
2. **`--queries` i overpass-turbo** (minutter) → verifiser syntaksen.
3. **Instrumentet** (én kjøring, tre små spørringer) → spørsmål 1–3, og dermed
   om (b) holder.

Ingen rader er rørt, ingen filtre endret, ingen klyngelogikk bygget.
