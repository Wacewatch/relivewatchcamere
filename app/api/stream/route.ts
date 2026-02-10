import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    const targetUrl = decodeURIComponent(url);

    try {
      new URL(targetUrl);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Get optional headers from query params
    const ua =
      request.nextUrl.searchParams.get("ua") || "VAVOO/2.6";
    const referer = request.nextUrl.searchParams.get("referer") || "";

    const headers: Record<string, string> = {
      "User-Agent": ua,
      Accept: "*/*",
      Connection: "keep-alive",
    };
    if (referer) {
      headers["Referer"] = referer;
      headers["Origin"] = new URL(referer).origin;
    }

    // Forward Range for segment seeking
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      headers["Range"] = rangeHeader;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    // Use redirect: "follow" to avoid double-hop latency
    const response = await fetch(targetUrl, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: `Stream error: ${response.status}` },
        { status: response.status },
      );
    }

    // Get the final URL after redirects (for correct base URL in m3u8 rewriting)
    const finalUrl = response.url || targetUrl;

    const contentType = response.headers.get("content-type") || "";

    // Handle M3U8 playlists - rewrite URLs to proxy through us
    if (
      contentType.includes("mpegurl") ||
      contentType.includes("m3u8") ||
      targetUrl.includes(".m3u8") ||
      finalUrl.includes(".m3u8")
    ) {
      const text = await response.text();
      // Use finalUrl (after redirects) for correct CDN base path
      const baseUrl = new URL(finalUrl);
      const pathParts = baseUrl.pathname.split("/");
      pathParts.pop();
      const basePath = pathParts.join("/") + "/";

      const lines = text.split("\n");
      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || trimmed === "") return line;

        let absoluteUrl: string;
        if (
          trimmed.startsWith("http://") ||
          trimmed.startsWith("https://")
        ) {
          absoluteUrl = trimmed;
        } else if (trimmed.startsWith("/")) {
          absoluteUrl = `${baseUrl.origin}${trimmed}`;
        } else {
          absoluteUrl = `${baseUrl.origin}${basePath}${trimmed}`;
        }

        // Segments from CDN don't need special UA
        const params = new URLSearchParams();
        params.set("url", encodeURIComponent(absoluteUrl));

        return `${request.nextUrl.origin}/api/stream?${params.toString()}`;
      });

      return new NextResponse(rewrittenLines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Range, User-Agent, Content-Type",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // For video segments - stream with caching
    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType || "video/MP2T",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, User-Agent, Content-Type",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    };

    const contentLength = response.headers.get("content-length");
    const contentRange = response.headers.get("content-range");
    if (contentLength) responseHeaders["Content-Length"] = contentLength;
    if (contentRange) responseHeaders["Content-Range"] = contentRange;

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Stream error",
      },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, User-Agent, Content-Type",
    },
  });
}
