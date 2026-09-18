# `/api/steder` — kontrakten

Stedsforslag til søket. Når en forelder skriver «Geilo», gir `/api/activities`
aktivitetstreffene (SkiGeilo, 157 km). Dette endepunktet gir i tillegg
**stedet**: «Geilo · tettsted i Hol», som appen kan tilby som «se hva som
finnes i nærheten».

Endepunktet gir bare forslag. **Appen bytter aldri sted av seg selv.** Et søk
på «Ski» handler fortsatt om skianlegg, og byen Ski er et tilbud ved siden av
aktivitetstreffene, ikke et hopp dit.

Kilden er Kartverkets stedsnavn-API. Appen kaller aldri Kartverket selv:
togedoo-web er datahubben. Logikken ligger i `lib/steder.ts`, og ruta i
`app/api/steder/route.ts`.

---

## Forespørsel

```
GET /api/steder?q=Geilo&lat=59.9139&lng=10.7522
```

| Parameter | Betydning |
|---|---|
| `q` | Søketeksten. **Under 3 tegn gir tom liste og ingen kall til Kartverket.** Maks 50 tegn. `*` fjernes. |
| `lat`, `lng` | Valgfritt. Gir avstand og brukes til rangering. Ugyldig eller halv posisjon ignoreres: da blir avstanden ukjent, og svaret er ellers det samme. |

## Svar

Alltid **HTTP 200**.

```jsonc
{
  "success": true,
  "data": [
    {
      "id": "…",              // Kartverkets stedsnummer, stabil id
      "navn": "Geilo",
      "type": "tettsted",     // kort norsk etikett, se under
      "kommune": "Hol",
      "kommunenummer": "3324",
      "fylke": "Buskerud",
      "lat": 60.5337,
      "lng": 8.2090,
      "distanceM": 156000,    // luftlinje i meter fra lat/lng, null uten posisjon
      "eksakt": true          // traff navnet eksakt, eller bare starten
    }
  ],
  "count": 1,
  "kilde": "kartverket",       // "kartverket" | "cache" | "ingen" | "utilgjengelig"
  "attribution": "Stedsnavn © Kartverket (CC BY 4.0)",
  "timestamp": "…"
}
```

**`attribution` skal vises i appen der stedsforslagene står.** Stedsnavnene er
Kartverkets data under CC BY 4.0, og lisensen krever kreditering.

**`kilde`:**

| Verdi | Betydning |
|---|---|
| `kartverket` | Hentet nå. Kan likevel være Next sin datacache, som ligger foran Kartverket. |
| `cache` | Fra minnebufferen i denne serverinstansen. |
| `ingen` | `q` var under 3 tegn. Ingen kall ble gjort. |
| `utilgjengelig` | Kartverket svarte ikke i tide, eller svarte med en feil. Lista er tom eller ufullstendig. **Appen skal ikke lese det som «stedet finnes ikke».** |

### Kommune og fylke

- Tospråklige kommuner får samme navn som i resten av datahubben
  (`lib/municipality.ts`). «Storfjord - Omasvuotna - Omasvuono» blir «Storfjord».
- Fylket får det norske leddet. «Troms - Romsa - Tromssa» blir «Troms».
- En kommune vises uten «kommune»/«herad» i navnet, for eksempel «Voss herad»
  som «Voss». Etiketten `kommune` sier det allerede.

---

## Hvilke steder som kommer med

Bare navneobjekttyper en familie tenker på som «et sted å dra til». Filteret
sendes til Kartverket, så gårdene aldri kommer over nettet.

| Kartverket-type | `type` i svaret |
|---|---|
| By | `by` |
| Tettsted | `tettsted` |
| Kommune | `kommune` |
| Bydel, Administrativ bydel | `bydel` |
| Bygdelag (bygd) | `bygd` |
| Tettsteddel | `del av tettsted` |
| Tettbebyggelse | `boligområde` |
| Grend | `grend` |

**Uten filter** (ekte søk mot Kartverket, 18. sep. 2026):

| Søk | Treff | Det meste av det | Stedstyper blant dem |
|---|---|---|---|
| Nes | 217 | 101 gård, 61 bruk, 14 navnegard, 10 bru | 6 |
| Sand | 104 | 51 bruk, 17 gård, 6 gammel bosettingsplass | 7 |
| Ski | 12 | 4 gård, 2 bruk, stasjon, bru, kirke | 2 |
| Geilo | 5 | 2 adressenavn, vik, navnegard | 1 |

**Utelatt med vilje:**

- **Fylke** er for stort. «Se hva som finnes i nærheten» av Innlandet betyr
  ingenting.
