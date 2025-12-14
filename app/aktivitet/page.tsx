// app/aktivitet/[id]/page.tsx
import { notFound } from 'next/navigation';

export default async function ActivityDetails({ params }: { params: { id: string } }) {
    const res = await fetch(`https://ungfritid.no/api/activity?id=${params.id}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store', // alltid friskt data
    });

    if (!res.ok) return notFound();

    const data = await res.json();
    const activity = data?.data?.activity;

    if (!activity) return notFound();

    return (
        <main className="p-6 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">{activity.name}</h1>
            <p className="mb-2">{activity.shortDescription || 'Ingen beskrivelse.'}</p>

            <div className="space-y-1 text-sm">
                <div><strong>Organisasjon:</strong> {activity.organization?.name || 'Ukjent'}</div>
                <div><strong>Adresse:</strong> {activity.place?.formattedAddress || 'Ukjent'}</div>
                <div><strong>Kommune:</strong> {activity.organization?.municipality || 'Ukjent'}</div>
                <div><strong>Kontaktperson:</strong> {activity.contactPerson || 'Ukjent'}</div>
                <div><strong>E-post:</strong> {activity.email || 'Ukjent'}</div>
                <div><strong>Telefon:</strong> {activity.phone || 'Ukjent'}</div>
                {activity.webpage && (
                    <div>
                        <a
                            href={activity.webpage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline"
                        >
                            Besøk nettside
                        </a>
                    </div>
                )}
            </div>
        </main>
    );
}
