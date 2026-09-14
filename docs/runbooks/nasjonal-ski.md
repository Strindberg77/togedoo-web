# Nasjonal ski og aking: forberedelsene

**Status:** koden står på grenen `claude/nasjonal-forberedelse`. **Ingenting er
kjørt** — ingen nasjonal henting, ingen seed, ingen skriving.

Dette er punkt 1–5 fra arbeidsformsvurderingen. Målet er at en **lokal
Claude-økt på Mac-en** kan kjøre hentingen og berikelsen uten tilsyn, og at
Frederik bare godkjenner skrivingen.

---

## Det som må måles først

Alt under hviler på at én nasjonal Overpass-spørring overlever med
verdifilteret. Det kan ikke måles herfra. **Kjør dette først:**

```bash
time curl -sS --max-time 300 -o /tmp/ski-omrade.json \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
[out:json][timeout:300];
(
  nwr["landuse"="winter_sports"]["disused"!~"."]["abandoned"!~"."](57.5,4.0,71.5,31.5);
);
out geom;'
jq '.elements | length' /tmp/ski-omrade.json
jq -r '.remark // "ingen remark"' /tmp/ski-omrade.json
ls -la /tmp/ski-omrade.json
```

Forventet: **~254 objekter**, ingen `remark`. Så den tunge:

```bash
time curl -sS --max-time 300 -o /tmp/ski-bevis.json \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
[out:json][timeout:300];
(
  nwr["piste:type"~"downhill|sled|playground"]["disused"!~"."]["abandoned"!~"."](57.5,4.0,71.5,31.5);
);
out geom;'
jq '.elements | length' /tmp/ski-bevis.json
jq -r '.remark // "ingen remark"' /tmp/ski-bevis.json
ls -la /tmp/ski-bevis.json
```

Forventet: **~3 240 objekter** (3 108 utforløyper + 89 akebakker + 43 skileik).
Uten filteret ville den samme spørringen hentet ~51 000 med full geometri.

| Utfall | Betydning |
|---|---|
| Begge svarer, ingen `remark` | Én nasjonal chunk er realistisk. Gå videre. |
| `remark` eller 504 | Del opp — men **ikke i 356 kommuner**. Prøv først halve landet i to bbox-er. |
| Svaret er over ~200 MB | Overpass klarte det, men minnet i Node blir et spørsmål. Mål det før neste steg. |

**Kjør også den samme bevisspørringen UTEN filteret én gang**, så tallet er
målt og ikke antatt. Da vet vi hva filteret faktisk sparte.

---

## Arbeidsformen

```
     Claude, lokalt på Mac-en          Frederik
     ─────────────────────────         ────────
  1. --dry-run --work            →
  2. leser oppsummeringen        →     leser 15 linjer
  3.                                   sier ja
  4. --resume --approve=<fp>     →     (skrivingen)
```

Steg 1 og 2 kan kjøres i timevis uten tilsyn. Steg 4 er det eneste som skriver,
og det nekter å kjøre uten fingeravtrykket fra steg 2.

### Kjøring 1 — hent og berik

```
npx --yes tsx scripts/import-places.ts --dry-run --work --category=skianlegg,aking
```

Skriver `.import-work/<chunk>.fetch.ndjson` og `.enrich.ndjson`, og avslutter
med godkjenningsoppsummeringen.

### Kjøring 2 — skriv

```
npx --yes tsx scripts/import-places.ts --work --resume --category=skianlegg,aking --approve=<fingeravtrykk>
```

Kommandoen står ferdig utfylt nederst i oppsummeringen. Den nekter hvis
fingeravtrykket ikke stemmer med det som ligger i arbeidskatalogen.

---

## Hva som stopper kjøringen av seg selv

| Vilkår | Terskel | Virkning |
|---|---|---|
| Claim-navneavvik | **1** | Avbryter hele kjøringen |
| Geokodingsfeil | > 20 % av forsøkene i en chunk, minst 10 forsøk | Avbryter hele kjøringen |
| Utbyttekollaps | < 20 % av forventet, etter 25 % av planen | `DOM: STOPP`, skriving nektes |

