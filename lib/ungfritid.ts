// lib/ungfritid.ts

// Definerer grensesnittet for hvordan dataen ser ut ETTER at vi har transformert den
export interface Activity {
    id: string;
    title: string;
    org: string;
    kommune: string;
    address: string;
    description: string;
    days: string[];
    url: string;
    // Felt for Appen (ToGeDoo):
    appCategory: string; // F.eks. "Sport", "Kultur"
    targetAudience: string; // F.eks. "Barn", "Ungdom"
}

// Kart over ToGeDoo-kategorier og deres tilsvarende søkeord i Ungfritid-dataen (lav case)
const categoryMap: { [key: string]: string } = {
    'Sport': 'sport',
    'Kultur': 'kultur',
    'Utendørs': 'utendørs',
    'Kreativt': 'kreativt',
    'Læring': 'læring',
    'Sosialt': 'sosialt',
};

/**
 * Mapper en aktivitet fra Ungfritid til ToGeDoo sine kategorier og målgrupper.
 */
function mapActivityToAppCategories(activity: any): { appCategory: string, targetAudience: string } {
    const rawCategory = activity.category?.toLowerCase() || ''; // Antar at Ungfritid har et 'category'-felt
    const rawDescription = activity.description?.toLowerCase() || '';
    const rawName = activity.name?.toLowerCase() || '';

    // --- 1. Kategori Mapping ---
    let mappedCategory = 'Aktivitet'; // Fallback

    const categories = Object.keys(categoryMap);

    for (const categoryName of categories) {
        const keyword = categoryMap[categoryName];

        // Sjekker om nøkkelordet finnes i tittel, kategori-felt eller beskrivelse
        if (rawCategory.includes(keyword) || rawName.includes(keyword) || rawDescription.includes(keyword)) {
            mappedCategory = categoryName;
            break; // Fant match, ferdig
        }
    }

    // --- 2. Målgruppe Mapping ---
    let audience = 'Familie'; // Defaulter til 'Familie' eller 'Voksne'

    // Vi må gjette målgruppe basert på manglende aldersfelt. Dette er et eksempel:
    if (rawName.includes('barn') || rawDescription.includes('barn') || (activity.minAge < 10 && activity.maxAge < 16)) {
        audience = 'Barn';
    } else if (rawName.includes('ungdom') || rawDescription.includes('ungdom') || (activity.minAge >= 13 && activity.maxAge <= 19)) {
        audience = 'Ungdom';
    } else if (rawName.includes('voksen') || rawDescription.includes('voksen')) {
        audience = 'Voksne';
    }

    return {
        appCategory: mappedCategory,
        targetAudience: audience,
    };
}


/**
 * Henter og transformerer aktivitetsdata fra Ungfritid.
 * Bruker Next.js 'revalidate' for å cache dataen i 1 time.
 * @param params Valgfrie søkeparametere.
 * @returns Et objekt med transformerte aktiviteter.
 */
export async function fetchUngfritidActivities(params: Record<string, string> = {}) {
    const baseUrl = 'https://ungfritid.no/api/findactivities';

    params.maxActivities = params.maxActivities || '500';
    params.keyword = params.keyword || ''; // Fjernet hardkodet 'a' for å hente mer data

    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value);
    });

    const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        next: { revalidate: 3600 }, // Caching i 1 time
    });

    if (!res.ok) throw new Error('Feil ved henting fra ungfritid.no');

    const raw = await res.json();
    const organizations = raw?.data?.organizations?.hits || [];

    const activities: Activity[] = organizations.flatMap((org: any) =>
        (org.activities || []).map((a: any) => {

            // Mapper til ToGeDoo sine app-spesifikke felt
            const appMapping = mapActivityToAppCategories(a);

            // Kombinerer og returnerer det endelige formatet
            return {
                id: a.id || a._id || '',
                // NY: Bruker en bedre fallback hvis tittelen mangler (bruker Org + Kategori):
                title: a.name || `${org.name || 'Ukjent organisasjon'} - ${appMapping.appCategory}`,
                org: org.name || 'Ukjent',
                kommune: org.municipality || 'Ukjent',
                address: a.place?.formattedAddress || 'Ukjent adresse',
                description: a.shortDescription || '',
                days: a.days || [],
                url: a.webpage || '',

                // Legger til de mappede kategoriene:
                ...appMapping,
            };
        })
    );

    return { data: activities };
}