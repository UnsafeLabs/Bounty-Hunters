import * as NetService from "@t3tools/shared/Net";
import { parsePersistedServerObservabilitySettings } from "@t3tools/shared/serverSettings";
import { DesktopBackendBootstrap, PortSchema } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as LogLevel from "effect/LogLevel";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { Argument, Flag } from "effect/unstable/cli";

import { readBootstrapEnvelope } from "../bootstrap.ts";
import {
  DEFAULT_PORT,
  deriveServerPaths,
  ensureServerDirectories,
  resolveStaticDir,
  RuntimeMode,
  type ServerConfigShape,
  type StartupPresentation,
} from "../config.ts";
import { expandHomePath, resolveBaseDir } from "../os-jank.ts";

export const modeFlag = Flag.choice("mode", RuntimeMode.literals).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
export const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
export const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
export const baseDirFlag = Flag.string("base-dir").pipe(
  Flag.withDescription("Base directory path (equivalent to T3CODE_HOME)."),
  Flag.optional,
);
export const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
export const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
export const bootstrapFdFlag = Flag.integer("bootstrap-fd").pipe(
  Flag.withSchema(Schema.Int),
  Flag.withDescription("Read one-time bootstrap secrets from the given file descriptor."),
  Flag.optional,
);
export const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
export const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to T3CODE_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);
export const tailscaleServeFlag = Flag.boolean("tailscale-serve").pipe(
  Flag.withDescription(
    "Configure Tailscale Serve to expose this backend over HTTPS on the Tailnet.",
  ),
  Flag.optional,
);
export const tailscaleServePortFlag = Flag.integer("tailscale-serve-port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("HTTPS port for Tailscale Serve when --tailscale-serve is enabled."),
  Flag.optional,
);

