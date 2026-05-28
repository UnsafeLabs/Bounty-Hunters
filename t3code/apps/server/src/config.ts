// @effect-diagnostics globalConsole:off
/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LogLevel from "effect/LogLevel";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";

export const DEFAULT_PORT = 3773;

export const RuntimeMode = Schema.Literals(["web", "desktop"]);
export type RuntimeMode = typeof RuntimeMode.Type;

export const StartupPresentation = Schema.Literals(["browser", "headless"]);
export type StartupPresentation = typeof StartupPresentation.Type;

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly keybindingsConfigPath: string;
  readonly settingsPath: string;
  readonly providerStatusCacheDir: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  readonly logsDir: string;
  readonly serverLogPath: string;
  readonly serverTracePath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly terminalLogsDir: string;
  readonly anonymousIdPath: string;
  readonly environmentIdPath: string;
  readonly serverRuntimeStatePath: string;
  readonly secretsDir: string;
}

/**
 * ServerConfigShape - Process/runtime configuration required by the server.
 */
export interface ServerConfigShape extends ServerDerivedPaths {
  readonly logLevel: LogLevel.LogLevel;
  readonly traceMinLevel: LogLevel.LogLevel;
  readonly traceTimingEnabled: boolean;
  readonly traceBatchWindowMs: number;
  readonly traceMaxBytes: number;
  readonly traceMaxFiles: number;
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
  readonly otlpExportIntervalMs: number;
  readonly otlpServiceName: string;
  readonly mode: RuntimeMode;
  readonly port: number;
  readonly host: string | undefined;
  readonly cwd: string;
  readonly baseDir: string;
  readonly staticDir: string | undefined;
  readonly devUrl: URL | undefined;
  readonly noBrowser: boolean;
  readonly startupPresentation: StartupPresentation;
  readonly desktopBootstrapToken: string | undefined;
  readonly autoBootstrapProjectFromCwd: boolean;
  readonly logWebSocketEvents: boolean;
  readonly tailscaleServeEnabled: boolean;
  readonly tailscaleServePort: number;
}

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfigShape["baseDir"],
  devUrl: ServerConfigShape["devUrl"],
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(baseDir, devUrl !== undefined ? "dev" : "userdata");
  const dbPath = join(stateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const logsDir = join(stateDir, "logs");
  const providerLogsDir = join(logsDir, "provider");
  const providerStatusCacheDir = join(baseDir, "caches");
  return {
    stateDir,
    dbPath,
    keybindingsConfigPath: join(stateDir, "keybindings.json"),
    settingsPath: join(stateDir, "settings.json"),
    providerStatusCacheDir,
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    logsDir,
    serverLogPath: join(logsDir, "server.log"),
    serverTracePath: join(logsDir, "server.trace.ndjson"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    terminalLogsDir: join(logsDir, "terminals"),
    anonymousIdPath: join(stateDir, "anonymous-id"),
    environmentIdPath: join(stateDir, "environment-id"),
    serverRuntimeStatePath: join(stateDir, "server-runtime.json"),
    secretsDir: join(stateDir, "secrets"),
  };
});

export const ensureServerDirectories = Effect.fn(function* (derivedPaths: ServerDerivedPaths) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* Effect.all(
    [
      fs.makeDirectory(derivedPaths.stateDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.logsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.providerLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.terminalLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.worktreesDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.keybindingsConfigPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true }),
      fs.makeDirectory(derivedPaths.providerStatusCacheDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.anonymousIdPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.serverRuntimeStatePath), { recursive: true }),
    ],
    { concurrency: "unbounded" },
  );
});

/**
 * ServerConfig - Service tag for server runtime configuration.
 */
export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()(
  "t3/config/ServerConfig",
) {
  static readonly layerTest = (cwd: string, baseDirOrPrefix: string | { prefix: string }) =>
    Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const devUrl = undefined;

        const fs = yield* FileSystem.FileSystem;
        const baseDir =
          typeof baseDirOrPrefix === "string"
            ? baseDirOrPrefix
            : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
        const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
        yield* ensureServerDirectories(derivedPaths);

        return {
          logLevel: "Error",
          traceMinLevel: "Info",
          traceTimingEnabled: true,
          traceBatchWindowMs: 200,
          traceMaxBytes: 10 * 1024 * 1024,
          traceMaxFiles: 10,
          otlpTracesUrl: undefined,
          otlpMetricsUrl: undefined,
          otlpExportIntervalMs: 10_000,
          otlpServiceName: "t3-server",
          cwd,
          baseDir,
          ...derivedPaths,
          mode: "web",
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: false,
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
          port: 0,
          host: undefined,
          desktopBootstrapToken: undefined,
          staticDir: undefined,
          devUrl,
          noBrowser: false,
          startupPresentation: "browser",
        } satisfies ServerConfigShape;
      }),
    );
}

