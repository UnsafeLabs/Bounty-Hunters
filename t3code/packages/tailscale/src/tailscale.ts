import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;
export const TAILSCALE_STATUS_TIMEOUT_MS = 1_500;
export const TAILSCALE_SERVE_TIMEOUT_MS = 10_000;
export const TAILSCALE_PROBE_TIMEOUT_MS = 2_500;
export const TAILSCALE_DIAGNOSE_TIMEOUT_MS = 15_000;
export const DEFAULT_TAILSCALE_PING_COUNT = 10;

export class TailscaleCommandError extends Data.TaggedError("TailscaleCommandError")<{
  readonly command: readonly string[];
  readonly message: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

export class TailscaleStatusParseError extends Data.TaggedError("TailscaleStatusParseError")<{
  readonly cause: unknown;
}> {}

export class TailscaleUnavailableError extends Data.TaggedError("TailscaleUnavailableError")<{
  readonly reason: string;
}> {}

export class TailscalePeerUnknownError extends Data.TaggedError("TailscalePeerUnknownError")<{
  readonly peer: string;
}> {}

const TailscaleStatusSelf = Schema.Struct({
  DNSName: Schema.optional(Schema.Unknown),
  TailscaleIPs: Schema.optional(Schema.Unknown),
});

const TailscaleStatusJson = Schema.Struct({
  Self: Schema.optional(TailscaleStatusSelf),
});

export type TailscaleStatusSelf = typeof TailscaleStatusSelf.Type;
export type TailscaleStatusJson = typeof TailscaleStatusJson.Type;

export interface TailscaleStatus {
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

const collectStdout = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const collectStderr = collectStdout;

const tailscaleCommandError = (
  args: readonly string[],
  message: string,
  exitCode: number | null,
  stderr = "",
): TailscaleCommandError =>
  new TailscaleCommandError({
    command: ["tailscale", ...args],
    message,
    exitCode,
    stderr,
  });

const decodeTailscaleStatusJson = Schema.decodeEffect(Schema.fromJsonString(TailscaleStatusJson));

function normalizeMagicDnsName(status: TailscaleStatusJson): string | null {
  const dnsName = status.Self?.DNSName;
  if (typeof dnsName !== "string") {
    return null;
  }

  const normalized = dnsName.trim().replace(/\.$/u, "");
  return normalized.length > 0 ? normalized : null;
}

export const parseTailscaleMagicDnsName = (
  rawStatusJson: string,
): Effect.Effect<string | null, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map(normalizeMagicDnsName),
  );

export function isTailscaleIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const [first, second, third, fourth] = parts.map((part) => Number.parseInt(part, 10));
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    [first, second, third, fourth].some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return first === 100 && second >= 64 && second <= 127;
}

export const parseTailscaleStatus = (
  rawStatusJson: string,
): Effect.Effect<TailscaleStatus, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      const rawIps = parsed.Self?.TailscaleIPs;
      const tailnetIpv4Addresses = Array.isArray(rawIps)
        ? rawIps
            .filter((address): address is string => typeof address === "string")
            .filter(isTailscaleIpv4Address)
        : [];

      return {
        magicDnsName: normalizeMagicDnsName(parsed),
        tailnetIpv4Addresses,
      };
    }),
  );

export const readTailscaleStatus: Effect.Effect<
  TailscaleStatus,
  TailscaleCommandError | TailscaleStatusParseError,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const args = ["status", "--json"];
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner
    .spawn(
      ChildProcess.make("tailscale", args, {
        shell: process.platform === "win32",
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        tailscaleCommandError(
          args,
          cause instanceof Error ? cause.message : "Failed to spawn tailscale status.",
          null,
        ),
      ),
    );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStdout(child.stdout),
      collectStderr(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError((cause) =>
      tailscaleCommandError(
        args,
        cause instanceof Error ? cause.message : "Failed to run tailscale status.",
        null,
      ),
    ),
  );
  if (exitCode !== 0) {
    return yield* tailscaleCommandError(
      args,
      `Tailscale status exited with code ${exitCode}.`,
      exitCode,
      stderr,
    );
  }
  return yield* parseTailscaleStatus(stdout);
}).pipe(
  Effect.scoped,
  Effect.timeoutOption(TAILSCALE_STATUS_TIMEOUT_MS),
  Effect.flatMap((result) =>
    Option.match(result, {
      onNone: () =>
        Effect.fail(
          tailscaleCommandError(["status", "--json"], "Tailscale status timed out.", null),
        ),
      onSome: Effect.succeed,
    }),
  ),
);

export function buildTailscaleHttpsBaseUrl(input: {
  readonly magicDnsName: string;
  readonly servePort?: number;
}): string {
  const url = new URL(`https://${input.magicDnsName}`);
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  if (servePort !== DEFAULT_TAILSCALE_SERVE_PORT) {
    url.port = String(servePort);
  }
  url.pathname = "/";
  return url.toString();
}

