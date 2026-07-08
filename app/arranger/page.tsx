'use client';
// Arrangørskjemaet (oppgave 2.9). Lim inn en lenke øverst for å
// forhåndsutfylle feltene, eller fyll inn manuelt. Innsendinger modereres
// før de blir synlige i appen — unntatt fra verifiserte arrangørkontoer,
// som publiserer direkte. Kontosiden kan også forhåndsutfylle skjemaet
// via sessionStorage (dupliser-funksjonen).
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import {
    expandOccurrences,
    MAX_OCCURRENCES,
    Recurrence,
    RecurrenceFrequency,
} from '../../lib/organizer';

const CATEGORIES = ['Kultur', 'Læring', 'Kreativt', 'Aktivitet'];
const TARGET_AUDIENCES = ['Barn', 'Ungdom', 'Familie', 'For alle'];
const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
    weekly: 'Ukentlig',
    biweekly: 'Annenhver uke',
    monthly: 'Månedlig',
};

interface FormState {
    title: string;
    description: string;
    category: string;
    targetAudience: string;
    venueName: string;
    address: string;
    municipality: string;
    startsDate: string;
    startsTime: string;
    endsDate: string;
    endsTime: string;
    isFree: boolean;
    priceText: string;
    url: string;
    imageUrl: string;
    contactEmail: string;
}

const EMPTY_FORM: FormState = {
    title: '',
    description: '',
    category: 'Aktivitet',
    targetAudience: 'For alle',
    venueName: '',
    address: '',
    municipality: '',
    startsDate: '',
    startsTime: '',
    endsDate: '',
    endsTime: '',
    isFree: true,
    priceText: '',
    url: '',
    imageUrl: '',
    contactEmail: '',
};

/** ISO-tidsstempel -> lokale {date, time}-verdier for input-feltene. */
function toLocalParts(iso?: string): { date: string; time: string } {
    if (!iso) return { date: '', time: '' };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
}

