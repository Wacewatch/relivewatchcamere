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

async function testDirect(url, sig) {
  // Test: Maybe the signature itself IS the key to get the stream directly
  // and vavoo.to/play URLs already ARE the final URLs, just need proper headers
  console.log(`\nStep 3: Testing direct fetch of m3u8 with signature header...`);
  const start = Date.now();
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "MediaHubMX/2",
      "mediahubmx-signature": sig,
      "Accept": "*/*",
    },
    redirect: "follow",
  });
  console.log(`  Status: ${resp.status} (${Date.now() - start}ms)`);
  console.log(`  Final URL: ${resp.url}`);
  console.log(`  Headers: content-type=${resp.headers.get("content-type")}, content-length=${resp.headers.get("content-length")}`);
  const text = await resp.text();
  console.log(`  Body (first 500 chars): ${text.substring(0, 500)}`);
  return text;
}

async function testWithVavooUA(url) {
  // Test: Just use VAVOO/2.6 user agent directly
  console.log(`\nStep 4: Testing direct fetch with VAVOO/2.6 UA (no proxy)...`);
  const start = Date.now();
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "VAVOO/2.6",
      "Accept": "*/*",
    },
    redirect: "follow",
  });
  console.log(`  Status: ${resp.status} (${Date.now() - start}ms)`);
  console.log(`  Final URL: ${resp.url}`);
  console.log(`  Headers: content-type=${resp.headers.get("content-type")}, content-length=${resp.headers.get("content-length")}`);
  const text = await resp.text();
  console.log(`  Body (first 500 chars): ${text.substring(0, 500)}`);
  
  // Parse the m3u8 to understand what URLs are in it
  const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  console.log(`\n  Segment/playlist URLs found: ${lines.length}`);
  lines.slice(0, 3).forEach(l => console.log(`    ${l}`));
  return text;
}

async function testResolveEndpoints(url, sig) {
  // Test different resolve endpoints
  const endpoints = [
    "https://vavoo.to/mediahubmx-resolve.json",
    "https://www.vavoo.tv/mediahubmx-resolve.json",
    "https://vavoo.to/api/resolve",
  ];
  
  for (const endpoint of endpoints) {
    console.log(`\nTesting endpoint: ${endpoint}`);
    const start = Date.now();
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": "MediaHubMX/2",
          "Accept": "application/json",
          "Content-Type": "application/json; charset=utf-8",
          "mediahubmx-signature": sig,
        },
        body: JSON.stringify({
          language: "de",
          region: "AT",
          url: url,
          clientVersion: "3.1.21",
        }),
      });
      console.log(`  Status: ${resp.status} (${Date.now() - start}ms)`);
      const text = await resp.text();
      console.log(`  Body: ${text.substring(0, 300)}`);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
}

const testUrl = "https://vavoo.to/play/1975426357/index.m3u8"; // FOOT+

async function main() {
  console.log("=== Vavoo Deep Debug Test ===\n");
  
  const sig = await getSignature();
  if (!sig) {
    console.log("\nFailed to get signature. Exiting.");
    return;
  }

  // Test 1: Direct fetch with signature
  await testDirect(testUrl, sig);
  
  // Test 2: Direct fetch with VAVOO UA
  await testWithVavooUA(testUrl);
  
  // Test 3: Different resolve endpoints  
  await testResolveEndpoints(testUrl, sig);
}

main().catch(console.error);
