# Nasjonal ski og aking

**Status:** grenen `claude/nasjonal-chunk`, bygget på
`claude/nasjonal-forberedelse`. Den nasjonale chunken er skrevet.
**Ingen nasjonal kjøring er gjort** — tørrkjøringen er Frederiks.

---

## Målingen som ligger til grunn

Kjørt mot `overpass-api.de` **ved midnatt**, bbox `(57.5,4.0,71.5,31.5)`:

| Spørring | Objekter | Tid | Størrelse |
|---|---|---|---|
| `nwr[landuse=winter_sports]` | 445 | 5,5 s | 3,2 MB |
| `nwr[piste:type~downhill\|sled\|playground]` | 7 555 | 35 s | 11,3 MB |
| *(til sammenligning)* `leisure=playground`, `out center tags` | 55 593 | 106 s | 9,3 MB |

Ingen `remark`, begge på første forsøk. **Én nasjonal chunk overlever.**

### Tre ting målingen faktisk viste

**1. `curl` trenger `-A`.** Uten en User-Agent svarer Apache **406 Not
Acceptable**, uansett hvor liten spørringen er. Kommandoene under har flagget;
den forrige utgaven av denne kjøreboka manglet det og ville feilet for neste
person. Importen selv har alltid sendt UA.

**2. Tidspunktet betyr mer enn størrelsen.** Oslo ALENE feilet med 504 i hver
eneste kjøring på dagtid. Hele Norge gikk gjennom ved midnatt. Den ufiltrerte
bevisspørringen feilet med «server is probably too busy» — altså **belastning,
ikke volum**.

> **Verdifilteret kan derfor ikke krediteres for at nasjonal henting ble
> mulig.** Sammenligningen filtrert/ufiltrert er ikke målt, fordi den
> ufiltrerte kjøringen aldri kom gjennom. Filteret sparer data uansett, siden
> `nordic` ikke leses av noen — men det er en annen påstand.

**3. Bboksen dekker Sverige, Danmark og Finland.** 445 polygoner mot 254 i
Geofabrik-fila, og 55 593 lekeplasser mot 11 901. Nesten 80 % av
lekeplasstreffene er utenfor Norge.

---

## Avgrensningen til Norge skjer på KOORDINATET

Objekter utenfor landet blir aldri rader: `buildRows` slår opp kommunen i
`data/kommuner.geojson`, og et punkt som ikke faller i noen norsk kommune
utelates med en linje i loggen.

```
  2 objekter utelatt — punktet ligger utenfor norske kommunegrenser (f.eks. way/201)
```

**Alternativet — et `area`-filter i spørringen — ble forkastet.** Begrunnelsen
er kostnadene, ikke eleganse:

| | Sent (grensefil) | Tidlig (`area[ISO3166-1=NO]`) |
|---|---|---|
| Målt? | **Ja** — 445 og 7 555 objekter, 40 s | **Nei** |
| Overføring | 14,5 MB i stedet for ~6 MB | ~6 MB |
| Geokoding av utenlandske rader | **null** — de utelates før geokodingsbehovet regnes ut | null |
| Romlig test | 0,1 s uansett (se under) | 0,1 s |
| Ny feilmodus | ingen | området løser seg ikke → tomt svar, som ser ut som et tomt land |

Norges grenseobjekt er blant de tyngste i OSM (lang kystlinje, tusenvis av
øyer). Å bytte en **målt** mekanisme mot en **umålt** for å spare 8 MB er feil
handel. Prisen for å filtrere sent er båndbredde og minne — ikke tid, fordi
den dyre ressursen (~1,1 s per navnløs rad) aldri brukes på utenlandske rader.

**Sjekk «utelatt»-linjene i loggen.** For ski forventes ~40 % utelatt
(445 → ~254). Er tallet null, virker ikke grensefila.

---

## Den romlige testen: 281 s → 0,1 s

Med hele landet i én chunk er alle 7 555 bevisobjekter kandidater for alle
445 polygoner — 3,4 millioner par. Målt på syntetiske data med de samme
antallene:

| | Tid | Dommer |
|---|---|---|
| Uten forkastningsfilter | **281,4 s** | 12 verifisert |
| Med forkastningsfilter | **0,1 s** | 12 verifisert |

Samme data, samme svar. Den gamle varianten var rent kvadratisk — målt på tre
punkter: 28 k par 2,3 s, 112 k par 9,4 s, 448 k par 37,2 s.

Filteret er boks-mot-boks før den ekte testen, og er et **oversett** av det
`anyInsideOrNearAny` godtar: et punkt inne i en ring ligger også inne i
ringens boks, så et objekt som ikke rører den utvidede boksen kan umulig
treffe. Egenskapstesten i `scripts/nasjonal-chunk.test.ts` kjører filtrert og
ufiltrert mot hverandre på 3 000 tilfeldige par.

