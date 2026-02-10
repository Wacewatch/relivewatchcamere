import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const VAVOO_USER_AGENT = 'VAVOO/2.6'

interface VavooChannel {
  country: string
  id: number
  name: string
  p?: number
}

interface Channel {
  id: string
  name: string
  url: string
  country: string
}

interface Country {
  code: string
  name: string
  channels: Channel[]
}

export async function GET(request: NextRequest) {
  try {
    console.log('[v0] Fetching Vavoo channels from https://vavoo.to/channels')

    const response = await fetch('https://vavoo.to/channels', {
      headers: {
        'User-Agent': VAVOO_USER_AGENT,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://vavoo.to/',
      },
    })

    if (!response.ok) {
      console.error('[v0] Failed to fetch channels:', response.status, response.statusText)
      return NextResponse.json(
        { error: `Failed to fetch channels: ${response.status}`, countries: [] },
        { status: response.status }
      )
    }

    const data: VavooChannel[] = await response.json()
    console.log('[v0] Received', data.length, 'channels')

    if (!Array.isArray(data) || data.length === 0) {
      console.log('[v0] No channels data received')
      return NextResponse.json({ countries: [] })
    }

    // Group channels by country
    const grouped: Record<string, Channel[]> = {}

    for (const item of data) {
      const countryCode = item.country || 'Unknown'
      
      if (!grouped[countryCode]) {
        grouped[countryCode] = []
      }

      // Generate stream URL based on channel ID
      const streamUrl = `https://vavoo.to/play/${item.id}/index.m3u8`

      grouped[countryCode].push({
        id: String(item.id),
        name: item.name,
        url: streamUrl,
        country: countryCode,
      })
    }

    // Convert to countries array
    const countries: Country[] = []
    
    for (const [countryCode, channels] of Object.entries(grouped)) {
      countries.push({
        code: countryCode.toLowerCase(),
        name: getCountryName(countryCode),
        channels,
      })
    }

    // Sort countries alphabetically
    countries.sort((a, b) => a.name.localeCompare(b.name))

    console.log('[v0] Returning', countries.length, 'countries')
    return NextResponse.json({ countries })
  } catch (error) {
    console.error('[v0] Error fetching Vavoo channels:', error)
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error',
        countries: [] 
      },
      { status: 500 }
    )
  }
}

function getCountryName(code: string): string {
  const countryNames: Record<string, string> = {
    'albania': 'Albania',
    'arabia': 'Arabia',
    'balkans': 'Balkans',
    'bulgaria': 'Bulgaria',
    'france': 'France',
    'germany': 'Germany',
    'italy': 'Italy',
    'netherlands': 'Netherlands',
    'poland': 'Poland',
    'portugal': 'Portugal',
    'romania': 'Romania',
    'russia': 'Russia',
    'spain': 'Spain',
    'turkey': 'Turkey',
    'uk': 'United Kingdom',
    'united_kingdom': 'United Kingdom',
  }
  
  return countryNames[code.toLowerCase()] || code.charAt(0).toUpperCase() + code.slice(1)
}
