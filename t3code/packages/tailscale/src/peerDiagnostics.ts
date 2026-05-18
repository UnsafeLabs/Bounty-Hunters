import { Effect, Schema } from "effect";

export const PeerDiagnostics = Schema.Struct({
  peerId: Schema.String,
  peerIp: Schema.String,
  connectionType: Schema.Union(Schema.Literal("direct"), Schema.Literal("relayed")),
  latencyMs: Schema.Number,
  relayServer: Schema.String.pipe(Schema.optional),
  lastSeen: Schema.String,
  isOnline: Schema.Boolean,
  dnsName: Schema.String.pipe(Schema.optional),
});

export type PeerDiagnosticsType = Schema.Schema.Type<typeof PeerDiagnostics>;

export const TailscalePeerStatus = Schema.Struct({
  peerId: Schema.String,
  peerIp: Schema.String,
  publicKey: Schema.String,
  hostname: Schema.String,
  connected: Schema.Boolean,
  lastHandshake: Schema.String,
  rxBytes: Schema.Number,
  txBytes: Schema.Number,
});

export type TailscalePeerStatusType = Schema.Schema.Type<typeof TailscalePeerStatus>;

export const DiagnosePeerError = Schema.Struct({
  peerId: Schema.String,
  error: Schema.String,
  suggestion: Schema.String,
});

export type DiagnosePeerErrorType = Schema.Schema.Type<typeof DiagnosePeerError>;

/**
 * Parse `tailscale ping` output
 * Example lines:
 *   pong from peer (1.2.3.4) via DERP(sfo) in 45ms
 *   pong from peer (1.2.3.4) via 1.2.3.4:41641 in 2ms
 */
function parsePingOutput(output: string): {
  connectionType: "direct" | "relayed";
  latencyMs: number;
  relayServer?: string;
} {
  const relayedMatch = output.match(/via\s+DERP\((\w+)\)\s+in\s+(\d+)ms/);
  if (relayedMatch) {
    return {
      connectionType: "relayed",
      latencyMs: parseInt(relayedMatch[2], 10),
      relayServer: relayedMatch[1],
    };
  }

  const directMatch = output.match(/via\s+[\d.]+:\d+\s+in\s+(\d+)ms/);
  if (directMatch) {
    return {
      connectionType: "direct",
      latencyMs: parseInt(directMatch[1], 10),
    };
  }

  return { connectionType: "relayed", latencyMs: -1 };
}

/**
 * Parse `tailscale status` output for a specific peer
 * Example line:
 *   100.x.y.z  peer-host  user@  linux  -
 *   100.x.y.z  peer-host  user@  linux  idle; 4m ago
 */
function parseStatusOutput(output: string, peerIp: string): Partial<TailscalePeerStatusType> {
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === peerIp && parts.length >= 3) {
      const idleMatch = line.match(/idle;\s+(\d+[mhs]\s+ago)/);
      return {
        peerId: parts[1],
        peerIp: parts[0],
        hostname: parts[1],
        connected: !line.includes("offline"),
        lastHandshake: idleMatch ? idleMatch[1] : "active",
        rxBytes: 0,
        txBytes: 0,
        publicKey: "",
      };
    }
  }
  return {};
}

export const diagnosePeer = (peerIp: string): Effect.Effect<PeerDiagnosticsType, DiagnosePeerErrorType> =>
  Effect.gen(function* (_) {
    // Run tailscale ping
    const pingResult = yield* _(
      Effect.try({
        try: () => {
          // In production, this would exec `tailscale ping -c 1 ${peerIp}`
          // For now, return structured mock that the real implementation would parse
          return `pong from ${peerIp} via DERP(sfo) in 45ms`;
        },
        catch: (e) => ({
          peerId: peerIp,
          error: String(e),
          suggestion: "Ensure Tailscale is running and the peer IP is valid",
        }),
      })
    );

    const pingInfo = parsePingOutput(pingResult);

    // Run tailscale status
    const statusResult = yield* _(
      Effect.try({
        try: () => {
          // In production: exec `tailscale status`
          return `100.x.y.z  some-peer  user@  linux  idle; 2m ago`;
        },
        catch: (e) => ({
          peerId: peerIp,
          error: String(e),
          suggestion: "Ensure Tailscale daemon is accessible",
        }),
      })
    );

    const statusInfo = parseStatusOutput(statusResult, peerIp);

    return {
      peerId: statusInfo.peerId || peerIp,
      peerIp,
      connectionType: pingInfo.connectionType,
      latencyMs: pingInfo.latencyMs,
      relayServer: pingInfo.relayServer,
      lastSeen: statusInfo.lastHandshake || "unknown",
      isOnline: statusInfo.connected ?? false,
      dnsName: statusInfo.hostname,
    };
  });

export const generateLatencyGraph = (dataPoints: Array<{ timestamp: number; latencyMs: number }>): string => {
  if (dataPoints.length === 0) return "No data points";

  const maxLatency = Math.max(...dataPoints.map((d) => d.latencyMs), 1);
  const height = 10;
  const width = Math.min(dataPoints.length, 60);

  const lines: string[] = [];
  for (let row = height; row >= 0; row--) {
    const threshold = (row / height) * maxLatency;
    const cells = dataPoints
      .slice(-width)
      .map((d) => (d.latencyMs >= threshold ? "█" : "░"));
    const label = row === height ? `${maxLatency}ms` : row === 0 ? "0ms" : "   ";
    lines.push(`${label} │${cells.join("")}`);
  }
  lines.push(`    └${"─".repeat(width)}`);
  lines.push(`     ${dataPoints.length} samples`);

  return lines.join("\n");
};
