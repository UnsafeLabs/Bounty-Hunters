/**
 * TailscaleDiagnostics - Peer diagnostics with latency graph (#844)
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Duration from "effect/Duration";

// ============ Schemas ============

export const ConnectionType = Schema.Literals(["direct", "relayed"]);
export type ConnectionType = typeof ConnectionType.Type;

export const PeerDiagnostics = Schema.Struct({
  peerId: Schema.String,
  connectionType: ConnectionType,
  latencyMs: Schema.optional(Schema.Number),
  peerIp: Schema.optional(Schema.String),
  derpServer: Schema.optional(Schema.String),
  derpRegion: Schema.optional(Schema.String),
  lastSeen: Schema.optional(Schema.String),
  isOnline: Schema.Boolean,
});
export type PeerDiagnostics = typeof PeerDiagnostics.Type;

export const LatencyRecord = Schema.Struct({
  timestamp: Schema.String,
  latencyMs: Schema.Number,
  connectionType: ConnectionType,
});
export type LatencyRecord = typeof LatencyRecord.Type;

export const DiagnosticsError = Schema.TaggedError<DiagnosticsError>()("DiagnosticsError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
});
export type DiagnosticsError = typeof DiagnosticsError.Type;

// ============ Service ============

export interface TailscaleDiagnostics {
  readonly diagnosePeer: (peerId: string) => Effect.Effect<PeerDiagnostics, DiagnosticsError>;
  readonly getLatencyHistory: (peerId: string) => Effect.Effect<ReadonlyArray<LatencyRecord>, DiagnosticsError>;
}

export const TailscaleDiagnostics = Context.GenericTag<TailscaleDiagnostics>(
  "@t3code/TailscaleDiagnostics"
);

// ============ CLI Parser ============

interface TailscalePingResult {
  peerId: string;
  latencyMs: number | undefined;
  connectionType: "direct" | "relayed";
  peerIp: string | undefined;
  derpServer: string | undefined;
}

function parsePingOutput(output: string): Omit<TailscalePingResult, "derpServer"> | null {
  // "pong from peer (1.2.3.4) via DERP(sfo) in 45ms"
  // "pong from peer (1.2.3.4) via 10.0.0.1 in 12ms"
  const viaDerp = output.match(/pong from .+? via DERP\((.+?)\) in (\d+)ms/);
  if (viaDerp) {
    return {
      peerId: "",
      latencyMs: parseInt(viaDerp[2]),
      connectionType: "relayed",
      peerIp: undefined,
    };
  }

  const viaDirect = output.match(/pong from .+? \(([\d.]+)\) via ([\d.]+) in (\d+)ms/);
  if (viaDirect) {
    return {
      peerId: "",
      latencyMs: parseInt(viaDirect[3]),
      connectionType: "direct",
      peerIp: viaDirect[1],
    };
  }

  // Simple direct: "pong from peer (1.2.3.4) in 8ms"
  const simple = output.match(/pong from .+? \(([\d.]+)\) in (\d+)ms/);
  if (simple) {
    return {
      peerId: "",
      latencyMs: parseInt(simple[2]),
      connectionType: "direct",
      peerIp: simple[1],
    };
  }

  return null;
}

interface TailscaleStatusPeer {
  peerId: string;
  derpServer: string | undefined;
  derpRegion: string | undefined;
  lastSeen: string | undefined;
  isOnline: boolean;
}

function parseStatusOutput(output: string, targetPeer: string): TailscaleStatusPeer | null {
  const lines = output.split("\n");
  for (const line of lines) {
    if (line.includes(targetPeer)) {
      const isOnline = !line.includes("offline") && !line.includes("idle");
      const derpMatch = line.match(/DERP\((.+?)\)/);
      return {
        peerId: targetPeer,
        derpServer: derpMatch?.[1],
        derpRegion: derpMatch?.[1]?.split("-")[0],
        lastSeen: undefined, // would need `tailscale status --json` for exact time
        isOnline,
      };
    }
  }
  return null;
}

// ============ Implementation ============

interface CommandRunner {
  readonly run: (cmd: string, args: string[], timeout?: Duration.Duration) => Effect.Effect<string, DiagnosticsError>;
}
const CommandRunner = Context.GenericTag<CommandRunner>("@t3code/CommandRunner");

// In-memory latency history (max 10 per peer)
const latencyHistory = new Map<string, Array<{ timestamp: string; latencyMs: number; connectionType: "direct" | "relayed" }>>();

const makeDiagnostics = Effect.gen(function* (_) {
  const runner = yield* _(CommandRunner);

  const diagnosePeer: TailscaleDiagnostics["diagnosePeer"] = (peerId) =>
    Effect.gen(function* (_) {
      // Run tailscale ping
      const pingOutput = yield* _(
        runner.run("tailscale", ["ping", "--c", "3", peerId], Duration.seconds(15))
      );

      const pingResult = parsePingOutput(pingOutput);

      // Run tailscale status
      const statusOutput = yield* _(
        runner.run("tailscale", ["status"], Duration.seconds(10))
      );

      const statusResult = parseStatusOutput(statusOutput, peerId);

      const diagnostics: PeerDiagnostics = {
        peerId,
        connectionType: pingResult?.connectionType ?? "relayed",
        latencyMs: pingResult?.latencyMs ?? undefined,
        peerIp: pingResult?.peerIp ?? undefined,
        derpServer: statusResult?.derpServer ?? pingResult?.derpServer,
        derpRegion: statusResult?.derpRegion,
        lastSeen: statusResult?.lastSeen ?? undefined,
        isOnline: statusResult?.isOnline ?? false,
      };

      // Store latency history
      if (diagnostics.latencyMs !== undefined) {
        const history = latencyHistory.get(peerId) ?? [];
        history.push({
          timestamp: new Date().toISOString(),
          latencyMs: diagnostics.latencyMs,
          connectionType: diagnostics.connectionType,
        });
        if (history.length > 10) history.shift();
        latencyHistory.set(peerId, history);
      }

      return diagnostics;
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new DiagnosticsError({ message: `Tailscale diagnostics failed: ${err}` }))
      )
    );

  const getLatencyHistory: TailscaleDiagnostics["getLatencyHistory"] = (peerId) =>
    Effect.sync(() => (latencyHistory.get(peerId) ?? []).map((r) => r));

  return TailscaleDiagnostics.of({ diagnosePeer, getLatencyHistory });
});

// ============ Layer ============

export const TailscaleDiagnosticsLive = Layer.effect(TailscaleDiagnostics, makeDiagnostics);
