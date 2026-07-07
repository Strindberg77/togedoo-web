'use client';
// Arrangørskjemaet (oppgave 2.9). Lim inn en lenke øverst for å
// forhåndsutfylle feltene, eller fyll inn manuelt. Innsendinger modereres
// før de blir synlige i appen.
import React, { useState } from 'react';

const CATEGORIES = ['Kultur', 'Læring', 'Kreativt', 'Aktivitet'];
const TARGET_AUDIENCES = ['Barn', 'Ungdom', 'Familie', 'For alle'];

interface FormState {
    title: string;
    description: string;
    category: string;
    targetAudience: string;
    venueName: string;
    address: string;
    municipality: string;
    startsAt: string;
    endsAt: string;
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
    startsAt: '',
    endsAt: '',
    isFree: true,
    priceText: '',
    url: '',
    imageUrl: '',
    contactEmail: '',
};

/** ISO-tidsstempel -> verdi for <input type="datetime-local"> (lokal tid). */
function toLocalInputValue(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ArrangorPage() {
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [parseUrl, setParseUrl] = useState('');
    const [parsing, setParsing] = useState(false);
    const [parseInfo, setParseInfo] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [submitted, setSubmitted] = useState(false);

    const set = (field: keyof FormState, value: string | boolean) =>
        setForm((f) => ({ ...f, [field]: value }));

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
            setForm((prev) => ({
                ...prev,
                title: f.title ?? prev.title,
                description: f.description ?? prev.description,
                venueName: f.venueName ?? prev.venueName,
                address: f.address ?? prev.address,
                municipality: f.municipality ?? prev.municipality,
                startsAt: toLocalInputValue(f.startsAt) || prev.startsAt,
                endsAt: toLocalInputValue(f.endsAt) || prev.endsAt,
                isFree: f.isFree ?? prev.isFree,
                priceText: f.priceText ?? prev.priceText,
                url: f.url ?? prev.url,
                imageUrl: f.imageUrl ?? prev.imageUrl,
            }));
            setParseInfo(
                data.parser === 'jsonld'
                    ? 'Fant strukturert eventdata — sjekk feltene under og juster om noe mangler.'
                    : data.parser === 'opengraph'
                      ? 'Fant tittel og beskrivelse — fyll inn tid og sted manuelt.'
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
        setSubmitting(true);
        setErrors([]);
        try {
            const res = await fetch('/api/organizer/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : '',
                    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
                    venueName: form.venueName || null,
                    address: form.address || null,
                    priceText: form.priceText || null,
                    url: form.url || null,
                    imageUrl: form.imageUrl || null,
                }),
            });
            const data = await res.json();
            if (data.success) {
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
                    Aktiviteten er mottatt og blir synlig i Togedoo etter en rask gjennomgang. Vi
                    kontakter deg på e-post hvis noe må avklares.
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
            <p className="mb-6 text-gray-600">
                Arrangerer du noe for barn, ungdom eller familier? Legg det inn her, så blir det
                synlig i Togedoo etter en rask gjennomgang.
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
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Starter *</label>
                        <input
                            type="datetime-local"
                            className={inputCls}
                            required
                            value={form.startsAt}
                            onChange={(e) => set('startsAt', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>Slutter</label>
                        <input
                            type="datetime-local"
                            className={inputCls}
                            value={form.endsAt}
                            onChange={(e) => set('endsAt', e.target.value)}
                        />
                    </div>
                </div>
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
