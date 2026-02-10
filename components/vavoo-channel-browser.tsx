'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Globe, Tv, Loader2, AlertCircle, Play, Search, ArrowLeft, Signal, Zap } from 'lucide-react'
import { Input } from '@/components/ui/input'
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

type StreamMode = 'standard' | 'auth' | 'cdn'

export default function VavooChannelBrowserUltra() {
  const [countries, setCountries] = useState<Country[]>([])
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [playError, setPlayError] = useState<string | null>(null)
  const [bufferHealth, setBufferHealth] = useState<number>(0)
  const [streamMode, setStreamMode] = useState<StreamMode>('cdn')
  const [currentQuality, setCurrentQuality] = useState<string>('auto')
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const bufferCheckInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadCountries()
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
      }
      if (bufferCheckInterval.current) {
        clearInterval(bufferCheckInterval.current)
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

  const playChannel = async (channel: Channel, mode: StreamMode = 'cdn') => {
    setSelectedChannel(channel)
    setPlayError(null)
    setBufferHealth(0)
    setStreamMode(mode)

    try {
      const encodedUrl = encodeURIComponent(channel.url)
      const proxyUrl = `/api/vavoo-stream-v2?url=${encodedUrl}&mode=${mode}`

      if (videoRef.current) {
        if (Hls.isSupported()) {
          if (hlsRef.current) {
            hlsRef.current.destroy()
          }

          const hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false,

            // Buffer ultra-optimisé
            maxBufferLength: 40,              // 40s buffer
            maxMaxBufferLength: 120,          // Max 120s
            maxBufferSize: 100 * 1000 * 1000, // 100 MB
            maxBufferHole: 0.3,
            backBufferLength: 120,

            // Loading très rapide
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 500,
            manifestLoadingMaxRetryTimeout: 10000,

            levelLoadingTimeOut: 10000,
            levelLoadingMaxRetry: 3,
            levelLoadingRetryDelay: 500,
            levelLoadingMaxRetryTimeout: 10000,

            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 500,
            fragLoadingMaxRetryTimeout: 60000,

            // Progressive et prefetch
            progressive: true,
            startFragPrefetch: true,

            // ABR optimisé
            startLevel: -1,
            capLevelToPlayerSize: true,
            abrEwmaDefaultEstimate: 1000000,  // Assume 1 Mbps initially
            abrBandWidthFactor: 0.90,
            abrBandWidthUpFactor: 0.60,
            abrMaxWithRealBitrate: false,

            // Parallélisation
            maxLoadingDelay: 2,

            xhrSetup: (xhr) => {
              xhr.timeout = 20000
              xhr.withCredentials = false
            },
          })

          hlsRef.current = hls

          // Manifest loaded
          hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            console.log(`[HLS] Manifest: ${data.levels.length} qualities`)
            data.levels.forEach((level, i) => {
              console.log(`  Level ${i}: ${level.width}x${level.height} @ ${(level.bitrate / 1000).toFixed(0)}kbps`)
            })
            
            videoRef.current?.play().catch((err) => {
              console.error('[Play] Error:', err)
              setPlayError('Cliquez sur ▶ pour démarrer')
            })
          })

          // Level switch
          hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            const level = hls.levels[data.level]
            const quality = level ? `${level.width}x${level.height}` : 'unknown'
            setCurrentQuality(quality)
            console.log(`[Quality] Switched to ${quality}`)
          })

          // Fragment loaded
          let loadCount = 0
          let totalLoadTime = 0
          hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            loadCount++
            totalLoadTime += data.stats.loading.end - data.stats.loading.start
            const avgLoadTime = totalLoadTime / loadCount

            console.log(
              `[Frag ${data.frag.sn}] ` +
              `${(data.stats.total / 1024).toFixed(1)}KB in ` +
              `${(data.stats.loading.end - data.stats.loading.start).toFixed(0)}ms ` +
              `(avg: ${avgLoadTime.toFixed(0)}ms)`
            )
          })

          // Errors avec récupération intelligente
          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('[HLS] Error:', {
              type: data.type,
              details: data.details,
              fatal: data.fatal,
            })

            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('[Recovery] Network error - retrying...')
                  setPlayError('Erreur réseau - reconnexion...')
                  setTimeout(() => {
                    hls.startLoad()
                    setPlayError(null)
                  }, 1000)
                  break

                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('[Recovery] Media error - recovering...')
                  setPlayError('Erreur média - récupération...')
                  hls.recoverMediaError()
                  setTimeout(() => setPlayError(null), 2000)
                  break

                default:
                  setPlayError(`Erreur fatale: ${data.details}`)
                  console.error('[Fatal]', data)
                  break
              }
            }
          })

          // Buffer monitoring
          if (bufferCheckInterval.current) {
            clearInterval(bufferCheckInterval.current)
          }

          bufferCheckInterval.current = setInterval(() => {
            if (videoRef.current && !videoRef.current.paused) {
              const buffered = videoRef.current.buffered
              if (buffered.length > 0) {
                const bufferEnd = buffered.end(buffered.length - 1)
                const currentTime = videoRef.current.currentTime
                const bufferAhead = bufferEnd - currentTime
                setBufferHealth(Math.min(100, (bufferAhead / 20) * 100))
              }
            }
          }, 500)

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
      'albania': 'al', 'arabia': 'sa', 'balkans': 'eu', 'bulgaria': 'bg',
      'france': 'fr', 'germany': 'de', 'italy': 'it', 'netherlands': 'nl',
      'poland': 'pl', 'portugal': 'pt', 'romania': 'ro', 'russia': 'ru',
      'spain': 'es', 'turkey': 'tr', 'united_kingdom': 'gb', 'uk': 'gb',
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
          {/* Video Player */}
          {selectedChannel && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Play className="w-5 h-5 text-blue-400 flex-shrink-0" />
                      <span className="truncate">{selectedChannel.name}</span>
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {selectedCountry?.name} • {currentQuality}
                    </CardDescription>
                  </div>
                  
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Buffer indicator */}
                    <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-1.5">
                      <Signal
                        className={`w-4 h-4 ${
                          bufferHealth > 70
                            ? 'text-green-400'
                            : bufferHealth > 30
                            ? 'text-yellow-400'
                            : 'text-red-400'
                        }`}
                      />
                      <span className="text-sm text-slate-300 font-mono">
                        {bufferHealth.toFixed(0)}%
                      </span>
                    </div>

                    {/* Mode indicator */}
                    <div className="bg-slate-800 rounded-lg px-3 py-1.5">
                      <span className="text-xs text-slate-400">
                        {streamMode === 'cdn' && <><Zap className="w-3 h-3 inline mr-1 text-green-400" />CDN Direct</>}
                        {streamMode === 'auth' && '🔐 Auth'}
                        {streamMode === 'standard' && '📡 Standard'}
                      </span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedChannel(null)
                        if (hlsRef.current) hlsRef.current.destroy()
                        if (bufferCheckInterval.current) clearInterval(bufferCheckInterval.current)
                      }}
                      className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Retour
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {playError && (
                  <Alert variant="destructive" className="bg-red-950/50 border-red-900">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{playError}</AlertDescription>
                  </Alert>
                )}

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

                {/* Mode selector */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => playChannel(selectedChannel, 'cdn')}
                    variant={streamMode === 'cdn' ? 'default' : 'outline'}
                    size="sm"
                    className={streamMode === 'cdn' ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    CDN Direct (Rapide)
                  </Button>
                  <Button
                    onClick={() => playChannel(selectedChannel, 'auth')}
                    variant={streamMode === 'auth' ? 'default' : 'outline'}
                    size="sm"
                  >
                    Proxy avec Auth
                  </Button>
                  <Button
                    onClick={() => playChannel(selectedChannel, 'standard')}
                    variant={streamMode === 'standard' ? 'default' : 'outline'}
                    size="sm"
                  >
                    Proxy Standard
                  </Button>
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
                          src={getCountryFlagUrl(country.code)}
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

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-2">
                  {filteredChannels.map((channel) => (
                    <Button
                      key={channel.id}
                      onClick={() => playChannel(channel, 'cdn')}
                      className="h-auto py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 transition-all justify-start"
                      variant="outline"
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                          {channel.logo ? (
                            <img
                              src={channel.logo}
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