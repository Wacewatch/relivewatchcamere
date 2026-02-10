// Test script to verify the Vavoo resolve flow works outside of Vercel Edge

async function getSignature() {
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
        signatures: ["6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e"],
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

  console.log("Step 1: Getting signature from ping...");
  const start = Date.now();

  const resp = await fetch("https://www.vavoo.tv/api/app/ping", {
    method: "POST",
    headers: {
      "User-Agent": "okhttp/4.11.0",
      "Accept": "application/json",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  console.log(`  Status: ${resp.status} (${Date.now() - start}ms)`);
  
  if (!resp.ok) {
    const text = await resp.text();
    console.log(`  Error body: ${text.substring(0, 300)}`);
    return null;
  }

  const data = await resp.json();
  console.log(`  Response keys: ${Object.keys(data).join(", ")}`);
  console.log(`  addonSig: ${data.addonSig ? data.addonSig.substring(0, 30) + "..." : "MISSING"}`);
  return data.addonSig || null;
}

async function resolveUrl(url, signature) {
  console.log(`\nStep 2: Resolving URL: ${url}`);
  const start = Date.now();

  const resp = await fetch("https://vavoo.to/mediahubmx-resolve.json", {
    method: "POST",
    headers: {
      "User-Agent": "MediaHubMX/2",
      "Accept": "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "mediahubmx-signature": signature,
    },
    body: JSON.stringify({
      language: "de",
      region: "AT",
      url: url,
      clientVersion: "3.1.21",
    }),
  });

  console.log(`  Status: ${resp.status} (${Date.now() - start}ms)`);

  if (!resp.ok) {
    const text = await resp.text();
    console.log(`  Error body: ${text.substring(0, 500)}`);
    return null;
  }

  const result = await resp.json();
  console.log(`  Response type: ${typeof result}, isArray: ${Array.isArray(result)}`);
  console.log(`  Raw response: ${JSON.stringify(result).substring(0, 500)}`);

  if (Array.isArray(result) && result.length > 0 && result[0]?.url) {
    console.log(`  Resolved URL: ${result[0].url}`);
    return result[0].url;
  }
  if (result && result.url) {
    console.log(`  Resolved URL: ${result.url}`);
    return result.url;
  }

  console.log("  No URL found in response");
  return null;
}

// Run test
const testUrl = "https://vavoo.to/play/1975426357/index.m3u8"; // FOOT+

async function main() {
  console.log("=== Vavoo Resolve Test ===\n");
  
  const sig = await getSignature();
  if (!sig) {
    console.log("\nFailed to get signature. Exiting.");
    return;
  }

  const resolved = await resolveUrl(testUrl, sig);
  if (!resolved) {
    console.log("\nFailed to resolve URL. Exiting.");
    return;
  }

  console.log(`\n=== SUCCESS ===`);
  console.log(`Original: ${testUrl}`);
  console.log(`Resolved: ${resolved}`);
}

main().catch(console.error);