const EnvServerConfig = Config.all({
  logLevel: Config.logLevel("T3CODE_LOG_LEVEL").pipe(Config.withDefault("Info")),
  traceMinLevel: Config.logLevel("T3CODE_TRACE_MIN_LEVEL").pipe(Config.withDefault("Info")),
  traceTimingEnabled: Config.boolean("T3CODE_TRACE_TIMING_ENABLED").pipe(Config.withDefault(true)),
  traceFile: Config.string("T3CODE_TRACE_FILE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  traceMaxBytes: Config.int("T3CODE_TRACE_MAX_BYTES").pipe(Config.withDefault(10 * 1024 * 1024)),
  traceMaxFiles: Config.int("T3CODE_TRACE_MAX_FILES").pipe(Config.withDefault(10)),
  traceBatchWindowMs: Config.int("T3CODE_TRACE_BATCH_WINDOW_MS").pipe(Config.withDefault(200)),
  otlpTracesUrl: Config.string("T3CODE_OTLP_TRACES_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  otlpMetricsUrl: Config.string("T3CODE_OTLP_METRICS_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  otlpExportIntervalMs: Config.int("T3CODE_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  otlpServiceName: Config.string("T3CODE_OTLP_SERVICE_NAME").pipe(Config.withDefault("t3-server")),
  mode: Config.schema(RuntimeMode, "T3CODE_MODE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  port: Config.port("T3CODE_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("T3CODE_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  t3Home: Config.string("T3CODE_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  noBrowser: Config.boolean("T3CODE_NO_BROWSER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  bootstrapFd: Config.int("T3CODE_BOOTSTRAP_FD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("T3CODE_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  tailscaleServeEnabled: Config.boolean("T3CODE_TAILSCALE_SERVE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  tailscaleServePort: Config.port("T3CODE_TAILSCALE_SERVE_PORT").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

// Environment variable registry for validation
const ENV_VAR_SCHEMA: Array<{
  key: string;
  required: boolean;
  description: string;
  pattern?: RegExp;
}> = [
  { key: "T3CODE_LOG_LEVEL", required: false, description: "Server log level (Debug|Info|Warn|Error)" },
  { key: "T3CODE_TRACE_MIN_LEVEL", required: false, description: "Trace minimum level" },
  { key: "T3CODE_TRACE_TIMING_ENABLED", required: false, description: "Enable trace timing" },
  { key: "T3CODE_TRACE_FILE", required: false, description: "Trace output file path" },
  { key: "T3CODE_TRACE_MAX_BYTES", required: false, description: "Max trace file size in bytes" },
  { key: "T3CODE_TRACE_MAX_FILES", required: false, description: "Max number of trace files" },
  { key: "T3CODE_TRACE_BATCH_WINDOW_MS", required: false, description: "Trace batch window in ms" },
  { key: "T3CODE_OTLP_TRACES_URL", required: false, description: "OTLP traces collector URL" },
  { key: "T3CODE_OTLP_METRICS_URL", required: false, description: "OTLP metrics collector URL" },
  { key: "T3CODE_OTLP_EXPORT_INTERVAL_MS", required: false, description: "OTLP export interval in ms" },
  { key: "T3CODE_OTLP_SERVICE_NAME", required: false, description: "OTLP service name" },
  { key: "T3CODE_MODE", required: false, description: "Runtime mode (web|desktop)" },
  { key: "T3CODE_PORT", required: false, description: "Server port number" },
  { key: "T3CODE_HOST", required: false, description: "Server bind host" },
  { key: "T3CODE_HOME", required: false, description: "Base directory for state and config" },
  { key: "VITE_DEV_SERVER_URL", required: false, description: "Dev web server URL for proxy" },
  { key: "T3CODE_NO_BROWSER", required: false, description: "Disable automatic browser opening" },
  { key: "T3CODE_BOOTSTRAP_FD", required: false, description: "File descriptor for bootstrap secrets" },
  { key: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD", required: false, description: "Auto-create project from working directory" },
  { key: "T3CODE_LOG_WS_EVENTS", required: false, description: "Log WebSocket events" },
  { key: "T3CODE_TAILSCALE_SERVE", required: false, description: "Enable Tailscale Serve" },
  { key: "T3CODE_TAILSCALE_SERVE_PORT", required: false, description: "Tailscale Serve HTTPS port" },
];

interface EnvVarValidation {
  key: string;
  description: string;
  required: boolean;
  present: boolean;
  value: string;
  valid: boolean;
  error?: string;
}

/**
 * Validate all registered environment variables.
 * Returns a list of validation results and whether the config is valid.
 */
export function validateEnvironmentVars(): {
  valid: boolean;
  results: EnvVarValidation[];
} {
  const results: EnvVarValidation[] = [];
  let valid = true;

  for (const entry of ENV_VAR_SCHEMA) {
    const value = process.env[entry.key];
    const present = value !== undefined;
    let validVar = true;
    let error: string | undefined;

    if (present && entry.pattern && !entry.pattern.test(value)) {
      validVar = false;
      error = `value "${value}" does not match expected format`;
    }

    if (!present && entry.required) {
      validVar = false;
      valid = false;
    }

    if (!validVar && entry.required) {
      valid = false;
    }

    results.push({
      key: entry.key,
      description: entry.description,
      required: entry.required,
      present,
      value: present ? value : "(not set)",
      valid: validVar,
      error,
    });
  }

  return { valid, results };
}

/**
 * Format and print the validation table to console.
 */
export function printEnvValidationTable(results: EnvVarValidation[]): void {
  const { Console } = Effect.sync(() => {
    // Use Effect.sync to access Console synchronously
    return globalThis.console as Console & { table: (obj: unknown) => void };
  });
  void Console.table(results.map((r) => ({
    Variable: r.key,
    Required: r.required ? "YES" : "no",
    Present: r.present ? "YES" : "MISSING",
    Value: r.value,
    Status: r.error ? `INVALID: ${r.error}` : r.present ? "OK" : "—",
  })));
}

export interface CliServerFlags {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly baseDir: Option.Option<string>;
  readonly cwd: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly bootstrapFd: Option.Option<number>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
  readonly tailscaleServeEnabled: Option.Option<boolean>;
  readonly tailscaleServePort: Option.Option<number>;
  readonly validateConfig: Option.Option<boolean>;
}

export interface CliAuthLocationFlags {
  readonly baseDir: Option.Option<string>;
  readonly devUrl?: Option.Option<URL>;
}

export const sharedServerLocationFlags = {
  baseDir: baseDirFlag,
  devUrl: devUrlFlag,
} as const;

export const projectLocationFlags = {
  baseDir: baseDirFlag,
} as const;

export const validateConfigFlag = Flag.boolean("validate-config").pipe(
  Flag.withDescription(
    "Validate environment variables and exit without starting the server.",
  ),
  Flag.optional,
);

export const sharedServerCommandFlags = {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  baseDir: baseDirFlag,
  cwd: Argument.string("cwd").pipe(
    Argument.withDescription(
      "Working directory for provider sessions (defaults to the current directory).",
    ),
    Argument.optional,
  ),
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  bootstrapFd: bootstrapFdFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
  tailscaleServeEnabled: tailscaleServeFlag,
  tailscaleServePort: tailscaleServePortFlag,
  "validate-config": validateConfigFlag,
} as const;

export const authLocationFlags = sharedServerLocationFlags;

const resolveOptionPrecedence = <Value>(
  ...values: ReadonlyArray<Option.Option<Value>>
): Option.Option<Value> => Option.firstSomeOf(values);

const loadPersistedObservabilitySettings = Effect.fn(function* (settingsPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(settingsPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }

  const raw = yield* fs.readFileString(settingsPath).pipe(Effect.orElseSucceed(() => ""));
  return parsePersistedServerObservabilitySettings(raw);
});

export const resolveServerConfig = (
  flags: CliServerFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const { findAvailablePort } = yield* NetService.NetService;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const env = yield* EnvServerConfig;
    const normalizedFlags = {
      mode: flags.mode ?? Option.none(),
      port: flags.port ?? Option.none(),
      host: flags.host ?? Option.none(),
      baseDir: flags.baseDir ?? Option.none(),
      cwd: flags.cwd ?? Option.none(),
      devUrl: flags.devUrl ?? Option.none(),
      noBrowser: flags.noBrowser ?? Option.none(),
      bootstrapFd: flags.bootstrapFd ?? Option.none(),
      autoBootstrapProjectFromCwd: flags.autoBootstrapProjectFromCwd ?? Option.none(),
      logWebSocketEvents: flags.logWebSocketEvents ?? Option.none(),
      tailscaleServeEnabled: flags.tailscaleServeEnabled ?? Option.none(),
      tailscaleServePort: flags.tailscaleServePort ?? Option.none(),
    } satisfies CliServerFlags;
    const bootstrapFd = Option.getOrUndefined(normalizedFlags.bootstrapFd) ?? env.bootstrapFd;
    const bootstrapEnvelope =
      bootstrapFd !== undefined
        ? yield* readBootstrapEnvelope(DesktopBackendBootstrap, bootstrapFd)
        : Option.none();
    const bootstrap = Option.getOrUndefined(bootstrapEnvelope);

    const mode: RuntimeMode = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.mode,
        Option.fromUndefinedOr(env.mode),
        Option.fromUndefinedOr(bootstrap?.mode),
      ),
      () => "web",
    );

    const port = yield* Option.match(
      resolveOptionPrecedence(
        normalizedFlags.port,
        Option.fromUndefinedOr(env.port),
        Option.fromUndefinedOr(bootstrap?.port),
      ),
      {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          if (mode === "desktop") {
            return Effect.succeed(DEFAULT_PORT);
          }
          return findAvailablePort(DEFAULT_PORT);
        },
      },
    );
    const devUrl = Option.getOrElse(
      resolveOptionPrecedence(normalizedFlags.devUrl, Option.fromUndefinedOr(env.devUrl)),
      () => undefined,
    );
    const baseDir = yield* resolveBaseDir(
      Option.getOrUndefined(
        resolveOptionPrecedence(
          normalizedFlags.baseDir,
          Option.fromUndefinedOr(env.t3Home),
          Option.fromUndefinedOr(bootstrap?.t3Home),
        ),
      ),
    );
    const rawCwd = Option.getOrElse(normalizedFlags.cwd, () => process.cwd());
    const cwd = path.resolve(yield* expandHomePath(rawCwd.trim()));
    yield* fs.makeDirectory(cwd, { recursive: true });
    const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
    yield* ensureServerDirectories(derivedPaths);
    const persistedObservabilitySettings = yield* loadPersistedObservabilitySettings(
      derivedPaths.settingsPath,
    );
    const serverTracePath = env.traceFile ?? derivedPaths.serverTracePath;
    yield* fs.makeDirectory(path.dirname(serverTracePath), { recursive: true });
    const startupPresentation = options?.startupPresentation ?? "browser";
    const isHeadlessStartup = startupPresentation === "headless";
    const noBrowser = Option.getOrElse(
      resolveOptionPrecedence(
        isHeadlessStartup ? Option.some(true) : Option.none(),
        normalizedFlags.noBrowser,
        Option.fromUndefinedOr(env.noBrowser),
        Option.fromUndefinedOr(bootstrap?.noBrowser),
      ),
      () => mode === "desktop",
    );
    const desktopBootstrapToken = bootstrap?.desktopBootstrapToken;
    const autoBootstrapProjectFromCwd = Option.getOrElse(
      resolveOptionPrecedence(
        Option.fromUndefinedOr(options?.forceAutoBootstrapProjectFromCwd),
        isHeadlessStartup ? Option.some(false) : Option.none(),
        normalizedFlags.autoBootstrapProjectFromCwd,
        Option.fromUndefinedOr(env.autoBootstrapProjectFromCwd),
      ),
      () => mode === "web",
    );
    const logWebSocketEvents = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.logWebSocketEvents,
        Option.fromUndefinedOr(env.logWebSocketEvents),
      ),
      () => Boolean(devUrl),
    );
    const tailscaleServeEnabled = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.tailscaleServeEnabled,
        Option.fromUndefinedOr(env.tailscaleServeEnabled),
        Option.fromUndefinedOr(bootstrap?.tailscaleServeEnabled),
      ),
      () => false,
    );
    const tailscaleServePort = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.tailscaleServePort,
        Option.fromUndefinedOr(env.tailscaleServePort),
        Option.fromUndefinedOr(bootstrap?.tailscaleServePort),
      ),
      () => 443,
    );
    const staticDir = devUrl ? undefined : yield* resolveStaticDir();
    const host = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.host,
        Option.fromUndefinedOr(env.host),
        Option.fromUndefinedOr(bootstrap?.host),
      ),
      () => (mode === "desktop" ? "127.0.0.1" : undefined),
    );
    const logLevel = Option.getOrElse(cliLogLevel, () => env.logLevel);

    const config: ServerConfigShape = {
      logLevel,
      traceMinLevel: env.traceMinLevel,
      traceTimingEnabled: env.traceTimingEnabled,
      traceBatchWindowMs: env.traceBatchWindowMs,
      traceMaxBytes: env.traceMaxBytes,
      traceMaxFiles: env.traceMaxFiles,
      otlpTracesUrl:
        env.otlpTracesUrl ??
        bootstrap?.otlpTracesUrl ??
        persistedObservabilitySettings.otlpTracesUrl,
      otlpMetricsUrl:
        env.otlpMetricsUrl ??
        bootstrap?.otlpMetricsUrl ??
        persistedObservabilitySettings.otlpMetricsUrl,
      otlpExportIntervalMs: env.otlpExportIntervalMs,
      otlpServiceName: env.otlpServiceName,
      mode,
      port,
      cwd,
      baseDir,
      ...derivedPaths,
      serverTracePath,
      host,
      staticDir,
      devUrl,
      noBrowser,
      startupPresentation,
      desktopBootstrapToken,
      autoBootstrapProjectFromCwd,
      logWebSocketEvents,
      tailscaleServeEnabled,
      tailscaleServePort,
    };

    return config;
  });

