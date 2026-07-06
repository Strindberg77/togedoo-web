// app/api/sync/route.ts
// Kjører full ingestion av alle kilder. Kalles av Vercel Cron (GET) eller
// manuelt (POST). Beskyttet med CRON_SECRET: Vercel sender automatisk
// `Authorization: Bearer <CRON_SECRET>` når miljøvariabelen er satt.
import { NextRequest, NextResponse } from 'next/server';
import { isDatahubConfigured } from '../../../lib/supabase';
import { runFullSync } from '../../../lib/ingest';

export const maxDuration = 300;

async function handleSync(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error('[Sync] CRON_SECRET er ikke konfigurert');
        return NextResponse.json({ success: false, error: 'Server misconfigured' }, { status: 500 });
    }
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isDatahubConfigured()) {
        return NextResponse.json(
            { success: false, error: 'Datahub-lagring er ikke konfigurert (SUPABASE_URL mangler)' },
            { status: 500 }
        );
    }

    const started = Date.now();
    const { results, expired } = await runFullSync();
    const failed = results.filter((r) => r.error);

    return NextResponse.json({
        success: failed.length === 0,
        results,
        expired,
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString(),
    });
}

export async function GET(request: NextRequest) {
    return handleSync(request);
}

export async function POST(request: NextRequest) {
    return handleSync(request);
}
