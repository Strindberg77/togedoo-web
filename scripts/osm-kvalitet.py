#!/usr/bin/env python3
"""
osm-kvalitet.py — måler datakvaliteten på lekeplasser og ballbaner NASJONALT,
før noe filter bygges.

    python3 scripts/osm-kvalitet.py /tmp/pp.geojsonseq

Ingen avhengigheter utover standardbiblioteket. Leser GeoJSONSeq (én JSON per
linje) fra `osmium export`, strømmende.

─────────────────────────────────────────────────────────────────────────
HVORFOR DEN FINNES

Én tur til Kjelsås i sep. 2026 ga en resultatliste der seks rader het
«Lekeplass ved Gunnar Schjelderups vei», to av dem 4 m fra hverandre, og en
plen sto oppført som basketballbane. Det åpenbare svaret er et kvalitetsfilter
og en avstandsterskel — og det er nettopp der man tar feil billig:

  · «pitch uten sport-tagg» kan ikke forekomme. Selektoren har krevd `sport`
    siden første commit (7e5b4db), så et slikt filter finnes allerede. Det som
    faktisk skiller plen fra bane er `surface`, og den måles derfor her.
  · «lekeplass uten utstyrstagg» hørtes ut som et rimelig filter. I Kjelsås
    har 0 av 17 lekeplasser en `playground:*`-tagg. Filteret ville tømt
    kategorien.
  · En avstandsterskel på 150 m slo sammen to ULIKE gater allerede i det ene
    borettslaget.

Et filter valgt på ett nabolag er en gjetning med tall på. Dette skriptet gir
de samme tallene over 11 901 lekeplasser og 15 423 ballbaner, så terskelen
kan velges på en kurve.

─────────────────────────────────────────────────────────────────────────
HVORFOR PYTHON I ET TS-REPO

Inndata er et flerhundre-megabyte uttrekk på maskinen som har osmium, ikke i
CI og ikke i appen. `python3` finnes der; `npx tsx` + node_modules er en
tyngre forutsetning for et engangsverktøy som aldri kjøres i produksjon.
Skriptet importeres ikke av noe, og har ingen avhengigheter å vedlikeholde.

─────────────────────────────────────────────────────────────────────────
HELE KJEDEN

  osmium tags-filter norge.osm.pbf \
    nwr/leisure=pitch nwr/leisure=playground \
    -o pp.osm.pbf --overwrite

  osmium export pp.osm.pbf -f geojsonseq \
    --add-unique-id=type_id --index-type=sparse_file_array \
    -o pp.geojsonseq --overwrite

  python3 scripts/osm-kvalitet.py pp.geojsonseq

`--add-unique-id=type_id` gir «@id»: «w123», som skriptet bruker til å skille
node fra flate. Uten den blir typefordelingen «?».

KRYSSJEKK, hvis tallene ser rare ut — da vet du om det er `osmium export` som
har mistet noe før du bruker dem til noe:

  osmium tags-filter norge.osm.pbf nwr/leisure=pitch -o p.pbf --overwrite
  osmium fileinfo -e p.pbf | grep -E "Number of .*: [0-9]"
  osmium tags-filter p.pbf nwr/sport -o p-sport.pbf --overwrite
  osmium fileinfo -e p-sport.pbf | grep -E "Number of .*: [0-9]"

─────────────────────────────────────────────────────────────────────────
SVARER PÅ

  1. leisure=pitch: hvor mange har sport-tagg, hvor mange ikke? Og for dem
     MED sport — hvordan fordeler `surface` seg? (Det er det filteret som
     faktisk er aktuelt.)
  2. leisure=playground: hvor mange har minst én utstyrstagg
     (playground=*, playground:*)?
  3. Hvor mange objekter i hver kategori ligger innenfor N meter av et annet
     objekt i SAMME kategori? Fem terskler, så valget tas på en kurve.

Pluss typefordeling node/way/relasjon: i Kjelsås er 7 av 17 lekeplasser noder
og 10 er flater, og ett node/way-par ligger 4 m fra hverandre. Samme sted
kartlagt to ganger, av to bidragsytere, er sin egen duplikatklasse.

SENTERPUNKTET ER BBOKS-SENTERET, ikke tyngdepunktet. Det er med vilje:
importen bruker `out center` i Overpass, som gir nøyaktig bboks-senteret
(se overpassQuery i scripts/import-places.ts). Tallene herfra er dermed
direkte sammenlignbare med lat/lng i activities-tabellen.

VERIFISERT MOT EKTE DATA: kjørt mot de 34 radene innenfor 700 m av
59.9556, 10.7684, og reproduserte klyngetallene som var regnet ut uavhengig
(17 lekeplasser → 5 med nabo ved 50 m, én klynge à 5 ved 75 m).
"""
import json
import math
import sys
from collections import Counter, defaultdict

