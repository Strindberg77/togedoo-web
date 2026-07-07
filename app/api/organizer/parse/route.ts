// app/api/organizer/parse/route.ts
// Lenketolkning for arrangørskjemaet: henter en offentlig eventside og
// foreslår feltverdier fra schema.org JSON-LD, med OpenGraph som fallback.
// Resultatet forhåndsutfyller bare skjemaet — ingenting lagres her.
import { NextRequest, NextResponse } from 'next/server';
import { parseEventUrl } from '../../../../lib/organizer';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const url = typeof (body as { url?: unknown })?.url === 'string' ? (body as { url: string }).url : '';
        if (!url) {
            return NextResponse.json({ success: false, error: 'Mangler lenke.' }, { status: 400 });
        }

        const { fields, parser } = await parseEventUrl(url);
        return NextResponse.json({ success: true, parser, fields });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Klarte ikke å tolke lenken.',
            },
            { status: 422 }
        );
    }
}
