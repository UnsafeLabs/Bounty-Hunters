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
export const TAILSCALE_DIAGNOSTICS_TIMEOUT_MS = 15_000;

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

const TailscaleStatusPeer = Schema.Struct({
  HostName: Schema.optional(Schema.Unknown),
  DNSName: Schema.optional(Schema.Unknown),
  TailscaleIPs: Schema.optional(Schema.Unknown),
  LastSeen: Schema.optional(Schema.Unknown),
  Online: Schema.optional(Schema.Unknown),
});

const TailscaleStatusJson = Schema.Struct({
  Self: Schema.optional(TailscaleStatusSelf),
  Peer: Schema.optional(Schema.Record(Schema.String, TailscaleStatusPeer)),
});

export type TailscaleStatusSelf = typeof TailscaleStatusSelf.Type;
export type TailscaleStatusJson = typeof TailscaleStatusJson.Type;

export interface TailscaleStatus {
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

export const PeerDiagnostics = Schema.Struct({
  peer: Schema.String,
  reachable: Schema.Boolean,
  connectionType: Schema.Literals(["direct", "relayed", "unknown"]),
  peerIp: Schema.NullOr(Schema.String),
  latencyMs: Schema.NullOr(Schema.Number),
  relayServer: Schema.NullOr(Schema.String),
  relayRegion: Schema.NullOr(Schema.String),
  lastSeen: Schema.NullOr(Schema.String),
  online: Schema.NullOr(Schema.Boolean),
  pingSamples: Schema.Array(
    Schema.Struct({
      latencyMs: Schema.Number,
      connectionType: Schema.Literals(["direct", "relayed", "unknown"]),
      peerIp: Schema.NullOr(Schema.String),
      relayServer: Schema.NullOr(Schema.String),
      relayRegion: Schema.NullOr(Schema.String),
      raw: Schema.String,
    }),
  ),
  statusMessage: Schema.NullOr(Schema.String),
});

export type PeerDiagnostics = typeof PeerDiagnostics.Type;

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

function normalizePeerName(value: string): string {
  return value.trim().replace(/\.$/u, "").toLowerCase();
}

function parseLatencyMs(raw: string): number | null {
  const match = /\bin\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/iu.exec(raw);
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) {
    return null;
  }
  return (match[2] ?? "").toLowerCase() === "s" ? value * 1_000 : value;
}

function parseRelay(raw: string): { relayServer: string | null; relayRegion: string | null } {
  const derpMatch = /\bDERP\(([^)]+)\)/iu.exec(raw) ?? /\bderp-([a-z0-9-]+)/iu.exec(raw);
  const relayServer = derpMatch?.[1] ?? null;
  if (!relayServer) {
    return { relayServer: null, relayRegion: null };
  }
  return {
    relayServer,
    relayRegion: relayServer.split("-")[0] || relayServer,
  };
}

function parsePeerIp(raw: string): string | null {
  const parenIp = /\((100\.(?:\d{1,3}\.){2}\d{1,3})\)/u.exec(raw)?.[1];
  if (parenIp && isTailscaleIpv4Address(parenIp)) {
    return parenIp;
  }
  const bareIp = /\b(100\.(?:\d{1,3}\.){2}\d{1,3})\b/u.exec(raw)?.[1];
  return bareIp && isTailscaleIpv4Address(bareIp) ? bareIp : null;
}

export function parseTailscalePingOutput(
  peer: string,
  rawPingOutput: string,
): Pick<
  PeerDiagnostics,
  | "reachable"
  | "connectionType"
  | "latencyMs"
  | "peerIp"
  | "relayServer"
  | "relayRegion"
  | "pingSamples"
  | "statusMessage"
> {
  const lines = rawPingOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const samples = lines
    .map((line) => {
      const latencyMs = parseLatencyMs(line);
      if (latencyMs === null) {
        return null;
      }
      const { relayServer, relayRegion } = parseRelay(line);
      const connectionType = relayServer
        ? "relayed"
        : /\bvia\b/iu.test(line)
          ? "direct"
          : "unknown";
      return {
        latencyMs,
        connectionType,
        peerIp: parsePeerIp(line),
        relayServer,
        relayRegion,
        raw: line,
      } as const;
    })
    .filter((sample): sample is NonNullable<typeof sample> => sample !== null)
    .slice(-10);
  const latest = samples.at(-1);

  return {
    reachable: samples.length > 0,
    connectionType: latest?.connectionType ?? "unknown",
    latencyMs: latest?.latencyMs ?? null,
    peerIp: latest?.peerIp ?? null,
    relayServer: latest?.relayServer ?? null,
    relayRegion: latest?.relayRegion ?? null,
    pingSamples: samples,
    statusMessage: samples.length > 0 ? null : lines.at(-1) ?? `No ping response from ${peer}.`,
  };
}