CELL_M = 30.0           # rutenettets basiscelle; terskler over denne får flere naboruter
M_PER_DEG_LAT = 111_320.0
TERSKLER = [20, 30, 50, 75, 100]


def bbox_center(geom):
    """Bboks-senteret, som Overpass' `out center`. None for tom geometri."""
    lats, lons = [], []

    def walk(c):
        if not c:
            return
        if isinstance(c[0], (int, float)):
            lons.append(c[0])
            lats.append(c[1])
        else:
            for d in c:
                walk(d)

    if geom is None:
        return None
    if geom.get("type") == "GeometryCollection":
        for g in geom.get("geometries", []):
            c = bbox_center(g)
            if c:
                lats.append(c[0])
                lons.append(c[1])
    else:
        walk(geom.get("coordinates"))
    if not lats:
        return None
    return ((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2)


def meters(a, b):
    """Haversine. Samme formel som appen (geo.dart), R = 6 371 000 m."""
    lat1, lon1 = a
    lat2, lon2 = b
    p = math.pi / 180
    dlat = (lat2 - lat1) * p
    dlon = (lon2 - lon1) * p
    h = (math.sin(dlat / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin(dlon / 2) ** 2)
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(h)))


def cell(pt, size_m):
    """Rutenettcelle. Lengdegraden projiseres med punktets EGEN breddegrad,
    så cellene holder ~samme meterbredde fra Lindesnes til Vardø."""
    lat, lon = pt
    y = int(math.floor(lat * M_PER_DEG_LAT / size_m))
    x = int(math.floor(lon * M_PER_DEG_LAT * math.cos(lat * math.pi / 180) / size_m))
    return (y, x)


def naboer_innen(punkter, terskel):
    """(antall objekter med minst én nabo, klyngestørrelser) ved enkeltlenke."""
    size = max(terskel, CELL_M)
    rutenett = defaultdict(list)
    for i, pt in enumerate(punkter):
        rutenett[cell(pt, size)].append(i)

    forelder = list(range(len(punkter)))

    def finn(x):
        while forelder[x] != x:
            forelder[x] = forelder[forelder[x]]
            x = forelder[x]
        return x

    par = 0
    for (y, x), idxs in rutenett.items():
        kandidater = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                kandidater.extend(rutenett.get((y + dy, x + dx), ()))
        for i in idxs:
            for j in kandidater:
                if j <= i:
                    continue
                if meters(punkter[i], punkter[j]) <= terskel:
                    par += 1
                    a, b = finn(i), finn(j)
                    if a != b:
                        forelder[a] = b

    grupper = Counter(finn(i) for i in range(len(punkter)))
    storrelser = Counter(v for v in grupper.values() if v > 1)
    med_nabo = sum(k * n for k, n in storrelser.items())
    return med_nabo, storrelser, par


