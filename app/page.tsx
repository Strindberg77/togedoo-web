'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToGedooLogo } from '@/app/components/ToGedooLogo';

interface Activity {
  id: string;
  title: string;
  description: string;
  ageGroup: string;
  location: string;
  image: string;
  category: string;
  price: string;
  when: string;
  municipality: string;
}

const categoryEmoji: Record<string, string> = {
  'Musikk': '🎵',
  'Dans': '💃',
  'Sport': '⚽',
  'Kunst': '🎨',
  'Friluftsliv': '🏕️',
  'Drama': '🎭',
  'Film': '🎬',
  'Fotografi': '📷',
  'Bok': '📚',
  'Aktivitet': '🎯',
};

function getEmojiForCategory(category: string): string {
  return categoryEmoji[category] || '🎯';
}

export default function Home() {
  const [selectedCity, setSelectedCity] = useState('Oslo');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cities = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];

  useEffect(() => {
    fetchActivities();
  }, [selectedCity]);

  const fetchActivities = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/activities?municipality=${selectedCity}&limit=12`
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.data) {
        setActivities(data.data);
      } else {
        setError('No activities found');
        setActivities([]);
      }
    } catch (err) {
      console.error('Error fetching activities:', err);
      setError('Failed to load activities. Please try again.');
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Navigation */}
      <nav className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <ToGedooLogo />
            </div>
            <div className="text-sm text-slate-600">
              Aktiviteter for norske familier
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="bg-white border-b border-slate-200 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Oppdag morsomme og lærerike aktiviteter for barna dine
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              <span className="inline-block bg-red-100 text-red-800 px-4 py-2 rounded-full">
                ❤️ Spesielt designet for norske familier
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* City Selector */}
      <section className="bg-white border-b border-slate-200 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-700 font-medium">📍 Velg by:</span>
              <Select value={selectedCity} onValueChange={setSelectedCity}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Velg by" />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((city) => (
                    <SelectItem key={city} value={city}>
                      {city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={fetchActivities}
              disabled={loading}
              className="bg-slate-900 hover:bg-slate-800 text-white"
            >
              {loading ? 'Laster...' : 'Se Aktiviteter'}
            </Button>
          </div>
        </div>
      </section>

      {/* Activities Grid */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {error && (
            <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-lg text-slate-600">Laster aktiviteter...</div>
            </div>
          ) : activities.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activities.map((activity) => (
                <Card
                  key={activity.id}
                  className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group"
                >
                  {/* Image with Emoji */}
                  <div className="relative h-48 bg-gradient-to-br from-blue-100 to-slate-200 overflow-hidden flex items-center justify-center">
                    <div className="text-7xl">
                      {getEmojiForCategory(activity.category)}
                    </div>
                    <div className="absolute top-3 right-3 bg-white rounded-full px-3 py-1 text-sm font-medium text-slate-900 shadow-md">
                      {activity.price}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-bold text-slate-900 line-clamp-2 mb-2 capitalize">
                      {activity.title}
                    </h3>

                    <p className="text-sm text-slate-600 line-clamp-2 mb-3">
                      {activity.description}
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      <span className="inline-block bg-blue-100 text-blue-800 px-2.5 py-1 rounded text-xs font-medium">
                        {activity.ageGroup}
                      </span>
                      <span className="inline-block bg-slate-100 text-slate-700 px-2.5 py-1 rounded text-xs font-medium">
                        {activity.category}
                      </span>
                    </div>

                    {/* When */}
                    <div className="text-xs text-slate-500 flex items-center gap-1">
                      <span>⏰</span> {activity.when}
                    </div>

                    {/* Location */}
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                      <span>📍</span>
                      <span className="line-clamp-1">{activity.location}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="text-lg text-slate-600">
                Ingen aktiviteter funnet for {selectedCity}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12 mt-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p>© 2025 ToGeDoo - Aktiviteter for norske familier</p>
          </div>
        </div>
      </footer>
    </div>
  );
}