const runTailscaleCommand = (
  args: readonly string[],
  input: {
    readonly spawnMessage: string;
    readonly runMessage: string;
    readonly exitMessage: (exitCode: number) => string;
    readonly timeoutMessage: string;
    readonly timeoutMs: number;
  },
): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner
      .spawn(
        ChildProcess.make("tailscale", args, {
          shell: process.platform === "win32",
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          tailscaleCommandError(
            args,
            cause instanceof Error ? cause.message : input.spawnMessage,
            null,
          ),
        ),
      );
    const [stderr, exitCode] = yield* Effect.all(
      [collectStderr(child.stderr), child.exitCode.pipe(Effect.map(Number))],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((cause) =>
        tailscaleCommandError(
          args,
          cause instanceof Error ? cause.message : input.runMessage,
          null,
        ),
      ),
    );
    if (exitCode !== 0) {
      return yield* tailscaleCommandError(args, input.exitMessage(exitCode), exitCode, stderr);
    }
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(input.timeoutMs),
    Effect.flatMap((result) =>
      Option.match(result, {
        onNone: () => Effect.fail(tailscaleCommandError(args, input.timeoutMessage, null)),
        onSome: Effect.succeed,
      }),
    ),
  );

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> => {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  const localHost = input.localHost ?? "127.0.0.1";
  const args = ["serve", "--bg", `--https=${servePort}`, `http://${localHost}:${input.localPort}`];
  return runTailscaleCommand(args, {
    spawnMessage: "Failed to spawn tailscale serve.",
    runMessage: "Failed to run tailscale serve.",
    exitMessage: (exitCode) => `Tailscale serve exited with code ${exitCode}.`,
    timeoutMessage: "Tailscale serve timed out.",
    timeoutMs: TAILSCALE_SERVE_TIMEOUT_MS,
  });
};

export const disableTailscaleServe = (
  input: {
    readonly servePort?: number;
  } = {},
): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
    return yield* runTailscaleCommand(["serve", `--https=${servePort}`, "off"], {
      spawnMessage: "Failed to spawn tailscale serve off.",
      runMessage: "Failed to run tailscale serve off.",
      exitMessage: (exitCode) => `Tailscale serve off exited with code ${exitCode}.`,
      timeoutMessage: "Tailscale serve off timed out.",
      timeoutMs: TAILSCALE_SERVE_TIMEOUT_MS,
    });
  });

export const probeTailscaleHttpsEndpoint = (input: {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}): Effect.Effect<boolean, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* Effect.gen(function* () {
      const url = new URL("/.well-known/t3/environment", input.baseUrl);
      const request = HttpClientRequest.get(url.toString());
      return yield* client.execute(request);
    }).pipe(Effect.timeoutOption(input.timeoutMs ?? TAILSCALE_PROBE_TIMEOUT_MS));

    return Option.match(response, {
      onNone: () => false,
      onSome: (httpResponse) => httpResponse.status >= 200 && httpResponse.status < 300,
    });
  }).pipe(Effect.catch(() => Effect.succeed(false)));

export const resolveTailscaleHttpsBaseUrl = (
  input: {
    readonly servePort?: number;
  } = {},
): Effect.Effect<
  string | null,
  TailscaleCommandError | TailscaleStatusParseError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  readTailscaleStatus.pipe(
    Effect.map((status) =>
      status.magicDnsName
        ? buildTailscaleHttpsBaseUrl({
            magicDnsName: status.magicDnsName,
            ...(input.servePort === undefined ? {} : { servePort: input.servePort }),
          })
        : null,
    ),
  );

// ---------------------------------------------------------------------------
// Peer diagnostics: `tailscale ping` + `tailscale status --json` for one peer.
// ---------------------------------------------------------------------------

const RelayInfo = Schema.Struct({
  name: Schema.String,
  region: Schema.String,
});

export type RelayInfo = typeof RelayInfo.Type;

export const PeerDiagnostics = Schema.Struct({
  peer: Schema.String,
  hostName: Schema.NullOr(Schema.String),
  online: Schema.Boolean,
  connectionType: Schema.Literal("direct", "relayed", "unknown"),
  peerIp: Schema.NullOr(Schema.String),
  directEndpoint: Schema.NullOr(Schema.String),
  relay: Schema.NullOr(RelayInfo),
  latencyMs: Schema.NullOr(Schema.Number),
  latencySamples: Schema.Array(Schema.Number),
  lastSeen: Schema.NullOr(Schema.String),
  tailnetIpv4Addresses: Schema.Array(Schema.String),
});

export type PeerDiagnostics = typeof PeerDiagnostics.Type;

