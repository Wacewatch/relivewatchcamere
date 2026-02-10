'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Play, Loader2, AlertCircle, CheckCircle2, Video } from 'lucide-react'
import Hls from 'hls.js'

export default function VavooProxyPlayer() {
  const [m3u8Url, setM3u8Url] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  const playStream = async () => {
    if (!m3u8Url.trim()) {
      setError('Veuillez entrer une URL m3u8')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // Encode the URL to pass through our proxy
      const encodedUrl = encodeURIComponent(m3u8Url)
      const proxyUrl = `/api/stream?url=${encodedUrl}`

      // Initialize HLS player
      if (videoRef.current) {
        if (Hls.isSupported()) {
          // Cleanup previous HLS instance
          if (hlsRef.current) {
            hlsRef.current.destroy()
          }

          const hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false,
            
            // Buffer réduit pour démarrage plus rapide
            maxBufferLength: 20,              // Seulement 20s de buffer
            maxMaxBufferLength: 600,
            maxBufferSize: 40 * 1000 * 1000,  // 40 MB
            maxBufferHole: 0.5,
            
            // Network - timeouts généreux
            manifestLoadingTimeOut: 30000,
            manifestLoadingMaxRetry: 6,
            manifestLoadingRetryDelay: 2000,
            
            levelLoadingTimeOut: 30000,
            levelLoadingMaxRetry: 6,
            levelLoadingRetryDelay: 2000,
            
            fragLoadingTimeOut: 60000,
            fragLoadingMaxRetry: 10,
            fragLoadingRetryDelay: 2000,
            fragLoadingMaxRetryTimeout: 64000,
            
            // Progressive loading - charge segment par segment
            progressive: true,
            
            // Quality - force la plus basse qualité disponible pour fluidité
            startLevel: 0,  // Force niveau le plus bas
            capLevelToPlayerSize: true,
            
            // UN SEUL segment à la fois pour éviter la congestion
            maxLoadingDelay: 1,
            
            xhrSetup: (xhr, url) => {
              xhr.timeout = 60000
            },
          })

          hlsRef.current = hls
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setSuccess(true)
            setLoading(false)
            
            // Start playback with preload
            videoRef.current?.play().catch(err => {
              console.error('Play error:', err)
              setError('Erreur de lecture - cliquez sur play pour démarrer')
            })
          })

          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS Error:', data.type, data.details, data.fatal)
            
            if (data.fatal) {
              setLoading(false)
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('Recovering from network error...')
                  setError('Erreur réseau - reconnexion...')
                  setTimeout(() => {
                    hls.startLoad()
                    setError(null)
                  }, 1000)
                  break
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('Recovering from media error...')
                  setError('Erreur média - récupération...')
                  hls.recoverMediaError()
                  setTimeout(() => setError(null), 2000)
                  break
                default:
                  setError(`Erreur fatale: ${data.details}`)
                  break
              }
            }
          })

          // Log buffer info for debugging
          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            if (videoRef.current) {
              const buffered = videoRef.current.buffered
              if (buffered.length > 0) {
                const bufferEnd = buffered.end(buffered.length - 1)
                const currentTime = videoRef.current.currentTime
                const bufferAhead = bufferEnd - currentTime
                console.log(`Buffer: ${bufferAhead.toFixed(1)}s ahead`)
              }
            }
          })

          hls.loadSource(proxyUrl)
          hls.attachMedia(videoRef.current)

        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS support (Safari)
          videoRef.current.src = proxyUrl
          
          videoRef.current.addEventListener('loadedmetadata', () => {
            setSuccess(true)
            setLoading(false)
          })
          
          videoRef.current.addEventListener('error', (e) => {
            setLoading(false)
            setError('Erreur de lecture du stream')
          })
          
          videoRef.current.play().catch(err => {
            setLoading(false)
            setError('Erreur de lecture - cliquez sur play')
          })
        } else {
          setLoading(false)
          setError('Votre navigateur ne supporte pas la lecture HLS')
        }
      }
    } catch (err) {
      setLoading(false)
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    }
  }

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="bg-blue-600/20 p-4 rounded-2xl border border-blue-500/30">
                <Video className="w-12 h-12 text-blue-400" />
              </div>
            </div>
            <h1 className="text-4xl font-bold text-white">
              Vavoo M3U8 Proxy Player
            </h1>
            <p className="text-slate-400 text-lg">
              Lecteur proxy optimisé pour les streams Vavoo avec support HLS avancé
            </p>
          </div>

          {/* Input Card */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-white">URL du Stream</CardTitle>
              <CardDescription className="text-slate-400">
                Collez votre lien m3u8 Vavoo ici
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="https://vavoo.to/play/2106748611/index.m3u8"
                  value={m3u8Url}
                  onChange={(e) => setM3u8Url(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && playStream()}
                  className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-blue-500"
                  disabled={loading}
                />
                <Button
                  onClick={playStream}
                  disabled={loading || !m3u8Url.trim()}
                  className="bg-blue-600 hover:bg-blue-700 min-w-[120px]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Chargement
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2 fill-current" />
                      Lire
                    </>
                  )}
                </Button>
              </div>

              {/* Status Messages */}
              {error && (
                <Alert variant="destructive" className="bg-red-950/50 border-red-900">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert className="bg-green-950/50 border-green-900">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  <AlertDescription className="text-green-400">
                    Stream chargé avec succès ! Lecture en cours...
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Video Player */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur overflow-hidden">
            <CardContent className="p-0">
              <div className="relative aspect-video bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full"
                  controls
                  playsInline
                  preload="metadata"
                >
                  Votre navigateur ne supporte pas la lecture vidéo.
                </video>
              </div>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-white text-lg">Caractéristiques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-slate-400">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <p>Proxy intelligent avec headers Vavoo optimisés</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <p>Support HLS.js avec retry automatique et récupération d'erreurs</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <p>Gestion des redirections et des URLs relatives</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <p>Support des requêtes Range pour le seeking vidéo</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <p>Streaming direct des segments sans buffer en mémoire</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
