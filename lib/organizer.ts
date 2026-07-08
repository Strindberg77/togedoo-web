// lib/organizer.ts
// Arrangørflyten (oppgave 2.9): validering av skjema-innsendinger (variant 2)
// og lenketolkning som forhåndsutfyller skjemaet (variant 1). Tolkningen
// foreslår bare feltverdier — arrangøren bekrefter alltid i skjemaet, og alt
// lander som status='pending' til moderering.

export const CATEGORIES = ['Kultur', 'Læring', 'Kreativt', 'Aktivitet'] as const;
export const TARGET_AUDIENCES = ['Barn', 'Ungdom', 'Familie', 'For alle'] as const;
export const RECURRENCE_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

// Én rad per forekomst i activities (samme modell som Flutter-appen),
// ikke RRULE-ekspansjon — enklere å moderere, filtrere og vise.
export const MAX_OCCURRENCES = 25;

export interface Recurrence {
    frequency: RecurrenceFrequency;
    count: number | null; // antall ganger, ELLER:
    until: string | null; // ISO-dato, siste mulige forekomst
}

export interface OrganizerSubmission {
    title: string;
    description: string;
    category: string;
    targetAudience: string;
    venueName: string | null;
    address: string | null;
    municipality: string;
    startsAt: string; // ISO 8601
    endsAt: string | null;
    isFree: boolean;
    priceText: string | null;
    url: string | null;
    imageUrl: string | null;
    contactEmail: string;
    recurrence: Recurrence | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(value: unknown, maxLen: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLen) return null;
    return trimmed;
}

function httpUrl(value: unknown): string | null {
    const s = str(value, 2000);
    if (!s) return null;
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
        return null;
    }
}

/** Validerer og normaliserer et innsendt skjema. Returnerer feilliste på norsk. */
export function validateSubmission(body: unknown): {
    submission: OrganizerSubmission | null;
    errors: string[];
} {
    const errors: string[] = [];
    const b = (body ?? {}) as Record<string, unknown>;

    const title = str(b.title, 200);
    if (!title) errors.push('Tittel er påkrevd (maks 200 tegn).');

    const description = str(b.description, 4000) ?? '';

    const category = str(b.category, 50) ?? 'Aktivitet';
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
        errors.push(`Ugyldig kategori. Gyldige: ${CATEGORIES.join(', ')}.`);
    }

    const targetAudience = str(b.targetAudience, 50) ?? 'For alle';
    if (!TARGET_AUDIENCES.includes(targetAudience as (typeof TARGET_AUDIENCES)[number])) {
        errors.push(`Ugyldig målgruppe. Gyldige: ${TARGET_AUDIENCES.join(', ')}.`);
    }

    const municipality = str(b.municipality, 100);
    if (!municipality) errors.push('Kommune er påkrevd.');

    const startsAtRaw = str(b.startsAt, 40);
    let startsAt: string | null = null;
    if (!startsAtRaw || isNaN(Date.parse(startsAtRaw))) {
        errors.push('Starttidspunkt er påkrevd og må være en gyldig dato/tid.');
    } else {
        startsAt = new Date(startsAtRaw).toISOString();
        if (Date.parse(startsAt) < Date.now() - 24 * 60 * 60 * 1000) {
            errors.push('Starttidspunktet kan ikke være i fortiden.');
        }
    }

    const endsAtRaw = str(b.endsAt, 40);
    let endsAt: string | null = null;
    if (endsAtRaw) {
        if (isNaN(Date.parse(endsAtRaw))) errors.push('Sluttidspunktet er ikke en gyldig dato/tid.');
        else endsAt = new Date(endsAtRaw).toISOString();
    }
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
        errors.push('Slutt må være etter start.');
    }

    const recurrence = parseRecurrence(b.recurrence, startsAt, errors);

    const contactEmail = str(b.contactEmail, 200);
    if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
        errors.push('Gyldig kontakt-e-post er påkrevd.');
    }

    const venueName = str(b.venueName, 200);
    const address = str(b.address, 300);
    if (!venueName && !address) {
        errors.push('Oppgi stedsnavn eller adresse, så aktiviteten kan vises på kartet.');
    }

    if (errors.length > 0) return { submission: null, errors };

    return {
        submission: {
            title: title!,
            description,
            category,
            targetAudience,
            venueName,
            address,
            municipality: municipality!,
            startsAt: startsAt!,
            endsAt,
            isFree: b.isFree !== false,
            priceText: str(b.priceText, 200),
            url: httpUrl(b.url),
            imageUrl: httpUrl(b.imageUrl),
            contactEmail: contactEmail!,
            recurrence,
        },
        errors: [],
    };
}