export interface TailscalePingSample {
  readonly latencyMs: number;
  readonly connectionType: "direct" | "relayed";
  readonly peerIp: string | null;
  readonly via: string;
  readonly relayName: string | null;
  readonly relayRegion: string | null;
}

export interface TailscalePingSummary {
  readonly samples: readonly TailscalePingSample[];
  readonly latencyMs: number | null;
  readonly connectionType: "direct" | "relayed" | null;
  readonly peerIp: string | null;
  readonly via: string | null;
  readonly relayName: string | null;
  readonly relayRegion: string | null;
}

const PING_LINE_REGEX = /^pong from \S+ \(([^)]+)\) via (.+?) in ([0-9]+(?:\.[0-9]+)?)\s*ms$/u;
const DERP_REGEX = /^DERP\(([^)]+)\)$/u;

export function parseTailscalePingLine(line: string): TailscalePingSample | null {
  const match = PING_LINE_REGEX.exec(line.trim());
  if (match === null) {
    return null;
  }
  const [, peerIp, via, latencyRaw] = match;
  if (peerIp === undefined || via === undefined || latencyRaw === undefined) {
    return null;
  }
  const latencyMs = Number.parseFloat(latencyRaw);
  if (!Number.isFinite(latencyMs)) {
    return null;
  }
  const derp = DERP_REGEX.exec(via);
  if (derp !== null) {
    return {
      latencyMs,
      connectionType: "relayed",
      peerIp,
      via,
      relayName: via,
      relayRegion: derp[1] ?? null,
    };
  }
  return {
    latencyMs,
    connectionType: "direct",
    peerIp,
    via,
    relayName: null,
    relayRegion: null,
  };
}

export function parseTailscalePingOutput(
  rawPingOutput: string,
  maxSamples: number = DEFAULT_TAILSCALE_PING_COUNT,
): TailscalePingSummary {
  const all: TailscalePingSample[] = [];
  for (const line of rawPingOutput.split(/\r?\n/u)) {
    const sample = parseTailscalePingLine(line);
    if (sample !== null) {
      all.push(sample);
    }
  }
  const samples = maxSamples > 0 ? all.slice(-maxSamples) : all;
  const last = samples.length > 0 ? samples[samples.length - 1] : undefined;
  return {
    samples,
    latencyMs: last?.latencyMs ?? null,
    connectionType: last?.connectionType ?? null,
    peerIp: last?.peerIp ?? null,
    via: last?.via ?? null,
    relayName: last?.relayName ?? null,
    relayRegion: last?.relayRegion ?? null,
  };
}

export interface TailscalePeerFacts {
  readonly hostName: string | null;
  readonly dnsName: string | null;
  readonly online: boolean;
  readonly relayRegion: string | null;
  readonly directEndpoint: string | null;
  readonly lastSeen: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeDnsName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\.$/u, "");
  return normalized.length > 0 ? normalized : null;
}

function tailnetIpv4AddressesFrom(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
        .filter((address): address is string => typeof address === "string")
        .filter(isTailscaleIpv4Address)
    : [];
}

function peerMatchesQuery(key: string, peer: Record<string, unknown>, query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  if (key.toLowerCase() === normalizedQuery) {
    return true;
  }
  const hostName = asNonEmptyString(peer.HostName);
  if (hostName !== null && hostName.toLowerCase() === normalizedQuery) {
    return true;
  }
  const dnsName = normalizeDnsName(peer.DNSName);
  if (dnsName !== null) {
    if (dnsName.toLowerCase() === normalizedQuery) {
      return true;
    }
    const firstLabel = dnsName.split(".")[0];
    if (firstLabel !== undefined && firstLabel.toLowerCase() === normalizedQuery) {
      return true;
    }
  }
  if (Array.isArray(peer.TailscaleIPs)) {
    for (const address of peer.TailscaleIPs) {
      if (typeof address === "string" && address.toLowerCase() === normalizedQuery) {
        return true;
      }
    }
  }
  return false;
}

function toPeerFacts(peer: Record<string, unknown>): TailscalePeerFacts {
  return {
    hostName: asNonEmptyString(peer.HostName),
    dnsName: normalizeDnsName(peer.DNSName),
    online: peer.Online === true,
    relayRegion: asNonEmptyString(peer.Relay),
    directEndpoint: asNonEmptyString(peer.CurAddr),
    lastSeen: asNonEmptyString(peer.LastSeen),
    tailnetIpv4Addresses: tailnetIpv4AddressesFrom(peer.TailscaleIPs),
  };
}

const TailscaleStatusPeersJson = Schema.Struct({
  Peer: Schema.optional(Schema.Unknown),
});

const decodeTailscaleStatusPeersJson = Schema.decodeEffect(
  Schema.fromJsonString(TailscaleStatusPeersJson),
);

