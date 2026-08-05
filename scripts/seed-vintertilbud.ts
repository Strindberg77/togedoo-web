// scripts/seed-vintertilbud.ts
//
// Kuratert seed for «nærliggende utflukter»: kommersielle/innendørs vinter- og
// fritidstilbud som ofte ligger UTENFOR de fire kommunegrensene, men hører til
// byens nærområde. OSM-dekningen er lav og sprikende (trampolineparker,
// innendørs skianlegg, badeland tagges inkonsistent), så de vedlikeholdes
// manuelt her — samme mønster som seed-dyremote.ts.
//
//   npx tsx scripts/seed-vintertilbud.ts --dry-run     (geokod + rapport, ingen skriving)
//   npx tsx scripts/seed-vintertilbud.ts               (geokod + upsert)
//   npx tsx scripts/seed-vintertilbud.ts --no-geocode  (bruk kun estimerte fallbacks)
//
// Krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (unntatt --dry-run), OG at
// migrasjon 0012 (near_city-kolonnen) er kjørt mot databasen.
//
// nearCity knytter et utenbys-sted til en «hjemby» (f.eks. Varingskollen i
// Nittedal → nearCity 'Oslo'). municipality beholder den EKTE kommunen for
// adresse/attribusjon. By-modus i /api/activities matcher (municipality OR
// near_city). Steder som ligger i selve byen (f.eks. Korketrekkeren i Oslo)
// setter kun municipality og lar nearCity være undefined.
//
// KOORDINATER: web-verifiserte adresser geokodes mot Kartverket ved kjøring
// (samme /sok-API som seed-dyremote). Entydig treff → published. Tvetydig/
// ingen treff → estimert fallback beholdes, status='pending' (API-et serverer
// bare 'published'), med advarsel i rapporten. manualCoord hopper over
// geokoding (for steder uten gateadresse, som en akebakke).
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';

// PROVISORISK kategori — bekreftes i steg 4 (egen «Vinter & innendørs»-chip vs.
// fordeling på eksisterende). Endres ETT sted her hvis navnet justeres.
const CATEGORY = 'Vinter & innendørs';

const SOURCE = {
    slug: 'kuratert-vintertilbud',
    name: 'Kuratert: Vinter & innendørs',
    kind: 'manual' as const,
};

const KARTVERKET_UA = 'Togedoo datahub (hello@togedoo.com)';

interface VinterSeed {
    externalId: string; // stabil upsert-nøkkel
    title: string;
    description: string; // kort, kuratert
    municipality: string; // EKTE kommune (adresse/attribusjon)
    nearCity?: string; // «hjemby» når stedet ligger utenfor kommunegrensen
    address: string; // web-verifisert, geokodes mot Kartverket
    addressAlternatives?: string[];
    manualCoord?: { lat: number; lng: number }; // hopp over geokoding (f.eks. akebakke)
    coordVerified?: boolean; // false = manualCoord er OMTRENTLIG, kan finjusteres (default true)
    fallbackLat: number; // estimert — brukes hvis geokoding feiler/tvetydig
    fallbackLng: number;
    isFree: boolean | null; // true=gratis, false=betalt, null=ukjent
    priceText?: string | null;
    url: string;
    targetAudience?: string; // default 'For alle'
    openingHours?: string | null;
}