function parseRecurrence(raw: unknown, startsAt: string | null, errors: string[]): Recurrence | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object') {
        errors.push('Ugyldig gjentakelse.');
        return null;
    }
    const r = raw as Record<string, unknown>;

    const frequency = r.frequency;
    if (!RECURRENCE_FREQUENCIES.includes(frequency as RecurrenceFrequency)) {
        errors.push('Ugyldig frekvens. Gyldige: ukentlig, annenhver uke, månedlig.');
        return null;
    }

    const hasCount = r.count !== null && r.count !== undefined && r.count !== '';
    const hasUntil = typeof r.until === 'string' && r.until.trim() !== '';
    if (hasCount === hasUntil) {
        errors.push('Velg enten antall ganger eller til-dato for gjentakelsen (ikke begge).');
        return null;
    }

    let count: number | null = null;
    let until: string | null = null;
    if (hasCount) {
        count = Number(r.count);
        if (!Number.isInteger(count) || count < 2 || count > MAX_OCCURRENCES) {
            errors.push(`Antall ganger må være mellom 2 og ${MAX_OCCURRENCES}.`);
            return null;
        }
    } else {
        const parsed = Date.parse(String(r.until));
        if (isNaN(parsed)) {
            errors.push('Til-datoen for gjentakelsen er ugyldig.');
            return null;
        }
        if (startsAt && parsed <= Date.parse(startsAt)) {
            errors.push('Til-datoen for gjentakelsen må være etter startdatoen.');
            return null;
        }
        until = new Date(parsed).toISOString();
    }

    return { frequency: frequency as RecurrenceFrequency, count, until };
}

/** Legger til måneder med klamping: 31. jan + 1 mnd = 28./29. feb, ikke 3. mars. */
function addMonthsClamped(date: Date, months: number): Date {
    const result = new Date(date);
    const day = result.getDate();
    result.setMonth(result.getMonth() + months);
    if (result.getDate() !== day) result.setDate(0);
    return result;
}

function shift(iso: string, frequency: RecurrenceFrequency, step: number): Date {
    const d = new Date(iso);
    if (frequency === 'monthly') return addMonthsClamped(d, step);
    d.setDate(d.getDate() + (frequency === 'weekly' ? 7 : 14) * step);
    return d;
}

/**
 * Ekspanderer en (validert) gjentakelse til konkrete forekomster.
 * Returnerer en feilstreng i stedet hvis til-datoen gir flere enn
 * MAX_OCCURRENCES forekomster.
 */
export function expandOccurrences(
    startsAt: string,
    endsAt: string | null,
    recurrence: Recurrence | null
): { occurrences: { startsAt: string; endsAt: string | null }[] } | { error: string } {
    if (!recurrence) return { occurrences: [{ startsAt, endsAt }] };

    const total = recurrence.count ?? MAX_OCCURRENCES + 1;
    // Til-dato gjelder ut hele dagen, uansett klokkeslett på forekomsten.
    const untilMs = recurrence.until
        ? Date.parse(recurrence.until) + 24 * 60 * 60 * 1000 - 1
        : Infinity;

    const occurrences: { startsAt: string; endsAt: string | null }[] = [];
    for (let i = 0; i < total; i++) {
        const start = shift(startsAt, recurrence.frequency, i);
        if (start.getTime() > untilMs) break;
        if (occurrences.length >= MAX_OCCURRENCES && recurrence.until) {
            return {
                error: `Gjentakelsen gir flere enn ${MAX_OCCURRENCES} forekomster. Velg en tidligere til-dato eller bruk antall ganger (maks ${MAX_OCCURRENCES}).`,
            };
        }
        occurrences.push({
            startsAt: start.toISOString(),
            endsAt: endsAt ? shift(endsAt, recurrence.frequency, i).toISOString() : null,
        });
    }
    return { occurrences };
}

// ---------------------------------------------------------------------------
// Variant 1: lenketolkning. schema.org Event (JSON-LD) er primærkilden —
// de fleste eventsider (kommuner, kulturhus, billettsystemer) har den.
// OpenGraph-tags er fallback for tittel/beskrivelse/bilde.
// ---------------------------------------------------------------------------

export interface ParsedEventFields {
    title?: string;
    description?: string;
    venueName?: string;
    address?: string;
    municipality?: string;
    startsAt?: string;
    endsAt?: string;
    isFree?: boolean;
    priceText?: string;
    url?: string;
    imageUrl?: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;

/** Grov SSRF-sperre: kun http(s) mot offentlige vertsnavn. DNS-rebinding er
 *  en kjent forenkling — tolkningen leser bare og resultatet modereres. */
function isFetchableUrl(u: URL): boolean {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        const [a, b] = host.split('.').map(Number);
        if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
            return false;
        }
    }
    if (host.includes(':')) return false; // IPv6-literal
    return true;
}

