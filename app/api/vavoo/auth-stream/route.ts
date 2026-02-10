import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Auth-stream proxy: Uses MediaHubMX/2 user-agent with the signature header
 * to resolve the CDN URL. This is different from "standard" (VAVOO/2.6 UA)
 * and "direct-cdn" (VAVOO/2.6 resolve + return m3u8 directly).
 * 
 * This tests whether using MediaHubMX UA gives different/better CDN routes.
 */

async function getVavooSignature(): Promise<string | null> {
  const currentTime = Date.now();
  const payload = {
    token: "",
    reason: "app-blur",
    locale: "de",
    theme: "dark",
    metadata: {
      device: {
        type: "Handset",
        brand: "google",
        model: "Pixel",
        name: "sdk_gphone64_arm64",
        uniqueId: "d10e5d99ab665233",
      },
      os: {
        name: "android",
        version: "13",
        abis: ["arm64-v8a", "armeabi-v7a", "armeabi"],
        host: "android",
      },
      app: {
        platform: "android",
        version: "3.1.21",
        buildId: "289515000",
        engine: "hbc85",
        signatures: [
          "6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e",
        ],
        installer: "app.revanced.manager.flutter",
      },
      version: {
        package: "tv.vavoo.app",
        binary: "3.1.21",
        js: "3.1.21",
      },
    },
    appFocusTime: 0,
    playerActive: false,
    playDuration: 0,
    devMode: false,
    hasAddon: true,
    castConnected: false,
    package: "tv.vavoo.app",
    version: "3.1.21",
    process: "app",
    firstAppStart: currentTime,
    lastAppStart: currentTime,
    ipLocation: "",
    adblockEnabled: true,
    proxy: {
      supported: ["ss", "openvpn"],
      engine: "ss",
      ssVersion: 1,
      enabled: true,
      autoServer: true,
      id: "de-fra",
    },
    iap: { supported: false },
  };

  try {
    const response = await fetch("https://www.vavoo.tv/api/app/ping", {
      method: "POST",
      headers: {
        "User-Agent": "okhttp/4.11.0",
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.addonSig || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const totalStart = Date.now();

  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Get signature for MediaHubMX auth
    const signature = await getVavooSignature();
    const sigDuration = Date.now() - totalStart;

    // Build headers for resolving - use MediaHubMX UA + signature
    const resolveHeaders: Record<string, string> = {
      "User-Agent": signature ? "MediaHubMX/2" : "VAVOO/2.6",
      "Accept": "*/*",
    };
    if (signature) {
      resolveHeaders["mediahubmx-signature"] = signature;
    }

    // Resolve the CDN URL by following redirects
    const resolveStart = Date.now();
    const resp = await fetch(url, {
      method: "GET",
      headers: resolveHeaders,
      redirect: "follow",
    });

    const resolveDuration = Date.now() - resolveStart;

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Auth resolve failed: ${resp.status}`, debug: { sigDuration, resolveDuration } },
        { status: 502 },
      );
    }

    // Get CDN URL and m3u8 content
    const cdnUrl = resp.url;
    const m3u8Content = await resp.text();

    if (!m3u8Content.includes("#EXTM3U")) {
      return NextResponse.json(
        { error: "Invalid m3u8", debug: { cdnUrl, bodyPreview: m3u8Content.substring(0, 200) } },
        { status: 502 },
      );
    }

    // Rewrite m3u8 with proxied segment URLs
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

        let absoluteUrl: string;
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          absoluteUrl = trimmed;
        } else if (trimmed.startsWith("/")) {
          absoluteUrl = `${baseUrlObj.origin}${trimmed}`;
        } else {
          absoluteUrl = `${baseUrlObj.origin}${basePath}${trimmed}`;
        }

        return `${origin}/api/stream?url=${encodeURIComponent(absoluteUrl)}`;
      })
      .join("\n");

    // Return m3u8 directly (like direct-cdn)
    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store",
        "X-CDN-URL": cdnUrl.substring(0, 100),
        "X-Has-Signature": signature ? "yes" : "no",
        "X-Sig-Duration": String(sigDuration),
        "X-Resolve-Duration": String(resolveDuration),
        "X-Total-Duration": String(Date.now() - totalStart),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
