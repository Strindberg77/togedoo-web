// scripts/arkiv/api-deichman-route.ts
//
// ARKIVERT (sep. 2026). Var app/api/deichman/route.ts: en offentlig rute som
// skrapet deichman.no direkte, uten innlogging og uten grense. Ingen brukte
// den — verken togedoo-web eller appen. Deichman-dataene kommer inn via
// nattjobben (/api/sync → lib/ingest.ts), som kaller skraperen direkte.
// Ligger utenfor app/, så Next serverer den ikke. Skal ikke tas i bruk igjen
// uten grense og uten at noen trenger den.
import { NextRequest, NextResponse } from 'next/server';
import { scrapeDeichman } from '../../lib/deichman';

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