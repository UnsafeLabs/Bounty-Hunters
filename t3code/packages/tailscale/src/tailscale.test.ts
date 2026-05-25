import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  buildTailscaleHttpsBaseUrl,
  diagnosePeer,
  disableTailscaleServe,
  ensureTailscaleServe,
  isTailscaleIpv4Address,
  LatencyTracker,
  parseTailscaleMagicDnsName,
  parseTailscalePingOutput,
  parseTailscaleStatus,
  PeerDiagnostics,
  readTailscaleStatus,
} from "./tailscale.ts";

const encoder = new TextEncoder();
const tailscaleStatusJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.100.100.100","fd7a:115c:a1e0::1","192.168.1.20"]}}`;
const tailscaleStatusWithSingleIpJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.90.1.2"]}}`;

function mockHandle(result: { stdout?: string; stderr?: string; code?: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout ?? "")),
    stderr: Stream.make(encoder.encode(result.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawnerLayer(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => { stdout?: string; stderr?: string; code?: number },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
      };
      return Effect.succeed(mockHandle(handler(childProcess.command, childProcess.args)));
    }),
  );
}

describe("tailscale", () => {
  it.effect("detects Tailnet IPv4 addresses", () =>
    Effect.sync(() => {
      assert.equal(isTailscaleIpv4Address("100.64.0.1"), true);
      assert.equal(isTailscaleIpv4Address("100.127.255.254"), true);
      assert.equal(isTailscaleIpv4Address("100.128.0.1"), false);
      assert.equal(isTailscaleIpv4Address("192.168.1.44"), false);
    }),
  );

  it.effect("parses MagicDNS names from tailscale status", () =>
    Effect.gen(function* () {
      const dnsName = yield* parseTailscaleMagicDnsName(tailscaleStatusJson);
      assert.equal(dnsName, "desktop.tail.ts.net");
      assert.equal(yield* parseTailscaleMagicDnsName("{}"), null);
    }),
  );

  it.effect("parses status facts", () =>
    Effect.gen(function* () {
      const status = yield* parseTailscaleStatus(tailscaleStatusJson);
      assert.deepEqual(status, {
        magicDnsName: "desktop.tail.ts.net",
        tailnetIpv4Addresses: ["100.100.100.100"],
      });
    }),
  );

  it.effect("builds clean HTTPS base URLs", () =>
    Effect.sync(() => {
      assert.equal(
        buildTailscaleHttpsBaseUrl({ magicDnsName: "desktop.tail.ts.net" }),
        "https://desktop.tail.ts.net/",
      );
      assert.equal(
        buildTailscaleHttpsBaseUrl({ magicDnsName: "desktop.tail.ts.net", servePort: 8443 }),
        "https://desktop.tail.ts.net:8443/",
      );
    }),
  );

  it.effect("reads tailscale status through the process spawner service", () => {
    const layer = mockSpawnerLayer((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["status", "--json"]);
      return {
        stdout: tailscaleStatusWithSingleIpJson,
      };
    });

    return Effect.gen(function* () {
      const status = yield* readTailscaleStatus.pipe(Effect.provide(layer));
      assert.deepEqual(status, {
        magicDnsName: "desktop.tail.ts.net",
        tailnetIpv4Addresses: ["100.90.1.2"],
      });
    });
  });

  it.effect("configures tailscale serve through the process spawner service", () => {
    const layer = mockSpawnerLayer((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["serve", "--bg", "--https=8443", "http://127.0.0.1:13773"]);
      return {};
    });

    return ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(Effect.provide(layer));
  });

  it.effect("disables tailscale serve through the process spawner service", () => {
    const commands: {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    }[] = [];
    const layer = mockSpawnerLayer((command, args) => {
      commands.push({ command, args });
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["serve", "--https=8443", "off"]);
      return {};
    });

    return Effect.gen(function* () {
      yield* disableTailscaleServe({ servePort: 8443 }).pipe(Effect.provide(layer));
      assert.deepEqual(commands, [
        { command: "tailscale", args: ["serve", "--https=8443", "off"] },
      ]);
    });
  });

  describe("peer diagnostics", () => {
    it.effect("parses direct pong output", () =>
      Effect.sync(() => {
        const result = parseTailscalePingOutput(
          "pong from desktop (100.100.100.100) in 35ms",
          "desktop",
        );
        assert.equal(result.connectionType, "direct");
        assert.equal(result.latencyMs, 35);
        assert.equal(result.peerIp, "100.100.100.100");
        assert.equal(result.relayServer, null);
        assert.equal(result.peerName, "desktop");
      }),
    );

    it.effect("parses relayed pong output with DERP server", () =>
      Effect.sync(() => {
        const result = parseTailscalePingOutput(
          "pong from desktop (100.100.100.100) via DERP(tor) in 120ms",
          "desktop",
        );
        assert.equal(result.connectionType, "relayed");
        assert.equal(result.latencyMs, 120);
        assert.equal(result.peerIp, "100.100.100.100");
        assert.equal(result.relayServer, "tor");
      }),
    );

    it.effect("returns unreachable for empty output", () =>
      Effect.sync(() => {
        const result = parseTailscalePingOutput("", "desktop");
        assert.equal(result.connectionType, "unreachable");
        assert.equal(result.latencyMs, null);
        assert.equal(result.peerIp, null);
        assert.equal(result.relayServer, null);
        assert.equal(result.lastSeen, null);
      }),
    );

    it.effect("returns unreachable for timeout output", () =>
      Effect.sync(() => {
        const result = parseTailscalePingOutput(
          "posting magicsock peer lookup\n\n\"timeout waiting for initial pong\"",
          "desktop",
        );
        assert.equal(result.connectionType, "unreachable");
      }),
    );

    it.effect("runs diagnosePeer through the process spawner", () => {
      const layer = mockSpawnerLayer((command, args) => {
        assert.equal(command, "tailscale");
        assert.deepEqual(args, ["ping", "--c", "1", "laptop"]);
        return {
          stdout: "pong from laptop (100.64.0.5) via DERP(nyc) in 82ms",
        };
      });

      return Effect.gen(function* () {
        const diag = yield* diagnosePeer("laptop").pipe(Effect.provide(layer));
        assert.equal(diag.connectionType, "relayed");
        assert.equal(diag.latencyMs, 82);
        assert.equal(diag.peerIp, "100.64.0.5");
        assert.equal(diag.relayServer, "nyc");
        assert.equal(diag.peerName, "laptop");
      });
    });

    it.effect("returns unreachable when tailscale ping times out", () => {
      const layer = mockSpawnerLayer(() => ({ stdout: "" }));

      return Effect.gen(function* () {
        const diag = yield* diagnosePeer("unknown-host").pipe(Effect.provide(layer));
        assert.equal(diag.connectionType, "unreachable");
      });
    });
  });

  describe("LatencyTracker", () => {
    it.effect("keeps last 10 results", () =>
      Effect.sync(() => {
        const tracker = new LatencyTracker();
        for (let i = 0; i < 15; i++) {
          tracker.addLatency(
            new PeerDiagnostics({
              peerName: "desktop",
              connectionType: "direct",
              latencyMs: i * 10,
              peerIp: "100.64.0.1",
              relayServer: null,
              lastSeen: new Date().toISOString(),
            }),
          );
        }
        const latencies = tracker.getLatencies();
        assert.equal(latencies.length, 10);
        // Oldest should be latency 50 (first 5 were evicted)
        assert.equal(latencies[0].latencyMs, 50);
        // Most recent should be latency 140
        assert.equal(latencies[9].latencyMs, 140);
      }),
    );

    it.effect("clear removes all entries", () =>
      Effect.sync(() => {
        const tracker = new LatencyTracker();
        tracker.addLatency(
          new PeerDiagnostics({
            peerName: "desktop",
            connectionType: "direct",
            latencyMs: 35,
            peerIp: "100.64.0.1",
            relayServer: null,
            lastSeen: new Date().toISOString(),
          }),
        );
        assert.equal(tracker.getLatencies().length, 1);
        tracker.clear();
        assert.equal(tracker.getLatencies().length, 0);
      }),
    );

    it.effect("returns null latencyMs for unreachable pings", () =>
      Effect.sync(() => {
        const tracker = new LatencyTracker();
        tracker.addLatency(
          new PeerDiagnostics({
            peerName: "desktop",
            connectionType: "unreachable",
            latencyMs: null,
            peerIp: null,
            relayServer: null,
            lastSeen: null,
          }),
        );
        const latencies = tracker.getLatencies();
        assert.equal(latencies.length, 1);
        assert.equal(latencies[0].latencyMs, null);
      }),
    );
  });
});