De to første avbryter **hele** kjøringen, ikke bare chunken. Skillet er
poenget: en Overpass-504 for Trondheim skal ikke stanse Bergen, men en claim
med feil id ville gjort samme feil i de neste 300 chunkene.

**De to tersklene er valgt, ikke målt.** Det står i koden der de defineres. De
skal kalibreres første gang en full nasjonal tørrkjøring finnes.

**Utbyttesjekken gjelder bare den nasjonale planen.** En per-kommune-kjøring
får tom forventningskolonne, fordi fire byer ikke er en andel av Norge man kan
regne ut fra antall chunks — Oslo alene har en tredel av landets lekeplasser.

---

## Oppsummeringen

```
========================================================================
GODKJENNING  c46cedd8   1 chunk(s)   2026-09-14 21:40

  DOM: GO
  RADER: 347   (nye 341, oppdaterer 6)

  kategori        rader   forventet   andel   uten ekte navn
  skianlegg         261         254    103%                4
  aking              86          89     97%                1

  Geokodingsfeil ......... 0 av 5 forsøk
  Overpass-omkamper ...... 3 av 6 spørringer  ADVARSEL
  Bekreftet tomme sett ... 0
  Claims ................. 5 objekter undertrykt, 0 navneavvik
  Duplikatkandidater ..... 0

  SKRIV:
    npx --yes tsx scripts/import-places.ts --work=.import-work --resume ...
========================================================================
```

De tre linjene som avgjør et ja eller nei:

- **nye vs. oppdaterer** — en upsert som oppdaterer 300 eksisterende rader er
  noe helt annet enn en som setter inn 300.
- **andel mot forventet** — 103 % er beroligende, 41 % er et stopp.
- **fingeravtrykket i skrivekommandoen** — det som gjør at ja betyr ja til
  DISSE radene.

---

## Oslo treffes på nytt

En nasjonal chunk henter også Oslo. Det er tilsiktet, og det skal **synes i
diffen**:

| Sted | Hva skjer |
|---|---|
| Tryvann, Wyller, Tommkleiva, Trollvannskleiva, Grefsenkleiva | **Ingenting.** Seedet, og de to OSM-relasjonene er claimet — objektene blir aldri rader. |
| Lia, Jerikobakken, Leirskallen | **Oppdateres**, ikke nye. De er importert fra før med samme `external_id`. |
| Korketrekkeren | **Ingenting.** Seedet og claimet. |

Så oppsummeringen skal vise minst tre i `oppdaterer`-kolonnen og fem
`objekter undertrykt` under Claims. Viser den null undertrykte, er claimene
ikke i spill, og da er noe galt.

---

## Angring

`<chunk>.before.ndjson` i arbeidskatalogen inneholder de `external_id`-ene som
**fantes fra før**. Alt som finnes etterpå og ikke står der, er nytt, og kan
avpubliseres presist:

```sql
update public.activities a
set status = 'rejected', locked = true
from public.sources s
where a.source_id = s.id
  and s.slug = 'osm-steder'
  and a.category in ('Skianlegg', 'Aking')
  and a.status = 'published'
  and a.external_id not in ( /* linjene fra before.ndjson */ );
```

**DEN ÆRLIGE BEGRENSNINGEN: oppdaterte rader kan ikke gjenopprettes.**
Importen har ingen historikk, og upserten overskriver feltene. En rad som lå
riktig og blir skrevet feil, er feil til noen retter den for hånd. Det er
grunnen til at «nye vs. oppdaterer» står øverst i oppsummeringen, og til at
den første nasjonale kjøringen for en kategori helst skal treffe en kategori
som er tom fra før.

---

## Det som IKKE er gjort

- Ingen nasjonal chunk er definert. `planForCities` lager bare
  by-chunks. Den nasjonale chunken (`cityAnchor: null`, bbox som
  `overpassArea`) skrives når målingen over er gjort — det er én funksjon, og
  den skal ikke skrives før vi vet om spørringen overlever.
- Ingen områdeakse for lekeplass og ballbane. De hører til kildebyttet.
- Terskelkalibreringen. Se over.
