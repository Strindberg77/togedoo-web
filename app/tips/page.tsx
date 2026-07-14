'use client';
// Brukertips om faste steder (lekeplass, ballbane, park osv.) som mangler
// i Togedoo. Gjenbruker arrangørskjemaets mønster, uten tid/dato-felt —
// steder er permanente. Innsendinger modereres før de blir synlige.
import React, { useState } from 'react';
import Link from 'next/link';

const CATEGORIES = ['Lekeplass', 'Ballbane', 'Park', 'Idrettshall', 'Badeplass', 'Museum', 'Annet'];

interface FormState {
    title: string;
    category: string;
    description: string;
    address: string;
    municipality: string;
    imageUrl: string;
    contactEmail: string;
}

const EMPTY_FORM: FormState = {
    title: '',
    category: 'Lekeplass',
    description: '',
    address: '',
    municipality: '',
    imageUrl: '',
    contactEmail: '',
};

export default function TipsPage() {
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [submitted, setSubmitted] = useState(false);

    const set = (field: keyof FormState, value: string) =>
        setForm((f) => ({ ...f, [field]: value }));

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        setErrors([]);
        try {
            const res = await fetch('/api/places/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    address: form.address || null,
                    imageUrl: form.imageUrl || null,
                }),
            });
            const data = await res.json();
            if (data.success) setSubmitted(true);
            else setErrors(data.errors ?? [data.error ?? 'Innsendingen feilet.']);
        } catch {
            setErrors(['Noe gikk galt. Prøv igjen.']);
        } finally {
            setSubmitting(false);
        }
    }

    const inputCls = 'w-full border rounded px-3 py-2';
    const labelCls = 'block text-sm font-medium mb-1';

    if (submitted) {
        return (
            <main className="p-6 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold mb-4">Takk for tipset!</h1>
                <p className="mb-4">
                    Stedet blir synlig i Togedoo etter en rask gjennomgang. Vi kontakter deg på
                    e-post hvis noe må avklares.
                </p>
                <button
                    className="bg-family-blue text-white px-4 py-2 rounded hover:bg-family-blue-light"
                    onClick={() => {
                        setForm(EMPTY_FORM);
                        setSubmitted(false);
                    }}
                >
                    Tips om et sted til
                </button>
            </main>
        );
    }

    return (
        <main className="p-6 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-2">Tips oss om et sted</h1>
            <p className="mb-6 text-gray-600">
                Vet du om en lekeplass, ballbane, park eller badeplass som mangler i Togedoo?
                Tips oss her, så legger vi den inn. Gjelder det et arrangement, bruk heller{' '}
                <Link href="/arranger" className="text-family-blue underline">
                    arrangørskjemaet
                </Link>.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className={labelCls}>Navn på stedet *</label>
                    <input
                        className={inputCls}
                        required
                        maxLength={200}
                        placeholder="F.eks. Lekeplassen ved Storgata"
                        value={form.title}
                        onChange={(e) => set('title', e.target.value)}
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
                <div>
                    <label className={labelCls}>Adresse eller stedsbeskrivelse</label>
                    <input
                        className={inputCls}
                        maxLength={300}
                        placeholder="Gateadresse, eller f.eks. «bak Vollen skole»"
                        value={form.address}
                        onChange={(e) => set('address', e.target.value)}
                    />
                    <p className="text-sm text-gray-500 mt-1">
                        Jo mer presist, jo bedre treffer stedet på kartet.
                    </p>
                </div>
                <div>
                    <label className={labelCls}>Beskrivelse</label>
                    <textarea
                        className={inputCls}
                        rows={3}
                        maxLength={2000}
                        placeholder="Hva finnes der? Passer det for små barn?"
                        value={form.description}
                        onChange={(e) => set('description', e.target.value)}
                    />
                </div>
                <div>
                    <label className={labelCls}>Bilde-URL (valgfritt)</label>
                    <input
                        type="url"
                        className={inputCls}
                        value={form.imageUrl}
                        onChange={(e) => set('imageUrl', e.target.value)}
                    />
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
                    <ul className="text-alert-red text-sm list-disc pl-5">
                        {errors.map((err) => (
                            <li key={err}>{err}</li>
                        ))}
                    </ul>
                )}

                <button
                    type="submit"
                    disabled={submitting}
                    className="bg-family-blue text-white px-6 py-3 rounded hover:bg-family-blue-light disabled:opacity-50"
                >
                    {submitting ? 'Sender inn…' : 'Send inn tips'}
                </button>
            </form>
        </main>
    );
}
