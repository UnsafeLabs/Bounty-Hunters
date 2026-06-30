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
export const validateConfigFlag = Flag.boolean("validate-config").pipe(
  Flag.withDescription(
    "Validate known startup environment variables and exit before starting the server.",
  ),
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
  validateConfig: validateConfigFlag,
} as const;

type EnvValidationStatus = "valid" | "default" | "optional" | "invalid";

export interface ServerEnvironmentValidationRow {
  readonly name: string;
  readonly status: EnvValidationStatus;
  readonly expected: string;
  readonly description: string;
  readonly value: string | undefined;
  readonly note: string;
}

export interface ServerEnvironmentValidationResult {
  readonly hasErrors: boolean;
  readonly rows: ReadonlyArray<ServerEnvironmentValidationRow>;
}

interface ServerEnvironmentValidationSpec {
  readonly name: string;
  readonly expected: string;
  readonly description: string;
  readonly defaultNote?: string;
  readonly sensitive?: boolean;
  readonly validate: (value: string) => boolean;
}

const serverEnvironmentValidationSpecs: ReadonlyArray<ServerEnvironmentValidationSpec> = [
  {
    name: "T3CODE_LOG_LEVEL",
    expected: "All | Fatal | Error | Warn | Info | Debug | Trace | None",
    description: "Server log level.",
    defaultNote: "defaults to Info",
    validate: (value) =>
      ["all", "fatal", "error", "warn", "warning", "info", "debug", "trace", "none"].includes(
        value.trim().toLowerCase(),
      ),
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    expected: "All | Fatal | Error | Warn | Info | Debug | Trace | None",
    description: "Minimum log level captured in trace output.",
    defaultNote: "defaults to Info",
    validate: (value) =>
      ["all", "fatal", "error", "warn", "warning", "info", "debug", "trace", "none"].includes(
        value.trim().toLowerCase(),
      ),
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    expected: "boolean",
    description: "Enable trace timing annotations.",
    defaultNote: "defaults to true",
    validate: (value) =>
      ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value.trim().toLowerCase()),
  },
  {
    name: "T3CODE_TRACE_FILE",
    expected: "path",
    description: "Override trace output file path.",
    validate: (value) => value.trim().length > 0,
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    expected: "integer >= 0",
    description: "Maximum bytes per trace log file.",
    defaultNote: "defaults to 10485760",
    validate: (value) => /^\d+$/.test(value.trim()),
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    expected: "integer >= 0",
    description: "Maximum number of trace log files to retain.",
    defaultNote: "defaults to 10",
    validate: (value) => /^\d+$/.test(value.trim()),
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    expected: "integer >= 0",
    description: "Trace batching window in milliseconds.",
    defaultNote: "defaults to 200",
    validate: (value) => /^\d+$/.test(value.trim()),
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    expected: "URL",
    description: "Optional OTLP traces endpoint.",
    validate: (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol.length > 0;
      } catch {
        return false;
      }
    },
  },
  {
    name: "T3CODE_POSTHOG_KEY",
    expected: "non-empty string",
    description: "Optional PostHog project key for telemetry.",
    validate: (value) => value.trim().length > 0,
    sensitive: true,
  },
  {
    name: "T3CODE_POSTHOG_HOST",
    expected: "URL",
    description: "Optional PostHog ingestion host.",
    defaultNote: "defaults to https://us.i.posthog.com",
    validate: (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol.length > 0;
      } catch {
        return false;
      }
    },
  },
  {
    name: "T3CODE_TELEMETRY_ENABLED",
    expected: "boolean",
    description: "Enable or disable anonymous telemetry buffering.",
    defaultNote: "defaults to true",
    validate: (value) =>
      ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value.trim().toLowerCase()),
  },
  {
    name: "T3CODE_TELEMETRY_FLUSH_BATCH_SIZE",
    expected: "number >= 0",
    description: "Maximum telemetry events per flush batch.",
    defaultNote: "defaults to 20",
    validate: (value) => !Number.isNaN(Number(value.trim())),
  },
  {
    name: "T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS",
    expected: "number >= 0",
    description: "Maximum buffered telemetry events in memory.",
    defaultNote: "defaults to 1000",
    validate: (value) => !Number.isNaN(Number(value.trim())),
  },
  {
    name: "T3CODE_BITBUCKET_API_BASE_URL",
    expected: "URL",
    description: "Optional Bitbucket API base URL override.",
    defaultNote: "defaults to https://api.bitbucket.org/2.0",
    validate: (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol.length > 0;
      } catch {
        return false;
      }
    },
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    expected: "URL",
    description: "Optional OTLP metrics endpoint.",
    validate: (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol.length > 0;
      } catch {
        return false;
      }
    },
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    expected: "integer >= 0",
    description: "OTLP export interval in milliseconds.",
    defaultNote: "defaults to 10000",
    validate: (value) => /^\d+$/.test(value.trim()),
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    expected: "non-empty string",
    description: "Service name attached to OTLP exports.",
    defaultNote: "defaults to t3-server",
    validate: (value) => value.trim().length > 0,
  },
  {
    name: "T3CODE_MODE",
    expected: "web | desktop",
    description: "Runtime mode.",
    validate: (value) => ["web", "desktop"].includes(value.trim()),
  },
  {
    name: "T3CODE_PORT",
    expected: "port 1-65535",
    description: "HTTP/WebSocket listen port.",
    validate: (value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
    },
  },
  {
    name: "T3CODE_HOST",
    expected: "host or IP string",
    description: "Optional bind host/interface.",
    validate: (value) => value.trim().length > 0,
  },
  {
    name: "T3CODE_HOME",
    expected: "path",
    description: "Optional base directory for state and worktrees.",
    validate: (value) => value.trim().length > 0,
  },
  {
    name: "VITE_DEV_SERVER_URL",
    expected: "URL",
    description: "Optional dev server URL for proxying the web app.",
    validate: (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol.length > 0;
      } catch {
        return false;
      }
    },
  },
  {
    name: "T3CODE_NO_BROWSER",
    expected: "boolean",
    description: "Disable automatic browser launch.",
    validate: (value) =>
      ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value.trim().toLowerCase()),
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    expected: "integer >= 0",
    description: "Optional bootstrap file descriptor.",
    validate: (value) => /^\d+$/.test(value.trim()),
  },
  {
    name: "T3CODE_BITBUCKET_ACCESS_TOKEN",
    expected: "non-empty string",
    description: "Optional Bitbucket bearer token.",
    validate: (value) => value.trim().length > 0,
    sensitive: true,
  },
  {
    name: "T3CODE_BITBUCKET_EMAIL",
    expected: "non-empty string",
    description: "Optional Bitbucket account email for app-password auth.",
    validate: (value) => value.trim().length > 0,
    sensitive: true,
  },
  {
    name: "T3CODE_BITBUCKET_API_TOKEN",
    expected: "non-empty string",
    description: "Optional Bitbucket API token for app-password auth.",
    validate: (value) => value.trim().length > 0,
    sensitive: true,
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    expected: "boolean",
    description: "Bootstrap the current working directory as a project on startup.",
    validate: (value) =>
      ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value.trim().toLowerCase()),
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    expected: "boolean",
    description: "Log outbound websocket events.",
    validate: (value) =>
      ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value.trim().toLowerCase()),
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    expected: "boolean",
    description: "Enable Tailscale Serve HTTPS exposure.",
    validate: (value) =>
      ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value.trim().toLowerCase()),
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    expected: "port 1-65535",
    description: "HTTPS port for Tailscale Serve.",
    defaultNote: "defaults to 443",
    validate: (value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
    },
  },
];

