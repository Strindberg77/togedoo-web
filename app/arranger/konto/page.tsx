'use client';
// Arrangørkonto: magic link-innlogging, profil (navn + varslingsvalg) og
// "mine aktiviteter" med status og dupliser-knapp. Dupliser legger forrige
// event i sessionStorage og sender arrangøren til skjemaet med feltene
// utfylt (uten dato — den nye datoen velges der).
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '../../../lib/supabaseBrowser';

interface Organizer {
    id: string;
    name: string;
    contact_email: string;
    verified: boolean;
    notify_on_submission: boolean;
}

interface MyActivity {
    id: string;
    title: string;
    description: string;
    category: string;
    target_audience: string;
    venue_name: string | null;
    address: string | null;
    municipality: string | null;
    starts_at: string | null;
    ends_at: string | null;
    is_free: boolean | null;
    price_text: string | null;
    url: string | null;
    image_url: string | null;
    status: string;
    created_at: string;
}

const STATUS_LABELS: Record<string, { text: string; cls: string }> = {
    pending: { text: 'Venter på gjennomgang', cls: 'bg-yellow-100 text-yellow-800' },
    published: { text: 'Publisert', cls: 'bg-green-100 text-green-800' },
    rejected: { text: 'Avvist', cls: 'bg-red-100 text-red-800' },
    expired: { text: 'Utløpt', cls: 'bg-gray-100 text-gray-600' },
};

