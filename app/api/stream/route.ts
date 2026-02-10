import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

// Cache pour stocker les signatures Vavoo
let cachedSignature: { sig: string; timestamp: number } | null = null
const SIGNATURE_CACHE_DURATION = 3600000 // 1 heure

async function getVavooSignature(): Promise<string | null> {
  // Vérifier le cache
  if (cachedSignature && Date.now() - cachedSignature.timestamp < SIGNATURE_CACHE_DURATION) {
    return cachedSignature.sig
  }

  const currentTime = Date.now()
  const payload = {
    token: '',
    reason: 'app-blur',
    locale: 'de',
    theme: 'dark',
    metadata: {
      device: {
        type: 'Handset',
        brand: 'google',
        model: 'Pixel',
        name: 'sdk_gphone64_arm64',
        uniqueId: 'd10e5d99ab665233'
      },
      os: {
        name: 'android',
        version: '13',
        abis: ['arm64-v8a', 'armeabi-v7a', 'armeabi'],
        host: 'android'
      },
      app: {
        platform: 'android',
        version: '3.1.21',
        buildId: '289515000',
        engine: 'hbc85',
        signatures: ['6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e'],
        installer: 'app.revanced.manager.flutter'
      },
      version: {
        package: 'tv.vavoo.app',
        binary: '3.1.21',
        js: '3.1.21'
      }
    },
    appFocusTime: 0,
    playerActive: false,
    playDuration: 0,
    devMode: false,
    hasAddon: true,
    castConnected: false,
    package: 'tv.vavoo.app',
    version: '3.1.21',
    process: 'app',
    firstAppStart: currentTime,
    lastAppStart: currentTime,
    ipLocation: '',
    adblockEnabled: true,
    proxy: {
      supported: ['ss', 'openvpn'],
      engine: 'ss',
      ssVersion: 1,
      enabled: true,
      autoServer: true,
      id: 'de-fra'
    },
    iap: {
      supported: false
    }
  }

  try {
    const response = await fetch('https://www.vavoo.tv/api/app/ping', {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.11.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'Accept-Encoding': 'gzip'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      console.error('[Vavoo Auth] Failed to get signature:', response.status)
      return null
    }

    const data = await response.json()
    const signature = data?.addonSig || null

    if (signature) {
      cachedSignature = { sig: signature, timestamp: Date.now() }
      console.log('[Vavoo Auth] Signature obtained and cached')
    }

    return signature
  } catch (error) {
    console.error('[Vavoo Auth] Error:', error)
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url')
    if (!url) {
      return NextResponse.json({ error: 'URL required' }, { status: 400 })
    }

    const targetUrl = decodeURIComponent(url)
    
    // Validation URL
    try {
      new URL(targetUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Obtenir la signature Vavoo
    const signature = await getVavooSignature()

    // Headers optimisés pour Vavoo
    const headers: Record<string, string> = {
      'User-Agent': 'VAVOO/2.6',
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'gzip, deflate',
    }

    // Ajouter la signature si disponible
    if (signature) {
      headers['mediahubmx-signature'] = signature
    }

    // Gérer les requêtes Range pour le seeking
    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    // Fetch avec timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    // Gestion des erreurs
    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: `Stream error: ${response.status}` },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('content-type') || ''

    // Traitement des playlists M3U8
    if (contentType.includes('mpegurl') || 
        contentType.includes('m3u8') || 
        targetUrl.includes('.m3u8')) {
      
      const text = await response.text()
      const baseUrl = new URL(targetUrl)
      const pathParts = baseUrl.pathname.split('/')
      pathParts.pop()
      const basePath = pathParts.join('/') + '/'
      
      const lines = text.split('\n')
      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim()
        
        if (trimmed.startsWith('#') || trimmed === '') {
          return line
        }

        let absoluteUrl: string
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          absoluteUrl = trimmed
        } else if (trimmed.startsWith('/')) {
          absoluteUrl = `${baseUrl.origin}${trimmed}`
        } else {
          absoluteUrl = `${baseUrl.origin}${basePath}${trimmed}`
        }

        const encodedUrl = encodeURIComponent(absoluteUrl)
        return `${request.nextUrl.origin}/api/vavoo-stream-v2?url=${encodedUrl}&mode=standard`
      })

      return new NextResponse(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
          'Cache-Control': 'public, max-age=10',
        },
      })
    }

    // Streaming des segments vidéo
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType || 'video/MP2T',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400', // Cache 24h pour segments
    }

    const contentLength = response.headers.get('content-length')
    const contentRange = response.headers.get('content-range')
    const acceptRanges = response.headers.get('accept-ranges')
    
    if (contentLength) responseHeaders['Content-Length'] = contentLength
    if (contentRange) responseHeaders['Content-Range'] = contentRange
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    })

  } catch (error) {
    console.error('[Vavoo Stream] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Stream error' },
      { status: 500 }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
    },
  })
}
