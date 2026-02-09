import * as cheerio from 'cheerio';

export interface DeichmanEvent {
    id: string;
    title: string;
    library: string;
    description: string;
    date: string;
    startTime: string;
    endTime?: string;
    location: string;
    type: string;
    targetAudience: string;
    imageUrl?: string;
    url: string;
    cancelled: boolean;
    tags: string[];
    appCategory: string;
    municipality: string;
}

const categoryMap: { [key: string]: string } = {
    'Film og spill': 'Kultur',
    'Forestilling': 'Kultur',
    'Formidling og fortelling': 'Læring',
    'Kurs og læring': 'Læring',
    'Verksted og kreativitet': 'Kreativt',
    'Lesesirkel': 'Læring',
    'Sosial møteplass': 'Sosialt',
};

function mapToAppCategory(type: string): string {
    return categoryMap[type] || 'Aktivitet';
}

export async function scrapeDeichman(options: {
    targetAudience?: string;
} = {}): Promise<{ success: boolean; data: DeichmanEvent[]; count: number; error?: string }> {

    try {
        console.log('[Deichman] Fetching events...');

        const response = await fetch('https://deichman.no/hva-skjer', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            next: { revalidate: 3600 },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        const $ = cheerio.load(html);
        const nextDataScript = $('script#__NEXT_DATA__').html();

        if (!nextDataScript) {
            throw new Error('Could not find __NEXT_DATA__ script');
        }

        const nextData = JSON.parse(nextDataScript);
        const allEvents = nextData?.props?.initialReduxState?.events?.events?.allEvents || [];

        console.log(`[Deichman] Found ${allEvents.length} events in initial load`);

        const events: DeichmanEvent[] = allEvents
            .filter((event: any) => {
                if (options.targetAudience && event.targetAudience !== options.targetAudience) {
                    return false;
                }
                if (event.cancelled) {
                    return false;
                }
                return true;
            })
            .map((event: any) => ({
                id: event.id,
                title: event.title || 'Ukjent arrangement',
                library: event.library || 'Deichman',
                description: event.ingress || '',
                date: event.date,
                startTime: event.startTime,
                endTime: event.endTime,
                location: event.location?.name || event.library || 'Oslo',
                type: event.type || 'Arrangement',
                targetAudience: event.targetAudience || 'For alle',
                imageUrl: event.image?.url ? `https://deichman.no${event.image.url}` : undefined,
                url: `https://deichman.no/arrangement/${event.id}`,
                cancelled: event.cancelled || false,
                tags: event.tags || [],
                appCategory: mapToAppCategory(event.type),
                municipality: 'Oslo',
            }));

        console.log(`[Deichman] Returning ${events.length} filtered events`);

        return {
            success: true,
            data: events,
            count: events.length,
        };

    } catch (error) {
        console.error('[Deichman] Scraping error:', error);
        return {
            success: false,
            data: [],
            count: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}