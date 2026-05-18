import { describe, it, expect } from "vitest";
import { parsePingOutput, generateLatencyGraph, PeerDiagnostics } from "./peerDiagnostics";
import { Schema } from "effect";

// Access the internal function for testing — export it from module
// Since parsePingOutput is not exported, we test via the schema and graph

describe("PeerDiagnostics Schema", () => {
  it("should validate a correct diagnostics object", () => {
    const data = {
      peerId: "peer-1",
      peerIp: "100.64.0.1",
      connectionType: "direct" as const,
      latencyMs: 5,
      lastSeen: "2m ago",
      isOnline: true,
    };
    const result = Schema.decodeUnknownSync(PeerDiagnostics)(data);
    expect(result.peerId).toBe("peer-1");
    expect(result.connectionType).toBe("direct");
  });

  it("should accept relayed connection with optional relayServer", () => {
    const data = {
      peerId: "peer-2",
      peerIp: "100.64.0.2",
      connectionType: "relayed" as const,
      latencyMs: 45,
      relayServer: "sfo",
      lastSeen: "active",
      isOnline: true,
    };
    const result = Schema.decodeUnknownSync(PeerDiagnostics)(data);
    expect(result.relayServer).toBe("sfo");
  });
});

describe("generateLatencyGraph", () => {
  it("should return message for empty data", () => {
    expect(generateLatencyGraph([])).toBe("No data points");
  });

  it("should generate a graph for data points", () => {
    const data = [
      { timestamp: 1, latencyMs: 10 },
      { timestamp: 2, latencyMs: 20 },
      { timestamp: 3, latencyMs: 30 },
    ];
    const graph = generateLatencyGraph(data);
    expect(graph).toContain("30ms");
    expect(graph).toContain("3 samples");
    expect(graph).toContain("█");
  });
});
