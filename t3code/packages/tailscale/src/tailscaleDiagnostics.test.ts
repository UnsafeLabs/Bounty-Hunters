import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  type PeerDiagnostics,
  type LatencyGraphEntry,
  type PeerDiagnosticsWithHistory,
} from "./tailscaleDiagnostics.ts";

describe("PeerDiagnostics types", () => {
  it("creates a valid PeerDiagnostics object", () => {
    const diag: PeerDiagnostics = {
      peerName: "test-peer",
      connectionType: "direct",
      peerIp: "100.64.0.1",
      relayServer: null,
      relayRegion: null,
      latencyMs: 42.5,
      lastSeen: "2 minutes ago",
      tailscaleVersion: "1.58.0",
    };
    assert.equal(diag.peerName, "test-peer");
    assert.equal(diag.connectionType, "direct");
    assert.equal(diag.latencyMs, 42.5);
  });

  it("creates a valid LatencyGraphEntry", () => {
    const entry: LatencyGraphEntry = {
      timestamp: Date.now(),
      latencyMs: 100,
    };
    assert.ok(entry.timestamp > 0);
    assert.equal(entry.latencyMs, 100);
  });

  it("creates a valid PeerDiagnosticsWithHistory", () => {
    const history: LatencyGraphEntry[] = [
      { timestamp: 1000, latencyMs: 50 },
      { timestamp: 2000, latencyMs: 60 },
      { timestamp: 3000, latencyMs: 55 },
    ];
    const result: PeerDiagnosticsWithHistory = {
      diagnostics: {
        peerName: "peer",
        connectionType: "relayed",
        peerIp: null,
        relayServer: "derp-1",
        relayRegion: "us-east",
        latencyMs: 55,
        lastSeen: "just now",
        tailscaleVersion: "1.58.0",
      },
      latencyHistory: history,
    };
    assert.equal(result.latencyHistory.length, 3);
    assert.equal(result.diagnostics.relayServer, "derp-1");
  });
});

describe("Latency history management", () => {
  it("maintains max 10 entries in history", () => {
    const MAX = 10;
    const history: LatencyGraphEntry[] = [];
    for (let i = 0; i < 15; i++) {
      const entry: LatencyGraphEntry = { timestamp: i * 1000, latencyMs: i * 10 };
      const updated = [...history, entry].slice(-MAX);
      history.length = 0;
      history.push(...updated);
    }
    assert.equal(history.length, 10);
    // Should have entries 5-14
    assert.equal(history[0]!.latencyMs, 50);
    assert.equal(history[9]!.latencyMs, 140);
  });
});