const SEED: VinterSeed[] = [
    // --- Oslo-regionen: utenfor kommunegrensen (nearCity = Oslo) ---
    {
        externalId: 'sno-lorenskog',
        title: 'SNØ Lørenskog',
        description: 'Innendørs skianlegg — alpint, langrenn, snowboard og akebakke under tak hele året, ca. 17 min fra Oslo.',
        municipality: 'Lørenskog', nearCity: 'Oslo',
        address: 'Snøfonna 5, 1470 Lørenskog',
        fallbackLat: 59.9268, fallbackLng: 10.9583,
        isFree: false, url: 'https://snooslo.no',
    },
    {
        externalId: 'jumpyard-sno-lorenskog',
        title: 'JumpYard SNØ (trampolinepark)',
        description: 'Stor innendørs trampolinepark i SNØ-anlegget på Lørenskog — hoppegroper, hinderløyper og aktiviteter for alle aldre.',
        municipality: 'Lørenskog', nearCity: 'Oslo',
        address: 'Snøfonna 5, 1470 Lørenskog',
        fallbackLat: 59.9268, fallbackLng: 10.9583,
        isFree: false, url: 'https://jumpyard.no/sno/',
    },
    {
        externalId: 'varingskollen-alpinsenter',
        title: 'Varingskollen Alpinsenter',
        description: 'Lokalt alpinsenter i Hakadal med bakker for alle nivåer og eget barneområde — 50 m fra Varingskollen stasjon.',
        municipality: 'Nittedal', nearCity: 'Oslo',
        address: 'Vargveien 21, 1488 Hakadal',
        fallbackLat: 60.1085, fallbackLng: 10.8330,
        isFree: false, url: 'https://www.varingskollen.no',
    },
    {
        externalId: 'kirkerudbakken-skisenter',
        title: 'Kirkerudbakken Skisenter',
        description: 'Asker og Bærums største alpinanlegg, ved Vøyenenga — varierte bakker, gratis barneheis og barnebakke.',
        municipality: 'Bærum', nearCity: 'Oslo',
        address: 'Borkenveien 2, 1339 Vøyenenga',
        fallbackLat: 59.9330, fallbackLng: 10.4680,
        isFree: false, url: 'https://www.skimore.no/kirkerudbakken',
    },
    {
        externalId: 'risenga-svommehall',
        title: 'Risenga svømmehall (badeland)',
        description: 'Badeland i Asker sentrum med sklier, bølgebasseng, barnebasseng, varmtvannsbasseng, stupetårn og klatrevegg.',
        municipality: 'Asker', nearCity: 'Oslo',
        address: 'Brages vei 8, 1387 Asker',
        addressAlternatives: ['Bragesvei 8, 1387 Asker'],
        fallbackLat: 59.8360, fallbackLng: 10.4350,
        isFree: false, url: 'https://svom.no/svommehall/risenga-svommehall',
    },
    {
        externalId: 'bolgen-bad-drobak',
        title: 'Bølgen bad & aktivitetssenter',
        description: 'Badeanlegg på Seiersten i Drøbak med sklier og basseng — ca. 40 min fra Oslo.',
        municipality: 'Frogn', nearCity: 'Oslo',
        address: 'Belsjøveien 2, 1443 Drøbak',
        fallbackLat: 59.6620, fallbackLng: 10.6300,
        isFree: false, url: 'https://www.bolgenbad.no',
    },
    {
        externalId: 'jessheimbadet',
        title: 'Jessheimbadet',
        description: 'Moderne badeanlegg i Jessheim med seks basseng, 41 m vannsklie og i ferier Norges største innendørs hinderløype i vann.',
        municipality: 'Ullensaker', nearCity: 'Oslo',
        address: 'Kanalvegen 100, 2069 Jessheim',
        fallbackLat: 60.1470, fallbackLng: 11.1770,
        isFree: false, url: 'https://www.jessheimbadet.no',
    },
    {
        externalId: 'leos-lekeland-baerum-grini',
        title: 'Leos Lekeland Bærum (Grini)',
        description: 'Stort innendørs lekeland i Grini Næringspark — klatring, sklier og hoppeslott for barn.',
        municipality: 'Bærum', nearCity: 'Oslo',
        address: 'Grini Næringspark 8, 1361 Østerås',
        fallbackLat: 59.9430, fallbackLng: 10.6050,
        isFree: false, url: 'https://www.leoslekeland.no/vare-lekeland/oslo/baerum',
        targetAudience: 'Barn',
    },
    // --- Inne i Oslo kommune (kun municipality, ingen nearCity) ---
    {
        externalId: 'leos-lekeland-oslo',
        title: 'Leos Lekeland Oslo',
        description: 'Innendørs lekeland med klatring, sklier og aktiviteter for barn.',
        municipality: 'Oslo',
        address: 'John G. Mattesons vei 4, 0687 Oslo',
        fallbackLat: 59.9070, fallbackLng: 10.8250,
        isFree: false, url: 'https://www.leoslekeland.no/vare-lekeland/oslo',
        targetAudience: 'Barn',
    },
    {
        externalId: 'korketrekkeren-aking',
        title: 'Korketrekkeren (akebakke)',
        description: 'Oslos mest kjente akebakke — ca. 2 km fra Frognerseteren til Midtstuen. Gratis å ake; kjelke kan leies. Åpen når det er nok snø.',
        municipality: 'Oslo',
        // Akebakke uten gateadresse — manuelt verifisert startpunkt ved
        // Frognerseteren (Kartverket ville ikke gitt entydig gateadresse).
        address: 'Frognerseteren, 0791 Oslo',
        manualCoord: { lat: 59.9836, lng: 10.6790 },
        fallbackLat: 59.9836, fallbackLng: 10.6790,
        isFree: true, url: 'https://akeforeningen.no', targetAudience: 'For alle',
    },

    // ================= BERGEN =================
    {
        externalId: 'ado-arena-bergen',
        title: 'AdO arena',
        description: 'Badeanlegg i Bergen sentrum med sklier (26 m og 68 m), stupetårn og barnebasseng.',
        municipality: 'Bergen',
        address: 'Lungegårdskaien 40, 5015 Bergen',
        fallbackLat: 60.3830, fallbackLng: 5.3390,
        isFree: false, priceText: 'Barn 50 kr', url: 'https://adoarena.no',
    },
    {
        externalId: 'vannkanten-badeland-loddefjord',
        title: 'Vannkanten Badeland',
        description: 'Bergens største badeland i Vestkanten Storsenter, Loddefjord — Norges lengste innendørs sklie (120 m).',
        municipality: 'Bergen',
        // Primær fra Brønnøysundregistrene/180.no; Apple Maps-adressen som
        // fallback (samme mønster som EKT/Risenga).
        address: 'Loddefjordveien 2, 5171 Loddefjord',
        addressAlternatives: ['Lyderhornsveien 351, 5171 Loddefjord'],
        fallbackLat: 60.3648, fallbackLng: 5.2345,
        isFree: false, url: 'https://svom.no/bad/bergen/vannkanten-badeland',
    },
    {
        externalId: 'rush-trampolinepark-bergen',
        title: 'Rush Trampolinepark Bergen',
        description: 'Stor innendørs trampolinepark på Kokstad — hoppegroper, hinderløyper og aktiviteter for alle aldre.',
        municipality: 'Bergen',
        // Offisielle kilder (Brønnøysund/1881/Rush) bruker «-vegen»; behold
        // «-veien»-skrivemåten som fallback.
        address: 'Kokstadvegen 23, 5257 Kokstad',
        addressAlternatives: ['Kokstadveien 23, 5257 Kokstad'],
        fallbackLat: 60.2900, fallbackLng: 5.2580,
        isFree: false, url: 'https://www.rushtrampolinepark.no/bergen',
    },
    {
        externalId: 'leos-lekeland-bergen',
        title: 'Leos Lekeland Bergen',
        description: 'Innendørs lekeland på Kokstad — klatring, sklier, ballhav og hoppeslott for barn.',
        municipality: 'Bergen',
        address: 'Kokstaddalen 18, 5257 Kokstad',
        fallbackLat: 60.2890, fallbackLng: 5.2560,
        isFree: false, url: 'https://www.leoslekeland.no/', targetAudience: 'Barn',
    },
    {
        externalId: 'eikedalen-skisenter',
        title: 'Eikedalen Skisenter',
        description: 'Familievennlig alpinanlegg ved Kvamskogen (8 heiser, 12 løyper), ca. 1 t fra Bergen.',
        municipality: 'Samnanger', nearCity: 'Bergen',
        address: 'Kråvegen 108, 5650 Tysse',
        fallbackLat: 60.4000, fallbackLng: 5.9600,
        isFree: false, url: 'https://www.eikedalen.no/',
    },

    // ================= TRONDHEIM =================
    {
        externalId: 'pirbadet-trondheim',
        title: 'Pirbadet',
        description: 'Trondheims store innendørs badeland på Brattøra — basseng, sklier, boblebad og barneområde.',
        municipality: 'Trondheim',
        address: 'Havnegata 12, 7010 Trondheim',
        fallbackLat: 63.4370, fallbackLng: 10.3980,
        isFree: false, url: 'https://pirbadet.no',
    },
    {
        externalId: 'rush-trampolinepark-trondheim',
        title: 'Rush Trampolinepark Trondheim',
        description: 'Innendørs aktivitetspark på Tiller — trampoliner, airbag, skumgroper og hinderløyper.',
        municipality: 'Trondheim',
        address: 'Østre Rosten 20, 7075 Tiller',
        fallbackLat: 63.3580, fallbackLng: 10.3770,
        isFree: false, url: 'https://www.rushtrampolinepark.no/trondheim',
    },
    {
        externalId: 'leos-lekeland-trondheim',
        title: 'Leos Lekeland Trondheim',
        description: 'Innendørs lekeland på Lade — klatrestativ, ballhav, tunneler, trampoliner og sklier.',
        municipality: 'Trondheim',
        // Kilder oppgir både Ladebekken 6 og 3 — bruker 6, med 3 som fallback.
        address: 'Ladebekken 6, 7041 Trondheim',
        addressAlternatives: ['Ladebekken 3, 7041 Trondheim'],
        fallbackLat: 63.4420, fallbackLng: 10.4300,
        isFree: false, url: 'https://www.leoslekeland.no/', targetAudience: 'Barn',
    },
    {
        externalId: 'vassfjellet-skisenter',
        title: 'Vassfjellet Skisenter',
        description: 'Familievennlig alpinanlegg (12 løyper, barneheis, skiskole) ca. 40 min sør for Trondheim.',
        municipality: 'Melhus', nearCity: 'Trondheim',
        // Ingen gateadresse finnes for anlegget. manualCoord er OMTRENTLIG
        // (~1–2 km — godt nok for et alpinsenter med stort areal).
        // coordVerified:false markerer at koordinaten kan finjusteres senere.
        address: 'Vassfjellet, 7224 Melhus',
        manualCoord: { lat: 63.2930, lng: 10.3690 },
        coordVerified: false,
        fallbackLat: 63.2930, fallbackLng: 10.3690,
        isFree: false, url: 'https://vassfjellet.no/',
    },

    // ================= STAVANGER =================
    {
        externalId: 'stavanger-svommehall',
        title: 'Stavanger svømmehall',
        description: 'Svømmehall i Stavanger sentrum med 25 m-basseng, barnebasseng og plaskebasseng.',
        municipality: 'Stavanger',
        address: 'Lars Hertervigs gate 4, 4005 Stavanger',
        fallbackLat: 58.9680, fallbackLng: 5.7350,
        isFree: false, url: 'https://www.stavanger.kommune.no/kultur-og-fritid/svommehaller/stavanger-svommehall2/',
    },
    {
        // KORRIGERT: Lagerveien 2 er 4033 Stavanger (Forus/Stavanger-siden) →
        // ligger I Stavanger kommune, så INGEN near_city (ville gitt feil
        // «· nær Stavanger»-merke).
        externalId: 'playground-forus',
        title: 'Playground',
        description: 'Norges/regionens største innendørs aktivitetspark (3 500 m²) på Forus — klatring, trampoliner, nettpark, skate.',
        municipality: 'Stavanger',
        address: 'Lagerveien 2, 4033 Stavanger',
        fallbackLat: 58.9130, fallbackLng: 5.7170,
        isFree: false, url: 'https://playground.no/',
    },
    {
        // KORRIGERT: Lagerveien 13 er 4033 Stavanger → I Stavanger kommune,
        // ingen near_city.
        externalId: 'rush-trampolinepark-stavanger',
        title: 'Rush Trampolinepark Stavanger',
        description: 'Stor innendørs trampolinepark på Forus — trampoliner, airbag, hinderløyper.',
        municipality: 'Stavanger',
        address: 'Lagerveien 13, 4033 Stavanger',
        fallbackLat: 58.9120, fallbackLng: 5.7160,
        isFree: false, url: 'https://www.rushtrampolinepark.no/',
    },
    {
        externalId: 'austratt-svommehall-sandnes',
        title: 'Austrått svømmehall',
        description: 'Svømmehall i Sandnes med basseng for hele familien.',
        municipality: 'Sandnes', nearCity: 'Stavanger',
        address: 'Kjervastadveien 2, 4325 Sandnes',
        fallbackLat: 58.8420, fallbackLng: 5.7450,
        isFree: false, priceText: 'Barn under 10 gratis',
        url: 'https://www.sandnes.kommune.no/sti/idrett-park-og-friluftsliv/svommehaller/austratt-svommehall/',
    },
    {
        // KORRIGERT: Sørmarkveien 20 er 4019 Stavanger → I Stavanger kommune,
        // ingen near_city.
        externalId: 'sormarka-arena-stavanger',
        title: 'Sørmarka Arena',
        description: 'Innendørs skøytehall og flerbrukshall med 17 m klatrevegg, ved Sørmarka.',
        municipality: 'Stavanger',
        address: 'Sørmarkveien 20, 4019 Stavanger',
        fallbackLat: 58.9260, fallbackLng: 5.7420,
        isFree: false, url: 'https://www.sormarka-arena.no/',
    },
];

