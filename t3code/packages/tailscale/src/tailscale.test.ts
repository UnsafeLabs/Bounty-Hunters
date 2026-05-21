import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  buildTailscaleHttpsBaseUrl,
  disableTailscaleServe,
  diagnosePeer,
  ensureTailscaleServe,
  isTailscaleIpv4Address,
  parsePingLine,
  parseTailscaleMagicDnsName,
  parseTailscaleStatus,
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
});

// ---------------------------------------------------------------------------
// Peer diagnostics tests
// ---------------------------------------------------------------------------

describe("parsePingLine", () => {
  it.effect("parses a direct ping response", () =>
    Effect.gen(function* () {
      const result = yield* parsePingLine("pong from my-peer via 100.64.0.1 in 12.3ms");
      assert.equal(result.connectionType, "direct");
      assert.equal(result.latencyMs, 12.3);
      assert.equal(result.peerIp, "100.64.0.1");
      assert.isNull(result.relayServer);
      assert.isNull(result.relayRegion);
    }),
  );

  it.effect("parses a relayed (DERP) ping response", () =>
    Effect.gen(function* () {
      const result = yield* parsePingLine("pong from my-peer via DERP(New York) in 45.7ms");
      assert.equal(result.connectionType, "relay");
      assert.equal(result.latencyMs, 45.7);
      assert.isNull(result.peerIp);
      assert.equal(result.relayServer, "New York");
      assert.equal(result.relayRegion, "New York");
    }),
  );

  it.effect("handles timeout / unreachable output", () =>
    Effect.gen(function* () {
      const result = yield* parsePingLine("timeout waiting for ping reply");
      assert.isNull(result.latencyMs);
      assert.equal(result.connectionType, "relay");
    }),
  );

  it.effect("handles empty ping output", () =>
    Effect.gen(function* () {
      const result = yield* parsePingLine("");
      assert.isNull(result.latencyMs);
    }),
  );

  it.effect("fails on unrecognized output format", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(parsePingLine("some random text"));
      assert.isTrue(result._tag === "Failure");
    }),
  );
});

describe("diagnosePeer", () => {
  const encoder = new TextEncoder();

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

  it.effect("returns direct connection diagnostics from successful ping", () => {
    const layer = mockSpawnerLayer((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["ping", "--c", "1", "my-peer.tail.ts.net"]);
      return { stdout: "pong from my-peer.tail.ts.net via 100.64.0.1 in 8.2ms\n" };
    });

    return Effect.gen(function* () {
      const result = yield* diagnosePeer("my-peer.tail.ts.net").pipe(Effect.provide(layer));
      assert.equal(result.reachable, true);
      assert.equal(result.connectionType, "direct");
      assert.equal(result.latencyMs, 8.2);
      assert.equal(result.peerIp, "100.64.0.1");
      assert.isNull(result.relayServer);
    });
  });

  it.effect("returns relayed connection diagnostics from DERP ping", () => {
    const layer = mockSpawnerLayer(() => ({
      stdout: "pong from far-peer via DERP(Singapore) in 120.5ms\n",
    }));

    return Effect.gen(function* () {
      const result = yield* diagnosePeer("far-peer").pipe(Effect.provide(layer));
      assert.equal(result.reachable, true);
      assert.equal(result.connectionType, "relay");
      assert.equal(result.latencyMs, 120.5);
      assert.equal(result.relayRegion, "Singapore");
      assert.isNull(result.peerIp);
    });
  });

  it.effect("handles ping timeout gracefully", () => {
    const layer = mockSpawnerLayer(() => ({
      code: 1,
      stderr: "tailscale ping failed\n",
    }));

    return Effect.gen(function* () {
      const result = yield* Effect.flip(diagnosePeer("offline-peer").pipe(Effect.provide(layer)));
      assert.equal(result.peer, "offline-peer");
      assert.include(result.message, "exited with code 1");
    });
  });
});
