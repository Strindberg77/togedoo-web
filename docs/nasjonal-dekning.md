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

Den bindende skranken er ikke geografi, men **grensen på 100 rader** — og den
er mindre alvorlig enn førsteutkastet av dette dokumentet hevdet. Se
avveiningen under funn 1: i Utforsk er skjevheten en konsekvens brukeren selv
har valgt, og per-kategori-grensen hører til forsiden, ikke hit.

---

## Funn 1: `limit: 100` er global, ikke per kategori

`explore_screen.dart` sender `limit: 100` til `/api/activities`, som sender
det videre som `p_limit` til `activities_nearby`. RPC-en sorterer på avstand
og kapper.

**Grensen deles av alle valgte kategorier.**

Oslo har 3996 lekeplasser. Velger en forelder i Oslo både Lekeplass og
Museum, er de 100 nærmeste stedene nesten utelukkende lekeplasser. Museene
havner nederst — og er borte helt hvis det finnes hundre lekeplasser nærmere
enn det nærmeste museet. Ikke fordi de ligger langt unna, men fordi de taper
kappløpet mot en tettere kategori.

Ved 200 km blir det ikke verre og ikke bedre: du får fortsatt de 100
nærmeste, som alle ligger innen få kilometer av brukeren. Hverken paginering
eller klynging løser det — **«N nærmeste per kategori» gjør det.**

### Men hvor alvorlig er det egentlig?

Førsteutkastet av dette dokumentet skrev at museene «faller ut», og at dette
«bør fikses før nasjonal dekning i det hele tatt gir mening». **Begge deler
var for sterkt, og er rettet her.**

Motargumentet, fra eier: *når brukeren selv har valgt kategoriene, er det ikke
urimelig at den største dominerer. Skjevheten er synlig og selvforklarende,
ikke skjult. De som velger Lekeplass vil ha lekeplass.*

Det holder. Presiseringen er at «faller ut» bare er sant i én av de tre
tilstandene:

| Modus | Hva som skjer med en liten kategori |
|---|---|
| **Radius** | Ligger **nederst** — med mindre den har ≥ 100 nærmere naboer, da er den **borte** |
| **By** | **Tilfeldig** om den er med i det hele tatt: de 100 radene er vilkårlige (`order by starts_at`, null for alle steder) |

Nederst er en preferanse. Borte er en feil. Tilfeldig er verken — det er
funn 3, og løses av arbeidet med by-modus, ikke av en per-kategori-grense.

**Terskelen for når skjevhet blir en ekte feil** er ikke et antall kategorier
eller et størrelsesforhold. Den er: *kan brukeren komme til det som mangler,
med en handling som finnes i appen?* Velger man alle femten og ser hundre
lekeplasser, kan man fravelge Lekeplass og finne museet. Skjevheten er
gjenopprettelig.

Den blir en feil i det øyeblikket **appen selv** setter sammen utvalget — en
forside som blander kategorier uten at brukeren har valgt noe. Den finnes
ikke i dag (`home_screen.dart` henter ingen datahub-steder).

**Konklusjon:** per-kategori-grensen er et krav til forsiden, ikke til
Utforsk. Den venter til forsiden bygges.

### Det som likevel var galt, og er rettet

Knappen skrev `Vis $n steder` med `n` = antall hentede rader. Med 3996
lekeplasser i Oslo sto det «Vis 100 steder» — et tak presentert som en total,
og den eneste måten brukeren kunne fått vite at lista var kappet.

Rettet i togedoo-modern: ordlyden er «Vis de N første» når hentingen traff
taket, og resultatlista har fått en linje som sier hva den faktisk inneholder
(«Lekeplass 94 · Museum 3 · Skianlegg 3 · flere finnes — snevre inn»).
Hentingen er uendret.

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
| `limit: 100` | Se funn 1 | **Ja — men når forsiden bygges** |

---

## Minste steg som ikke må rives ned

Tre ting, i rekkefølge. Alle additive, alle små nok for kvelder.

1. **Hev begge radiustakene.** To linjer. Da blir Oppdal synlig for en
   Trondheims-familie, uten noen ny arkitektur.
2. **Importer per fylke i stedet for per by.** Bytter `DEFAULT_CITIES` mot en
   fylkesliste og `admin_level=7` mot `4`. Samme kode, annen inndata.
3. **Per-kategori-grense** — men først når forsiden bygges, ikke som
   forutsetning for nasjonal dekning. Se avveiningen under funn 1.

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
