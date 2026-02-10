'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Globe, Tv, Loader2, AlertCircle, Play, Search, ArrowLeft, CheckCircle2 } from 'lucide-react'
import Hls from 'hls.js'

interface Channel {
  id: string
  name: string
  logo?: string
  url: string
  country: string
}

interface Country {
  code: string
  name: string
  channels: Channel[]
}

export default function VavooChannelBrowser() {
  const [countries, setCountries] = useState<Country[]>([])
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [playError, setPlayError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  useEffect(() => {
    loadCountries()
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
      }
    }
  }, [])

  const loadCountries = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/vavoo/channels')
      
      if (!response.ok) {
        throw new Error('Failed to load channels')
      }
      
      const data = await response.json()
      setCountries(data.countries || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels')
    } finally {
      setLoading(false)
    }
  }

  const playChannel = async (channel: Channel, proxyMode: 'standard' | 'auth-simple' | 'direct-cdn' = 'standard') => {
    setSelectedChannel(channel)
    setPlayError(null)
    setPlaying(true)

    try {
      let proxyUrl: string

      if (proxyMode === 'direct-cdn') {
        // Use direct CDN resolver (resolves to real CDN URL)
        const response = await fetch('/api/vavoo/direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: channel.url })
        })

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.error || 'Failed to resolve direct CDN URL')
        }

        const data = await response.json()
        proxyUrl = data.proxyUrl
      } else if (proxyMode === 'auth-simple') {
        // Use auth-stream proxy (adds signature to standard proxy)
        const response = await fetch('/api/vavoo/auth-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: channel.url })
        })

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.error || 'Failed to get authenticated proxy')
        }

        const data = await response.json()
        proxyUrl = data.proxyUrl
      } else {
        // Use standard proxy method (simple /api/proxy)
        const response = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: channel.url })
        })

        if (!response.ok) {
          throw new Error('Failed to get proxy URL')
        }

        const data = await response.json()
        proxyUrl = data.proxyUrl
      }

      if (videoRef.current) {
        if (Hls.isSupported()) {
          if (hlsRef.current) {
            hlsRef.current.destroy()
          }

          const hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1000 * 1000,
            maxBufferHole: 0.5,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 4,
            levelLoadingTimeOut: 15000,
            levelLoadingMaxRetry: 4,
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 6,
            startFragPrefetch: true,
            progressive: true,
            xhrSetup: (xhr) => {
              xhr.setRequestHeader('User-Agent', 'VAVOO/2.6')
            }
          })

          hlsRef.current = hls

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current?.play().catch(() => {
              setPlayError('Cliquez sur play pour lancer la lecture')
            })
          })

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  setPlayError('Erreur réseau - reconnexion...')
                  setTimeout(() => {
                    hls.startLoad()
                    setPlayError(null)
                  }, 2000)
                  break
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError()
                  break
                default:
                  setPlayError(`Erreur: ${data.details}`)
                  break
              }
            }
          })

          hls.loadSource(proxyUrl)
          hls.attachMedia(videoRef.current)

        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = proxyUrl
          videoRef.current.play().catch(() => {
            setPlayError('Erreur de lecture')
          })
        }
      }
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Erreur de lecture')
    }
  }

  const getCountryFlagUrl = (countryCode: string): string => {
    const codeMap: Record<string, string> = {
      'albania': 'al',
      'arabia': 'sa',
      'balkans': 'eu',
      'bulgaria': 'bg',
      'france': 'fr',
      'germany': 'de',
      'italy': 'it',
      'netherlands': 'nl',
      'poland': 'pl',
      'portugal': 'pt',
      'romania': 'ro',
      'russia': 'ru',
      'spain': 'es',
      'turkey': 'tr',
      'united_kingdom': 'gb',
      'united kingdom': 'gb',
      'uk': 'gb',
    }
    const iso = codeMap[countryCode.toLowerCase()] || countryCode.toLowerCase()
    return `https://flagcdn.com/w80/${iso}.png`
  }

  const filteredChannels = selectedCountry
    ? selectedCountry.channels.filter(channel =>
        channel.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : []

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
          <p className="text-slate-400">Chargement des chaînes...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Video Player - Show when channel selected */}
          {selectedChannel && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Play className="w-5 h-5 text-blue-400" />
                      {selectedChannel.name}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {selectedCountry?.name}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedChannel(null)
                      if (hlsRef.current) {
                        hlsRef.current.destroy()
                      }
                    }}
                    className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Retour
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {playError && (
                  <Alert variant="destructive" className="bg-red-950/50 border-red-900">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{playError}</AlertDescription>
                  </Alert>
                )}
                
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => selectedChannel && playChannel(selectedChannel, 'standard')}
                    variant="outline"
                    size="sm"
                    className="bg-slate-800 border-slate-700 hover:bg-slate-700"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Proxy Standard
                  </Button>
                  <Button
                    onClick={() => selectedChannel && playChannel(selectedChannel, 'auth-simple')}
                    variant="outline"
                    size="sm"
                    className="bg-blue-900/50 border-blue-700 hover:bg-blue-800 text-blue-200"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Proxy avec Auth
                  </Button>
                  <Button
                    onClick={() => selectedChannel && playChannel(selectedChannel, 'direct-cdn')}
                    variant="outline"
                    size="sm"
                    className="bg-green-900/50 border-green-700 hover:bg-green-800 text-green-200"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    CDN Direct (Rapide)
                  </Button>
                </div>

                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    className="w-full h-full"
                    controls
                    playsInline
                    autoPlay
                    preload="auto"
                  >
                    Votre navigateur ne supporte pas la lecture vidéo.
                  </video>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Country Selection */}
          {!selectedCountry && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Globe className="w-5 h-5 text-blue-400" />
                  Sélectionnez un pays
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {countries.length} pays disponibles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {countries.map((country) => (
                    <Button
                      key={country.code}
                      onClick={() => setSelectedCountry(country)}
                      className="h-auto py-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 transition-all"
                      variant="outline"
                    >
                      <div className="flex flex-col items-center gap-2 w-full">
                        <img
                          src={getCountryFlagUrl(country.code) || "/placeholder.svg"}
                          alt={country.name}
                          className="w-10 h-7 object-cover rounded shadow-sm"
                          crossOrigin="anonymous"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                        <div className="text-center">
                          <div className="font-semibold text-white">{country.name}</div>
                          <div className="text-xs text-slate-400">
                            {country.channels.length} chaînes
                          </div>
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Channel List */}
          {selectedCountry && !selectedChannel && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Tv className="w-5 h-5 text-blue-400" />
                      {selectedCountry.name}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {filteredChannels.length} chaînes
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedCountry(null)
                      setSearchQuery('')
                    }}
                    className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Retour
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    type="text"
                    placeholder="Rechercher une chaîne..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-slate-950 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                {/* Channels Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-2">
                  {filteredChannels.map((channel) => (
                    <Button
                      key={channel.id}
                      onClick={() => playChannel(channel)}
                      className="h-auto py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 transition-all justify-start"
                      variant="outline"
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                          {channel.logo ? (
                            <img
                              src={channel.logo || "/placeholder.svg"}
                              alt={channel.name}
                              className="w-8 h-8 object-contain"
                            />
                          ) : (
                            <Tv className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <span className="font-medium text-white text-left truncate">
                          {channel.name}
                        </span>
                      </div>
                    </Button>
                  ))}
                </div>

                {filteredChannels.length === 0 && (
                  <div className="text-center py-12 text-slate-400">
                    Aucune chaîne trouvée
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