export const parsePeerStatus = (
  rawStatusJson: string,
  peer: string,
): Effect.Effect<
  Pick<PeerDiagnostics, "peerIp" | "lastSeen" | "online">,
  TailscaleStatusParseError
> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((status) => {
      const normalizedPeer = normalizePeerName(peer);
      const peerEntry = Object.values(status.Peer ?? {}).find((entry) => {
        const names = [entry.HostName, entry.DNSName]
          .filter((value): value is string => typeof value === "string")
          .map(normalizePeerName);
        return names.some(
          (name) => name === normalizedPeer || name.startsWith(`${normalizedPeer}.`),
        );
      });
      const rawIps = peerEntry?.TailscaleIPs;
      const peerIp = Array.isArray(rawIps)
        ? (rawIps.find((address): address is string =>
            typeof address === "string" && isTailscaleIpv4Address(address),
          ) ?? null)
        : null;
      return {
        peerIp,
        lastSeen: typeof peerEntry?.LastSeen === "string" ? peerEntry.LastSeen : null,
        online: typeof peerEntry?.Online === "boolean" ? peerEntry.Online : null,
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

const runTailscaleOutputCommand = (
  args: readonly string[],
  input: {
    readonly spawnMessage: string;
    readonly runMessage: string;
    readonly exitMessage: (exitCode: number) => string;
    readonly timeoutMessage: string;
    readonly timeoutMs: number;
  },
): Effect.Effect<
  { readonly stdout: string; readonly stderr: string },
  TailscaleCommandError,
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
        Effect.mapError((cause) =>
          tailscaleCommandError(
            args,
            cause instanceof Error ? cause.message : input.spawnMessage,
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
          cause instanceof Error ? cause.message : input.runMessage,
          null,
        ),
      ),
    );
    if (exitCode !== 0) {
      return yield* tailscaleCommandError(args, input.exitMessage(exitCode), exitCode, stderr);
    }
    return { stdout, stderr };
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

export const diagnosePeer = (input: {
  readonly peer: string;
  readonly samples?: number;
  readonly timeoutMs?: number;
}): Effect.Effect<
  PeerDiagnostics,
  TailscaleCommandError | TailscaleStatusParseError,
  ChildProcessSpawner.ChildProcessSpawner
> => {
  const samples = Math.max(1, Math.min(input.samples ?? 10, 10));
  const timeoutMs = input.timeoutMs ?? TAILSCALE_DIAGNOSTICS_TIMEOUT_MS;
  return Effect.gen(function* () {
    const [pingOutput, statusOutput] = yield* Effect.all(
      [
        runTailscaleOutputCommand(["ping", "--c", String(samples), input.peer], {
          spawnMessage: "Failed to spawn tailscale ping.",
          runMessage: "Failed to run tailscale ping.",
          exitMessage: (exitCode) => `Tailscale ping exited with code ${exitCode}.`,
          timeoutMessage: "Tailscale ping timed out.",
          timeoutMs,
        }),
        runTailscaleOutputCommand(["status", "--json"], {
          spawnMessage: "Failed to spawn tailscale status.",
          runMessage: "Failed to run tailscale status.",
          exitMessage: (exitCode) => `Tailscale status exited with code ${exitCode}.`,
          timeoutMessage: "Tailscale status timed out.",
          timeoutMs,
        }),
      ],
      { concurrency: "unbounded" },
    );
    const pingDiagnostics = parseTailscalePingOutput(input.peer, pingOutput.stdout);
    const status = yield* parsePeerStatus(statusOutput.stdout, input.peer);
    return {
      peer: input.peer,
      ...pingDiagnostics,
      peerIp: pingDiagnostics.peerIp ?? status.peerIp,
      lastSeen: status.lastSeen,
      online: status.online,
    };
  });
};
