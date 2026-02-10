import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL manquante ou invalide' },
        { status: 400 }
      )
    }

    // Validate that it's a valid URL
    try {
      new URL(url)
    } catch {
      return NextResponse.json(
        { error: 'Format d\'URL invalide' },
        { status: 400 }
      )
    }

    // Create a proxied URL that points to our stream endpoint
    const baseUrl = request.nextUrl.origin
    const encodedUrl = encodeURIComponent(url)
    const proxyUrl = `${baseUrl}/api/stream?url=${encodedUrl}`

    return NextResponse.json({ proxyUrl })
  } catch (error) {
    console.error('Proxy error:', error)
    return NextResponse.json(
      { error: 'Erreur lors de la création du proxy' },
      { status: 500 }
    )
  }
}
