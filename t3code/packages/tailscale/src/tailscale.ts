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
// Peer diagnostics
// ---------------------------------------------------------------------------

export const ConnectionType = Schema.Literal("direct", "relayed", "unreachable");

export class PeerDiagnostics extends Schema.Class<PeerDiagnostics>("PeerDiagnostics")({
  peerName: Schema.String,
  connectionType: ConnectionType,
  latencyMs: Schema.NullOr(Schema.Number),
  peerIp: Schema.NullOr(Schema.String),
  relayServer: Schema.NullOr(Schema.String),
  lastSeen: Schema.NullOr(Schema.String),
}) {}

export type PeerDiagnosticsType = typeof PeerDiagnostics.Type;

const DIRECT_PONG_RE =
  /^pong from\s+(?<peer>[^ ]+)\s+\((?<ip>[^)]+)\)\s+in\s+(?<latency>\d+)ms\s*$/;
const RELAYED_PONG_RE =
  /^pong from\s+(?<peer>[^ ]+)\s+\((?<ip>[^)]+)\)\s+via\s+DERP\((?<relay>[^)]+)\)\s+in\s+(?<latency>\d+)ms\s*$/;

export function parseTailscalePingOutput(
  rawOutput: string,
  peerName: string,
): PeerDiagnosticsType {
  const trimmed = rawOutput.trim();

  // Try relayed pattern first (more specific)
  const relayedMatch = RELAYED_PONG_RE.exec(trimmed);
  if (relayedMatch?.groups) {
    return new PeerDiagnostics({
      peerName,
      connectionType: "relayed",
      latencyMs: Number(relayedMatch.groups.latency),
      peerIp: relayedMatch.groups.ip,
      relayServer: relayedMatch.groups.relay,
      lastSeen: new Date().toISOString(),
    });
  }

  // Try direct pattern
  const directMatch = DIRECT_PONG_RE.exec(trimmed);
  if (directMatch?.groups) {
    return new PeerDiagnostics({
      peerName,
      connectionType: "direct",
      latencyMs: Number(directMatch.groups.latency),
      peerIp: directMatch.groups.ip,
      relayServer: null,
      lastSeen: new Date().toISOString(),
    });
  }

  // Unreachable / timeout
  return new PeerDiagnostics({
    peerName,
    connectionType: "unreachable",
    latencyMs: null,
    peerIp: null,
    relayServer: null,
    lastSeen: null,
  });
}

export const TAILSCALE_PING_TIMEOUT_MS = 5_000;

export const diagnosePeer = (
  peerName: string,
): Effect.Effect<
  PeerDiagnosticsType,
  TailscaleCommandError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const args = ["ping", "--c", "1", peerName];
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
            cause instanceof Error ? cause.message : "Failed to spawn tailscale ping.",
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
          cause instanceof Error ? cause.message : "Failed to run tailscale ping.",
          null,
        ),
      ),
    );

    // tailscale ping returns non-zero for unreachable peers; we still parse stdout
    const output = stdout || stderr;
    return parseTailscalePingOutput(output, peerName);
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(TAILSCALE_PING_TIMEOUT_MS),
    Effect.flatMap((result) =>
      Option.match(result, {
        onNone: () =>
          Effect.succeed(
            new PeerDiagnostics({
              peerName,
              connectionType: "unreachable",
              latencyMs: null,
              peerIp: null,
              relayServer: null,
              lastSeen: null,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

// ---------------------------------------------------------------------------
// LatencyTracker
// ---------------------------------------------------------------------------

export interface LatencyEntry {
  readonly timestamp: string;
  readonly latencyMs: number | null;
}

export class LatencyTracker {
  private readonly entries: LatencyEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 10) {
    this.maxSize = maxSize;
  }

  addLatency(result: PeerDiagnosticsType): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      latencyMs: result.latencyMs,
    });
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }
  }

  getLatencies(): ReadonlyArray<LatencyEntry> {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}
