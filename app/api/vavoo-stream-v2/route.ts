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
    locale: 'de',
    theme: 'dark',
    metadata: {
      device: {
        type: 'Handset',
        brand: 'google',
        model: 'Pixel',
        name: 'sdk_gphone64_arm64',
        uniqueId: 'd10e5d99ab665233',
      },
      os: {
        name: 'android',
        version: '13',
        abis: ['arm64-v8a', 'armeabi-v7a', 'armeabi'],
        host: 'android',
      },
      app: {
        platform: 'android',
        version: '3.1.21',
        buildId: '289515000',
        engine: 'hbc85',
        signatures: ['6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e'],
        installer: 'app.revanced.manager.flutter',
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
    adblockEnabled: true,
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
        'Accept-Encoding': 'gzip',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      console.log('[Auth] Ping failed:', response.status)
      return null
    }

    const data = await response.json()
    const sig = data?.addonSig

    if (sig) {
      cache.signature = {
        sig,
        exp: Date.now() + 3600000, // 1h
      }
      console.log('[Auth] Signature obtained successfully')
    } else {
      console.log('[Auth] No addonSig in response')
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
    console.log('[CDN] Using cached URL for:', vavooUrl.substring(0, 60))
    return cached.url
  }

  const payload = {
    language: 'de',
    region: 'AT',
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
        'Accept-Encoding': 'gzip',
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
      console.log('[CDN] Resolved to:', cdnUrl.substring(0, 80))
    } else {
      console.log('[CDN] No URL in resolve response:', JSON.stringify(result).substring(0, 200))
    }

    return cdnUrl
  } catch (error) {
    console.error('[CDN] Resolve error:', error)
    return null
  }
}

// Determine if a URL is a vavoo.to URL that needs resolution
function isVavooUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes('vavoo.to')
  } catch {
    return false
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
    const headers: Record<string, string> = {
      'User-Agent': 'VAVOO/2.6',
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'gzip, deflate',
    }

    const isVavoo = isVavooUrl(targetUrl)

    // Mode CDN Direct - Only resolve vavoo.to URLs, pass CDN URLs through directly
    if (mode === 'cdn') {
      if (isVavoo) {
        // This is a vavoo.to URL - resolve it to CDN
        const signature = await getVavooSignature()
        if (!signature) {
          console.error('[CDN] Failed to get signature for:', targetUrl.substring(0, 60))
          return NextResponse.json({ error: 'Auth failed' }, { status: 502 })
        }

        const cdnUrl = await resolveVavooUrl(targetUrl, signature)
        if (!cdnUrl) {
          console.error('[CDN] Failed to resolve:', targetUrl.substring(0, 60))
          return NextResponse.json({ error: 'CDN resolve failed' }, { status: 502 })
        }

        finalUrl = cdnUrl
        // CDN URLs don't need vavoo-specific headers
        delete headers['mediahubmx-signature']
      } else {
        // This is already a CDN URL (segment from resolved manifest) - fetch directly
        // Use generic headers for CDN
        headers['User-Agent'] = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      }
    }
    // Mode with Auth - Add signature to all vavoo.to requests
    else if (mode === 'auth') {
      if (isVavoo) {
        const signature = await getVavooSignature()
        if (signature) {
          headers['mediahubmx-signature'] = signature
        }
      }
    }
    // Standard mode - proxy with vavoo headers for vavoo.to URLs
    // For non-vavoo URLs, use generic headers
    else if (!isVavoo) {
      headers['User-Agent'] = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    }

    // Range support
    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    // Fetch with optimized timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 25000)

    console.log(`[Fetch] ${mode} | ${isVavoo ? 'vavoo' : 'cdn'} | ${finalUrl.substring(0, 80)}`)

    const response = await fetch(finalUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!response.ok && response.status !== 206) {
      console.error(`[Fetch] Error ${response.status} for: ${finalUrl.substring(0, 80)}`)
      // For segments, try without custom headers as fallback
      if (!finalUrl.includes('.m3u8') && response.status === 403) {
        console.log('[Fetch] Retrying with minimal headers...')
        const retryResponse = await fetch(finalUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Accept': '*/*',
          },
          redirect: 'follow',
        })
        if (retryResponse.ok || retryResponse.status === 206) {
          const ct = retryResponse.headers.get('content-type') || 'video/MP2T'
          return new NextResponse(retryResponse.body, {
            status: retryResponse.status,
            headers: {
              'Content-Type': ct,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        }
      }
      return NextResponse.json(
        { error: `Fetch error: ${response.status}` },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('content-type') || ''

    // M3U8 manifest processing
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8') ||
      finalUrl.includes('.m3u8') ||
      targetUrl.includes('.m3u8')
    ) {
      const text = await response.text()
      console.log(`[M3U8] Processing manifest (${text.length} bytes), mode=${mode}`)

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

        // In CDN mode: if the resolved manifest points to CDN segments,
        // still proxy them but they won't need resolution since they're not vavoo.to URLs
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
          'Cache-Control': 'no-cache, no-store',
        },
      })
    }

    // Streaming segments
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType || 'video/MP2T',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
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
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Stream] Timeout')
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 })
    }
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
