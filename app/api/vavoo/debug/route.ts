import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Debug endpoint to test each step of the Vavoo proxy chain independently.
 * GET /api/vavoo/debug?step=ping            -> test signature
 * GET /api/vavoo/debug?step=resolve&url=... -> test resolve
 * GET /api/vavoo/debug?step=all&url=...     -> test full chain
 */
export async function GET(request: NextRequest) {
  const step = request.nextUrl.searchParams.get("step") || "ping";
  const url = request.nextUrl.searchParams.get("url") || "";
  const results: Record<string, unknown> = { step, timestamp: new Date().toISOString() };

  // Step 1: Test ping/signature
  if (step === "ping" || step === "all") {
    const start = Date.now();
    try {
      const currentTime = Date.now();
      const payload = {
        token: "",
        reason: "app-blur",
        locale: "de",
        theme: "dark",
        metadata: {
          device: { type: "Handset", brand: "google", model: "Pixel", name: "sdk_gphone64_arm64", uniqueId: "d10e5d99ab665233" },
          os: { name: "android", version: "13", abis: ["arm64-v8a", "armeabi-v7a", "armeabi"], host: "android" },
          app: { platform: "android", version: "3.1.21", buildId: "289515000", engine: "hbc85", signatures: ["6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e"], installer: "app.revanced.manager.flutter" },
          version: { package: "tv.vavoo.app", binary: "3.1.21", js: "3.1.21" },
        },
        appFocusTime: 0, playerActive: false, playDuration: 0, devMode: false,
        hasAddon: true, castConnected: false, package: "tv.vavoo.app", version: "3.1.21",
        process: "app", firstAppStart: currentTime, lastAppStart: currentTime,
        ipLocation: "", adblockEnabled: true,
        proxy: { supported: ["ss", "openvpn"], engine: "ss", ssVersion: 1, enabled: true, autoServer: true, id: "de-fra" },
        iap: { supported: false },
      };

      const resp = await fetch("https://www.vavoo.tv/api/app/ping", {
        method: "POST",
        headers: {
          "User-Agent": "okhttp/4.11.0",
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
      });

      const respText = await resp.text();
      let respJson = null;
      try { respJson = JSON.parse(respText); } catch { /* not json */ }

      results.ping = {
        status: resp.status,
        ok: resp.ok,
        duration: Date.now() - start,
        addonSig: respJson?.addonSig ? respJson.addonSig.substring(0, 30) + "..." : null,
        hasSignature: !!respJson?.addonSig,
        rawResponse: respText.substring(0, 500),
      };

      // If step=all, continue to resolve
      if (step === "all" && url && respJson?.addonSig) {
        const resolveStart = Date.now();
        try {
          const resolveResp = await fetch("https://vavoo.to/mediahubmx-resolve.json", {
            method: "POST",
            headers: {
              "User-Agent": "MediaHubMX/2",
              Accept: "application/json",
              "Content-Type": "application/json; charset=utf-8",
              "mediahubmx-signature": respJson.addonSig,
            },
            body: JSON.stringify({
              language: "de",
              region: "AT",
              url: url,
              clientVersion: "3.1.21",
            }),
          });

          const resolveText = await resolveResp.text();
          let resolveJson = null;
          try { resolveJson = JSON.parse(resolveText); } catch { /* not json */ }

          let resolvedUrl = null;
          if (Array.isArray(resolveJson) && resolveJson[0]?.url) {
            resolvedUrl = resolveJson[0].url;
          } else if (resolveJson?.url) {
            resolvedUrl = resolveJson.url;
          }

          results.resolve = {
            status: resolveResp.status,
            ok: resolveResp.ok,
            duration: Date.now() - resolveStart,
            resolvedUrl: resolvedUrl,
            rawResponse: resolveText.substring(0, 500),
          };
        } catch (e) {
          results.resolve = {
            error: e instanceof Error ? e.message : String(e),
            duration: Date.now() - resolveStart,
          };
        }
      }
    } catch (e) {
      results.ping = {
        error: e instanceof Error ? e.message : String(e),
        duration: Date.now() - start,
      };
    }
  }

  if (step === "resolve" && url) {
    // Need to get signature first
    results.info = "Use step=all to test the full chain (ping + resolve)";
  }

  results.totalDuration = Date.now();
  return NextResponse.json(results, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
