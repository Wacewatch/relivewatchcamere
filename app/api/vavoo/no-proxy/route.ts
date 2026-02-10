import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "edge";

/**
 * No-Proxy endpoint: Resolves the CDN URL and returns M3U8 with ABSOLUTE CDN URLs
 * so the browser fetches segments directly from CDN without going through Vercel
 */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Step 1: Resolve the real CDN URL by following redirects
    const resolveStart = Date.now();
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "VAVOO/2.6",
        Accept: "*/*",
      },
      redirect: "follow",
    });

    const cdnUrl = response.url;
    const resolveDuration = Date.now() - resolveStart;

    // Step 2: Fetch the M3U8 from the CDN URL
    const m3u8Start = Date.now();
    const m3u8Response = await fetch(cdnUrl, {
      headers: {
        "User-Agent": "VAVOO/2.6",
        Accept: "*/*",
      },
    });

    if (!m3u8Response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch m3u8: ${m3u8Response.status}` },
        { status: m3u8Response.status }
      );
    }

    const m3u8Text = await m3u8Response.text();
    const m3u8Duration = Date.now() - m3u8Start;

    // Step 3: Rewrite M3U8 with absolute CDN URLs (no proxy)
    const baseUrl = new URL(cdnUrl);
    const pathParts = baseUrl.pathname.split("/");
    pathParts.pop();
    const basePath = pathParts.join("/") + "/";

    const lines = m3u8Text.split("\n");
    const rewrittenLines = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") return line;

      // Convert relative URLs to absolute CDN URLs
      let absoluteUrl: string;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        absoluteUrl = trimmed;
      } else if (trimmed.startsWith("/")) {
        absoluteUrl = `${baseUrl.origin}${trimmed}`;
      } else {
        absoluteUrl = `${baseUrl.origin}${basePath}${trimmed}`;
      }

      return absoluteUrl;
    });

    const rewrittenM3u8 = rewrittenLines.join("\n");

    // Return the rewritten M3U8 with debug headers
    return new NextResponse(rewrittenM3u8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "X-CDN-URL": cdnUrl,
        "X-Resolve-Duration": resolveDuration.toString(),
        "X-M3U8-Duration": m3u8Duration.toString(),
        "X-Original-URL": url,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        debug: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      },
      { status: 500 }
    );
  }
}
