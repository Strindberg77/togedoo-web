'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { MapPin, Users, Heart, ChevronRight } from 'lucide-react'
import { ToGedooLogo } from '@/app/components/ToGedooLogo'

interface Activity {
  id: number
  title: string
  age: string
  image: string
  description: string
  category?: string
}

const CITIES = [
  { value: 'oslo', label: 'Oslo', emoji: '🏔️' },
  { value: 'bergen', label: 'Bergen', emoji: '🏔️' },
  { value: 'trondheim', label: 'Trondheim', emoji: '🏘️' },
  { value: 'stavanger', label: 'Stavanger', emoji: '🏖️' },
]

export default function Home() {
  const [selectedCity, setSelectedCity] = useState('oslo')
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchActivities('oslo')
  }, [])

  const fetchActivities = async (city: string) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/activities?city=${city}`)
      if (!response.ok) throw new Error('Failed to fetch activities')
      const data = await response.json()
      setActivities(data)
      setSelectedCity(city)
    } catch (err) {
      setError('Kunne ikke laste aktiviteter. Prøv igjen.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const currentCity = CITIES.find(c => c.value === selectedCity)

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Navigation Bar */}
      <nav className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <ToGedooLogo />
          <p className="text-sm text-slate-600 dark:text-slate-400">Aktiviteter for hele familien</p>
        </div>
      </nav>
      
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="mb-8">
          <h2 className="text-5xl md:text-6xl font-bold mb-4 text-slate-900 dark:text-white">
            Finn Aktiviteter
          </h2>
          <p className="text-xl text-slate-600 dark:text-slate-300 mb-6">
            Oppdag morsomme og lærerike aktiviteter for barna dine
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900/30 rounded-full">
            <Heart className="w-5 h-5 text-red-500" />
            <span className="text-sm font-medium text-blue-900 dark:text-blue-300">
              Spesielt designet for norske familier
            </span>
          </div>
        </div>

        {/* City Selector */}
        <div className="flex flex-col md:flex-row justify-center gap-4 items-center mb-12">
          <Select value={selectedCity} onValueChange={fetchActivities}>
            <SelectTrigger className="w-full md:w-[250px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CITIES.map(city => (
                <SelectItem key={city.value} value={city.value}>
                  <span className="flex items-center gap-2">
                    {city.emoji} {city.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="lg"
            onClick={() => fetchActivities(selectedCity)}
            disabled={loading}
            className="w-full md:w-auto"
          >
            {loading ? 'Laster...' : 'Se Aktiviteter'}
          </Button>
        </div>

        {/* Active City Display */}
        {currentCity && (
          <Badge variant="secondary" className="gap-2 mb-8">
            <MapPin className="w-4 h-4" />
            {currentCity.label}
          </Badge>
        )}
      </section>

      {/* Error State */}
      {error && (
        <div className="container mx-auto px-4 mb-8">
          <Card className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
            <CardContent className="pt-6">
              <p className="text-red-800 dark:text-red-300">{error}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Activities Grid */}
      <section className="container mx-auto px-4 pb-20">
        {activities.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activities.map(activity => (
              <Card
                key={activity.id}
                className="overflow-hidden hover:shadow-lg transition-all duration-300 hover:scale-105 cursor-pointer group"
              >
                <CardHeader className="pb-3">
                  <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">
                    {activity.image}
                  </div>
                  <CardTitle className="text-lg group-hover:text-blue-600 transition-colors">
                    {activity.title}
                  </CardTitle>
                  {activity.category && (
                    <Badge variant="outline" className="w-fit mt-2">
                      {activity.category}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Alder:
                    </p>
                    <Badge variant="secondary">{activity.age}</Badge>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {activity.description}
                  </p>
                  <Button
                    variant="ghost"
                    className="w-full gap-2 group/btn"
                  >
                    Les mer
                    <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !loading && activities.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Users className="w-12 h-12 mx-auto mb-4 text-slate-400" />
              <p className="text-slate-600 dark:text-slate-400">
                Ingen aktiviteter funnet. Velg en by og prøv igjen.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
        <div className="container mx-auto px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
          <p>© 2025 ToGeDoo - Aktiviteter for norske familier</p>
        </div>
      </footer>
    </main>
  )
}