export const resolveCliAuthConfig = (
  flags: CliAuthLocationFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
) =>
  resolveServerConfig(
    {
      mode: Option.none(),
      port: Option.none(),
      host: Option.none(),
      baseDir: flags.baseDir,
      cwd: Option.none(),
      devUrl: flags.devUrl ?? Option.none(),
      noBrowser: Option.none(),
      bootstrapFd: Option.none(),
      autoBootstrapProjectFromCwd: Option.none(),
      logWebSocketEvents: Option.none(),
      tailscaleServeEnabled: Option.none(),
      tailscaleServePort: Option.none(),
    },
    cliLogLevel,
  );

const DurationShorthandPattern = /^(?<value>\d+)(?<unit>ms|s|m|h|d|w)$/i;

const parseDurationInput = (value: string): Duration.Duration | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const shorthand = DurationShorthandPattern.exec(trimmed);
  const normalizedInput = shorthand?.groups
    ? (() => {
        const amountText = shorthand.groups.value;
        const unitText = shorthand.groups.unit;
        if (typeof amountText !== "string" || typeof unitText !== "string") {
          return null;
        }

        const amount = Number.parseInt(amountText, 10);
        if (!Number.isFinite(amount)) return null;

        switch (unitText.toLowerCase()) {
          case "ms":
            return `${amount} millis`;
          case "s":
            return `${amount} seconds`;
          case "m":
            return `${amount} minutes`;
          case "h":
            return `${amount} hours`;
          case "d":
            return `${amount} days`;
          case "w":
            return `${amount} weeks`;
          default:
            return null;
        }
      })()
    : (trimmed as Duration.Input);

  if (normalizedInput === null) return null;

  const decoded = Duration.fromInput(normalizedInput as Duration.Input);
  return Option.isSome(decoded) ? decoded.value : null;
};

export const DurationFromString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Duration,
    SchemaTransformation.transformOrFail({
      decode: (value) => {
        const duration = parseDurationInput(value);
        if (duration !== null) {
          return Effect.succeed(duration);
        }
        return Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(value), {
            message: "Invalid duration. Use values like 5m, 1h, 30d, or 15 minutes.",
          }),
        );
      },
      encode: (duration) => Effect.succeed(Duration.format(duration)),
    }),
  ),
);
