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
  parsePeerStatus,
  parseTailscalePingOutput,
  parseTailscaleMagicDnsName,
  parseTailscaleStatus,
  readTailscaleStatus,
} from "./tailscale.ts";

const encoder = new TextEncoder();
const tailscaleStatusJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.100.100.100","fd7a:115c:a1e0::1","192.168.1.20"]}}`;
const tailscaleStatusWithSingleIpJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.90.1.2"]}}`;
const tailscalePeerStatusJson = `{"Peer":{"nodekey:abc":{"HostName":"runner-1","DNSName":"runner-1.tail.ts.net.","TailscaleIPs":["100.88.1.9"],"LastSeen":"2026-06-06T18:00:00Z","Online":false}}}`;

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

  it.effect("parses peer status facts", () =>
    Effect.gen(function* () {
      const status = yield* parsePeerStatus(tailscalePeerStatusJson, "runner-1");
      assert.deepEqual(status, {
        peerIp: "100.88.1.9",
        lastSeen: "2026-06-06T18:00:00Z",
        online: false,
      });
    }),
  );

  it("parses direct and relayed ping diagnostics", () => {
    const direct = parseTailscalePingOutput(
      "runner-1",
      [
        "pong from runner-1 (100.88.1.9) via 203.0.113.10:41641 in 24ms",
        "pong from runner-1 (100.88.1.9) via 203.0.113.10:41641 in 25.5ms",
      ].join("\n"),
    );
    assert.deepEqual(direct, {
      reachable: true,
      connectionType: "direct",
      latencyMs: 25.5,
      peerIp: "100.88.1.9",
      relayServer: null,
      relayRegion: null,
      pingSamples: [
        {
          latencyMs: 24,
          connectionType: "direct",
          peerIp: "100.88.1.9",
          relayServer: null,
          relayRegion: null,
          raw: "pong from runner-1 (100.88.1.9) via 203.0.113.10:41641 in 24ms",
        },
        {
          latencyMs: 25.5,
          connectionType: "direct",
          peerIp: "100.88.1.9",
          relayServer: null,
          relayRegion: null,
          raw: "pong from runner-1 (100.88.1.9) via 203.0.113.10:41641 in 25.5ms",
        },
      ],
      statusMessage: null,
    });

    const relayed = parseTailscalePingOutput(
      "runner-1",
      "pong from runner-1 (100.88.1.9) via DERP(nyc) in 80ms",
    );
    assert.equal(relayed.connectionType, "relayed");
    assert.equal(relayed.relayServer, "nyc");
    assert.equal(relayed.relayRegion, "nyc");
    assert.equal(relayed.latencyMs, 80);
  });

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

  it.effect("diagnoses a peer through ping and status commands", () => {
    const layer = mockSpawnerLayer((command, args) => {
      assert.equal(command, "tailscale");
      if (args[0] === "ping") {
        assert.deepEqual(args, ["ping", "--c", "3", "runner-1"]);
        return {
          stdout: [
            "pong from runner-1 (100.88.1.9) via DERP(nyc) in 81ms",
            "pong from runner-1 (100.88.1.9) via DERP(nyc) in 79ms",
            "pong from runner-1 (100.88.1.9) via DERP(nyc) in 80ms",
          ].join("\n"),
        };
      }
      assert.deepEqual(args, ["status", "--json"]);
      return { stdout: tailscalePeerStatusJson };
    });

    return Effect.gen(function* () {
      const diagnostics = yield* diagnosePeer({ peer: "runner-1", samples: 3 }).pipe(
        Effect.provide(layer),
      );
      assert.deepEqual(diagnostics, {
        peer: "runner-1",
        reachable: true,
        connectionType: "relayed",
        peerIp: "100.88.1.9",
        latencyMs: 80,
        relayServer: "nyc",
        relayRegion: "nyc",
        lastSeen: "2026-06-06T18:00:00Z",
        online: false,
        pingSamples: [
          {
            latencyMs: 81,
            connectionType: "relayed",
            peerIp: "100.88.1.9",
            relayServer: "nyc",
            relayRegion: "nyc",
            raw: "pong from runner-1 (100.88.1.9) via DERP(nyc) in 81ms",
          },
          {
            latencyMs: 79,
            connectionType: "relayed",
            peerIp: "100.88.1.9",
            relayServer: "nyc",
            relayRegion: "nyc",
            raw: "pong from runner-1 (100.88.1.9) via DERP(nyc) in 79ms",
          },
          {
            latencyMs: 80,
            connectionType: "relayed",
            peerIp: "100.88.1.9",
            relayServer: "nyc",
            relayRegion: "nyc",
            raw: "pong from runner-1 (100.88.1.9) via DERP(nyc) in 80ms",
          },
        ],
        statusMessage: null,
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
});
