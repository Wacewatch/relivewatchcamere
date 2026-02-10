import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url')

    if (!url) {
      return NextResponse.json(
        { error: 'URL parameter is required' },
        { status: 400 }
      )
    }

    const targetUrl = decodeURIComponent(url)

    // Validate URL
    try {
      new URL(targetUrl)
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      )
    }

    // Get signature if provided
    const signature = request.nextUrl.searchParams.get('sig')

    // Use MediaHubMX user-agent as the resolved URLs expect it
    const headers: Record<string, string> = {
      'User-Agent': signature ? 'MediaHubMX/2' : 'VAVOO/2.6',
      'Accept': '*/*',
      'Connection': 'keep-alive',
    }

    // Add signature header if provided
    if (signature) {
      headers['mediahubmx-signature'] = signature
    }

    // Custom headers from query params (h_*)
    for (const [key, value] of request.nextUrl.searchParams.entries()) {
      if (key.startsWith('h_') && key !== 'h_sig') {
        const headerName = key.substring(2).replace(/_/g, '-')
        headers[headerName] = value
      }
    }

    // Handle Range requests
    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    // Fetch with timeout

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000) // 60s timeout

    const response = await fetch(targetUrl, {
      headers,
      redirect: 'manual',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    // Handle redirects (3xx)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location) {
        // Follow the redirect through our proxy
        
        // Build absolute redirect URL
        let redirectUrl: string
        if (location.startsWith('http://') || location.startsWith('https://')) {
          redirectUrl = location
        } else if (location.startsWith('/')) {
          const baseUrl = new URL(targetUrl)
          redirectUrl = `${baseUrl.origin}${location}`
        } else {
          const baseUrl = new URL(targetUrl)
          const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1)
          redirectUrl = `${baseUrl.origin}${basePath}${location}`
        }

        // Proxy the redirect URL through our endpoint
        const encodedRedirect = encodeURIComponent(redirectUrl)
        return NextResponse.redirect(
          `${request.nextUrl.origin}/api/stream?url=${encodedRedirect}`,
          307 // Temporary redirect
        )
      }
    }

    if (!response.ok) {
      // Stream error
      return NextResponse.json(
        { error: `Stream error: ${response.status}` },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('content-type') || ''

    // Handle M3U8 playlists
    if (contentType.includes('mpegurl') || 
        contentType.includes('m3u8') || 
        targetUrl.includes('.m3u8')) {
      
      const text = await response.text()
      const baseUrl = new URL(targetUrl)
      
      // Base path for relative URLs
      const pathParts = baseUrl.pathname.split('/')
      pathParts.pop()
      const basePath = pathParts.join('/') + '/'
      
      const lines = text.split('\n')
      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim()
        
        // Keep comments and empty lines
        if (trimmed.startsWith('#') || trimmed === '') {
          return line
        }

        let absoluteUrl: string

        // Build absolute URL
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          absoluteUrl = trimmed
        } else if (trimmed.startsWith('/')) {
          absoluteUrl = `${baseUrl.origin}${trimmed}`
        } else {
          absoluteUrl = `${baseUrl.origin}${basePath}${trimmed}`
        }

        // Proxy through our endpoint
        const encodedUrl = encodeURIComponent(absoluteUrl)
        return `${request.nextUrl.origin}/api/stream?url=${encodedUrl}`
      })

      const rewrittenText = rewrittenLines.join('\n')

      return new NextResponse(rewrittenText, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }

    // For video segments - stream directly with moderate caching
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType || 'video/MP2T',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, User-Agent, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    }

    const contentLength = response.headers.get('content-length')
    const contentRange = response.headers.get('content-range')
    
    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength
    }
    
    if (contentRange) {
      responseHeaders['Content-Range'] = contentRange
    }

    // Stream response body
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    })

  } catch (error) {
    // Stream proxy error
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
