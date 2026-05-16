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
  parseTailscaleMagicDnsName,
  parseTailscalePingOutput,
  parseTailscaleStatus,
  parseTailscaleStatusPeer,
  readTailscaleStatus,
} from "./tailscale.ts";

const encoder = new TextEncoder();
const tailscaleStatusJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.100.100.100","fd7a:115c:a1e0::1","192.168.1.20"]}}`;
const tailscaleStatusWithSingleIpJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.90.1.2"]}}`;
const tailscalePeerStatusJson = JSON.stringify({
  Peer: {
    "node:123": {
      DNSName: "runner.tail.ts.net.",
      HostName: "runner",
      TailscaleIPs: ["100.90.1.44"],
      LastSeen: "2026-05-15T21:10:00Z",
      Online: true,
      Relay: "derp-nyc",
    },
  },
});

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

  it.effect("parses direct and relayed tailscale ping samples", () =>
    Effect.sync(() => {
      const samples = parseTailscalePingOutput(
        [
          "pong from runner (100.90.1.44) via 192.168.1.20:41641 in 11.2ms",
          "pong from runner (100.90.1.44) via DERP(nyc) in 83ms",
        ].join("\n"),
      );

      assert.deepEqual(samples, [
        {
          sequence: 1,
          latencyMs: 11.2,
          connectionType: "direct",
          peerIp: "100.90.1.44",
          relayServer: null,
          relayRegion: null,
          raw: "pong from runner (100.90.1.44) via 192.168.1.20:41641 in 11.2ms",
        },
        {
          sequence: 2,
          latencyMs: 83,
          connectionType: "relayed",
          peerIp: "100.90.1.44",
          relayServer: "nyc",
          relayRegion: "nyc",
          raw: "pong from runner (100.90.1.44) via DERP(nyc) in 83ms",
        },
      ]);
    }),
  );

  it.effect("parses peer status facts", () =>
    Effect.gen(function* () {
      const peer = yield* parseTailscaleStatusPeer(tailscalePeerStatusJson, {
        peer: "runner.tail.ts.net",
        peerIp: null,
      });
      assert.deepEqual(peer, {
        lastSeen: "2026-05-15T21:10:00Z",
        online: true,
        relayServer: "nyc",
        relayRegion: "nyc",
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

  it.effect("diagnoses a peer through mocked tailscale ping and status", () => {
    const commands: {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    }[] = [];
    const layer = mockSpawnerLayer((command, args) => {
      commands.push({ command, args });
      if (args[0] === "ping") {
        return {
          stdout: [
            "pong from runner (100.90.1.44) via 192.168.1.20:41641 in 12ms",
            "pong from runner (100.90.1.44) via DERP(nyc) in 81ms",
          ].join("\n"),
        };
      }
      return { stdout: tailscalePeerStatusJson };
    });

    return Effect.gen(function* () {
      const diagnostics = yield* diagnosePeer({ peer: "runner" }).pipe(Effect.provide(layer));
      assert.deepEqual(commands, [
        {
          command: "tailscale",
          args: ["ping", "--c=10", "--timeout=15s", "runner"],
        },
        {
          command: "tailscale",
          args: ["status", "--json"],
        },
      ]);
      assert.equal(diagnostics.peer, "runner");
      assert.equal(diagnostics.connectionType, "relayed");
      assert.equal(diagnostics.latencyMs, 81);
      assert.equal(diagnostics.peerIp, "100.90.1.44");
      assert.equal(diagnostics.relayServer, "nyc");
      assert.equal(diagnostics.relayRegion, "nyc");
      assert.equal(diagnostics.lastSeen, "2026-05-15T21:10:00Z");
      assert.equal(diagnostics.online, true);
      assert.equal(diagnostics.samples.length, 2);
      assert.equal(diagnostics.error, null);
    });
  });

  it.effect("returns a graceful diagnostic error when tailscale ping fails", () => {
    const layer = mockSpawnerLayer(() => ({
      stderr: "peer not found",
      code: 1,
    }));

    return Effect.gen(function* () {
      const diagnostics = yield* diagnosePeer({ peer: "missing" }).pipe(Effect.provide(layer));
      assert.equal(diagnostics.connectionType, "unknown");
      assert.equal(diagnostics.error?.includes("peer not found"), true);
      assert.deepEqual(diagnostics.samples, []);
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
