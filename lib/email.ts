// lib/email.ts
// Bekreftelses-e-post via Resend sitt REST-API (ingen SDK-avhengighet).
// Dobbelt opt-in: sendes bare når RESEND_API_KEY og EMAIL_FROM er satt OG
// arrangøren har slått på varsling på kontoen sin. E-postfeil skal aldri
// velte en innsending — kall er fire-and-forget for kalleren.

export function isEmailConfigured(): boolean {
    return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendSubmissionConfirmation(
    to: string,
    activityTitle: string,
    published: boolean
): Promise<boolean> {
    if (!isEmailConfigured()) return false;
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: process.env.EMAIL_FROM,
                to: [to],
                subject: published
                    ? `«${activityTitle}» er publisert i Togedoo`
                    : `«${activityTitle}» er mottatt`,
                text: published
                    ? `Hei!\n\nAktiviteten «${activityTitle}» er publisert og er nå synlig i Togedoo.\n\nDu kan se og administrere aktivitetene dine på https://togedoo-web.vercel.app/arranger/konto\n\nHilsen Togedoo`
                    : `Hei!\n\nAktiviteten «${activityTitle}» er mottatt og blir synlig i Togedoo etter en rask gjennomgang.\n\nDu kan følge status på https://togedoo-web.vercel.app/arranger/konto\n\nHilsen Togedoo`,
            }),
        });
        if (!res.ok) {
            console.error('[Email] Resend svarte', res.status, await res.text());
        }
        return res.ok;
    } catch (err) {
        console.error('[Email] Sending feilet:', err);
        return false;
    }
}
