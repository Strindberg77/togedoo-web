// lib/reports.ts
// Felles logikk for stedsrapporter («meld feil») og auto-terskelen fra
// migrasjon 0007: fingerprint-hashing, avstandsberegning og tersklene for
// mengde-basert selvbekreftelse.
import { createHash } from 'crypto';

export const REPORT_REASONS = ['finnes_ikke', 'feil_lokasjon', 'feil_info'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Auto-terskel: kun for 'finnes_ikke' (objektiv og reversibel — admin kan
// sette published tilbake; locked består så re-importen ikke overstyrer).
// 'feil_lokasjon'/'feil_info' får aldri auto-handling, kun prioritering i
// admin-køen.
export const AUTO_REJECT_THRESHOLD = 3; // unike rapportører
export const AUTO_REJECT_WINDOW_DAYS = 60;
export const AUTO_REJECT_MAX_DISTANCE_M = 5000; // rapportør må ha vært i nærheten

// Rate-limiting i databasen (per ip_hash) — erstatter in-memory-limiteren
// som nullstilles per serverless-instans.
export const REPORT_RATE_LIMIT = 10;
export const REPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

function salt(): string {
    // Uten salt fungerer hashingen fortsatt, men er lettere å reversere for
    // den som kjenner device-ID-formatet. Sett REPORT_HASH_SALT i Vercel.
    return process.env.REPORT_HASH_SALT ?? '';
}

/** Saltet fingerprint av appens anonyme device-ID. Null hvis ID mangler
 *  eller ser ugyldig ut — rapporten teller da ikke mot auto-terskelen. */
export function reporterHash(deviceId: unknown): string | null {
    if (typeof deviceId !== 'string') return null;
    const trimmed = deviceId.trim();
    if (trimmed.length < 8 || trimmed.length > 128) return null;
    return createHash('sha256').update(`${salt()}:device:${trimmed}`).digest('hex');
}

/** Saltet IP-hash, kun til rate-limiting (aldri til unikhets-telling —
 *  familier på samme wifi deler IP). */
export function ipHash(ip: string): string {
    return createHash('sha256').update(`${salt()}:ip:${ip}`).digest('hex');
}

export function parseCoordinate(value: unknown, min: number, max: number): number | null {
    const n = typeof value === 'number' ? value : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Storsirkelavstand i meter (haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
