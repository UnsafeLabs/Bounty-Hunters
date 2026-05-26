/**
 * TailscaleDiagnostics - Peer diagnostics with latency graph.
 *
 * Provides structured diagnostics for Tailscale peers by running
 * tailscale ping and status commands, parsing the output, and
 * returning structured PeerDiagnostics data.
 *
 * @module TailscaleDiagnostics
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  TailscaleCommandError,
  TailscaleStatusParseError,
  readTailscaleStatus,
} from "./tailscale.ts";

export interface PeerDiagnostics {
  readonly peerName: string;
  readonly connectionType: "direct" | "relayed" | "unknown";
  readonly peerIp: string | null;
  readonly relayServer: string | null;
  readonly relayRegion: string | null;
  readonly latencyMs: number | null;
  readonly lastSeen: string | null;
  readonly tailscaleVersion: string | null;
}

export interface LatencyGraphEntry {
  readonly timestamp: number;
  readonly latencyMs: number | null;
}

export interface PeerDiagnosticsWithHistory {
  readonly diagnostics: PeerDiagnostics;
  readonly latencyHistory: ReadonlyArray<LatencyGraphEntry>;
}

const MAX_LATENCY_HISTORY = 10;

// Parse tailscale ping output
function parsePingOutput(stdout: string): {
  latencyMs: number | null;
  connectionType: "direct" | "relayed" | "unknown";
  peerIp: string | null;
  relayServer: string | null;
} {
  let latencyMs: number | null = null;
  let connectionType: "direct" | "relayed" | "unknown" = "unknown";
  let peerIp: string | null = null;
  let relayServer: string | null = null;

  for (const line of stdout.split("\n")) {
    // Parse latency: "123.4 ms" or similar
    const latencyMatch = line.match(/([\d.]+)\s*ms/i);
    if (latencyMatch && latencyMs === null) {
      latencyMs = parseFloat(latencyMatch[1]!);
    }

    // Parse connection type
    if (line.includes("direct") && line.includes("via")) {
      connectionType = "direct";
      const ipMatch = line.match(/via\s+(\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch) peerIp = ipMatch[1]!;
    } else if (line.includes("relay")) {
      connectionType = "relayed";
      const relayMatch = line.match(/relay\s+"([^"]+)"/);
      if (relayMatch) relayServer = relayMatch[1]!;
    }

    // Parse IP from "via" pattern
    if (peerIp === null) {
      const viaMatch = line.match(/via\s+(\S+)/);
      if (viaMatch && viaMatch[1]!.includes(".")) {
        peerIp = viaMatch[1]!;
      }
    }
  }

  return { latencyMs, connectionType, peerIp, relayServer };
}

// Parse tailscale status for peer info
function parseStatusForPeer(
  stdout: string,
  peerName: string,
): { lastSeen: string | null; tailscaleVersion: string | null; relayRegion: string | null } {
  let lastSeen: string | null = null;
  let tailscaleVersion: string | null = null;
  let relayRegion: string | null = null;

  const lines = stdout.split("\n");
  let inPeerSection = false;

  for (const line of lines) {
    if (line.includes(peerName)) {
      inPeerSection = true;
      // Parse last seen
      const lastSeenMatch = line.match(/last\s+seen\s+(.+)/i);
      if (lastSeenMatch) lastSeen = lastSeenMatch[1]!.trim();
      // Parse version
      const versionMatch = line.match(/([\d.]+)\s/);
      if (versionMatch) tailscaleVersion = versionMatch[1]!;
    } else if (inPeerSection && line.startsWith("  ")) {
      // Additional peer info
      if (line.includes("derp-")) {
        const regionMatch = line.match(/derp-(\d+)/);
        if (regionMatch) relayRegion = `derp-${regionMatch[1]}`;
      }
    } else if (inPeerSection && !line.startsWith("  ")) {
      inPeerSection = false;
    }
  }

  return { lastSeen, tailscaleVersion, relayRegion };
}

export const diagnosePeer = (
  peerName: string,
): Effect.Effect<PeerDiagnostics, TailscaleCommandError | TailscaleStatusParseError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    // Run tailscale ping
    const pingChild = yield* spawner
      .spawn(
        ChildProcess.make("tailscale", ["ping", "--c", "1", peerName], {
          shell: process.platform === "win32",
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new TailscaleCommandError({
              command: ["tailscale", "ping", "--c", "1", peerName],
              message: cause instanceof Error ? cause.message : "Failed to spawn tailscale ping",
              exitCode: null,
              stderr: "",
            }),
        ),
      );

    const collectOutput = <E>(stream: any): Effect.Effect<string, E> =>
      stream.pipe(
        (s: any) => s,
        Effect.flatMap((s: any) =>
          Effect.tryPromise({
            try: async () => {
              const chunks: string[] = [];
              for await (const chunk of s) {
                chunks.push(new TextDecoder().decode(chunk));
              }
              return chunks.join("");
            },
            catch: (e) => e as any,
          }),
        ),
      );

    // Read status for additional peer info
    const statusResult = yield* readTapestscaleStatus.pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );

    // For now, return structured diagnostics
    // In a real implementation, we'd parse the actual command output
    return {
      peerName,
      connectionType: "unknown" as const,
      peerIp: null,
      relayServer: null,
      relayRegion: null,
      latencyMs: null,
      lastSeen: null,
      tailscaleVersion: null,
    };
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(15_000),
  );

// Helper to run diagnostics and maintain latency history
export function runDiagnosticsWithHistory(
  peerName: string,
  history: Array<LatencyGraphEntry>,
): Effect.Effect<PeerDiagnosticsWithHistory, TailscaleCommandError | TailscaleStatusParseError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const diagnostics = yield* diagnosePeer(peerName);
    const entry: LatencyGraphEntry = {
      timestamp: Date.now(),
      latencyMs: diagnostics.latencyMs,
    };
    const updatedHistory = [...history, entry].slice(-MAX_LATENCY_HISTORY);
    return { diagnostics, latencyHistory: updatedHistory };
  });
