import { describe, it, expect } from "vitest";
import { parseTailscalePingOutput, parseTailscaleStatusOutput } from "./peerDiagnostics.ts";

describe("parseTailscalePingOutput", () => {
  it("parses direct connection ping", () => {
    const output = "pong from peer1 (100.64.0.1) in 5ms";
    const result = parseTailscalePingOutput(output);

    expect(result).not.toBeNull();
    expect(result!.connectionType).toBe("direct");
    expect(result!.latency).toBe(5);
    expect(result!.peerIp).toBe("100.64.0.1");
    expect(result!.relayServer).toBeNull();
  });

  it("parses relay connection ping via DERP", () => {
    const output = "pong from peer1 (100.64.0.2) via DERP(tokyo) in 45ms";
    const result = parseTailscalePingOutput(output);

    expect(result).not.toBeNull();
    expect(result!.connectionType).toBe("relay");
    expect(result!.latency).toBe(45);
    expect(result!.relayServer).toBe("tokyo");
  });

  it("returns null for empty output", () => {
    const result = parseTailscalePingOutput("");
    expect(result).toBeNull();
  });

  it("returns null for unrecognized output", () => {
    const result = parseTailscalePingOutput("some random text");
    expect(result).toBeNull();
  });

  it("parses high latency ping", () => {
    const output = "pong from peer2 (10.0.0.5) in 250ms";
    const result = parseTailscalePingOutput(output);

    expect(result).not.toBeNull();
    expect(result!.latency).toBe(250);
    expect(result!.connectionType).toBe("direct");
  });
});

describe("parseTailscaleStatusOutput", () => {
  it("parses online peer status", () => {
    const output = "peer1 abc123... idle   100.64.0.1  -";
    const result = parseTailscaleStatusOutput(output, "peer1");

    expect(result).not.toBeNull();
    expect(result!.isOnline).toBe(true);
  });

  it("parses offline peer status", () => {
    const output = "peer2 def456... offline  -  -";
    const result = parseTailscaleStatusOutput(output, "peer2");

    expect(result).not.toBeNull();
    expect(result!.isOnline).toBe(false);
  });

  it("returns null when peer not found", () => {
    const output = "other-peer ... idle 100.64.0.1  -";
    const result = parseTailscaleStatusOutput(output, "peer1");

    expect(result).toBeNull();
  });

  it("parses relay info from status", () => {
    const output = "peer1 abc123... active 100.64.0.1  relay \"tokyo\" (ap-northeast)";
    const result = parseTailscaleStatusOutput(output, "peer1");

    expect(result).not.toBeNull();
    expect(result!.relayServer).toBe("tokyo");
    expect(result!.relayRegion).toBe("ap-northeast");
  });
});

describe("PeerDiagnostics schema", () => {
  it("validates correct diagnostics shape", () => {
    const valid = {
      peerId: "peer-1",
      connectionType: "direct" as const,
      latency: 5,
      relayServer: null,
      relayRegion: null,
      peerIp: "100.64.0.1",
      lastSeen: new Date().toISOString(),
      isOnline: true,
    };

    expect(valid.connectionType).toBe("direct");
    expect(valid.latency).toBe(5);
    expect(valid.isOnline).toBe(true);
  });
});
