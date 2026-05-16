import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
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
const TAILSCALE_DIAGNOSTICS_PING_COUNT = 10;

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
  DNSName: Schema.optional(Schema.Unknown),
  HostName: Schema.optional(Schema.Unknown),
  TailscaleIPs: Schema.optional(Schema.Unknown),
  LastSeen: Schema.optional(Schema.Unknown),
  Online: Schema.optional(Schema.Unknown),
  Relay: Schema.optional(Schema.Unknown),
});

const TailscaleStatusJson = Schema.Struct({
  Self: Schema.optional(TailscaleStatusSelf),
  Peer: Schema.optional(Schema.Record(Schema.String, TailscaleStatusPeer)),
});

export type TailscaleStatusSelf = typeof TailscaleStatusSelf.Type;
export type TailscaleStatusPeer = typeof TailscaleStatusPeer.Type;
export type TailscaleStatusJson = typeof TailscaleStatusJson.Type;

export interface TailscaleStatus {
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

export interface TailscalePingSample {
  readonly sequence: number;
  readonly latencyMs: number | null;
  readonly connectionType: "direct" | "relayed" | "unknown";
  readonly peerIp: string | null;
  readonly relayServer: string | null;
  readonly relayRegion: string | null;
  readonly raw: string;
}

export interface PeerDiagnostics {
  readonly peer: string;
  readonly checkedAt: string;
  readonly connectionType: "direct" | "relayed" | "unknown";
  readonly latencyMs: number | null;
  readonly peerIp: string | null;
  readonly relayServer: string | null;
  readonly relayRegion: string | null;
  readonly lastSeen: string | null;
  readonly online: boolean | null;
  readonly samples: readonly TailscalePingSample[];
  readonly error: string | null;
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

function normalizeRelayValue(value: string | null): {
  readonly relayServer: string | null;
  readonly relayRegion: string | null;
} {
  if (!value) {
    return { relayServer: null, relayRegion: null };
  }

  const normalized = value
    .trim()
    .replace(/^DERP\((.*)\)$/iu, "$1")
    .replace(/^derp-/iu, "");
  if (!normalized) {
    return { relayServer: value, relayRegion: null };
  }

  const parts = normalized.split("-");
  return {
    relayServer: normalized,
    relayRegion: parts.at(-1) ?? normalized,
  };
}

function normalizeStatusTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStatusIps(peer: TailscaleStatusPeer | undefined): readonly string[] {
  const rawIps = peer?.TailscaleIPs;
  return Array.isArray(rawIps) ? rawIps.filter((ip): ip is string => typeof ip === "string") : [];
}

function findPeerStatus(
  status: TailscaleStatusJson,
  peer: string,
  peerIp: string | null,
): TailscaleStatusPeer | undefined {
  const normalizedPeer = peer.trim().replace(/\.$/u, "").toLowerCase();
  const normalizedIp = peerIp?.trim();
  const peers = status.Peer ? Object.values(status.Peer) : [];

  return peers.find((entry) => {
    const names = [entry.DNSName, entry.HostName]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().replace(/\.$/u, "").toLowerCase());
    const ips = readStatusIps(entry);

    return (
      names.includes(normalizedPeer) ||
      ips.includes(peer) ||
      (normalizedIp !== undefined && ips.includes(normalizedIp))
    );
  });
}

export function parseTailscalePingOutput(rawOutput: string): readonly TailscalePingSample[] {
  const samples: TailscalePingSample[] = [];
  const lines = rawOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const match =
      /pong from .+? \((?<peerIp>[^)]+)\) via (?<via>.+?) in (?<latency>[0-9.]+)ms/iu.exec(line);
    if (!match?.groups) {
      continue;
    }

    const via = match.groups.via?.trim();
    const latency = match.groups.latency;
    const peerIp = match.groups.peerIp;
    if (!via || !latency || !peerIp) {
      continue;
    }
    const isRelay = /^DERP\(/iu.test(via) || /^derp-/iu.test(via);
    const relay = isRelay ? normalizeRelayValue(via) : { relayServer: null, relayRegion: null };
    samples.push({
      sequence: samples.length + 1,
      latencyMs: Number(latency),
      connectionType: isRelay ? "relayed" : "direct",
      peerIp,
      relayServer: relay.relayServer,
      relayRegion: relay.relayRegion,
      raw: line,
    });
  }

  return samples;
}

export const parseTailscaleStatusPeer = (
  rawStatusJson: string,
  input: { readonly peer: string; readonly peerIp: string | null },
): Effect.Effect<
  {
    readonly lastSeen: string | null;
    readonly online: boolean | null;
    readonly relayServer: string | null;
    readonly relayRegion: string | null;
  },
  TailscaleStatusParseError
> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((status) => {
      const peerStatus = findPeerStatus(status, input.peer, input.peerIp);
      const relay = normalizeRelayValue(
        typeof peerStatus?.Relay === "string" ? peerStatus.Relay : null,
      );

      return {
        lastSeen: normalizeStatusTimestamp(peerStatus?.LastSeen),
        online: typeof peerStatus?.Online === "boolean" ? peerStatus.Online : null,
        relayServer: relay.relayServer,
        relayRegion: relay.relayRegion,
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

const runTailscaleOutput = (
  args: readonly string[],
  input: {
    readonly spawnMessage: string;
    readonly runMessage: string;
    readonly exitMessage: (exitCode: number) => string;
  },
): Effect.Effect<string, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> =>
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
    return stdout;
  }).pipe(Effect.scoped);

function formatDiagnosticsError(error: unknown): string {
  if (error instanceof TailscaleCommandError) {
    const detail = error.stderr.trim();
    return detail ? `${error.message} ${detail}` : error.message;
  }
  if (error instanceof TailscaleStatusParseError) {
    return "Tailscale status output could not be parsed.";
  }
  return error instanceof Error ? error.message : "Tailscale diagnostics failed.";
}

function summarizeDiagnostics(
  peer: string,
  pingOutput: string,
  statusOutput: string | null,
): Effect.Effect<PeerDiagnostics, TailscaleStatusParseError> {
  const samples = parseTailscalePingOutput(pingOutput).slice(-TAILSCALE_DIAGNOSTICS_PING_COUNT);
  const latestSample = samples.at(-1);
  const peerIp = latestSample?.peerIp ?? null;

  return (
    statusOutput
      ? parseTailscaleStatusPeer(statusOutput, { peer, peerIp })
      : Effect.succeed({
          lastSeen: null,
          online: null,
          relayServer: null,
          relayRegion: null,
        })
  ).pipe(
    Effect.flatMap((statusPeer) =>
      DateTime.now.pipe(
        Effect.map((now) => {
          const relayServer = latestSample?.relayServer ?? statusPeer.relayServer;
          const relayRegion = latestSample?.relayRegion ?? statusPeer.relayRegion;
          return {
            peer,
            checkedAt: DateTime.formatIso(now),
            connectionType: latestSample?.connectionType ?? "unknown",
            latencyMs: latestSample?.latencyMs ?? null,
            peerIp,
            relayServer,
            relayRegion,
            lastSeen: statusPeer.lastSeen,
            online: statusPeer.online,
            samples,
            error:
              samples.length > 0 ? null : "No successful tailscale ping samples were returned.",
          };
        }),
      ),
    ),
  );
}

export const diagnosePeer = (input: {
  readonly peer: string;
}): Effect.Effect<PeerDiagnostics, never, ChildProcessSpawner.ChildProcessSpawner> => {
  const peer = input.peer.trim();
  const emptyResult = (error: string, checkedAt: string): PeerDiagnostics => ({
    peer,
    checkedAt,
    connectionType: "unknown",
    latencyMs: null,
    peerIp: null,
    relayServer: null,
    relayRegion: null,
    lastSeen: null,
    online: null,
    samples: [],
    error,
  });

  if (!peer) {
    return DateTime.now.pipe(
      Effect.map((now) =>
        emptyResult("A peer name or Tailscale IP is required.", DateTime.formatIso(now)),
      ),
    );
  }

  return Effect.gen(function* () {
    const pingOutput = yield* runTailscaleOutput(["ping", "--c=10", "--timeout=15s", peer], {
      spawnMessage: "Failed to spawn tailscale ping.",
      runMessage: "Failed to run tailscale ping.",
      exitMessage: (exitCode) => `Tailscale ping exited with code ${exitCode}.`,
    });
    const statusOutput = yield* runTailscaleOutput(["status", "--json"], {
      spawnMessage: "Failed to spawn tailscale status.",
      runMessage: "Failed to run tailscale status.",
      exitMessage: (exitCode) => `Tailscale status exited with code ${exitCode}.`,
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    return yield* summarizeDiagnostics(peer, pingOutput, statusOutput);
  }).pipe(
    Effect.timeoutOption(TAILSCALE_DIAGNOSTICS_TIMEOUT_MS),
    Effect.flatMap((result) =>
      Option.match(result, {
        onNone: () =>
          DateTime.now.pipe(
            Effect.map((now) =>
              emptyResult(
                "Tailscale diagnostics timed out after 15 seconds.",
                DateTime.formatIso(now),
              ),
            ),
          ),
        onSome: Effect.succeed,
      }),
    ),
    Effect.catch((error) =>
      DateTime.now.pipe(
        Effect.map((now) => emptyResult(formatDiagnosticsError(error), DateTime.formatIso(now))),
      ),
    ),
  );
};

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
