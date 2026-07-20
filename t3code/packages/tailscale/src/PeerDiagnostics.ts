/**
 * Tailscale peer diagnostics: parse ping/status, latency history (issue #844).
 */

export type ConnectionType = "direct" | "relayed" | "unknown";

export interface PeerDiagnostics {
  peer: string;
  connectionType: ConnectionType;
  latencyMs: number | null;
  peerIp: string | null;
  derpServer: string | null;
  derpRegion: string | null;
  lastSeen: string | null;
  online: boolean;
  error: string | null;
  latencyHistory: number[];
}

export interface DiagnoseOptions {
  /** Injected runner for tests; defaults to throwing "not installed" style errors. */
  runCommand?: (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
  timeoutMs?: number;
  pingCount?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Parse `tailscale ping` lines for latency and direct/relay hints. */
export function parsePingOutput(stdout: string): {
  latencies: number[];
  connectionType: ConnectionType;
  peerIp: string | null;
  derpServer: string | null;
} {
  const latencies: number[] = [];
  let connectionType: ConnectionType = "unknown";
  let peerIp: string | null = null;
  let derpServer: string | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    const lat = line.match(/in\s+([\d.]+)\s*ms/i) || line.match(/time[=:]?\s*([\d.]+)\s*ms/i);
    if (lat) latencies.push(Number(lat[1]));

    if (/via\s+DERP/i.test(line) || /relay/i.test(line)) {
      connectionType = "relayed";
      const derp = line.match(/DERP\s*\(([^)]+)\)/i) || line.match(/via\s+([A-Za-z0-9_-]+)/i);
      if (derp) derpServer = derp[1]!.trim();
    }
    if (/direct/i.test(line) && !/via\s+DERP/i.test(line)) {
      connectionType = "direct";
    }
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (ip && connectionType === "direct") peerIp = ip[1]!;
    // also capture from "pong from 100.x"
    const pong = line.match(/pong from\s+(\S+)/i);
    if (pong && /^\d+\.\d+\.\d+\.\d+$/.test(pong[1]!)) peerIp = pong[1]!;
  }

  if (connectionType === "unknown" && latencies.length > 0) {
    connectionType = derpServer ? "relayed" : "direct";
  }

  return { latencies, connectionType, peerIp, derpServer };
}

/** Parse `tailscale status` for a peer's last seen / relay region. */
export function parseStatusForPeer(
  stdout: string,
  peer: string,
): {
  lastSeen: string | null;
  online: boolean;
  derpRegion: string | null;
  peerIp: string | null;
} {
  const lines = stdout.split(/\r?\n/);
  let lastSeen: string | null = null;
  let online = false;
  let derpRegion: string | null = null;
  let peerIp: string | null = null;
  const peerLower = peer.toLowerCase();

  for (const line of lines) {
    if (!line.toLowerCase().includes(peerLower) && !line.includes(peer)) {
      // also match by IP hostname fragments
      continue;
    }
    const ip = line.match(/\b(100\.\d+\.\d+\.\d+)\b/);
    if (ip) peerIp = ip[1]!;
    if (/offline/i.test(line)) online = false;
    else if (/active|idle|online/i.test(line) || ip) online = true;
    const seen = line.match(/last seen[:\s]+(.+?)(?:\s{2,}|$)/i) || line.match(/(\d+[smhd]\s+ago)/i);
    if (seen) lastSeen = seen[1]!.trim();
    const region = line.match(/relay[:\s]+([A-Za-z0-9_-]+)/i) || line.match(/derp[:\s]+([A-Za-z0-9_-]+)/i);
    if (region) derpRegion = region[1]!;
  }

  return { lastSeen, online, derpRegion, peerIp };
}

/** Keep last N latency samples for graph. */
export function pushLatencyHistory(history: number[], sample: number, max = 10): number[] {
  const next = history.concat(sample);
  return next.length > max ? next.slice(next.length - max) : next;
}

export async function diagnosePeer(
  peer: string,
  options: DiagnoseOptions = {},
): Promise<PeerDiagnostics> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pingCount = options.pingCount ?? 3;
  const run =
    options.runCommand ??
    (async () => {
      throw new Error("tailscale CLI not available");
    });

  const base: PeerDiagnostics = {
    peer,
    connectionType: "unknown",
    latencyMs: null,
    peerIp: null,
    derpServer: null,
    derpRegion: null,
    lastSeen: null,
    online: false,
    error: null,
    latencyHistory: [],
  };

  try {
    const controller = { timedOut: false };
    const timer = setTimeout(() => {
      controller.timedOut = true;
    }, timeoutMs);

    try {
      const status = await run(["status"]);
      const statusInfo = parseStatusForPeer(status.stdout, peer);

      const ping = await run(["ping", "-c", String(pingCount), peer]);
      const pingInfo = parsePingOutput(ping.stdout + "\n" + ping.stderr);

      if (controller.timedOut) {
        return { ...base, error: `diagnostics timed out after ${timeoutMs}ms` };
      }

      let history: number[] = [];
      for (const lat of pingInfo.latencies) {
        history = pushLatencyHistory(history, lat, 10);
      }

      const latencyMs =
        history.length > 0
          ? history.reduce((a, b) => a + b, 0) / history.length
          : null;

      return {
        peer,
        connectionType: pingInfo.connectionType,
        latencyMs,
        peerIp: pingInfo.peerIp ?? statusInfo.peerIp,
        derpServer: pingInfo.derpServer,
        derpRegion: statusInfo.derpRegion,
        lastSeen: statusInfo.lastSeen,
        online: statusInfo.online || history.length > 0,
        error: ping.code !== 0 && history.length === 0 ? ping.stderr || "ping failed" : null,
        latencyHistory: history,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const notInstalled = /not found|not available|ENOENT|not installed/i.test(msg);
    return {
      ...base,
      error: notInstalled
        ? "tailscale is not installed or not on PATH"
        : `peer diagnostics failed: ${msg}`,
    };
  }
}

/** RPC-shaped wrapper with hard 15s budget. */
export async function diagnosePeerRpc(
  peer: string,
  options: DiagnoseOptions = {},
): Promise<PeerDiagnostics> {
  return diagnosePeer(peer, { ...options, timeoutMs: options.timeoutMs ?? 15_000 });
}
