"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Globe,
  Tv,
  Loader2,
  AlertCircle,
  Play,
  Search,
  ArrowLeft,
  Bug,
  ChevronDown,
  ChevronUp,
  Zap,
  Shield,
  Rocket,
} from "lucide-react";
import Hls from "hls.js";

interface Channel {
  id: string;
  name: string;
  logo?: string;
  url: string;
  country: string;
}

interface Country {
  code: string;
  name: string;
  channels: Channel[];
}

interface ProxyLog {
  time: string;
  type: "info" | "error" | "success" | "warn";
  message: string;
  data?: unknown;
}

type ProxyMode = "standard" | "auth" | "direct-cdn";

export default function VavooChannelBrowser() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [playError, setPlayError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [activeProxy, setActiveProxy] = useState<ProxyMode | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [proxyLogs, setProxyLogs] = useState<ProxyLog[]>([]);
  const [hlsStats, setHlsStats] = useState<{
    level: number;
    bandwidth: number;
    buffered: number;
    dropped: number;
    loaded: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback(
    (type: ProxyLog["type"], message: string, data?: unknown) => {
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;
      setProxyLogs((prev) => [...prev.slice(-50), { time, type, message, data }]);
    },
    [],
  );

  useEffect(() => {
    loadCountries();
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);

  const loadCountries = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/vavoo/channels");
      if (!response.ok) throw new Error("Failed to load channels");
      const data = await response.json();
      setCountries(data.countries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  };

  const startHlsStats = useCallback(() => {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    statsIntervalRef.current = setInterval(() => {
      const hls = hlsRef.current;
      const video = videoRef.current;
      if (!hls || !video) return;

      const buffered = video.buffered.length > 0
        ? video.buffered.end(video.buffered.length - 1) - video.currentTime
        : 0;

      setHlsStats({
        level: hls.currentLevel,
        bandwidth: Math.round((hls.bandwidthEstimate || 0) / 1000),
        buffered: Math.round(buffered * 10) / 10,
        dropped: (hls as unknown as { streamController?: { fragPlayed?: number } }).streamController?.fragPlayed || 0,
        loaded: hls.latency || 0,
      });
    }, 1000);
  }, []);

  const playChannel = async (channel: Channel, proxyMode: ProxyMode) => {
    setSelectedChannel(channel);
    setPlayError(null);
    setPlaying(true);
    setActiveProxy(proxyMode);
    setProxyLogs([]);
    setHlsStats(null);

    addLog("info", `Starting playback with proxy: ${proxyMode}`);
    addLog("info", `Channel: ${channel.name} | URL: ${channel.url}`);

    try {
      let proxyUrl: string;
      const fetchStart = Date.now();

      if (proxyMode === "direct-cdn") {
        addLog("info", "Calling /api/vavoo/direct (resolve CDN URL upfront)...");
        const response = await fetch("/api/vavoo/direct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: channel.url }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: "Unknown" }));
          addLog("error", `Direct CDN failed: ${data.error}`, data.debug);
          throw new Error(data.error || "Direct CDN failed");
        }

        // The endpoint returns m3u8 content directly - create a blob URL
        const m3u8Text = await response.text();
        const blob = new Blob([m3u8Text], { type: "application/vnd.apple.mpegurl" });
        proxyUrl = URL.createObjectURL(blob);
        
        const cdnUrl = response.headers.get("X-CDN-URL") || "unknown";
        const resolveDuration = response.headers.get("X-Resolve-Duration") || "?";
        addLog("success", `CDN resolved in ${resolveDuration}ms | CDN: ${cdnUrl}`);
      } else if (proxyMode === "auth") {
        addLog("info", "Calling /api/vavoo/auth-stream (MediaHubMX UA + signature)...");
        const response = await fetch("/api/vavoo/auth-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: channel.url }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: "Unknown" }));
          addLog("error", `Auth proxy failed: ${data.error}`, data.debug);
          throw new Error(data.error || "Auth proxy failed");
        }

        // Returns m3u8 directly - create blob URL
        const m3u8Text = await response.text();
        const blob = new Blob([m3u8Text], { type: "application/vnd.apple.mpegurl" });
        proxyUrl = URL.createObjectURL(blob);
        
        const hasSig = response.headers.get("X-Has-Signature") || "?";
        const sigDuration = response.headers.get("X-Sig-Duration") || "?";
        const resolveDuration = response.headers.get("X-Resolve-Duration") || "?";
        addLog("success", `Auth proxy ready: sig=${hasSig} (${sigDuration}ms) resolve=${resolveDuration}ms`);
      } else {
        addLog("info", "Calling /api/proxy (standard)...");
        const response = await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: channel.url }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error("Failed to get proxy URL");

        proxyUrl = data.proxyUrl;
        addLog("success", `Standard proxy ready in ${Date.now() - fetchStart}ms`);
      }

      addLog("info", `Loading HLS source...`);

      if (videoRef.current) {
        if (Hls.isSupported()) {
          if (hlsRef.current) hlsRef.current.destroy();

          const hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false,
            // Aggressive buffering to prevent stalls
            backBufferLength: 30,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            maxBufferSize: 120 * 1000 * 1000,
            maxBufferHole: 1.5,
            // Tolerant of slow loads
            manifestLoadingTimeOut: 20000,
            manifestLoadingMaxRetry: 6,
            levelLoadingTimeOut: 20000,
            levelLoadingMaxRetry: 6,
            fragLoadingTimeOut: 30000,
            fragLoadingMaxRetry: 8,
            // Performance
            startFragPrefetch: true,
            progressive: true,
            // Start at lowest quality then upgrade (faster first frame)
            startLevel: 0,
            // ABR tuning
            abrEwmaDefaultEstimate: 1000000,
            abrBandWidthFactor: 0.8,
            abrBandWidthUpFactor: 0.5,
            // Nudge past stalls
            nudgeOffset: 0.2,
            nudgeMaxRetry: 10,
            highBufferWatchdogPeriod: 3,
          });

          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
            addLog("success", `Manifest parsed: ${data.levels.length} quality levels`);
            videoRef.current?.play().catch(() => {
              setPlayError("Cliquez sur play pour lancer la lecture");
            });
            startHlsStats();
          });

          hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
            addLog("info", `Level loaded: ${data.details.totalduration?.toFixed(1)}s total duration`);
          });

          hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
            const size = data.frag.stats?.total || 0;
            const duration = data.frag.stats?.loading
              ? data.frag.stats.loading.end - data.frag.stats.loading.start
              : 0;
            addLog(
              "info",
              `Segment loaded: ${(size / 1024).toFixed(0)}KB in ${duration.toFixed(0)}ms (${duration > 0 ? ((size * 8) / duration / 1000).toFixed(1) : "?"}Mbps)`,
            );
          });

          hls.on(Hls.Events.ERROR, (_e, data) => {
            addLog(
              data.fatal ? "error" : "warn",
              `HLS ${data.fatal ? "FATAL" : "warn"}: ${data.type} - ${data.details}`,
            );
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  setPlayError("Erreur reseau - reconnexion...");
                  setTimeout(() => {
                    hls.startLoad();
                    setPlayError(null);
                  }, 2000);
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError();
                  break;
                default:
                  setPlayError(`Erreur: ${data.details}`);
                  break;
              }
            }
          });

          hls.loadSource(proxyUrl);
          hls.attachMedia(videoRef.current);
        } else if (
          videoRef.current.canPlayType("application/vnd.apple.mpegurl")
        ) {
          videoRef.current.src = proxyUrl;
          videoRef.current.play().catch(() => {
            setPlayError("Erreur de lecture");
          });
          startHlsStats();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur de lecture";
      setPlayError(msg);
      addLog("error", msg);
    }
  };

  const getCountryFlagUrl = (countryCode: string): string => {
    const codeMap: Record<string, string> = {
      albania: "al",
      arabia: "sa",
      balkans: "eu",
      bulgaria: "bg",
      france: "fr",
      germany: "de",
      italy: "it",
      netherlands: "nl",
      poland: "pl",
      portugal: "pt",
      romania: "ro",
      russia: "ru",
      spain: "es",
      turkey: "tr",
      united_kingdom: "gb",
      "united kingdom": "gb",
      uk: "gb",
    };
    const iso =
      codeMap[countryCode.toLowerCase()] || countryCode.toLowerCase();
    return `https://flagcdn.com/w80/${iso}.png`;
  };

  const filteredChannels = selectedCountry
    ? selectedCountry.channels.filter((channel) =>
        channel.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
          <p className="text-slate-400">Chargement des chaines...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Video Player */}
          {selectedChannel && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Play className="w-5 h-5 text-blue-400" />
                      {selectedChannel.name}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {selectedCountry?.name}
                      {activeProxy && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {activeProxy === "standard" && "Standard"}
                          {activeProxy === "auth" && "Auth"}
                          {activeProxy === "direct-cdn" && "CDN Direct"}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedChannel(null);
                      setActiveProxy(null);
                      setProxyLogs([]);
                      setHlsStats(null);
                      if (hlsRef.current) hlsRef.current.destroy();
                      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
                    }}
                    className="bg-transparent bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Retour
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {playError && (
                  <Alert
                    variant="destructive"
                    className="bg-red-950/50 border-red-900"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{playError}</AlertDescription>
                  </Alert>
                )}

                {/* Proxy Buttons */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => playChannel(selectedChannel, "standard")}
                    variant="outline"
                    size="sm"
                    className={`bg-transparent border-slate-700 hover:bg-slate-700 ${activeProxy === "standard" ? "bg-slate-700 border-blue-500 text-white" : "bg-slate-800"}`}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Proxy Standard
                  </Button>
                  <Button
                    onClick={() => playChannel(selectedChannel, "auth")}
                    variant="outline"
                    size="sm"
                    className={`bg-transparent border-blue-700 hover:bg-blue-800 text-blue-200 ${activeProxy === "auth" ? "bg-blue-800 border-blue-400" : "bg-blue-900/50"}`}
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Proxy avec Auth
                  </Button>
                  <Button
                    onClick={() => playChannel(selectedChannel, "direct-cdn")}
                    variant="outline"
                    size="sm"
                    className={`bg-transparent border-green-700 hover:bg-green-800 text-green-200 ${activeProxy === "direct-cdn" ? "bg-green-800 border-green-400" : "bg-green-900/50"}`}
                  >
                    <Rocket className="w-4 h-4 mr-2" />
                    CDN Direct (Rapide)
                  </Button>
                </div>

                {/* Video Player */}
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    className="w-full h-full"
                    controls
                    playsInline
                    autoPlay
                    preload="auto"
                  >
                    Votre navigateur ne supporte pas la lecture video.
                  </video>
                </div>

                {/* HLS Stats Bar */}
                {hlsStats && (
                  <div className="flex gap-4 text-xs text-slate-400 bg-slate-800/50 rounded px-3 py-2 font-mono">
                    <span>
                      <Zap className="w-3 h-3 inline mr-1 text-yellow-400" />
                      {hlsStats.bandwidth} kbps
                    </span>
                    <span>Buffer: {hlsStats.buffered}s</span>
                    <span>Level: {hlsStats.level}</span>
                  </div>
                )}

                {/* Debug Panel */}
                <div className="border border-slate-700 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setDebugOpen(!debugOpen)}
                    className="w-full flex items-center justify-between px-4 py-2 bg-slate-800/50 hover:bg-slate-800 transition-colors text-sm text-slate-300"
                  >
                    <span className="flex items-center gap-2">
                      <Bug className="w-4 h-4" />
                      Debug Proxy ({proxyLogs.length} logs)
                    </span>
                    {debugOpen ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {debugOpen && (
                    <div className="max-h-64 overflow-y-auto bg-slate-950 p-3 font-mono text-xs space-y-1">
                      {proxyLogs.length === 0 && (
                        <p className="text-slate-500">
                          Aucun log. Cliquez sur un proxy pour commencer.
                        </p>
                      )}
                      {proxyLogs.map((log, i) => (
                        <div
                          key={`${log.time}-${i}`}
                          className={`flex gap-2 ${
                            log.type === "error"
                              ? "text-red-400"
                              : log.type === "success"
                                ? "text-green-400"
                                : log.type === "warn"
                                  ? "text-yellow-400"
                                  : "text-slate-400"
                          }`}
                        >
                          <span className="text-slate-600 flex-shrink-0">
                            {log.time}
                          </span>
                          <span className="flex-shrink-0">
                            {log.type === "error"
                              ? "[ERR]"
                              : log.type === "success"
                                ? "[OK]"
                                : log.type === "warn"
                                  ? "[WARN]"
                                  : "[INFO]"}
                          </span>
                          <span className="break-all">{log.message}</span>
                        </div>
                      ))}
                      {proxyLogs.some((l) => l.data) && (
                        <details className="mt-2">
                          <summary className="text-slate-500 cursor-pointer hover:text-slate-300">
                            Donnees brutes
                          </summary>
                          <pre className="text-slate-500 mt-1 whitespace-pre-wrap break-all">
                            {JSON.stringify(
                              proxyLogs
                                .filter((l) => l.data)
                                .map((l) => ({
                                  time: l.time,
                                  data: l.data,
                                })),
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Country Selection */}
          {!selectedCountry && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Globe className="w-5 h-5 text-blue-400" />
                  Selectionnez un pays
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {countries.length} pays disponibles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {countries.map((country) => (
                    <Button
                      key={country.code}
                      onClick={() => setSelectedCountry(country)}
                      className="h-auto py-4 bg-transparent bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 transition-all"
                      variant="outline"
                    >
                      <div className="flex flex-col items-center gap-2 w-full">
                        <img
                          src={
                            getCountryFlagUrl(country.code) ||
                            "/placeholder.svg"
                          }
                          alt={country.name}
                          className="w-10 h-7 object-cover rounded shadow-sm"
                          crossOrigin="anonymous"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        <div className="text-center">
                          <div className="font-semibold text-white">
                            {country.name}
                          </div>
                          <div className="text-xs text-slate-400">
                            {country.channels.length} chaines
                          </div>
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Channel List */}
          {selectedCountry && !selectedChannel && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Tv className="w-5 h-5 text-blue-400" />
                      {selectedCountry.name}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {filteredChannels.length} chaines
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedCountry(null);
                      setSearchQuery("");
                    }}
                    className="bg-transparent bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Retour
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    type="text"
                    placeholder="Rechercher une chaine..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-slate-950 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-2">
                  {filteredChannels.map((channel) => (
                    <Button
                      key={channel.id}
                      onClick={() => playChannel(channel, "standard")}
                      className="h-auto py-3 bg-transparent bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 transition-all justify-start"
                      variant="outline"
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                          {channel.logo ? (
                            <img
                              src={channel.logo || "/placeholder.svg"}
                              alt={channel.name}
                              className="w-8 h-8 object-contain"
                            />
                          ) : (
                            <Tv className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <span className="font-medium text-white text-left truncate">
                          {channel.name}
                        </span>
                      </div>
                    </Button>
                  ))}
                </div>

                {filteredChannels.length === 0 && (
                  <div className="text-center py-12 text-slate-400">
                    Aucune chaine trouvee
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
