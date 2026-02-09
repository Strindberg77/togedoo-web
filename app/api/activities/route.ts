// app/api/activities/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { scrapeDeichman } from '../../../lib/deichman';
import { scrapeBergen } from '../../../lib/bergen';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const municipality = searchParams.get('municipality') || undefined;
        const targetAudience = searchParams.get('targetAudience') || undefined;

        console.log(`[Activities API] Request: municipality=${municipality}, targetAudience=${targetAudience}`);

        // Hent fra begge byer parallelt
        const [deichmanResult, bergenResult] = await Promise.all([
            scrapeDeichman({ targetAudience }),
            scrapeBergen(),
        ]);

        console.log(`[Activities API] Deichman: ${deichmanResult.count}, Bergen: ${bergenResult.count}`);

        // Kombiner og filtrer
        let allActivities = [
            ...(deichmanResult.data || []).map(event => ({
                ...event,
                source: 'deichman.no',
            })),
            ...(bergenResult.data || []).map(event => ({
                ...event,
                source: 'bergenbibliotek.no',
            })),
        ];

        // Filtrer på by hvis spesifisert
        if (municipality) {
            allActivities = allActivities.filter(act =>
                act.municipality.toLowerCase() === municipality.toLowerCase()
            );
        }

        // Filtrer på målgruppe hvis spesifisert
        if (targetAudience) {
            allActivities = allActivities.filter(act =>
                act.targetAudience.toLowerCase() === targetAudience.toLowerCase()
            );
        }

        return NextResponse.json({
            success: true,
            data: allActivities,
            count: allActivities.length,
            sources: {
                oslo: deichmanResult.count || 0,
                bergen: bergenResult.count || 0,
            },
            filters: {
                municipality: municipality || 'alle',
                targetAudience: targetAudience || 'alle',
            },
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[Activities API Error]:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch activities',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}