**Minne:** 77 MB heap ved full skala. Målingen brukte ~693 000 geometripunkter;
de 14,5 MB ekte rådata tilsvarer ~320 000, altså rundt halvparten. Tallet er
konservativt.

**Lekeplass er et annet regnestykke** og er ikke i scope: 55 593 objekter, og
de har ingen romlig test — der er geokodingen flaskehalsen.

---

## Klyngingen nasjonalt

Med hele landet som én chunk kan to anlegg med samme navn i hver sin ende av
landet havne i samme navnegruppe. Taket er 1 000 m, så det skal ikke skje.
**Vist med tester, ikke med et resonnement:**

- Fem akebakker som alle heter «Marikollen skisenter», spredt fra Agder til
  Finnmark → **fem rader**.
- To med samme navn 900 m fra hverandre → **én rad**. Uten denne ville testen
  over bare bevist at grupperingen ikke virker.
- Fem *alpinanlegg* med samme navn → fem rader. **Skianlegg grupperer aldri på
  navn** — «klyngingen» der er den romlige bevistesten per polygon. Bare Aking
  navnegrupperer.
- Et bevis i Finnmark verifiserer ikke et polygon i Agder.

---

## Hva Frederik skal kjøre

### 1. Bekreft at spørringene fortsatt går gjennom

**Kjør om natten.** Merk `-A` — uten den svarer Apache 406.

```bash
UA='Togedoo datahub (hello@togedoo.com)'

time curl -sS -A "$UA" --max-time 300 -o /tmp/ski-omrade.json \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
[out:json][timeout:300];
(
  nwr["landuse"="winter_sports"]["disused"!~"."]["abandoned"!~"."](57.5,4.0,71.5,31.5);
);
out geom;'
jq '.elements | length' /tmp/ski-omrade.json     # forventet ~445
jq -r '.remark // "ingen remark"' /tmp/ski-omrade.json

time curl -sS -A "$UA" --max-time 300 -o /tmp/ski-bevis.json \
  https://overpass-api.de/api/interpreter --data-urlencode 'data=
[out:json][timeout:300];
(
  nwr["piste:type"~"downhill|sled|playground"]["disused"!~"."]["abandoned"!~"."](57.5,4.0,71.5,31.5);
);
out geom;'
jq '.elements | length' /tmp/ski-bevis.json      # forventet ~7555
jq -r '.remark // "ingen remark"' /tmp/ski-bevis.json
```

### 2. Nasjonal tørrkjøring

```bash
npx --yes tsx scripts/import-places.ts --national --dry-run --work --category=skianlegg,aking
```

Tre Overpass-spørringer (ski-område, ski-bevis, aking), så berikelse og
godkjenningsoppsummering. **Ingenting skrives.**

Det skal stå i utskriften:

| Linje | Forventet |
|---|---|
| `hent Norge/skianlegg` | ~445 omrade, ~7555 bevis |
| `hent Norge/aking` | ~700 objekter (89 i Norge + naboland) |
| `objekter utelatt — utenfor norske kommunegrenser` | **ikke null** — ellers virker ikke grensefila |
| `skianlegg` i tabellen | rundt 254, andel rundt 100 % |
| `aking` i tabellen | rundt 89 |
| Claims | **6 objekter undertrykt** — Korketrekkeren + de to Oslo-relasjonene |
| Duplikatkandidater | 0 forventet |

### 3. Les oppsummeringen, så skriv

Skrivekommandoen står ferdig utfylt nederst, med fingeravtrykket. Den nekter
hvis noe har endret seg siden godkjenningen.

```bash
npx --yes tsx scripts/import-places.ts --national --work --resume --category=skianlegg,aking --approve=<fingeravtrykk>
```

---

## Stoppvilkårene er ikke utløst mot ekte data ennå

Terskelen på 20 % geokodingsfeil og 20 % utbyttekollaps er **valgt, ikke
målt**. Utbyttesjekken er den eneste som er sett virke, og bare mot
mock-data i test.

**Det er forutsetningen for neste steg** (nattjobb/automatisering): et
stoppvilkår som aldri er utløst mot ekte data, er en påstand og ikke en vakt.
Tørrkjøringen over er første anledning til å se dem oppføre seg.

---

## Det som IKKE er gjort

- Ingen nasjonal kjøring, ingen skriving.
- Ingen lekeplass eller ballbane nasjonalt. 55 593 objekter, ~80 % utenfor
  Norge, og geokoding som flaskehals — de hører til kildebyttet.
- Ingen områdeakse. Med én nasjonal chunk trengs den ikke, og spørsmålet om
  `admin_level` er fortsatt ubesvart for de kategoriene som må deles opp.
- Ingen nattjobb. Se over.