interface GeoResult {
    lat?: number;
    lng?: number;
    total: number;
    verified: boolean;
    note: string;
}

// Forover-geokoding mot Kartverket (samme API/UA/retry-filosofi som
// seed-dyremote; /sok, fuzzy=false for presisjon).
async function geocode(address: string): Promise<GeoResult> {
    const params = new URLSearchParams({ sok: address, fuzzy: 'false', treffPerSide: '5' });
    const url = `https://ws.geonorge.no/adresser/v1/sok?${params}`;
    const TIMEOUT_MS = Number(process.env.KARTVERKET_TIMEOUT_MS ?? 8000);
    const BACKOFFS_MS = [2000, 4000];

    let res: Response | null = null;
    let transient = '';
    for (let attempt = 0; ; attempt++) {
        try {
            res = await fetch(url, { headers: { 'User-Agent': KARTVERKET_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (err) {
            res = null;
            transient =
                err instanceof Error && err.name === 'TimeoutError'
                    ? `timeout etter ${TIMEOUT_MS / 1000} s`
                    : `nettverksfeil: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (res) {
            if (res.ok) break;
            if (![429, 500, 502, 503].includes(res.status)) {
                return { total: 0, verified: false, note: `geokoding feilet: HTTP ${res.status}` };
            }
            transient = `HTTP ${res.status}`;
        }
        if (attempt >= BACKOFFS_MS.length) {
            return { total: 0, verified: false, note: `geokoding utilgjengelig: ${transient}` };
        }
        await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt]));
    }

    const data = await res!.json();
    const total: number = data?.metadata?.totaltAntallTreff ?? (data?.adresser?.length ?? 0);
    const hit = data?.adresser?.[0];
    const p = hit?.representasjonspunkt;
    if (!hit || typeof p?.lat !== 'number' || typeof p?.lon !== 'number') {
        return { total, verified: false, note: total > 1 ? `tvetydig (${total} treff)` : 'ingen treff' };
    }
    if (total === 1) {
        return { lat: p.lat, lng: p.lon, total, verified: true, note: `entydig: ${hit.adressetekst}` };
    }
    return { lat: p.lat, lng: p.lon, total, verified: false, note: `tvetydig (${total} treff), topp: ${hit.adressetekst}` };
}

function toRow(seed: VinterSeed, sourceId: string, lat: number, lng: number, verified: boolean) {
    return {
        source_id: sourceId,
        external_id: seed.externalId,
        kind: 'place',
        title: seed.title,
        description: seed.description,
        category: CATEGORY,
        target_audience: seed.targetAudience ?? 'For alle',
        address: seed.address,
        municipality: seed.municipality,
        near_city: seed.nearCity ?? null,
        lat,
        lng,
        is_free: seed.isFree,
        price_text: seed.priceText ?? null,
        url: seed.url,
        opening_hours: seed.openingHours ?? null,
        status: verified ? 'published' : 'pending',
    };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const noGeocode = process.argv.includes('--no-geocode');

    const resolved: { seed: VinterSeed; lat: number; lng: number; verified: boolean; note: string }[] = [];
    const warnings: string[] = [];
    for (const seed of SEED) {
        let lat = seed.fallbackLat;
        let lng = seed.fallbackLng;
        let verified = false;
        let note = 'estimert (--no-geocode)';
        let usedAddress = seed.address;
        if (seed.manualCoord) {
            lat = seed.manualCoord.lat;
            lng = seed.manualCoord.lng;
            // Publiseres uansett (koordinat finnes), men coordVerified:false
            // markerer at den er omtrentlig og kan finjusteres senere.
            verified = true;
            if (seed.coordVerified === false) {
                note = 'manualCoord OMTRENTLIG (coordVerified:false — finjuster senere)';
                warnings.push(`  ⚠ ${seed.title} — omtrentlig koordinat (coordVerified:false), finjuster senere`);
            } else {
                note = 'manuelt verifisert';
            }
        } else if (!noGeocode) {
            const candidates = [seed.address, ...(seed.addressAlternatives ?? [])];
            let best: { geo: GeoResult; addr: string } | null = null;
            for (const addr of candidates) {
                const geo = await geocode(addr);
                await new Promise((r) => setTimeout(r, 300));
                if (
                    !best ||
                    (geo.verified && !best.geo.verified) ||
                    (typeof geo.lat === 'number' && best.geo.lat == null)
                ) {
                    best = { geo, addr };
                }
                if (geo.verified) break;
            }
            const geo = best!.geo;
            usedAddress = best!.addr;
            note = candidates.length > 1 ? `${geo.note} [${usedAddress}]` : geo.note;
            if (typeof geo.lat === 'number' && typeof geo.lng === 'number') {
                lat = geo.lat;
                lng = geo.lng;
            }
            verified = geo.verified;
            if (!verified) warnings.push(`  ⚠ ${seed.title} — ${usedAddress}: ${note}`);
        }
        resolved.push({ seed, lat, lng, verified, note });
    }

    const verifiedCount = resolved.filter((r) => r.verified).length;
    console.log(`Vinter & innendørs-seed [kategori="${CATEGORY}"]: ${SEED.length} steder — ${verifiedCount} entydig geokodet (published), ${SEED.length - verifiedCount} pending.\n`);
    for (const r of resolved) {
        const homeCity = r.seed.nearCity ? `→${r.seed.nearCity}` : '   ';
        console.log(
            `  [${r.verified ? 'PUBLISHED' : 'pending  '}] ${r.seed.municipality.padEnd(11)}${homeCity} ` +
                `${r.seed.title.padEnd(36)} ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}  (${r.note})`
        );
    }
    if (warnings.length) {
        console.log(`\nTrenger bekreftelse (${warnings.length}):`);
        warnings.forEach((w) => console.log(w));
    }

    if (dryRun) {
        console.log('\n[dry-run] Ingen skriving.');
        return;
    }
    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');

    const db = supabaseAdmin();

    const { data: source, error: sourceError } = await db
        .from('sources')
        .upsert({ slug: SOURCE.slug, name: SOURCE.name, kind: SOURCE.kind, active: true }, { onConflict: 'slug' })
        .select('id')
        .single();
    if (sourceError || !source) throw new Error(`Kunne ikke sikre kilden: ${sourceError?.message}`);

    const { data: lockedRows, error: lockedError } = await db
        .from('activities')
        .select('external_id')
        .eq('source_id', source.id)
        .eq('locked', true);
    if (lockedError) throw new Error(`Oppslag av låste rader feilet: ${lockedError.message}`);
    const locked = new Set((lockedRows ?? []).map((r) => r.external_id));

    const rows = resolved
        .filter((r) => !locked.has(r.seed.externalId))
        .map((r) => toRow(r.seed, source.id, r.lat, r.lng, r.verified));
    if (locked.size) console.log(`\nHopper over ${resolved.length - rows.length} låste rader.`);

    const { error } = await db.from('activities').upsert(rows, { onConflict: 'source_id,external_id' });
    if (error) throw new Error(`Upsert feilet: ${error.message}`);

    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${rows.length} vinter/innendørs-steder (${verifiedCount} geokodet)` })
        .eq('id', source.id);

    console.log(`\nFerdig: upsertet ${rows.length} steder i kategorien "${CATEGORY}".`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
