import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const ConnectionType = Schema.Literal("direct", "relay");
export type ConnectionType = typeof ConnectionType.Type;

export const PeerDiagnostics = Schema.Struct({
  peerId: Schema.String,
  connectionType: ConnectionType,
  latency: Schema.Number,
  relayServer: Schema.NullOr(Schema.String),
  relayRegion: Schema.NullOr(Schema.String),
  peerIp: Schema.NullOr(Schema.String),
  lastSeen: Schema.String,
  isOnline: Schema.Boolean,
});
export type PeerDiagnostics = typeof PeerDiagnostics.Type;

export const PingResult = Schema.Struct({
  latency: Schema.Number,
  connectionType: ConnectionType,
  peerIp: Schema.NullOr(Schema.String),
  relayServer: Schema.NullOr(Schema.String),
});
export type PingResult = typeof PingResult.Type;

export class PeerDiagnosticsError extends Error {
  readonly _tag = "PeerDiagnosticsError";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export interface PeerDiagnosticsServiceShape {
  readonly diagnosePeer: (
    peerId: string,
  ) => Effect.Effect<PeerDiagnostics, PeerDiagnosticsError>;

  readonly pingPeer: (
    peerId: string,
    count?: number,
  ) => Effect.Effect<ReadonlyArray<PingResult>, PeerDiagnosticsError>;
}

export class PeerDiagnosticsService extends Context.Service<
  PeerDiagnosticsService,
  PeerDiagnosticsServiceShape
>()("t3/tailscale/PeerDiagnosticsService") {}

export function parseTailscalePingOutput(output: string): PingResult | null {
  const lines = output.split("\n");

  for (const line of lines) {
    const directMatch = line.match(
      /pong from .* \(([\d.]+)\) via (DERP|DERP-\w+)\(([^)]+)\) in (\d+)ms/,
    );
    if (directMatch) {
      return {
        latency: parseInt(directMatch[4], 10),
        connectionType: "relay",
        peerIp: directMatch[1],
        relayServer: directMatch[3],
      };
    }

    const localMatch = line.match(
      /pong from .* \(([\d.]+)\) via (\D*) in (\d+)ms/,
    );
    if (localMatch) {
      return {
        latency: parseInt(localMatch[3], 10),
        connectionType: "direct",
        peerIp: localMatch[1],
        relayServer: null,
      };
    }

    const directPing = line.match(/pong from .* \(([\d.]+)\) in (\d+)ms/);
    if (directPing) {
      return {
        latency: parseInt(directPing[2], 10),
        connectionType: "direct",
        peerIp: directPing[1],
        relayServer: null,
      };
    }
  }

  return null;
}

export function parseTailscaleStatusOutput(
  output: string,
  peerId: string,
): { lastSeen: string; isOnline: boolean; relayServer: string | null; relayRegion: string | null } | null {
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.includes(peerId)) continue;

    const onlineMatch = line.match(/(idle|active|offline)/);
    const isOnline = onlineMatch ? onlineMatch[1] !== "offline" : false;

    const relayMatch = line.match(/relay\s+"([^"]+)"(?:\s+\(([^)]+)\))?/);
    const relayServer = relayMatch ? relayMatch[1] : null;
    const relayRegion = relayMatch ? relayMatch[2] ?? null : null;

    const lastSeen = new Date().toISOString();

    return { lastSeen, isOnline, relayServer, relayRegion };
  }

  return null;
}
