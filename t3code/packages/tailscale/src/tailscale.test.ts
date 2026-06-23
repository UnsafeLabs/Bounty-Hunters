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
  parseTailscalePingLine,
  parseTailscalePingOutput,
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

const diagnosticsStatusJson = JSON.stringify({
  Self: { DNSName: "desktop.tail.ts.net.", TailscaleIPs: ["100.64.0.1"] },
  Peer: {
    "nodekey:aaa": {
      HostName: "runner-direct",
      DNSName: "runner-direct.tail.ts.net.",
      TailscaleIPs: ["100.64.0.5", "fd7a:115c::5"],
      Relay: "",
      CurAddr: "198.51.100.7:41641",
      LastSeen: "2026-06-23T10:00:00Z",
      Online: true,
    },
    "nodekey:bbb": {
      HostName: "runner-relayed",
      DNSName: "runner-relayed.tail.ts.net.",
      TailscaleIPs: ["100.64.0.9"],
      Relay: "nyc",
      CurAddr: "",
      LastSeen: "2026-06-23T09:55:00Z",
      Online: false,
    },
  },
});

const directPingOutput = [
  "pong from runner-direct (100.64.0.5) via 198.51.100.7:41641 in 12ms",
  "pong from runner-direct (100.64.0.5) via 198.51.100.7:41641 in 9ms",
].join("\n");

const relayedPingOutput = Array.from(
  { length: 12 },
  (_, index) => `pong from runner-relayed (100.64.0.9) via DERP(nyc) in ${index + 1}ms`,
).join("\n");

function diagnosticsSpawnerLayer(pingOutput: string) {
  const commands: { readonly command: string; readonly args: ReadonlyArray<string> }[] = [];
  const layer = mockSpawnerLayer((command, args) => {
    commands.push({ command, args });
    if (args[0] === "status") {
      return { stdout: diagnosticsStatusJson };
    }
    if (args[0] === "ping") {
      return { stdout: pingOutput };
    }
    return {};
  });
  return { layer, commands };
}

describe("diagnosePeer", () => {
  it.effect("parses a direct ping line into the peer IP and latency", () =>
    Effect.sync(() => {
      const sample = parseTailscalePingLine(
        "pong from runner-direct (100.64.0.5) via 198.51.100.7:41641 in 12ms",
      );
      assert.deepEqual(sample, {
        latencyMs: 12,
        connectionType: "direct",
        peerIp: "100.64.0.5",
        via: "198.51.100.7:41641",
        relayName: null,
        relayRegion: null,
      });
    }),
  );

  it.effect("parses a relayed ping line into the DERP name and region", () =>
    Effect.sync(() => {
      const sample = parseTailscalePingLine("pong from r (100.64.0.9) via DERP(nyc) in 41ms");
      assert.deepEqual(sample, {
        latencyMs: 41,
        connectionType: "relayed",
        peerIp: "100.64.0.9",
        via: "DERP(nyc)",
        relayName: "DERP(nyc)",
        relayRegion: "nyc",
      });
    }),
  );

  it.effect("ignores non-pong lines and timeouts", () =>
    Effect.sync(() => {
      assert.equal(parseTailscalePingLine('ping "runner-direct" timed out'), null);
      assert.equal(parseTailscalePingLine(""), null);
      const summary = parseTailscalePingOutput('ping "x" timed out\nno matching peer');
      assert.deepEqual(summary.samples, []);
      assert.equal(summary.latencyMs, null);
      assert.equal(summary.connectionType, null);
    }),
  );

  it.effect("keeps only the last 10 ping samples for the latency graph", () =>
    Effect.sync(() => {
      const summary = parseTailscalePingOutput(relayedPingOutput);
      assert.equal(summary.samples.length, 10);
      assert.deepEqual(
        summary.samples.map((sample) => sample.latencyMs),
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      );
      assert.equal(summary.latencyMs, 12);
    }),
  );

  it.effect("reports a direct connection with the peer IP", () => {
    const { layer, commands } = diagnosticsSpawnerLayer(directPingOutput);
    return Effect.gen(function* () {
      const diagnostics = yield* diagnosePeer({ peer: "runner-direct" }).pipe(Effect.provide(layer));
      assert.deepEqual(diagnostics, {
        peer: "runner-direct",
        hostName: "runner-direct",
        online: true,
        connectionType: "direct",
        peerIp: "100.64.0.5",
        directEndpoint: "198.51.100.7:41641",
        relay: null,
        latencyMs: 9,
        latencySamples: [12, 9],
        lastSeen: "2026-06-23T10:00:00Z",
        tailnetIpv4Addresses: ["100.64.0.5"],
      });
      assert.deepEqual(commands[1], {
        command: "tailscale",
        args: ["ping", "--until-direct=false", "--c=10", "runner-direct"],
      });
    });
  });

  it.effect("reports a relayed connection with the DERP name and region", () => {
    const { layer } = diagnosticsSpawnerLayer(relayedPingOutput);
    return Effect.gen(function* () {
      const diagnostics = yield* diagnosePeer({ peer: "runner-relayed" }).pipe(
        Effect.provide(layer),
      );
      assert.equal(diagnostics.connectionType, "relayed");
      assert.deepEqual(diagnostics.relay, { name: "DERP(nyc)", region: "nyc" });
      assert.equal(diagnostics.peerIp, "100.64.0.9");
      assert.equal(diagnostics.directEndpoint, null);
      assert.equal(diagnostics.online, false);
      assert.equal(diagnostics.latencySamples.length, 10);
    });
  });

  it.effect("forwards a custom ping count to the tailscale CLI", () => {
    const { layer, commands } = diagnosticsSpawnerLayer(directPingOutput);
    return Effect.gen(function* () {
      yield* diagnosePeer({ peer: "runner-direct", pingCount: 4 }).pipe(Effect.provide(layer));
      assert.deepEqual(commands[1]?.args, [
        "ping",
        "--until-direct=false",
        "--c=4",
        "runner-direct",
      ]);
    });
  });

  it.effect("fails with TailscalePeerUnknownError for an unknown peer", () => {
    const { layer } = diagnosticsSpawnerLayer(directPingOutput);
    return Effect.gen(function* () {
      const error = yield* diagnosePeer({ peer: "ghost" }).pipe(Effect.provide(layer), Effect.flip);
      assert.equal(error._tag, "TailscalePeerUnknownError");
    });
  });

  it.effect("rejects a non-positive ping count", () => {
    const { layer } = diagnosticsSpawnerLayer(directPingOutput);
    return Effect.gen(function* () {
      const error = yield* diagnosePeer({ peer: "runner-direct", pingCount: 0 }).pipe(
        Effect.provide(layer),
        Effect.flip,
      );
      assert.equal(error._tag, "TailscaleCommandError");
    });
  });

  it.effect("fails with TailscaleUnavailableError when tailscale is not installed", () => {
    const layer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.fail(new Error("spawn tailscale ENOENT"))),
    );
    return Effect.gen(function* () {
      const error = yield* diagnosePeer({ peer: "runner-direct" }).pipe(
        Effect.provide(layer),
        Effect.flip,
      );
      assert.equal(error._tag, "TailscaleUnavailableError");
    });
  });
});
