import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

// Cache global pour les signatures et résolutions
const cache = {
  signature: null as { sig: string; exp: number } | null,
  cdnUrls: new Map<string, { url: string; exp: number }>(),
}

// Nettoyer le cache expiré
function cleanExpiredCache() {
  const now = Date.now()
  if (cache.signature && cache.signature.exp < now) {
    cache.signature = null
  }
  for (const [key, value] of cache.cdnUrls.entries()) {
    if (value.exp < now) {
      cache.cdnUrls.delete(key)
    }
  }
}

// Obtenir la signature Vavoo
async function getVavooSignature(): Promise<string | null> {
  cleanExpiredCache()
  
  if (cache.signature && cache.signature.exp > Date.now()) {
    return cache.signature.sig
  }

  const payload = {
    token: '',
    reason: 'app-start',
    locale: 'en',
    theme: 'dark',
    metadata: {
      device: {
        type: 'Handset',
        brand: 'google',
        model: 'Pixel 7',
        name: 'google_pixel_7',
        uniqueId: crypto.randomUUID().replace(/-/g, '').substring(0, 16),
      },
      os: {
        name: 'android',
        version: '14',
        abis: ['arm64-v8a'],
        host: 'android',
      },
      app: {
        platform: 'android',
        version: '3.1.21',
        buildId: '289515000',
        engine: 'hbc85',
        signatures: ['6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e'],
        installer: 'com.android.vending',
      },
      version: {
        package: 'tv.vavoo.app',
        binary: '3.1.21',
        js: '3.1.21',
      },
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
    firstAppStart: Date.now(),
    lastAppStart: Date.now(),
    ipLocation: '',
    adblockEnabled: false,
    proxy: {
      supported: ['ss', 'openvpn'],
      engine: 'ss',
      ssVersion: 1,
      enabled: true,
      autoServer: true,
      id: 'de-fra',
    },
    iap: { supported: false },
  }

  try {
    const response = await fetch('https://www.vavoo.tv/api/app/ping', {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.11.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) return null

    const data = await response.json()
    const sig = data?.addonSig

    if (sig) {
      cache.signature = {
        sig,
        exp: Date.now() + 3600000, // 1h
      }
      console.log('[Auth] Signature obtained')
    }

    return sig
  } catch (error) {
    console.error('[Auth] Error:', error)
    return null
  }
}

// Résoudre l'URL Vavoo vers CDN direct
async function resolveVavooUrl(vavooUrl: string, signature: string): Promise<string | null> {
  cleanExpiredCache()
  
  const cached = cache.cdnUrls.get(vavooUrl)
  if (cached && cached.exp > Date.now()) {
    return cached.url
  }

  const payload = {
    language: 'en',
    region: 'US',
    url: vavooUrl,
    clientVersion: '3.1.21',
  }

  try {
    const response = await fetch('https://vavoo.to/mediahubmx-resolve.json', {
      method: 'POST',
      headers: {
        'User-Agent': 'MediaHubMX/2',
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'mediahubmx-signature': signature,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      console.error('[CDN] Resolve failed:', response.status)
      return null
    }

    const result = await response.json()
    let cdnUrl: string | null = null

    if (Array.isArray(result) && result.length > 0 && result[0].url) {
      cdnUrl = result[0].url
    } else if (result && typeof result === 'object' && result.url) {
      cdnUrl = result.url
    }

    if (cdnUrl) {
      cache.cdnUrls.set(vavooUrl, {
        url: cdnUrl,
        exp: Date.now() + 1800000, // 30min
      })
      console.log('[CDN] Resolved:', cdnUrl.substring(0, 50) + '...')
    }

    return cdnUrl
  } catch (error) {
    console.error('[CDN] Resolve error:', error)
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url')
    const mode = request.nextUrl.searchParams.get('mode') || 'standard'

    if (!url) {
      return NextResponse.json({ error: 'URL required' }, { status: 400 })
    }

    const targetUrl = decodeURIComponent(url)

    // Validation
    try {
      new URL(targetUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    let finalUrl = targetUrl
    const headers: HeadersInit = {
      'User-Agent': 'VAVOO/2.6',
      'Accept': '*/*',
      'Connection': 'keep-alive',
    }

    // Mode CDN Direct - Résolution complète vers CDN
    if (mode === 'cdn' && targetUrl.includes('vavoo.to')) {
      const signature = await getVavooSignature()
      if (!signature) {
        return NextResponse.json({ error: 'Auth failed' }, { status: 502 })
      }

      const cdnUrl = await resolveVavooUrl(targetUrl, signature)
      if (!cdnUrl) {
        return NextResponse.json({ error: 'CDN resolve failed' }, { status: 502 })
      }

      finalUrl = cdnUrl
      // Pour CDN, pas besoin de signature
      delete headers['mediahubmx-signature']
    }
    // Mode avec Auth - Ajouter signature
    else if (mode === 'auth') {
      const signature = await getVavooSignature()
      if (signature) {
        headers['mediahubmx-signature'] = signature
      }
    }

    // Range support
    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    // Fetch avec timeout optimisé
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20000)

    const response = await fetch(finalUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!response.ok && response.status !== 206) {
      console.error('[Fetch] Error:', response.status, finalUrl)
      return NextResponse.json(
        { error: `Fetch error: ${response.status}` },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('content-type') || ''

    // Traitement M3U8
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8') ||
      targetUrl.includes('.m3u8')
    ) {
      const text = await response.text()
      const baseUrl = new URL(finalUrl)
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
        // Propager le mode CDN pour les segments
        const segmentMode = mode === 'cdn' ? '&mode=cdn' : mode === 'auth' ? '&mode=auth' : ''
        return `${request.nextUrl.origin}/api/vavoo-stream-v2?url=${encodedUrl}${segmentMode}`
      })

      return new NextResponse(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
          'Cache-Control': 'no-cache',
        },
      })
    }

    // Streaming segments avec cache agressif
    const responseHeaders: HeadersInit = {
      'Content-Type': contentType || 'video/MP2T',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable', // Cache 1 an
    }

    const contentLength = response.headers.get('content-length')
    const contentRange = response.headers.get('content-range')

    if (contentLength) responseHeaders['Content-Length'] = contentLength
    if (contentRange) responseHeaders['Content-Range'] = contentRange

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('[Stream] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Stream error' },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
    },
  })
}