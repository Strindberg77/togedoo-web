// scripts/seed-dyremote.ts
//
// Kuratert seed for «Dyremøte»-kategorien: dyre-/gårdsbesøksmål i de fire
// dekkede byene (Oslo, Bergen, Trondheim, Stavanger). Ren OSM-tag-henting
// (tourism=zoo/aquarium) underrapporterer kraftig — de fleste av disse er
// besøksgårder uten dyretagg, eller tagget sprikende — så de vedlikeholdes
// manuelt her som en egen kilde ved siden av 'osm-steder'.
//
//   npx tsx scripts/seed-dyremote.ts --dry-run   (rapport, ingen skriving)
//   npx tsx scripts/seed-dyremote.ts             (upsert)
//
// Krever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (unntatt --dry-run).
//
// KOORDINATER: adressene er web-verifiserte. lat/lng er verifisert KUN der
// coordVerified=true; ellers er de estimert fra adressen, og raden seedes som
// status='pending' (API-et serverer bare 'published'), slik at den ikke går
// live før koordinaten er bekreftet. Bekreft/korriger lat/lng + sett
// coordVerified=true → status blir 'published' ved neste kjøring.
//
// Denne fila er sannhetskilden for kategorien: rediger her og kjør på nytt.
// Rader med locked=true (brukerrapport «finnes ikke») røres aldri, som i
// OSM-importen.
import { supabaseAdmin, isDatahubConfigured } from '../lib/supabase';

const SOURCE = {
    slug: 'kuratert-dyremote',
    name: 'Kuratert: Dyremøte',
    kind: 'manual' as const,
};

interface DyremoteSeed {
    externalId: string; // stabil upsert-nøkkel
    title: string;
    description: string; // kort, kuratert
    municipality: 'Oslo' | 'Bergen' | 'Trondheim' | 'Stavanger';
    address: string; // web-verifisert
    lat: number;
    lng: number;
    coordVerified: boolean; // true → publiseres; false → pending til bekreftet
    isFree: boolean | null; // true=gratis, false=betalt, null=ukjent
    priceText?: string | null;
    url: string;
    targetAudience?: string; // default 'Barn'
    openingHours?: string | null;
}

// coordVerified: kun Akvariet i Bergen har en web-verifisert koordinat.
// De øvrige er estimert fra verifisert adresse og MÅ bekreftes før publisering.
const SEED: DyremoteSeed[] = [
    // --- Oslo ---
    {
        externalId: 'kampen-barnebondegard',
        title: 'Kampen økologiske barnebondegård',
        description: 'Bybondegård med hest, esel, minigris, sau, geit og høner — for barnefamilier.',
        municipality: 'Oslo',
        address: 'Skedsmogata 23, 0655 Oslo',
        lat: 59.9137, lng: 10.7828, coordVerified: false,
        isFree: true, url: 'https://kampenbarnebondegard.com',
    },
    {
        externalId: 'nordre-lindeberg-gard',
        title: 'Nordre Lindeberg gård',
        description: 'Oslo kommunes besøksgård i Groruddalen, med dyr og aktiviteter, åpen for alle.',
        municipality: 'Oslo',
        address: 'Sam Eydes vei 9, 1084 Oslo',
        lat: 59.9490, lng: 10.8760, coordVerified: false,
        isFree: true, url: 'https://www.nordrelindeberggard.com',
    },
    {
        externalId: 'ekt-rideskole-husdyrpark',
        title: 'EKT Rideskole og Husdyrpark',
        description: 'Rideskole og husdyrpark på Ekebergsletta med dyr å hilse på.',
        municipality: 'Oslo',
        address: 'Ekebergveien 99, 1181 Oslo',
        lat: 59.8830, lng: 10.7830, coordVerified: false,
        isFree: null, url: 'https://www.rideskole.no',
    },
    {
        externalId: 'oslo-reptilpark',
        title: 'Oslo Reptilpark',
        description: 'Innendørs dyrepark med slanger, øgler, skilpadder og andre reptiler — midt i sentrum.',
        municipality: 'Oslo',
        address: 'St. Olavs gate 2, 0165 Oslo',
        lat: 59.9167, lng: 10.7383, coordVerified: false,
        isFree: false, url: 'https://www.reptilpark.no',
        targetAudience: 'For alle',
    },
    // --- Bergen ---
    {
        externalId: 'akvariet-bergen',
        title: 'Akvariet i Bergen',
        description: 'Et av Nordens eldste akvarier, på Nordnes — fisk, pingviner, krypdyr og sjøpattedyr.',
        municipality: 'Bergen',
        address: 'Nordnesbakken 4, 5005 Bergen',
        lat: 60.399655, lng: 5.303323, coordVerified: true,
        isFree: false, url: 'https://akvariet.no',
        targetAudience: 'For alle',
    },
    {
        externalId: 'ovre-eide-gard',
        title: 'Øvre-Eide gård',
        description: 'Besøksgård ved Jordalsvannet i Åsane med gårdsbesøk, dyr og åpne gårdsdager.',
        municipality: 'Bergen',
        address: 'Eidsvåg, Åsane, Bergen',
        lat: 60.4790, lng: 5.3490, coordVerified: false,
        isFree: null, url: 'https://www.ovre-eide.no',
        targetAudience: 'For alle',
    },
    {
        externalId: 'bergen-strutsefarm',
        title: 'Bergen Strutsefarm',
        description: 'Strutsefarm i Fyllingsdalen med omvisning og dyr.',
        municipality: 'Bergen',
        address: 'Rosenlundveien 31, 5146 Fyllingsdalen',
        lat: 60.3470, lng: 5.2760, coordVerified: false,
        isFree: false, url: 'https://strutsefarmen.no',
        targetAudience: 'For alle',
    },
    // --- Trondheim ---
    {
        externalId: 'voll-gard-trondheim',
        title: 'Voll gård',
        description: 'Hele byens bondegård på Moholt — dyr, gårdskafé og aktiviteter året rundt.',
        municipality: 'Trondheim',
        address: 'Gamle Jonsvannsveien 1, 7049 Trondheim',
        lat: 63.4090, lng: 10.4500, coordVerified: false,
        isFree: true, url: 'https://www.vollgard.no',
    },
    // --- Stavanger ---
    {
        externalId: 'gausel-fritidsgard',
        title: 'Gausel fritidsgård',
        description: 'Stavanger kommunes besøksgård med geit, sau, høner, gris, ku og alpakka.',
        municipality: 'Stavanger',
        address: 'Keramikkveien 36, 4032 Stavanger',
        lat: 58.9010, lng: 5.7250, coordVerified: false,
        isFree: true, url: 'https://www.stavanger.kommune.no',
    },
    {
        externalId: 'ullandhaug-okologisk-gard',
        title: 'Ullandhaug økologiske gård',
        description: 'Økologisk gård med turstier, lekeplass og dyr — kaniner, ullgris, ender, hester og høner.',
        municipality: 'Stavanger',
        address: 'Ullandhaugveien 150, 4021 Stavanger',
        lat: 58.9330, lng: 5.7060, coordVerified: false,
        isFree: true, url: 'http://www.ullandhaug-gard.no',
    },
];

