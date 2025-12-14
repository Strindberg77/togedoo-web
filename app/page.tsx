'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export default function UngfritidPage() {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/activities')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setActivities(data.data);
        } else {
          setError('Kunne ikke hente aktiviteter.');
        }
      })
      .catch((err) => {
        console.error('Feil ved henting:', err);
        setError('Noe gikk galt.');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Ungfritid Aktiviteter</h1>

      {loading && <p>Laster aktiviteter...</p>}
      {error && <p className="text-red-500">{error}</p>}
      {!loading && !error && activities.length === 0 && <p>Ingen aktiviteter funnet.</p>}

      <ul className="space-y-4">
        {activities.map((activity, index) => (
          <li key={`${activity.id || activity.title}-${index}`}>
            {/*
              ENDRING HER:
              1. Bruker 'activity.url' (fra Ungfritids 'a.webpage').
              2. Setter 'target="_blank"' for å åpne i ny fane (anbefalt for eksterne lenker).
              3. Setter 'rel="noopener noreferrer"' for sikkerhet.
            */}
            <Link
              href={activity.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block" // Sikrer at lenken fyller hele li-elementet
            >
              <div className="border p-4 rounded shadow-sm bg-white hover:bg-gray-50 transition">
                <h2 className="text-lg font-semibold mb-1 text-blue-600">
                  {activity.title}
                </h2>
                <p><strong>Organisasjon:</strong> {activity.org || 'Ukjent'}</p>
                <p><strong>Kategori:</strong> {activity.appCategory || 'Aktivitet'}</p> {/* Viser mappet kategori! */}
                <p><strong>Målgruppe:</strong> {activity.targetAudience || 'Familie'}</p> {/* Viser mappet målgruppe! */}
                {/* Viser full adresse hvis den finnes, ellers viser vi kommunen alene */}
                {activity.address && <p><strong>Adresse:</strong> {activity.address}</p>}

                {/* Viser kommune. Hvis både adresse og kommune mangler, viser vi 'Ukjent sted' */}
                <p>
                  <strong>Sted:</strong> {activity.kommune || activity.address || 'Ukjent sted'}
                  {/* Bonus: Hvis du får postnummer, kan du legge det til her */}
                  {/* {activity.postcode && `, ${activity.postcode}`} */}
                </p>

                {activity.description && (
                  <p className="mt-2 text-sm text-gray-700">
                    {activity.description}
                  </p>
                )}

                {activity.days && activity.days.length > 0 && (
                  <p className="text-sm text-gray-600 mt-1">
                    <strong>Dager:</strong> {activity.days.join(', ')}
                  </p>
                )}

                {/* Bonus: Vis en pil for å indikere ekstern lenke */}
                <p className="text-sm text-blue-500 mt-2 hover:text-blue-700">
                  Se detaljer hos Ungfritid →
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}