export default function KontoPage() {
    const supabase = supabaseBrowser();
    const [loading, setLoading] = useState(true);
    const [token, setToken] = useState<string | null>(null);
    const [organizer, setOrganizer] = useState<Organizer | null>(null);
    const [emailConfigured, setEmailConfigured] = useState(false);
    const [activities, setActivities] = useState<MyActivity[]>([]);
    const [loginEmail, setLoginEmail] = useState('');
    const [loginSent, setLoginSent] = useState(false);
    const [name, setName] = useState('');
    const [notify, setNotify] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const loadAccount = useCallback(async (accessToken: string) => {
        const headers = { Authorization: `Bearer ${accessToken}` };
        const [meRes, actRes] = await Promise.all([
            fetch('/api/organizer/me', { headers }),
            fetch('/api/organizer/activities', { headers }),
        ]);
        const me = await meRes.json();
        const act = await actRes.json();
        if (me.success) {
            setOrganizer(me.organizer);
            setName(me.organizer.name);
            setNotify(me.organizer.notify_on_submission);
            setEmailConfigured(!!me.emailConfigured);
        }
        if (act.success) setActivities(act.data);
    }, []);

    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }
        supabase.auth.getSession().then(async ({ data }) => {
            const accessToken = data.session?.access_token ?? null;
            setToken(accessToken);
            if (accessToken) await loadAccount(accessToken);
            setLoading(false);
        });
        const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
            const accessToken = session?.access_token ?? null;
            setToken(accessToken);
            if (accessToken) await loadAccount(accessToken);
            else setOrganizer(null);
        });
        return () => sub.subscription.unsubscribe();
    }, [supabase, loadAccount]);

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (!supabase || !loginEmail.trim()) return;
        const { error } = await supabase.auth.signInWithOtp({
            email: loginEmail.trim(),
            options: { emailRedirectTo: window.location.href },
        });
        if (error) setMessage(`Innlogging feilet: ${error.message}`);
        else setLoginSent(true);
    }

    async function handleSaveProfile(e: React.FormEvent) {
        e.preventDefault();
        if (!token) return;
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch('/api/organizer/me', {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, notifyOnSubmission: notify }),
            });
            const data = await res.json();
            if (data.success) {
                setOrganizer(data.organizer);
                setMessage('Lagret.');
            } else {
                setMessage(data.error ?? 'Lagring feilet.');
            }
        } finally {
            setSaving(false);
        }
    }

    function handleDuplicate(activity: MyActivity) {
        sessionStorage.setItem(
            'togedoo-dupliser',
            JSON.stringify({
                title: activity.title,
                description: activity.description,
                category: activity.category,
                targetAudience: activity.target_audience,
                venueName: activity.venue_name ?? '',
                address: activity.address ?? '',
                municipality: activity.municipality ?? '',
                isFree: activity.is_free !== false,
                priceText: activity.price_text ?? '',
                url: activity.url ?? '',
                imageUrl: activity.image_url ?? '',
            })
        );
        window.location.href = '/arranger';
    }

    if (!supabase) {
        return (
            <main className="p-6 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold mb-4">Arrangørkonto</h1>
                <p>Kontofunksjonen er ikke aktivert ennå. Du kan fortsatt{' '}
                    <Link href="/arranger" className="text-blue-600 underline">
                        sende inn aktiviteter uten konto
                    </Link>.
                </p>
            </main>
        );
    }

    if (loading) {
        return (
            <main className="p-6 max-w-2xl mx-auto">
                <p>Laster…</p>
            </main>
        );
    }

    if (!token || !organizer) {
        return (
            <main className="p-6 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold mb-2">Logg inn som arrangør</h1>
                <p className="mb-6 text-gray-600">
                    Med konto samles aktivitetene dine på ett sted, og du kan gjenbruke tidligere
                    arrangementer med ett klikk. Vi sender deg en innloggingslenke på e-post —
                    ingen passord.
                </p>
                {loginSent ? (
                    <p className="border rounded p-4 bg-green-50">
                        Sjekk e-posten din! Vi har sendt en innloggingslenke til{' '}
                        <strong>{loginEmail}</strong>.
                    </p>
                ) : (
                    <form onSubmit={handleLogin} className="flex gap-2">
                        <input
                            type="email"
                            required
                            className="w-full border rounded px-3 py-2"
                            placeholder="din@epost.no"
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                        />
                        <button
                            type="submit"
                            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 whitespace-nowrap"
                        >
                            Send lenke
                        </button>
                    </form>
                )}
                {message && <p className="mt-3 text-red-600 text-sm">{message}</p>}
                <p className="mt-6 text-sm text-gray-500">
                    <Link href="/arranger" className="text-blue-600 underline">
                        Send inn uten konto
                    </Link>
                </p>
            </main>
        );
    }

    return (
        <main className="p-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">Arrangørkonto</h1>
                <button
                    className="text-sm text-gray-500 underline"
                    onClick={() => supabase.auth.signOut()}
                >
                    Logg ut
                </button>
            </div>

            <section className="border rounded p-4 mb-8">
                <p className="text-sm text-gray-600 mb-3">
                    Innlogget som <strong>{organizer.contact_email}</strong>
                    {organizer.verified && (
                        <span className="ml-2 inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-800">
                            Verifisert — innsendinger publiseres direkte
                        </span>
                    )}
                </p>
                <form onSubmit={handleSaveProfile} className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Arrangørnavn (vises som kilde)
                        </label>
                        <input
                            className="w-full border rounded px-3 py-2"
                            maxLength={200}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={notify}
                            onChange={(e) => setNotify(e.target.checked)}
                        />
                        Send meg bekreftelse på e-post ved innsending
                        {!emailConfigured && (
                            <span className="text-gray-400">(e-postutsending er ikke aktivert ennå)</span>
                        )}
                    </label>
                    <button
                        type="submit"
                        disabled={saving}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? 'Lagrer…' : 'Lagre'}
                    </button>
                    {message && <span className="ml-3 text-sm text-gray-600">{message}</span>}
                </form>
            </section>

            <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-semibold">Mine aktiviteter</h2>
                <Link
                    href="/arranger"
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
                >
                    Ny aktivitet
                </Link>
            </div>
            {activities.length === 0 ? (
                <p className="text-gray-600">
                    Ingen aktiviteter ennå.{' '}
                    <Link href="/arranger" className="text-blue-600 underline">
                        Legg inn den første
                    </Link>.
                </p>
            ) : (
                <ul className="space-y-3">
                    {activities.map((activity) => {
                        const status = STATUS_LABELS[activity.status] ?? {
                            text: activity.status,
                            cls: 'bg-gray-100 text-gray-600',
                        };
                        return (
                            <li key={activity.id} className="border rounded p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-medium">{activity.title}</p>
                                        <p className="text-sm text-gray-500">
                                            {activity.starts_at
                                                ? new Date(activity.starts_at).toLocaleString('nb-NO', {
                                                      dateStyle: 'medium',
                                                      timeStyle: 'short',
                                                  })
                                                : 'Uten dato'}
                                            {activity.municipality ? ` · ${activity.municipality}` : ''}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={`px-2 py-0.5 rounded text-xs ${status.cls}`}>
                                            {status.text}
                                        </span>
                                        <button
                                            className="text-sm text-blue-600 underline"
                                            onClick={() => handleDuplicate(activity)}
                                        >
                                            Dupliser
                                        </button>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </main>
    );
}
