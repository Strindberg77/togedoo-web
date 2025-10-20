// app/api/activities/route.ts
import { NextRequest, NextResponse } from 'next/server';

interface UngfritidActivity {
    id?: string;
    title?: string;
    description?: string;
    ageGroup?: string;
    location?: string;
    imageUrl?: string;
    categoryName?: string;
    startDate?: string;
    endDate?: string;
    price?: string | number;
    [key: string]: any;
}

interface ToGedooActivity {
    id: string;
    title: string;
    description: string;
    ageGroup: string;
    location: string;
    image: string;
    category: string;
    price: string;
    when: string;
    municipality: string;
}

// Ungfritid API base URL
const UNGFRITID_BASE = 'https://ungfritid.no/api/findactivities';

// Map municipality names to their API format
const municipalityMap: Record<string, string> = {
    oslo: 'Oslo',
    bergen: 'Bergen',
    trondheim: 'Trondheim',
    stavanger: 'Stavanger',
    kristiansand: 'Kristiansand',
    tromso: 'Tromsø',
};

// Build Ungfritid query string
function buildUngfritidQuery(municipality: string, limit: number = 50): URLSearchParams {
    const params = new URLSearchParams();
    params.append('area', 'municipality');
    params.append('place', municipalityMap[municipality.toLowerCase()] || municipality);
    params.append('maxActivities', limit.toString());
    return params;
}

// Transform Ungfritid response to ToGedoo format
function transformActivity(activity: any, municipality: string): ToGedooActivity {
    // Extract data from nested Ungfritid structure
    const basicInfo = activity.basicInfo || {};
    const moreInfo = activity.moreAboutActivity || {};
    const contactPos = activity.contactPositions?.[0]?.position;

    const id = activity._id || activity.slug || `${Date.now()}-${Math.random()}`;
    const title = activity.slug?.replace(/-/g, ' ') || basicInfo.activityTitle || 'Aktivitet';
    const description = moreInfo.shortDescription || basicInfo.activityDescription || '';

    // Age group - extract from array if present
    let ageGroup = 'Alle aldre';
    if (Array.isArray(activity.activityFor?.age) && activity.activityFor.age.length > 0) {
        const ages = activity.activityFor.age;
        ageGroup = `${ages[0].from}-${ages[0].to} år`;
    } else if (Array.isArray(activity.ageGroup) && activity.ageGroup.length > 0) {
        ageGroup = `${activity.ageGroup[0].from}-${activity.ageGroup[0].to} år`;
    }

    const location = contactPos?.description || municipality;
    const image = basicInfo.image || '/images/placeholder-activity.png';
    const tags = activity.tags || [];
    const category = tags.length > 0 ? tags[0] : 'Aktivitet';

    // Price
    let price = 'Gratis';
    if (activity.necessaryEquipment?.prices && activity.necessaryEquipment.prices.length > 0) {
        price = activity.necessaryEquipment.prices[0].price + ' kr';
    }

    // When/date
    let when = basicInfo.when || 'Kommende';

    return {
        id,
        title,
        description,
        ageGroup,
        location,
        image,
        category,
        price,
        when,
        municipality,
    };
}

// Main request handler
async function handleActivityRequest(municipality: string, limit: number) {
    try {
        console.log(`[Ungfritid API] Fetching activities for: ${municipality}`);

        // Build query parameters for Ungfritid GET request
        const queryParams = buildUngfritidQuery(municipality, limit);
        const ungfritidUrl = `${UNGFRITID_BASE}?${queryParams.toString()}`;

        console.log(`[Ungfritid API] URL: ${ungfritidUrl}`);

        // Fetch from Ungfritid (GET request)
        const response = await fetch(ungfritidUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'ToGeDoo/1.0 (Next.js)',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(
                `[Ungfritid API] Error: ${response.status} ${response.statusText}`,
                errorText.substring(0, 200)
            );
            throw new Error(`Ungfritid API returned ${response.status}`);
        }

        const ungfritidData = await response.json();
        console.log('[Ungfritid API] Response received, parsing...');
        console.log('[Ungfritid API] Raw response (first 500 chars):', JSON.stringify(ungfritidData).substring(0, 500));
        console.log('[Ungfritid API] Response type:', typeof ungfritidData);
        console.log('[Ungfritid API] Is array?', Array.isArray(ungfritidData));
        console.log('[Ungfritid API] Top-level keys:', Object.keys(ungfritidData).slice(0, 10));

        // Handle response - Ungfritid returns activities in activities.hits
        let activities: UngfritidActivity[] = [];

        if (ungfritidData.activities?.hits && Array.isArray(ungfritidData.activities.hits)) {
            activities = ungfritidData.activities.hits;
            console.log('[Ungfritid API] Found activities.hits array');
        } else if (Array.isArray(ungfritidData)) {
            activities = ungfritidData;
            console.log('[Ungfritid API] Found array directly');
        } else if (ungfritidData.data && Array.isArray(ungfritidData.data)) {
            activities = ungfritidData.data;
            console.log('[Ungfritid API] Found data property');
        } else {
            console.log('[Ungfritid API] Could not find activities in response');
            console.log('[Ungfritid API] Response keys:', Object.keys(ungfritidData));
        }

        console.log(`[Ungfritid API] Found ${activities.length} activities`);

        // Transform activities to ToGedoo format
        const transformedActivities = activities
            .slice(0, limit)
            .map((activity) => transformActivity(activity, municipality));

        console.log(
            `[Ungfritid API] Successfully transformed ${transformedActivities.length} activities`
        );

        return NextResponse.json({
            success: true,
            data: transformedActivities,
            count: transformedActivities.length,
            municipality,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[Ungfritid API] Error:', error);

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

// Handle POST requests
export async function POST(request: NextRequest) {
    try {
        const { municipality = 'Oslo', limit = 50 } = await request.json();

        if (!municipality) {
            return NextResponse.json(
                { error: 'Municipality parameter is required' },
                { status: 400 }
            );
        }

        return handleActivityRequest(municipality, limit);
    } catch (error) {
        console.error('[Ungfritid API] POST Error:', error);
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 }
        );
    }
}

// Handle GET requests
export async function GET(request: NextRequest) {
    const municipality = request.nextUrl.searchParams.get('municipality') || 'Oslo';
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');

    return handleActivityRequest(municipality, limit);
}