/** Lokale dato- og tidsfelter -> ISO, eller null hvis ugyldig/ufullstendig. */
function partsToIso(date: string, time: string): string | null {
    if (!date || !time) return null;
    const d = new Date(`${date}T${time}`);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function ArrangorPage() {
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [parseUrl, setParseUrl] = useState('');
    const [parsing, setParsing] = useState(false);
    const [parseInfo, setParseInfo] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [submitted, setSubmitted] = useState(false);
    const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
    // Dato-UI: sluttdato og gjentakelse er skjult bak hver sin toggle,
    // siden de fleste arrangementer er én enkelthendelse på én dag.
    const [multiDay, setMultiDay] = useState(false);
    const [recurring, setRecurring] = useState(false);
    const [frequency, setFrequency] = useState<RecurrenceFrequency>('weekly');
    const [recurrenceMethod, setRecurrenceMethod] = useState<'count' | 'until'>('count');
    const [recurrenceCount, setRecurrenceCount] = useState('4');
    const [recurrenceUntil, setRecurrenceUntil] = useState('');
    const [sessionToken, setSessionToken] = useState<string | null>(null);
    const [sessionEmail, setSessionEmail] = useState<string | null>(null);

    useEffect(() => {
        // Dupliser-prefill fra kontosiden (uten dato — ny dato velges her).
        const stored = sessionStorage.getItem('togedoo-dupliser');
        if (stored) {
            sessionStorage.removeItem('togedoo-dupliser');
            try {
                const dup = JSON.parse(stored);
                setForm((prev) => ({ ...prev, ...dup }));
            } catch {
                // Ugyldig innhold; ignorer.
            }
        }

        const supabase = supabaseBrowser();
        if (!supabase) return;
        supabase.auth.getSession().then(({ data }) => {
            const session = data.session;
            if (!session) return;
            setSessionToken(session.access_token);
            setSessionEmail(session.user.email ?? null);
            if (session.user.email) {
                setForm((prev) =>
                    prev.contactEmail ? prev : { ...prev, contactEmail: session.user.email! }
                );
            }
        });
    }, []);

    const set = (field: keyof FormState, value: string | boolean) =>
        setForm((f) => ({ ...f, [field]: value }));

    function buildRecurrence(): Recurrence | null {
        if (!recurring) return null;
        return {
            frequency,
            count: recurrenceMethod === 'count' ? Number(recurrenceCount) || 0 : null,
            until: recurrenceMethod === 'until' && recurrenceUntil ? recurrenceUntil : null,
        };
    }

    /** Sammendrag for gjentakelse: bruker samme ekspansjon som serveren. */
    function recurrenceSummary(): { text: string; isError: boolean } | null {
        if (!recurring) return null;
        const startsAt = partsToIso(form.startsDate, form.startsTime);
        if (!startsAt) return { text: 'Fyll inn dato og starttid for å se sammendraget.', isError: false };
        const rec = buildRecurrence();
        if (rec && rec.count !== null && (rec.count < 2 || rec.count > MAX_OCCURRENCES)) {
            return { text: `Antall ganger må være mellom 2 og ${MAX_OCCURRENCES}.`, isError: true };
        }
        if (rec && rec.count === null && !rec.until) {
            return { text: 'Velg en til-dato for å se sammendraget.', isError: false };
        }
        const expanded = expandOccurrences(startsAt, null, rec);
        if ('error' in expanded) return { text: expanded.error, isError: true };
        const dates = expanded.occurrences;
        const fmt = (iso: string) =>
            new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
        return {
            text: `Dette vil opprette ${dates.length} aktiviteter, fra ${fmt(dates[0].startsAt)} til ${fmt(dates[dates.length - 1].startsAt)}.`,
            isError: false,
        };
    }

    async function handleParse() {
        if (!parseUrl.trim()) return;
        setParsing(true);
        setParseInfo(null);
        try {
            const res = await fetch('/api/organizer/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: parseUrl.trim() }),
            });
            const data = await res.json();
            if (!data.success) {
                setParseInfo(data.error || 'Klarte ikke å tolke lenken.');
                return;
            }
            const f = data.fields ?? {};
            const starts = toLocalParts(f.startsAt);
            const ends = toLocalParts(f.endsAt);
            // Dato uten klokkeslett i kilden: foreslå bare datoen, ikke 00:00.
            if (f.startsAtHasTime === false) starts.time = '';
            if (f.endsAtHasTime === false) ends.time = '';
            setForm((prev) => ({
                ...prev,
                title: f.title ?? prev.title,
                description: f.description ?? prev.description,
                venueName: f.venueName ?? prev.venueName,
                address: f.address ?? prev.address,
                municipality: f.municipality ?? prev.municipality,
                startsDate: starts.date || prev.startsDate,
                startsTime: starts.time || prev.startsTime,
                endsDate: ends.date && ends.date !== starts.date ? ends.date : prev.endsDate,
                endsTime: ends.time || prev.endsTime,
                isFree: f.isFree ?? prev.isFree,
                priceText: f.priceText ?? prev.priceText,
                url: f.url ?? prev.url,
                imageUrl: f.imageUrl ?? prev.imageUrl,
            }));
            if (ends.date && starts.date && ends.date !== starts.date) setMultiDay(true);
            const structured = data.parser === 'jsonld' || data.parser === 'nextdata';
            setParseInfo(
                structured && starts.time
                    ? 'Fant strukturert eventdata — sjekk feltene under og juster om noe mangler.'
                    : structured || data.parser === 'opengraph'
                      ? 'Fant ikke tidspunkt automatisk — fyll inn dato og klokkeslett manuelt.'
                      : 'Fant ingen eventdata på siden — fyll inn feltene manuelt.'
            );
        } catch {
            setParseInfo('Noe gikk galt under tolkningen. Fyll inn manuelt.');
        } finally {
            setParsing(false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErrors([]);

        const startsAt = partsToIso(form.startsDate, form.startsTime);
        if (!startsAt) {
            setErrors(['Oppgi både dato og starttid.']);
            return;
        }
        // Slutt: samme dag som standard; egen sluttdato kun ved flerdagers.
        let endsAt: string | null = null;
        if (multiDay) {
            if (!form.endsDate) {
                setErrors(['Oppgi sluttdato, eller skru av «Strekker seg over flere dager».']);
                return;
            }
            endsAt = partsToIso(form.endsDate, form.endsTime || form.startsTime);
        } else if (form.endsTime) {
            endsAt = partsToIso(form.startsDate, form.endsTime);
        }
        const recurrence = buildRecurrence();
        if (recurrence) {
            const check = expandOccurrences(startsAt, endsAt, recurrence);
            if ('error' in check) {
                setErrors([check.error]);
                return;
            }
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/organizer/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
                },
                body: JSON.stringify({
                    ...form,
                    startsAt,
                    endsAt,
                    recurrence,
                    venueName: form.venueName || null,
                    address: form.address || null,
                    priceText: form.priceText || null,
                    url: form.url || null,
                    imageUrl: form.imageUrl || null,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setSubmittedMessage(data.message ?? null);
                setSubmitted(true);
            } else {
                setErrors(data.errors ?? [data.error ?? 'Innsendingen feilet.']);
            }
        } catch {
            setErrors(['Noe gikk galt. Prøv igjen.']);
        } finally {
            setSubmitting(false);
        }
    }

    if (submitted) {
        return (
            <main className="p-6 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold mb-4">Takk for innsendingen!</h1>
                <p className="mb-4">
                    {submittedMessage ??
                        'Aktiviteten er mottatt og blir synlig i Togedoo etter en rask gjennomgang.'}{' '}
                    Vi kontakter deg på e-post hvis noe må avklares.
                </p>
                <button
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                    onClick={() => {
                        setForm(EMPTY_FORM);
                        setParseUrl('');
                        setParseInfo(null);
                        setSubmitted(false);
                    }}
                >
                    Send inn en til
                </button>
            </main>
        );
    }

    const inputCls = 'w-full border rounded px-3 py-2';
    const labelCls = 'block text-sm font-medium mb-1';

    return (
        <main className="p-6 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-2">Legg inn aktivitet</h1>
            <p className="mb-2 text-gray-600">
                Arrangerer du noe for barn, ungdom eller familier? Legg det inn her, så blir det
                synlig i Togedoo etter en rask gjennomgang.
            </p>
            <p className="mb-6 text-sm">
                {sessionEmail ? (
                    <>
                        Innlogget som <strong>{sessionEmail}</strong> — innsendingen knyttes til{' '}
                        <Link href="/arranger/konto" className="text-blue-600 underline">
                            kontoen din
                        </Link>.
                    </>
                ) : (
                    <>
                        Arrangerer du ofte?{' '}
                        <Link href="/arranger/konto" className="text-blue-600 underline">
                            Logg inn med arrangørkonto
                        </Link>{' '}
                        for å samle og gjenbruke aktivitetene dine.
                    </>
                )}
            </p>

            <div className="border rounded p-4 mb-8 bg-gray-50">
                <label className={labelCls} htmlFor="parseUrl">
                    Har du en nettside for arrangementet? Lim inn lenken, så fyller vi ut det vi finner.
                </label>
                <div className="flex gap-2">
                    <input
                        id="parseUrl"
                        type="url"
                        className={inputCls}
                        placeholder="https://..."
                        value={parseUrl}
                        onChange={(e) => setParseUrl(e.target.value)}
                    />
                    <button
                        type="button"
                        onClick={handleParse}
                        disabled={parsing}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                    >
                        {parsing ? 'Henter…' : 'Hent fra lenke'}
                    </button>
                </div>
                {parseInfo && <p className="mt-2 text-sm text-gray-700">{parseInfo}</p>}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className={labelCls}>Tittel *</label>
                    <input
                        className={inputCls}
                        required
                        maxLength={200}
                        value={form.title}
                        onChange={(e) => set('title', e.target.value)}
                    />
                </div>
                <div>
                    <label className={labelCls}>Beskrivelse</label>
                    <textarea
                        className={inputCls}
                        rows={4}
                        maxLength={4000}
                        value={form.description}
                        onChange={(e) => set('description', e.target.value)}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Kategori</label>
                        <select
                            className={inputCls}
                            value={form.category}
                            onChange={(e) => set('category', e.target.value)}
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Målgruppe</label>
                        <select
                            className={inputCls}
                            value={form.targetAudience}
                            onChange={(e) => set('targetAudience', e.target.value)}
                        >
                            {TARGET_AUDIENCES.map((t) => (
                                <option key={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className={labelCls}>Dato *</label>
                        <input
                            type="date"
                            className={inputCls}
                            required
                            value={form.startsDate}
                            onChange={(e) => set('startsDate', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Klokkeslett start *</label>
                        <input
                            type="time"
                            className={inputCls}
                            required
                            value={form.startsTime}
                            onChange={(e) => set('startsTime', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Klokkeslett slutt</label>
                        <input
                            type="time"
                            className={inputCls}
                            value={form.endsTime}
                            onChange={(e) => set('endsTime', e.target.value)}
                        />
                    </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={multiDay}
                        onChange={(e) => setMultiDay(e.target.checked)}
                    />
                    Strekker seg over flere dager
                </label>
                {multiDay && (
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Sluttdato *</label>
                            <input
                                type="date"
                                className={inputCls}
                                required={multiDay}
                                value={form.endsDate}
                                onChange={(e) => set('endsDate', e.target.value)}
                            />
                            <p className="text-sm text-gray-500 mt-1">
                                Klokkeslett slutt gjelder sluttdatoen.
                            </p>
                        </div>
                    </div>
                )}

                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={recurring}
                        onChange={(e) => setRecurring(e.target.checked)}
                    />
                    Gjentakende aktivitet
                </label>
                {recurring && (
                    <div className="border rounded p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls}>Frekvens</label>
                                <select
                                    className={inputCls}
                                    value={frequency}
                                    onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                                >
                                    {(Object.keys(FREQUENCY_LABELS) as RecurrenceFrequency[]).map((f) => (
                                        <option key={f} value={f}>
                                            {FREQUENCY_LABELS[f]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelCls}>Avslutt etter</label>
                                <div className="flex gap-4 items-center h-10">
                                    <label className="flex items-center gap-1 text-sm">
                                        <input
                                            type="radio"
                                            name="recurrenceMethod"
                                            checked={recurrenceMethod === 'count'}
                                            onChange={() => setRecurrenceMethod('count')}
                                        />
                                        Antall ganger
                                    </label>
                                    <label className="flex items-center gap-1 text-sm">
                                        <input
                                            type="radio"
                                            name="recurrenceMethod"
                                            checked={recurrenceMethod === 'until'}
                                            onChange={() => setRecurrenceMethod('until')}
                                        />
                                        Til dato
                                    </label>
                                </div>
                            </div>
                        </div>
                        {recurrenceMethod === 'count' ? (
                            <div>
                                <label className={labelCls}>Antall ganger (2–{MAX_OCCURRENCES})</label>
                                <input
                                    type="number"
                                    min={2}
                                    max={MAX_OCCURRENCES}
                                    className={inputCls}
                                    value={recurrenceCount}
                                    onChange={(e) => setRecurrenceCount(e.target.value)}
                                />
                            </div>
                        ) : (
                            <div>
                                <label className={labelCls}>Til dato</label>
                                <input
                                    type="date"
                                    className={inputCls}
                                    value={recurrenceUntil}
                                    onChange={(e) => setRecurrenceUntil(e.target.value)}
                                />
                            </div>
                        )}
                        {(() => {
                            const summary = recurrenceSummary();
                            if (!summary) return null;
                            return (
                                <p className={`text-sm ${summary.isError ? 'text-red-600' : 'text-gray-700'}`}>
                                    {summary.text}
                                </p>
                            );
                        })()}
                    </div>
                )}
                <div>
                    <label className={labelCls}>Stedsnavn (f.eks. lokale eller bygg)</label>
                    <input
                        className={inputCls}
                        maxLength={200}
                        value={form.venueName}
                        onChange={(e) => set('venueName', e.target.value)}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Adresse</label>
                        <input
                            className={inputCls}
                            maxLength={300}
                            value={form.address}
                            onChange={(e) => set('address', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Kommune *</label>
                        <input
                            className={inputCls}
                            required
                            maxLength={100}
                            value={form.municipality}
                            onChange={(e) => set('municipality', e.target.value)}
                        />
                    </div>
                </div>
                <p className="text-sm text-gray-500 -mt-2">
                    Oppgi stedsnavn eller adresse, så vises aktiviteten på kartet.
                </p>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={form.isFree}
                            onChange={(e) => set('isFree', e.target.checked)}
                        />
                        Gratis
                    </label>
                    {!form.isFree && (
                        <input
                            className={inputCls}
                            placeholder="Pris, f.eks. 50 kr"
                            maxLength={200}
                            value={form.priceText}
                            onChange={(e) => set('priceText', e.target.value)}
                        />
                    )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Lenke til arrangementet</label>
                        <input
                            type="url"
                            className={inputCls}
                            value={form.url}
                            onChange={(e) => set('url', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Bilde-URL</label>
                        <input
                            type="url"
                            className={inputCls}
                            value={form.imageUrl}
                            onChange={(e) => set('imageUrl', e.target.value)}
                        />
                    </div>
                </div>
                <div>
                    <label className={labelCls}>Kontakt-e-post * (vises ikke offentlig)</label>
                    <input
                        type="email"
                        className={inputCls}
                        required
                        maxLength={200}
                        value={form.contactEmail}
                        onChange={(e) => set('contactEmail', e.target.value)}
                    />
                </div>

                {errors.length > 0 && (
                    <ul className="text-red-600 text-sm list-disc pl-5">
                        {errors.map((err) => (
                            <li key={err}>{err}</li>
                        ))}
                    </ul>
                )}

                <button
                    type="submit"
                    disabled={submitting}
                    className="bg-blue-600 text-white px-6 py-3 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {submitting ? 'Sender inn…' : 'Send inn aktivitet'}
                </button>
            </form>
        </main>
    );
}
