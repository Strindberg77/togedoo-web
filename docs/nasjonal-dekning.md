# Fra fire byer til nasjonal dekning

**Status:** vurdering, ingen beslutning tatt. Ingen kode endret.
**Skrevet:** sep. 2026, foranlediget av alpinseeden (~25 anlegg, Tryvann til
Hemsedal).

Dokumentet svarer på ett spørsmål: hva skal til for at Togedoo dekker hele
Norge, og deretter Sverige, uten å bygge noe som må rives ned igjen.

---

## Sammendrag

Arkitekturen er allerede geografisk. Radius-modus går gjennom PostGIS med
brukerens posisjon og sorterer nærmest først — den skalerer i prinsippet til
hele landet. Det er **parameterne** som er firebymodellen, ikke strukturen.

Men den bindende skranken er ikke geografi. Det er **grensen på 100 rader**,
og den er brutt i dag, uavhengig av radius.

---

## Funn 1: `limit: 100` er global, ikke per kategori

`explore_screen.dart` sender `limit: 100` til `/api/activities`, som sender
det videre som `p_limit` til `activities_nearby`. RPC-en sorterer på avstand
og kapper.

**Grensen deles av alle valgte kategorier.**

Oslo har 3996 lekeplasser. Velger en forelder i Oslo både Lekeplass og
Museum, er de 100 nærmeste stedene nesten utelukkende lekeplasser. Museene
faller ut av resultatet — ikke fordi de er langt unna, men fordi de taper
kappløpet mot en tettere kategori.

Dette er ikke en fremtidig skaleringsfeil. **Det skjer i dag**, og radius er
ikke involvert.

Ved 200 km blir det bare mer synlig: du får fortsatt de 100 nærmeste, som
alle ligger innen få kilometer av brukeren. Hverken paginering eller klynging
løser det — **«N nærmeste per kategori» gjør det.**

Dette bør fikses før nasjonal dekning i det hele tatt gir mening.

---

## Funn 2: det er TO radiustak, ikke ett

| Sted | Verdi |
|---|---|
| `explore_screen.dart` — `_radiusOptionsMeters` | `[5000, 10000, 20000, 50000]` |
| `app/api/activities/route.ts:141` | `Math.min(…, 100000)` |

```ts
const radius = Math.min(Number(searchParams.get('radius') ?? 10000) || 10000, 100000);
```

Serveren klipper til 100 km uansett hva appen ber om. Å bare heve app-lista
er derfor ikke nok: Oppdal ligger 120 km fra Trondheim og forblir usynlig.

**Begge må opp.** To linjer til sammen.

---

## Funn 3: by-modus velger vilkårlig

Dokumentert separat i `seed-backlog.md` under «Kjent gjeld». Kort gjentatt:
by-modus sorterer på `starts_at`, som er null for alle stedsrader, og kapper
til 100. Utvalget er i praksis databasens radrekkefølge.

Avstandssorteringen som ble lagt inn i sep. 2026 sorterer utvalget *etter* at
det er hentet, og løser derfor presentasjonen, ikke utvalget.

---

## Hvor «fire byer» sitter

| Sted | Hva det er | Må endres? |
|---|---|---|
| `import-places.ts` — `DEFAULT_CITIES` og import-loopen | Kjører per by | **Ja** — største enkeltbegrensning |
| `import-places.ts` — `area[admin_level=7][name=<by>]` | Kommune-basert Overpass-område | **Ja** — må bli fylke eller land |
| `route.ts` — by-modus (`municipality ilike … OR near_city ilike …`) | Nødspor uten avstandsdimensjon | **Avvikles**, ikke endres — se under |
| `seed-*.ts` — `nearCity` | «Hjemby» for utenbys-steder | **Nei** — den er sann der den brukes, den skal bare ikke være obligatorisk |
| `lib/cities.ts` — fire bysentre | Oppslag på navn | **Nei** — se under |
| Appen — by-chips | Fire faste byer | **Ja, til slutt** |
| Appen — `_serverCategories` | Kategoriliste | **Nei** — ingen bygeografi |
| Radiustakene | Se funn 2 | **Ja** |
| `limit: 100` | Se funn 1 | **Ja, og først** |

---

## Minste steg som ikke må rives ned

Tre ting, i rekkefølge. Alle additive, alle små nok for kvelder.

1. **Per-kategori-grense i stedet for global.** Løser en feil som finnes i
   dag, og er en forutsetning for alt annet.
2. **Hev begge radiustakene.** To linjer. Da blir Oppdal synlig for en
   Trondheims-familie, uten noen ny arkitektur.
3. **Importer per fylke i stedet for per by.** Bytter `DEFAULT_CITIES` mot en
   fylkesliste og `admin_level=7` mot `4`. Samme kode, annen inndata.

