import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Step 1: Get addonSig from Vavoo ping API
 * Exactly as EasyProxy does in vavoo.py get_auth_signature()
 */
async function getSignature(): Promise<{ sig: string | null; error: string | null; duration: number }> {
  const start = Date.now();
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
    const resp = await fetch("https://www.vavoo.tv/api/app/ping", {
      method: "POST",
      headers: {
        "User-Agent": "okhttp/4.11.0",
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        sig: null,
        error: `Ping failed: ${resp.status} ${text.substring(0, 100)}`,
        duration: Date.now() - start,
      };
    }

    const data = await resp.json();
    const sig = data?.addonSig || null;
    return {
      sig,
      error: sig ? null : `No addonSig in response: ${JSON.stringify(data).substring(0, 200)}`,
      duration: Date.now() - start,
    };
  } catch (e) {
    return {
      sig: null,
      error: `Ping exception: ${e instanceof Error ? e.message : String(e)}`,
      duration: Date.now() - start,
    };
  }
}

/**
 * Step 2: Resolve vavoo URL to real CDN URL
 * Exactly as EasyProxy does in vavoo.py _resolve_vavoo_link()
 */
async function resolveUrl(
  url: string,
  signature: string,
): Promise<{ resolvedUrl: string | null; error: string | null; duration: number; rawResponse: string }> {
  const start = Date.now();
  const payload = {
    language: "de",
    region: "AT",
    url: url,
    clientVersion: "3.1.21",
  };

  try {
    const resp = await fetch("https://vavoo.to/mediahubmx-resolve.json", {
      method: "POST",
      headers: {
        "User-Agent": "MediaHubMX/2",
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "mediahubmx-signature": signature,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        resolvedUrl: null,
        error: `Resolve failed: ${resp.status} ${text.substring(0, 200)}`,
        duration: Date.now() - start,
        rawResponse: text.substring(0, 500),
      };
    }

    const result = await resp.json();
    const raw = JSON.stringify(result).substring(0, 500);

    // Handle array response (most common from EasyProxy)
    if (Array.isArray(result) && result.length > 0 && result[0]?.url) {
      return {
        resolvedUrl: result[0].url,
        error: null,
        duration: Date.now() - start,
        rawResponse: raw,
      };
    }

    // Handle object response
    if (result && typeof result === "object" && result.url) {
      return {
        resolvedUrl: result.url,
        error: null,
        duration: Date.now() - start,
        rawResponse: raw,
      };
    }

    return {
      resolvedUrl: null,
      error: `No URL in resolve response`,
      duration: Date.now() - start,
      rawResponse: raw,
    };
  } catch (e) {
    return {
      resolvedUrl: null,
      error: `Resolve exception: ${e instanceof Error ? e.message : String(e)}`,
      duration: Date.now() - start,
      rawResponse: "",
    };
  }
}

export async function POST(request: NextRequest) {
  const totalStart = Date.now();

  try {
    const body = await request.json();
    const url = body?.url;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Step 1: Get signature
    const sigResult = await getSignature();
    if (!sigResult.sig) {
      return NextResponse.json(
        {
          error: "Signature failed",
          debug: {
            step: "signature",
            detail: sigResult.error,
            duration: sigResult.duration,
          },
        },
        { status: 502 },
      );
    }

    // Step 2: Resolve URL
    const resolveResult = await resolveUrl(url, sigResult.sig);
    if (!resolveResult.resolvedUrl) {
      return NextResponse.json(
        {
          error: "Resolve failed",
          debug: {
            step: "resolve",
            detail: resolveResult.error,
            signatureDuration: sigResult.duration,
            resolveDuration: resolveResult.duration,
            rawResponse: resolveResult.rawResponse,
          },
        },
        { status: 502 },
      );
    }

    // Step 3: Build proxy URL with correct headers for the resolved CDN
    // EasyProxy uses: user-agent: Mozilla/..., referer: https://vavoo.to/
    const baseUrl = request.nextUrl.origin;
    const params = new URLSearchParams();
    params.set("url", encodeURIComponent(resolveResult.resolvedUrl));
    params.set(
      "ua",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    params.set("referer", "https://vavoo.to/");
    const proxyUrl = `${baseUrl}/api/stream?${params.toString()}`;

    return NextResponse.json({
      proxyUrl,
      debug: {
        resolvedUrl: resolveResult.resolvedUrl,
        signatureDuration: sigResult.duration,
        resolveDuration: resolveResult.duration,
        totalDuration: Date.now() - totalStart,
        rawResponse: resolveResult.rawResponse,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        debug: { step: "outer", totalDuration: Date.now() - totalStart },
      },
      { status: 500 },
    );
  }
}
