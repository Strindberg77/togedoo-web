'use client';

import { useEffect, useState } from 'react';

interface Activity {
  id: number;
  title: string;
  age: string;
  image: string;
  description: string;
}

interface CityData {
  city: string;
  activities: Activity[];
}

export default function Home() {
  const [city, setCity] = useState('oslo');
  const [data, setData] = useState<CityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivities(city);
  }, [city]);

  const fetchActivities = async (selectedCity: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/activities?city=${selectedCity}`);
      const json = await response.json();
      setData(json);
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="bg-white shadow">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">ToGeDoo</h1>
          <button className="bg-blue-600 text-white px-4 py-2 rounded-full">Log In</button>
        </nav>
      </header>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h2 className="text-5xl font-bold text-gray-900 mb-4">
            Connect, Share, and <span className="text-blue-600">Grow Together</span>
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            Familieaktiviteter i Norge - velg din by
          </p>
        </div>

        <div className="flex gap-4 justify-center mb-12">
          <button
            onClick={() => setCity('oslo')}
            className={`px-6 py-3 rounded-full font-semibold transition ${city === 'oslo'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-blue-600 border-2 border-blue-600'
              }`}
          >
            Oslo
          </button>
          <button
            onClick={() => setCity('bergen')}
            className={`px-6 py-3 rounded-full font-semibold transition ${city === 'bergen'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-blue-600 border-2 border-blue-600'
              }`}
          >
            Bergen
          </button>
        </div>

        {loading ? (
          <div className="text-center text-gray-600">Laster aktiviteter...</div>
        ) : data ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {data.activities.map((activity) => (
              <div
                key={activity.id}
                className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition"
              >
                <div className="text-5xl mb-4">{activity.image}</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {activity.title}
                </h3>
                <p className="text-sm text-blue-600 mb-2">Alder: {activity.age}</p>
                <p className="text-gray-600">{activity.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-red-600">Feil ved lasting av data</div>
        )}
      </section>
    </main >
  );
}