Ingen av dem bygger noe som må rives.

---

## Hva by-modus bør bli

By-modus finnes fordi posisjon kan feile eller nektes. Men det den *egentlig*
gjør er å skaffe et koordinat på en annen måte.

Sluttbildet er at den forsvinner som egen modus og erstattes av en
**stedsvelger som gir en koordinat**, hvorpå alt går gjennom samme radius-vei.
Da er det én kodesti i stedet for to, og hele `municipality ilike … OR
near_city ilike …`-greina forsvinner sammen med gjelden i `seed-backlog.md`.

Mellomsteget er å la `municipality` være hvilken som helst kommune, ikke én av
fire. Billig, og peker samme vei.

**`lib/cities.ts` er ikke et hinder.** Den er et oppslag på navn; å legge til
byer er å legge til rader. Den blir upraktisk først når lista passerer ti–tolv
og bør bli en tabell, og helt overflødig når stedsvelgeren leverer koordinater
direkte. Å ha bygget den var likevel riktig — den gjorde dagens by-modus
ærlig mens den lever.

---

## Nasjonal import: hva den koster

**Overpass er ikke problemet.** I dag: 4 byer × 9 kategorier = 36 spørringer.
Per fylke: 15 × 9 = 135. Med `OVERPASS_QUERY_PAUSE_MS` på 1 s og
retry-logikken er det timer, ikke dager, og det kan kjøres fylke for fylke.

**Geokodingen er problemet.** `TITLE_PAUSE_MS` er 1100 ms, og hvert sted uten
brukbart OSM-navn trenger ett revers-oppslag. Norge har 11 901
`leisure=playground`. Er 80 % navnløse, er det ~9500 oppslag × 1,1 s ≈ **3
timer bare for lekeplasser**, før de andre kategoriene. For hele landet trolig
et døgn eller mer på første kjøring.

Overkommelig — `geocode_cache` gjør andre kjøring billig — men det må
planlegges som en batch-jobb, kjørt fylkesvis så en avbrutt kjøring ikke
koster alt.

> **Anslag, ikke måling.** Navneandelen per kategori er ikke målt utenfor de
> fire byene.

---

## Sverige: hva som er norsk

| Punkt | |
|---|---|
| `lib/geocode.ts` — `ws.geonorge.no`, `api.kartverket.no` | Må byttes per land (Lantmäteriet i Sverige) |
| `import-places.ts` — `admin_level=7` | Kalibrert for norsk kommune, må verifiseres per land |
| **`lib/places.ts` — `isUsablePlaceName`** | Mindre åpenbart: `SUSPICIOUS_PATTERNS` matcher norske ordendelser (`gata`, `gaten`, `veien`, `vegen`, `allé`) og norske institusjonsord (`barnehage`, `skole`, `borettslag`, `menighet`). På svenske navn siler den feil i begge retninger. |
| Kategorinavn og tagliner i appen | Ren tekst, men per språk |
| `near_city` og bykonstantene | Data |

Resten — kategorier, OSM-tagger, fasetter, prislogikk — er landuavhengig.

---

## Alpinseeden: kjør den nå

**Ingenting går tapt ved å seede før modellen endres.** Verifisert: `grep` på
`.delete()`, `DELETE` og `prune` i `import-places.ts` og seed-skriptene gir
null treff. Alt er upsert på `(source_id, external_id)`.

**Ett forbehold, og det er viktig.** Garantien hviler på at `external_id` er
stabil. For seedede rader er den en slug du bestemmer selv. Endres
slug-formatet senere, **oppdateres ikke radene — de dupliseres.** Velg
slug-formen nå og ikke rør den.

Konkret for de ~25:

- Sett ekte `municipality` og koordinater for alle.
- Sett `nearCity` **kun der den er sann**. Hemsedal får ingen. Det er ikke en
  mangel — det er en ærlig representasjon av at stedet ikke hører til noen av
  de fire.
- Hemsedal blir da usynlig i by-modus til radiustakene heves. Det er greit, og
  det er selvforklarende.

Radene bærer koordinater, som er det den nasjonale modellen bygger på.
`nearCity` er en tilleggsopplysning som fortsatt vil være sann for Vassfjellet
og bare slutter å være nødvendig.

---

## Det dette dokumentet ikke svarer på

- Om per-kategori-grensen skal løses i RPC-en (én spørring med
  `row_number() over (partition by category)`) eller som én spørring per
  kategori fra API-et. Ikke undersøkt.
- Hva fylkeslista skal være, og om `admin_level=4` faktisk gir norske fylker
  i OSM. Ikke verifisert.
- Faktiske radtall per kategori nasjonalt, utover lekeplass-tallet.