- **Poststed** dubler tettstedene, og er en postgrense.
- **Annen administrativ inndeling** er mest tidligere kommuner, som
  «Ski kommune» (nå Nordre Follo) og «Søgne kommune». Et sted som ikke finnes
  lenger skal ikke tilbys.
- **Statistisk tettsted** gir bare to treff på «S*» i hele landet.
- **Landskapsområde og dalføre**: «Trysil» og «Hemsedal» finnes som dette, men
  kommunen med samme navn dekker dem.
- **Fjell, alpinanlegg og hotell**: Hafjell, Norefjell og Skeikampen er *fjell*
  i registeret, og Vrådal er et *hotell*. De gir derfor ingen stedsforslag.
  Skianleggene der er aktivitetsrader og finnes gjennom `/api/activities`.

Historiske navn verken matches eller vises. Nesbyen het «Nes kommune» før
2020, og et søk på «Nes» gir derfor ikke Nesbyen som eksakt treff.

## Rangering

1. **Eksakt navnetreff foran delvis.** Hovednavnet teller mest, deretter andre
   navn stedet har (Tingnes heter også «Nes»).
2. **Stedstype**, i rekkefølgen fra tabellen over: by, tettsted, kommune,
   bydel, bygd, del av tettsted, boligområde, grend.
3. **Avstand** fra `lat`/`lng`, når den er oppgitt.
4. Navn og id, for en stabil rekkefølge.

**Samme navn i samme kommune er ett forslag.** Registeret fører Ski både som
by og som bygd, og Hemsedal både som kommune og bygd. Det best rangerte står
igjen.

**Maks 5 treff.**

## Robusthet og cache

- **Timeout: 1,5 sekunder** mot Kartverket. Er Kartverket tregt eller nede,
  svarer endepunktet 200 med tom liste og `kilde: "utilgjengelig"`.
- **Aktivitetssøket skal aldri vente på dette.** Appen kaller de to
  endepunktene hver for seg og viser aktivitetstreffene med én gang.
- To kall til Kartverket går i parallell: eksakt («Sand») og prefiks
  («Sand*»). Kartverket sorterer på kategori før treffkvalitet, så et rent
  prefikssøk kan skyve det eksakte stedet ut av første side. Uten prefikset
  ville kommunene («Trysil kommune», «Voss herad») aldri blitt funnet på
  «Trysil» og «Voss».
- **Cache i et døgn**, på søketeksten og ikke på posisjonen. Posisjonen
  påvirker bare rangeringen, som gjøres på nytt hver gang. Cachen er en
  minnebuffer per serverinstans, pluss Next sin datacache
  (`next.revalidate`), som deles mellom instansene.
- **Bare hele svar caches.** Feiler ett av de to kallene, vises det som kom,
  men det lagres ikke.

## Verifisert mot ekte data

Fra Oslo sentrum (59.9139, 10.7522), 18. sep. 2026, gjennom ruta:

| Søk | Svar |
|---|---|
| Geilo | **Geilo · tettsted · Hol · Buskerud · 156 km**, Geilomoen (del av tettsted), Geilo hyttegrend (grend), Geilostrondi (grend, Skjåk) |
| Ski | **Ski · by · Nordre Follo · 22 km**, Skien (by), Skillebekk, Skiptvet, Skjærviken (tettsteder) |
| Voss | **Voss · kommune · Vestland · 252 km**, Vossavangen (tettsted) |
| Trysil | **Trysil · kommune · Innlandet · 176 km** |
| Hemsedal | **Hemsedal · kommune · Buskerud · 160 km** |
| Sand | Fem steder som heter Sand: tettsted i Ullensaker (34 km), Nord-Odal (69 km) og Suldal (257 km), boligområde på Hvaler, og grend i Porsgrunn |
| Nes | Tettsted i Ringerike (84 km), **kommune i Akershus (46 km)**, bygd i Ørland, boligområde i Molde, og grend i Nissedal |
| Blorfgruk | Ingen treff |

Geilo gir 156 km her og SkiGeilo 157 km i `/api/activities`. Tettstedets punkt
og skianleggets adkomstpunkt ligger ikke på samme sted.

### Svartid

Målt mot `next dev`, ti søk ruta aldri hadde sett før (Beitostølen,
Lillehammer, Rjukan og flere):

| | Min | Median | Maks |
|---|---|---|---|
| Kaldt: to kall til Kartverket i parallell | 54 ms | 64 ms | 191 ms |
| Varmt: samme søk igjen, fra cache | 2 ms | 4 ms | 6 ms |

I produksjon kommer nettverket til Vercel og en eventuell kald start i
tillegg. Se målingene av `/api/activities` i
[api-activities.md](api-activities.md).