function toRow(seed: DyremoteSeed, sourceId: string) {
    return {
        source_id: sourceId,
        external_id: seed.externalId,
        kind: 'place',
        title: seed.title,
        description: seed.description,
        category: 'Dyremøte',
        target_audience: seed.targetAudience ?? 'Barn',
        address: seed.address,
        municipality: seed.municipality,
        lat: seed.lat,
        lng: seed.lng,
        is_free: seed.isFree,
        price_text: seed.priceText ?? null,
        url: seed.url,
        opening_hours: seed.openingHours ?? null,
        status: seed.coordVerified ? 'published' : 'pending',
    };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    const published = SEED.filter((s) => s.coordVerified).length;
    console.log(
        `Dyremøte-seed: ${SEED.length} steder — ${published} med verifisert ` +
            `koordinat (published), ${SEED.length - published} estimert (pending).`
    );
    for (const s of SEED) {
        console.log(
            `  [${s.coordVerified ? 'PUBLISHED' : 'pending  '}] ${s.municipality.padEnd(10)} ` +
                `${s.title} — ${s.address}`
        );
    }

    if (dryRun) {
        console.log('\n[dry-run] Ingen skriving.');
        return;
    }
    if (!isDatahubConfigured()) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mangler.');

    const db = supabaseAdmin();

    // 1) Sikre kilden.
    const { data: source, error: sourceError } = await db
        .from('sources')
        .upsert({ slug: SOURCE.slug, name: SOURCE.name, kind: SOURCE.kind, active: true }, { onConflict: 'slug' })
        .select('id')
        .single();
    if (sourceError || !source) throw new Error(`Kunne ikke sikre kilden: ${sourceError?.message}`);

    // 2) Respekter låste rader (brukerrapport «finnes ikke») — rør dem aldri.
    const { data: lockedRows, error: lockedError } = await db
        .from('activities')
        .select('external_id')
        .eq('source_id', source.id)
        .eq('locked', true);
    if (lockedError) throw new Error(`Oppslag av låste rader feilet: ${lockedError.message}`);
    const locked = new Set((lockedRows ?? []).map((r) => r.external_id));

    const rows = SEED.filter((s) => !locked.has(s.externalId)).map((s) => toRow(s, source.id));
    if (locked.size) console.log(`Hopper over ${SEED.length - rows.length} låste rader.`);

    const { error } = await db.from('activities').upsert(rows, { onConflict: 'source_id,external_id' });
    if (error) throw new Error(`Upsert feilet: ${error.message}`);

    await db
        .from('sources')
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `ok: ${rows.length} dyremøte-steder` })
        .eq('id', source.id);

    console.log(`\nFerdig: upsertet ${rows.length} steder i kategorien Dyremøte.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
