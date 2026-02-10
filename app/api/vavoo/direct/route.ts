import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * CDN Direct Proxy
 * 
 * Instead of proxying through vavoo.to (which adds a redirect hop),
 * this endpoint resolves the real CDN URL upfront by following the
 * vavoo.to redirect, then returns a proxy URL pointing directly
 * at the CDN. This eliminates the 307 redirect hop on every manifest reload.
 * 
 * Flow:
 * 1. Fetch vavoo.to/play/... with VAVOO/2.6 UA (follows redirect)
 * 2. Get the final CDN URL (like https://xxx.ngolpdkyoctjcddxshli469r.org/...)
 * 3. Return proxy URL pointing to CDN URL directly
 */
export async function POST(request: NextRequest) {
  const totalStart = Date.now();

  try {
    const body = await request.json();
    const url = body?.url;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Step 1: Resolve the vavoo.to URL to the real CDN URL by following redirects
    const resolveStart = Date.now();
    
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "VAVOO/2.6",
        "Accept": "*/*",
      },
      redirect: "follow",
    });

    const resolveDuration = Date.now() - resolveStart;

    if (!resp.ok) {
      return NextResponse.json(
        {
          error: `CDN resolve failed: ${resp.status}`,
          debug: { resolveDuration, status: resp.status },
        },
        { status: 502 },
      );
    }

    // The response.url is the final CDN URL after redirects
    const cdnUrl = resp.url;
    
    // Read the m3u8 content to verify it's valid
    const m3u8Content = await resp.text();
    const isValid = m3u8Content.includes("#EXTM3U");

    if (!isValid) {
      return NextResponse.json(
        {
          error: "Invalid m3u8 response from CDN",
          debug: { cdnUrl, resolveDuration, bodyPreview: m3u8Content.substring(0, 200) },
        },
        { status: 502 },
      );
    }

    // Step 2: Rewrite the m3u8 inline (segments are relative, make them absolute via proxy)
    const baseUrlObj = new URL(cdnUrl);
    const pathParts = baseUrlObj.pathname.split("/");
    pathParts.pop();
    const basePath = pathParts.join("/") + "/";
    const origin = request.nextUrl.origin;

    const rewritten = m3u8Content
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || trimmed === "") return line;

        // Build absolute CDN URL for this segment
        let absoluteUrl: string;
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          absoluteUrl = trimmed;
        } else if (trimmed.startsWith("/")) {
          absoluteUrl = `${baseUrlObj.origin}${trimmed}`;
        } else {
          absoluteUrl = `${baseUrlObj.origin}${basePath}${trimmed}`;
        }

        // Proxy through /api/stream (CDN segments don't need special UA)
        return `${origin}/api/stream?url=${encodeURIComponent(absoluteUrl)}`;
      })
      .join("\n");

    // Return as m3u8 directly so HLS.js can consume it
    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store",
        "X-CDN-URL": cdnUrl.substring(0, 100),
        "X-Resolve-Duration": String(resolveDuration),
        "X-Total-Duration": String(Date.now() - totalStart),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        debug: { totalDuration: Date.now() - totalStart },
      },
      { status: 500 },
    );
  }
}