export const resolveStaticDir = Effect.fn(function* () {
  const { join, resolve } = yield* Path.Path;
  const { exists } = yield* FileSystem.FileSystem;
  const bundledClient = resolve(join(import.meta.dirname, "client"));
  const bundledStat = yield* exists(join(bundledClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (bundledStat) {
    return bundledClient;
  }

  const monorepoClient = resolve(join(import.meta.dirname, "../../web/dist"));
  const monorepoStat = yield* exists(join(monorepoClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (monorepoStat) {
    return monorepoClient;
  }
  return undefined;
});

/**
 * EnvVarDefinition - Description of a single environment variable for validation.
 */
export interface EnvVarDefinition {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly type: string;
  readonly defaultValue?: string;
}

/**
 * ALL_ENV_VARS - Comprehensive registry of all known environment variables.
 */
export const ALL_ENV_VARS: readonly EnvVarDefinition[] = [
  { name: "T3CODE_HOME", description: "Base directory for server state", required: false, type: "string (path)", defaultValue: "~/.t3" },
  { name: "T3CODE_MODE", description: "Runtime mode: web or desktop", required: false, type: "string (web|desktop)", defaultValue: "web" },
  { name: "T3CODE_PORT", description: "Port for the HTTP/WebSocket server", required: false, type: "number (1024-65535)", defaultValue: "3773" },
  { name: "T3CODE_HOST", description: "Host/interface to bind", required: false, type: "string (IP/hostname)" },
  { name: "T3CODE_LOG_LEVEL", description: "Minimum log level to emit", required: false, type: "string (Debug|Info|Warning|Error)", defaultValue: "Info" },
  { name: "T3CODE_NO_BROWSER", description: "Disable auto browser opening", required: false, type: "boolean", defaultValue: "false" },
  { name: "VITE_DEV_SERVER_URL", description: "Dev web URL for development", required: false, type: "string (URL)" },
  { name: "T3CODE_TRACE_MIN_LEVEL", description: "Minimum log level for trace output", required: false, type: "string (Debug|Info|Warning|Error)", defaultValue: "Info" },
  { name: "T3CODE_TRACE_TIMING_ENABLED", description: "Enable timing in traces", required: false, type: "boolean", defaultValue: "true" },
  { name: "T3CODE_TRACE_FILE", description: "Override trace NDJSON file path", required: false, type: "string (path)" },
  { name: "T3CODE_TRACE_MAX_BYTES", description: "Max trace file size before rotation", required: false, type: "number (bytes)", defaultValue: "10485760" },
  { name: "T3CODE_TRACE_MAX_FILES", description: "Max rotated trace files to retain", required: false, type: "number (integer)", defaultValue: "10" },
  { name: "T3CODE_TRACE_BATCH_WINDOW_MS", description: "Trace batching window in ms", required: false, type: "number (ms)", defaultValue: "200" },
  { name: "T3CODE_OTLP_TRACES_URL", description: "OTLP gRPC endpoint for traces", required: false, type: "string (URL)" },
  { name: "T3CODE_OTLP_METRICS_URL", description: "OTLP gRPC endpoint for metrics", required: false, type: "string (URL)" },
  { name: "T3CODE_OTLP_EXPORT_INTERVAL_MS", description: "OTLP export interval in ms", required: false, type: "number (ms)", defaultValue: "10000" },
  { name: "T3CODE_OTLP_SERVICE_NAME", description: "OTLP service name", required: false, type: "string", defaultValue: "t3-server" },
  { name: "T3CODE_TAILSCALE_SERVE", description: "Enable Tailscale Serve", required: false, type: "boolean", defaultValue: "false" },
  { name: "T3CODE_TAILSCALE_SERVE_PORT", description: "HTTPS port for Tailscale Serve", required: false, type: "number (1024-65535)", defaultValue: "443" },
  { name: "T3CODE_LOG_WS_EVENTS", description: "Log WebSocket push events", required: false, type: "boolean", defaultValue: "false" },
  { name: "T3CODE_BOOTSTRAP_FD", description: "Bootstrap FD for secrets", required: false, type: "number (fd)" },
  { name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD", description: "Auto-bootstrap project for CWD", required: false, type: "boolean", defaultValue: "false" },
];

const parseEnvBoolean = (value: string): boolean | undefined => {
  const lower = value.trim().toLowerCase();
  if (lower === "1" || lower === "true" || lower === "yes") return true;
  if (lower === "0" || lower === "false" || lower === "no" || lower === "") return false;
  return undefined;
};

const parseEnvNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
};

export interface EnvVarValidationResult {
  readonly definition: EnvVarDefinition;
  readonly status: "ok" | "missing" | "invalid_type";
  readonly actualValue?: string;
  readonly errorMessage?: string;
}
export const validateEnvVars = (): readonly EnvVarValidationResult[] => {
  const results: EnvVarValidationResult[] = [];
  for (const def of ALL_ENV_VARS) {
    const rawValue = process.env[def.name];
    const value = (rawValue ?? "").trim();
    if (value === "" || rawValue === undefined) {
      if (def.required) {
        results.push({
          definition: def,
          status: "missing",
          errorMessage: "Required variable " + def.name + " is not set",
        });
      } else {
        const defaultStr = def.defaultValue ?? "unset";
        results.push({
          definition: def,
          status: "ok",
          actualValue: "<default: " + defaultStr + ">",
        });
      }
      continue;
    }
    const typeInfo = def.type.toLowerCase();
    if (typeInfo.includes("boolean")) {
      const parsed = parseEnvBoolean(rawValue);
      if (parsed === undefined) {
        results.push({
          definition: def,
          status: "invalid_type",
          actualValue: rawValue,
          errorMessage: "Expected boolean (true/false/1/0/yes/no), got \"" + rawValue + "\"",
        });
        continue;
      }
    }
    if (typeInfo.includes("number") || typeInfo.includes("port") || typeInfo.includes("bytes") || typeInfo.includes("ms") || typeInfo.includes("fd") || typeInfo.includes("integer")) {
      const parsed = parseEnvNumber(rawValue);
      if (parsed === undefined) {
        results.push({
          definition: def,
          status: "invalid_type",
          actualValue: rawValue,
          errorMessage: "Expected number, got \"" + rawValue + "\"",
        });
        continue;
      }
    }
    if (typeInfo.includes("url")) {
      try {
        new URL(rawValue);
      } catch {
        results.push({
          definition: def,
          status: "invalid_type",
          actualValue: rawValue,
          errorMessage: "Expected valid URL, got \"" + rawValue + "\"",
        });
        continue;
      }
    }
    results.push({ definition: def, status: "ok", actualValue: rawValue });
  }
  return results;
};
export const printEnvVarValidationTable = (results: readonly EnvVarValidationResult[]): boolean => {
  const issues = results.filter((r) => r.status !== "ok");
  if (issues.length === 0) {
    console.error("");
    console.error("  " + String.fromCodePoint(0x2705) + " Environment variables: all valid");
    console.error("");
    return true;
  }
  console.error("");
  console.error("  " + String.fromCodePoint(0x274c) + " Environment variable validation failed");
  console.error("");
  const border = String.fromCodePoint(0x2500).repeat(96);
  console.error("  " + border);
  console.error("  " + String.fromCodePoint(0x2502) + " %-30s " + String.fromCodePoint(0x2502) + " %-12s " + String.fromCodePoint(0x2502) + " %-40s " + String.fromCodePoint(0x2502), "Variable", "Status", "Value / Message");
  console.error("  " + border);
  for (const result of issues) {
    const statusStr = result.status === "missing" ? String.fromCodePoint(0x1f534) + " MISSING" : String.fromCodePoint(0x1f7e1) + " INVALID";
    const valueStr = result.errorMessage ?? (result.actualValue ? result.actualValue : "<empty>");
    console.error("  " + String.fromCodePoint(0x2502) + " %-30s " + String.fromCodePoint(0x2502) + " %-12s " + String.fromCodePoint(0x2502) + " %-40s " + String.fromCodePoint(0x2502), result.definition.name, statusStr, valueStr);
  }
  console.error("  " + border);
  console.error("");
  for (const result of issues) {
    console.error("  Variable   : " + result.definition.name);
    console.error("  Description: " + result.definition.description);
    console.error("  Expected   : " + result.definition.type);
    if (result.definition.defaultValue) {
      console.error("  Default    : " + result.definition.defaultValue);
    }
    console.error("  Problem    : " + (result.errorMessage ?? "Missing required value"));
    console.error("");
  }
  return false;
};
export const exitIfEnvVarsInvalid = (): void => {
  const results = validateEnvVars();
  const passed = printEnvVarValidationTable(results);
  if (!passed) {
    console.error("  " + String.fromCodePoint(0x274c) + " Server startup aborted due to env var validation errors.");
    console.error("     Set the required variables and restart.");
    console.error("");
    process.exit(1);
  }
};