def main(stier):
    per_kat = defaultdict(list)          # leisure -> [(lat, lon)]
    tagger = defaultdict(Counter)        # leisure -> Counter over egenskaper
    surface_med_sport = Counter()
    typefordeling = defaultdict(Counter)  # leisure -> Counter over n/w/r
    linjer = feilet = 0

    for sti in stier:
        with open(sti, encoding="utf-8") as f:
            for linje in f:
                linje = linje.strip().lstrip("\x1e")  # RS-prefiks i RFC 8142
                if not linje:
                    continue
                linjer += 1
                try:
                    o = json.loads(linje)
                except json.JSONDecodeError:
                    feilet += 1
                    continue
                p = o.get("properties") or {}
                leisure = p.get("leisure")
                if leisure not in ("pitch", "playground"):
                    continue
                c = bbox_center(o.get("geometry"))
                if c is None:
                    tagger[leisure]["UTEN GEOMETRI"] += 1
                    continue
                per_kat[leisure].append(c)

                oid = str(p.get("@id") or o.get("id") or "")
                typefordeling[leisure][oid[:1] if oid[:1] in "nwr" else "?"] += 1

                t = tagger[leisure]
                t["totalt"] += 1
                if p.get("sport"):
                    t["har sport"] += 1
                    surface_med_sport[p.get("surface") or "(mangler)"] += 1
                if p.get("name"):
                    t["har name"] += 1
                if p.get("access"):
                    t[f"access={p['access']}"] += 1
                if p.get("surface"):
                    t["har surface"] += 1
                if any(k == "playground" or k.startswith("playground:") for k in p):
                    t["har utstyrstagg"] += 1
                if p.get("description"):
                    t["har description"] += 1

    print(f"LEST {linjer} linjer" + (f", {feilet} kunne ikke parses" if feilet else ""))

    for kat in ("pitch", "playground"):
        rader = per_kat.get(kat, [])
        t = tagger[kat]
        n = t["totalt"]
        if not n:
            print(f"\n=== leisure={kat}: ingen objekter ===")
            continue
        print(f"\n{'='*66}\n=== leisure={kat}: {n} objekter ===")
        print("  typer: " + "  ".join(f"{k}={v}" for k, v in sorted(typefordeling[kat].items())))

        def andel(navn, antall):
            print(f"  {navn:<24} {antall:>6}  ({antall / n * 100:5.1f} %)")

        if kat == "pitch":
            # SPØRSMÅL 1
            andel("har sport", t["har sport"])
            andel("UTEN sport", n - t["har sport"])
        else:
            # SPØRSMÅL 2
            andel("har utstyrstagg", t["har utstyrstagg"])
            andel("UTEN utstyrstagg", n - t["har utstyrstagg"])
        andel("har name", t["har name"])
        andel("har surface", t["har surface"])
        for k in sorted(k for k in t if k.startswith("access=")):
            andel(f"  {k}", t[k])
        if t["UTEN GEOMETRI"]:
            print(f"  uten geometri (hoppet over): {t['UTEN GEOMETRI']}")

        # SPØRSMÅL 3
        print(f"\n  NABOER I SAMME KATEGORI (bboks-senter mot bboks-senter)")
        print(f"  {'terskel':>8}  {'m/nabo':>7}  {'andel':>6}  klyngestørrelser")
        for terskel in TERSKLER:
            med, storrelser, _ = naboer_innen(rader, terskel)
            fordeling = ",  ".join(
                f"{v} klynge{'r' if v > 1 else ''} à {k}"
                for k, v in sorted(storrelser.items())) or "ingen"
            print(f"  {terskel:>6} m  {med:>7}  {med / n * 100:5.1f} %  {fordeling}")

    if surface_med_sport:
        print(f"\n{'='*66}\n=== surface PÅ pitch MED sport (filteret som vurderes) ===")
        sum_s = sum(surface_med_sport.values())
        for k, v in surface_med_sport.most_common():
            print(f"  {k:<22} {v:>6}  ({v / sum_s * 100:5.1f} %)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    try:
        main(sys.argv[1:])
    except BrokenPipeError:
        # `| head` lukker røret. Python skriver ellers en traceback som ser ut
        # som en feil i målingen, og det er den siste utskriften man vil at en
        # måling skal ende på.
        try:
            sys.stdout.close()
        finally:
            sys.exit(0)