export const validateServerEnvironment = (
  env: Readonly<Record<string, string | undefined>>,
): ServerEnvironmentValidationResult => {
  const rows = serverEnvironmentValidationSpecs.map((spec) => {
    const rawValue = env[spec.name];
    const displayValue =
      rawValue === undefined
        ? undefined
        : spec.sensitive
          ? rawValue.length > 0
            ? "[redacted]"
            : ""
          : rawValue;
    if (rawValue === undefined) {
      return {
        name: spec.name,
        status: spec.defaultNote ? "default" : "optional",
        expected: spec.expected,
        description: spec.description,
        value: undefined,
        note: spec.defaultNote ?? "optional and unset",
      } satisfies ServerEnvironmentValidationRow;
    }

    if (spec.validate(rawValue)) {
      return {
        name: spec.name,
        status: "valid",
        expected: spec.expected,
        description: spec.description,
        value: displayValue,
        note: "valid",
      } satisfies ServerEnvironmentValidationRow;
    }

    return {
      name: spec.name,
      status: "invalid",
      expected: spec.expected,
      description: spec.description,
      value: displayValue,
      note: spec.sensitive ? "received [redacted]" : `received ${JSON.stringify(rawValue)}`,
    } satisfies ServerEnvironmentValidationRow;
  });

  return {
    hasErrors: rows.some((row) => row.status === "invalid"),
    rows,
  };
};

export const formatServerEnvironmentValidation = (
  result: ServerEnvironmentValidationResult,
): string => {
  const lines = [
    "T3 Code server environment validation",
    result.hasErrors
      ? "Status: failed - fix the invalid values before startup."
      : "Status: passed - startup environment looks valid.",
    "",
    "STATUS   VARIABLE                              EXPECTED                               VALUE                  NOTE",
  ];

  for (const row of result.rows) {
    const status = row.status.toUpperCase().padEnd(8, " ");
    const name = row.name.padEnd(37, " ");
    const expected = row.expected.padEnd(38, " ");
    const value = (row.value ?? "-").slice(0, 20).padEnd(22, " ");
    lines.push(`${status}${name}${expected}${value}${row.note}`);
  }

  return lines.join("\n");
};

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
      validateConfig: flags.validateConfig ?? Option.none(),
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
      validateConfig: Option.none(),
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
