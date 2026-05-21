import * as Chunk from "effect/Chunk";
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
export const TAILSCALE_PING_TIMEOUT_MS = 15_000;

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

// Peer diagnostics schemas
export const PeerDiagnostics = Schema.Struct({
        peer: Schema.String,
        connectionType: Schema.Union(
                Schema.Literal("direct"),
                Schema.Literal("relayed"),
                Schema.Literal("unknown"),
        ),
        latencyMs: Schema.Number,
        relayServer: Schema.optional(Schema.String),
        relayLocation: Schema.optional(Schema.String),
        lastSeen: Schema.optional(Schema.String),
        success: Schema.Boolean,
        error: Schema.optional(Schema.String),
});
export type PeerDiagnostics = typeof PeerDiagnostics.Type;

export const PingResult = Schema.Struct({
        peer: Schema.String,
        latencyMs: Schema.Number,
        connectionType: Schema.Literal("direct") | Schema.Literal("relayed") | Schema.Literal("unknown"),
        relayServer: Schema.optional(Schema.String),
        relayLocation: Schema.optional(Schema.String),
        timestamp: Schema.String,
});
export type PingResult = typeof PingResult.Type;

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

// In-memory ping history store (last 10 pings per peer)
const pingHistoryStore = new Map<string, PingResult[]>();

const MAX_PING_HISTORY = 10;

const addToPingHistory = (result: PingResult): void => {
        const peer = result.peer;
        const history = pingHistoryStore.get(peer) ?? [];
        history.unshift(result);
        if (history.length > MAX_PING_HISTORY) {
                history.length = MAX_PING_HISTORY;
        }
        pingHistoryStore.set(peer, history);
};

export const getPingHistory = (peer: string): Effect.Effect<Chunk.Chunk<PingResult>> =>
        Effect.sync(() => {
                const history = pingHistoryStore.get(peer) ?? [];
                return Chunk.fromIterable(history);
        });

// Parse latency from tailscale ping output
const parseLatencyFromPing = (output: string): number | null => {
        // Format: "pong from foo.bar.ts.net: latency=12.34ms"
        const match = output.match(/latency=(\d+(?:\.\d+)?)ms/u);
        if (match) {
                return Number.parseFloat(match[1]);
        }
        return null;
};

// Parse connection type from tailscale ping output
const parseConnectionTypeFromPing = (output: string): "direct" | "relayed" | "unknown" => {
        if (output.includes("via DERP")) {
                return "relayed";
        }
        if (output.includes("direct")) {
                return "direct";
        }
        return "unknown";
};

// Parse relay server from tailscale ping output
const parseRelayServerFromPing = (output: string): string | null => {
        const match = output.match(/via DERP (\S+)/u);
        return match ? match[1] : null;
};

// Parse relay location from tailscale ping output
const parseRelayLocationFromPing = (output: string): string | null => {
        const match = output.match(/via DERP \S+ \(([^)]+)\)/u);
        return match ? match[1] : null;
};

export const pingPeer = (peer: string): Effect.Effect<PingResult> =>
        Effect.gen(function* () {
                const args = ["ping", peer, "--count=1"];
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

                const combinedOutput = stdout + stderr;
                const latencyMs = parseLatencyFromPing(combinedOutput) ?? 0;
                const connectionType = parseConnectionTypeFromPing(combinedOutput);
                const relayServer = parseRelayServerFromPing(combinedOutput) ?? undefined;
                const relayLocation = parseRelayLocationFromPing(combinedOutput) ?? undefined;


                const result: PingResult = {
                        peer,
                        latencyMs,
                        connectionType,
                        relayServer,
                        relayLocation,
                        timestamp: new Date().toISOString(),
                };

                if (exitCode === 0) {
                        addToPingHistory(result);
                }

                return result;
        }).pipe(
                Effect.scoped,
                Effect.timeoutOption(TAILSCALE_PING_TIMEOUT_MS),
                Effect.flatMap((result) =>
                        Option.match(result, {
                                onNone: () =>
                                        Effect.fail(
                                                tailscaleCommandError(
                                                        ["ping", peer, "--count=1"],
                                                        "Tailscale ping timed out.",
                                                        null,
                                                ),
                                        ),
                                onSome: Effect.succeed,
                        }),
                ),
        );

export const diagnosePeer = (
        peer: string,
): Effect.Effect<PeerDiagnostics, TailscaleCommandError> =>
        Effect.gen(function* () {
                const pingResult = yield* pingPeer(peer);

                return {
                        peer,
                        connectionType: pingResult.connectionType,
                        latencyMs: pingResult.latencyMs,
                        relayServer: pingResult.relayServer,
                        relayLocation: pingResult.relayLocation,
                        lastSeen: pingResult.timestamp,
                        success: pingResult.latencyMs > 0,
                        error: pingResult.latencyMs === 0 ? "Ping failed or timed out" : undefined,
                };
        });

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