// app/api/activities/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchUngfritidActivities } from '../../../lib/ungfritid';

export async function GET(request: NextRequest) {
    try {
        // Vi ignorerer request.url params her, bruker interne defaults i fetch‑funksjonen
        const result = await fetchUngfritidActivities();

        const activities = result.data || [];  // Her er listen med alle aktiviteter

        console.log(`[Ungfritid API] ${activities.length} aktiviteter returnert`);

        return NextResponse.json({
            success: true,
            data: activities,
            count: activities.length,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[Ungfritid API Error]:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch activities from Ungfritid',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
