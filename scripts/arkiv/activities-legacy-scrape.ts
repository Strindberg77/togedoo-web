// scripts/arkiv/activities-legacy-scrape.ts
//
// ARKIVERT (sep. 2026). Var reservestien i app/api/activities/route.ts: når
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY manglet, skrapet ruta Deichman og
// Bergen bibliotek live ved hvert kall og svarte med mode: "legacy". Den
// kjørte aldri i produksjon (variablene er satt), men ville gjort det uten
// grense i et miljø uten dem. Ruta svarer nå 503 i stedet.
//
// Bergen bibliotek er dessuten satt på pause (DATAHUB_SETUP.md): feeden har
// ingen arrangementsdato. Skal ikke tas i bruk igjen.
import { NextResponse } from 'next/server';
import { scrapeDeichman } from '../../lib/deichman';
import { scrapeBergen } from '../../lib/bergen';

// Gammel oppførsel: live-scrape per request, uten koordinater. Fjernes når
// datahubben er i drift.
export async function fromLegacyScrape(searchParams: URLSearchParams) {
    const municipality = searchParams.get('municipality') || undefined;
    const targetAudience = searchParams.get('targetAudience') || undefined;

    const [deichmanResult, bergenResult] = await Promise.all([
        scrapeDeichman({ targetAudience }),
        scrapeBergen(),
    ]);

    let allActivities = [
        ...(deichmanResult.data || []).map((event) => ({ ...event, source: 'deichman.no' })),
        ...(bergenResult.data || []).map((event) => ({ ...event, source: 'bergenbibliotek.no' })),
    ];

    if (municipality) {
        allActivities = allActivities.filter(
            (act) => act.municipality.toLowerCase() === municipality.toLowerCase()
        );
    }
    if (targetAudience) {
        allActivities = allActivities.filter(
            (act) => act.targetAudience.toLowerCase() === targetAudience.toLowerCase()
        );
    }

    return NextResponse.json({
        success: true,
        mode: 'legacy',
        data: allActivities,
        count: allActivities.length,
        timestamp: new Date().toISOString(),
    });
}