function stripHtml(s: string): string {
    return s
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function firstString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
        for (const v of value) {
            const s = firstString(v);
            if (s) return s;
        }
    }
    if (value && typeof value === 'object' && 'url' in (value as object)) {
        return firstString((value as { url: unknown }).url);
    }
    return undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
    if (typeof value !== 'string' || isNaN(Date.parse(value))) return undefined;
    return new Date(value).toISOString();
}

/** Finner første schema.org-node med @type som slutter på 'Event'. */
function findEventNode(data: unknown): Record<string, unknown> | null {
    if (Array.isArray(data)) {
        for (const item of data) {
            const found = findEventNode(item);
            if (found) return found;
        }
        return null;
    }
    if (!data || typeof data !== 'object') return null;
    const node = data as Record<string, unknown>;
    const type = node['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === 'string' && t.endsWith('Event'))) return node;
    if (node['@graph']) return findEventNode(node['@graph']);
    return null;
}

function fieldsFromJsonLd(event: Record<string, unknown>): ParsedEventFields {
    const fields: ParsedEventFields = {};
    fields.title = firstString(event.name);
    const desc = firstString(event.description);
    if (desc) fields.description = stripHtml(desc).slice(0, 4000);
    fields.startsAt = isoOrUndefined(firstString(event.startDate));
    fields.endsAt = isoOrUndefined(firstString(event.endDate));
    fields.url = firstString(event.url);
    fields.imageUrl = firstString(event.image);

    const location = Array.isArray(event.location) ? event.location[0] : event.location;
    if (location && typeof location === 'object') {
        const loc = location as Record<string, unknown>;
        fields.venueName = firstString(loc.name);
        const addr = loc.address;
        if (typeof addr === 'string') {
            fields.address = addr.trim();
        } else if (addr && typeof addr === 'object') {
            const a = addr as Record<string, unknown>;
            const street = firstString(a.streetAddress);
            const locality = firstString(a.addressLocality);
            if (street) fields.address = street;
            if (locality) fields.municipality = locality;
        }
    } else if (typeof location === 'string') {
        fields.venueName = location.trim();
    }

    const offers = Array.isArray(event.offers) ? event.offers[0] : event.offers;
    if (offers && typeof offers === 'object') {
        const price = firstString((offers as Record<string, unknown>).price);
        if (price !== undefined) {
            const numeric = Number(price);
            if (!isNaN(numeric)) {
                fields.isFree = numeric === 0;
                if (numeric > 0) fields.priceText = `${numeric} kr`;
            }
        }
    }

    for (const key of Object.keys(fields) as (keyof ParsedEventFields)[]) {
        if (fields[key] === undefined) delete fields[key];
    }
    return fields;
}

function ogContent(html: string, property: string): string | undefined {
    const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
        'i'
    );
    const m = html.match(re);
    const raw = m?.[1] ?? m?.[2];
    return raw ? stripHtml(raw) : undefined;
}

export async function parseEventUrl(rawUrl: string): Promise<{
    fields: ParsedEventFields;
    parser: 'jsonld' | 'opengraph' | 'none';
}> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error('Ugyldig lenke.');
    }
    if (!isFetchableUrl(url)) throw new Error('Lenken må peke på en offentlig nettside (http/https).');

    const res = await fetch(url.href, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TogedooBot/1.0; +https://togedoo.com)',
            Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Fikk ikke hentet siden (HTTP ${res.status}).`);
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);

    // JSON-LD først: strukturert og komplett når den finnes.
    const ldBlocks = html.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    for (const match of ldBlocks) {
        try {
            const event = findEventNode(JSON.parse(match[1]));
            if (event) {
                const fields = fieldsFromJsonLd(event);
                if (fields.title) return { fields: { url: url.href, ...fields }, parser: 'jsonld' };
            }
        } catch {
            // Ugyldig JSON-LD-blokk; prøv neste.
        }
    }

    const og: ParsedEventFields = {
        title: ogContent(html, 'og:title'),
        description: ogContent(html, 'og:description'),
        imageUrl: ogContent(html, 'og:image'),
        url: url.href,
    };
    for (const key of Object.keys(og) as (keyof ParsedEventFields)[]) {
        if (og[key] === undefined) delete og[key];
    }
    if (og.title) return { fields: og, parser: 'opengraph' };

    return { fields: { url: url.href }, parser: 'none' };
}
