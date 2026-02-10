import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

// Cache pour stocker les signatures Vavoo
let cachedSignature: { sig: string; timestamp: number } | null = null
const SIGNATURE_CACHE_DURATION = 3600000 // 1 heure

// Cache pour CDN resolved URLs
const cdnCache = new Map<string, { url: string; exp: number }>()

async function getVavooSignature(): Promise<string | null> {
  // Verifier le cache
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
      console.error('[Vavoo Auth] Ping failed:', response.status)
      return null
    }

    const data = await response.json()
    const signature = data?.addonSig || null

    if (signature) {
      cachedSignature = { sig: signature, timestamp: Date.now() }
      console.log('[Vavoo Auth] Signature obtained and cached')
    } else {
      console.error('[Vavoo Auth] No addonSig in response')
    }

    return signature
  } catch (error) {
    console.error('[Vavoo Auth] Error:', error)
    return null
  }
}

// Resolve vavoo.to URL to CDN direct URL
async function resolveVavooUrl(vavooUrl: string, signature: string): Promise<string | null> {
  // Check cache
  const cached = cdnCache.get(vavooUrl)
  if (cached && cached.exp > Date.now()) {
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
      console.error('[CDN Resolve] Failed:', response.status)
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
      cdnCache.set(vavooUrl, { url: cdnUrl, exp: Date.now() + 1800000 })
      console.log('[CDN Resolve] OK:', cdnUrl.substring(0, 80))
    }

    return cdnUrl
  } catch (error) {
    console.error('[CDN Resolve] Error:', error)
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

    // Always get signature - needed for ALL vavoo.to requests
    const signature = await getVavooSignature()

    let finalUrl = targetUrl
    let useVavooHeaders = true

    // Check if this is a vavoo.to URL
    const isVavoo = (() => {
      try {
        return new URL(targetUrl).hostname.includes('vavoo.to')
      } catch {
        return false
      }
    })()

    // Mode CDN: try to resolve vavoo.to URLs to direct CDN
    if (mode === 'cdn' && isVavoo && signature) {
      const cdnUrl = await resolveVavooUrl(targetUrl, signature)
      if (cdnUrl) {
        finalUrl = cdnUrl
        useVavooHeaders = false // CDN URLs don't need vavoo headers
      } else {
        // CDN resolve failed - fall back to direct proxy with signature
        console.log('[CDN] Resolve failed, falling back to direct proxy with auth')
      }
    }

    // For non-vavoo URLs (CDN segments), don't use vavoo headers
    if (!isVavoo) {
      useVavooHeaders = false
    }

    // Build headers
    const headers: Record<string, string> = {
      'User-Agent': useVavooHeaders ? 'VAVOO/2.6' : 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'gzip, deflate',
    }

    // ALWAYS add signature for vavoo.to URLs (this is the key fix!)
    if (isVavoo && signature && useVavooHeaders) {
      headers['mediahubmx-signature'] = signature
    }

    // Range support for seeking
    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    // Fetch with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(finalUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    // Handle errors
    if (!response.ok && response.status !== 206) {
      console.error(`[Stream] Error ${response.status} for: ${finalUrl.substring(0, 100)}`)
      return NextResponse.json(
        { error: `Stream error: ${response.status}` },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('content-type') || ''

    // M3U8 manifest processing - rewrite URLs to proxy through us
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8') ||
      finalUrl.includes('.m3u8') ||
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
        // Keep the same mode for sub-requests (segments, sub-playlists)
        return `${request.nextUrl.origin}/api/vavoo-stream-v2?url=${encodedUrl}&mode=${mode}`
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

    // Streaming segments
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType || 'video/MP2T',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
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
    if (error instanceof Error && error.name === 'AbortError') {
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