export const findPeerInStatus = (
  rawStatusJson: string,
  peer: string,
): Effect.Effect<Option.Option<TailscalePeerFacts>, TailscaleStatusParseError> =>
  decodeTailscaleStatusPeersJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      const peers = asRecord(parsed.Peer);
      if (peers === null) {
        return Option.none();
      }
      for (const [key, value] of Object.entries(peers)) {
        const record = asRecord(value);
        if (record !== null && peerMatchesQuery(key, record, peer)) {
          return Option.some(toPeerFacts(record));
        }
      }
      return Option.none();
    }),
  );

export function buildPeerDiagnostics(input: {
  readonly peer: string;
  readonly facts: TailscalePeerFacts;
  readonly ping: TailscalePingSummary;
}): PeerDiagnostics {
  const { facts, ping } = input;
  const connectionType: PeerDiagnostics["connectionType"] =
    ping.connectionType ??
    (facts.directEndpoint !== null
      ? "direct"
      : facts.relayRegion !== null
        ? "relayed"
        : "unknown");

  const peerIp = facts.tailnetIpv4Addresses[0] ?? ping.peerIp ?? null;

  const directEndpoint =
    connectionType === "direct"
      ? (facts.directEndpoint ?? (ping.connectionType === "direct" ? ping.via : null))
      : null;

  const relayRegion = ping.relayRegion ?? facts.relayRegion;
  const relay: RelayInfo | null =
    connectionType === "relayed"
      ? {
          name: ping.relayName ?? (relayRegion !== null ? `DERP(${relayRegion})` : "DERP"),
          region: relayRegion ?? "",
        }
      : null;

  return {
    peer: input.peer,
    hostName: facts.hostName ?? facts.dnsName,
    online: facts.online,
    connectionType,
    peerIp,
    directEndpoint,
    relay,
    latencyMs: ping.latencyMs,
    latencySamples: ping.samples.map((sample) => sample.latencyMs),
    lastSeen: facts.lastSeen,
    tailnetIpv4Addresses: facts.tailnetIpv4Addresses,
  };
}

const captureTailscaleOutput = (
  args: readonly string[],
): Effect.Effect<
  { readonly stdout: string; readonly stderr: string; readonly exitCode: number },
  TailscaleUnavailableError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner
      .spawn(
        ChildProcess.make("tailscale", args, {
          shell: process.platform === "win32",
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new TailscaleUnavailableError({
              reason:
                cause instanceof Error
                  ? cause.message
                  : "Failed to spawn tailscale. Is it installed and on PATH?",
            }),
        ),
      );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStdout(child.stdout),
        collectStderr(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new TailscaleUnavailableError({
            reason: cause instanceof Error ? cause.message : "Failed to read tailscale output.",
          }),
      ),
    );
    return { stdout, stderr, exitCode };
  }).pipe(Effect.scoped);

export const diagnosePeer = (input: {
  readonly peer: string;
  readonly pingCount?: number;
  readonly timeoutMs?: number;
}): Effect.Effect<
  PeerDiagnostics,
  | TailscaleUnavailableError
  | TailscalePeerUnknownError
  | TailscaleStatusParseError
  | TailscaleCommandError,
  ChildProcessSpawner.ChildProcessSpawner
> => {
  const peer = input.peer.trim();
  const pingCount = input.pingCount ?? DEFAULT_TAILSCALE_PING_COUNT;
  const timeoutMs = input.timeoutMs ?? TAILSCALE_DIAGNOSE_TIMEOUT_MS;
  return Effect.gen(function* () {
    if (peer.length === 0) {
      return yield* new TailscalePeerUnknownError({ peer: input.peer });
    }
    if (!Number.isInteger(pingCount) || pingCount < 1) {
      return yield* new TailscaleCommandError({
        command: ["tailscale", "ping"],
        message: `Invalid pingCount: ${String(input.pingCount)}. Must be a positive integer.`,
        exitCode: null,
        stderr: "",
      });
    }
    const statusCapture = yield* captureTailscaleOutput(["status", "--json"]);
    const peerFacts = yield* findPeerInStatus(statusCapture.stdout, peer);
    if (Option.isNone(peerFacts)) {
      return yield* new TailscalePeerUnknownError({ peer });
    }
    const pingArgs = ["ping", "--until-direct=false", `--c=${pingCount}`, peer];
    const pingCapture = yield* captureTailscaleOutput(pingArgs);
    const ping = parseTailscalePingOutput(pingCapture.stdout, pingCount);
    return buildPeerDiagnostics({ peer, facts: peerFacts.value, ping });
  }).pipe(
    Effect.timeoutOption(timeoutMs),
    Effect.flatMap((result) =>
      Option.match(result, {
        onNone: () =>
          Effect.fail(
            tailscaleCommandError(["ping", peer], "Tailscale peer diagnostics timed out.", null),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
};
