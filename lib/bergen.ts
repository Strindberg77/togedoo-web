// lib/bergen.ts
import xml2js from 'xml2js';

export interface BergenEvent {
    id: string;
    title: string;
    description: string;
    date: string;
    url: string;
    library: string;
    municipality: string;
    appCategory: string;
    targetAudience: string;
}

function inferCategory(title: string, description: string): string {
    const text = `${title} ${description}`.toLowerCase();

    if (text.includes('barn') || text.includes('baby')) return 'Barn';
    if (text.includes('ungdom')) return 'Ungdom';
    if (text.includes('verksted') || text.includes('kreativ')) return 'Kreativt';
    if (text.includes('datahjelp') || text.includes('teknologi')) return 'Læring';
    if (text.includes('musikk') || text.includes('konsert')) return 'Kultur';
    if (text.includes('forfatter') || text.includes('bok')) return 'Læring';

    return 'Sosialt';
}

function inferAudience(title: string, description: string): string {
    const text = `${title} ${description}`.toLowerCase();

    if (text.includes('barn')) return 'Barn';
    if (text.includes('ungdom')) return 'Ungdom';
    if (text.includes('familie')) return 'Familie';

    return 'Voksne';
}

export async function scrapeBergen(): Promise<{
    success: boolean;
    data: BergenEvent[];
    count: number;
    error?: string
}> {
    try {
        console.log('[Bergen] Fetching RSS feed...');

        const response = await fetch('https://bergenbibliotek.no/arrangement/rss.xml', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            next: { revalidate: 3600 }, // Cache 1 time
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xmlText = await response.text();

        // Parse XML
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xmlText);

        const items = result?.rss?.channel?.[0]?.item || [];

        console.log(`[Bergen] Found ${items.length} events in RSS`);

        const events: BergenEvent[] = items.map((item: any) => {
            const title = item.title?.[0] || 'Ukjent arrangement';
            const description = item.description?.[0] || '';
            const pubDate = item.pubDate?.[0] || '';
            const guid = item.guid?.[0] || '';

            // Extract ID from GUID URL
            const id = guid.split('/').pop() || guid;

            return {
                id,
                title,
                description,
                date: pubDate,
                url: guid,
                library: 'Bergen bibliotek',
                municipality: 'Bergen',
                appCategory: inferCategory(title, description),
                targetAudience: inferAudience(title, description),
            };
        });

        console.log(`[Bergen] Returning ${events.length} events`);

        return {
            success: true,
            data: events,
            count: events.length,
        };

    } catch (error) {
        console.error('[Bergen] Scraping error:', error);
        return {
            success: false,
            data: [],
            count: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}