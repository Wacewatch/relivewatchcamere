import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function getVavooSignature(): Promise<string | null> {
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
      return null
    }

    const data = await response.json()
    return data?.addonSig || null
  } catch (error) {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      )
    }

    // Get signature
    const signature = await getVavooSignature()
    if (!signature) {
      return NextResponse.json(
        { error: 'Failed to get auth signature' },
        { status: 502 }
      )
    }

    // Create proxified URL with signature in query
    const baseUrl = request.nextUrl.origin
    const encodedUrl = encodeURIComponent(url)
    const encodedSig = encodeURIComponent(signature)
    const proxyUrl = `${baseUrl}/api/stream?url=${encodedUrl}&sig=${encodedSig}`

    return NextResponse.json({ proxyUrl })

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
