import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Auth-stream proxy: Same as standard proxy but adds the Vavoo signature
 * as a mediahubmx-signature header to all segment requests.
 * This is for testing whether the signature helps with stream quality
 * WITHOUT resolving to a different CDN URL.
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
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Get signature
    const signature = await getVavooSignature();

    // Create proxified URL - pass signature as mediahubmx-signature via custom header param
    const baseUrl = request.nextUrl.origin;
    const params = new URLSearchParams();
    params.set("url", encodeURIComponent(url));
    // Use MediaHubMX user-agent when we have a signature
    if (signature) {
      params.set("ua", "MediaHubMX/2");
    }

    const proxyUrl = `${baseUrl}/api/stream?${params.toString()}`;

    return NextResponse.json({
      proxyUrl,
      hasSignature: !!signature,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
