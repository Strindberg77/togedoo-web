import { NextRequest, NextResponse } from 'next/server';
import { scrapeDeichman } from '../../../lib/deichman';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const targetAudience = searchParams.get('targetAudience') || undefined;

        console.log(`[Deichman API] Request: targetAudience=${targetAudience}`);

        const result = await scrapeDeichman({ targetAudience });

        return NextResponse.json({
            success: result.success,
            data: result.data,
            count: result.count,
            source: 'deichman.no',
            municipality: 'Oslo',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[Deichman API Error]:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to scrape Deichman.no',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}