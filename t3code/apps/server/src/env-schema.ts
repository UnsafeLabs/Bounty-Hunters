/**
 * EnvSchema - Environment variable schema and validation for T3 Code Server.
 */
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export interface EnvVar<A> {
  readonly key: string;
  readonly description: string;
  readonly default: string | undefined;
  readonly type: string;
  readonly config: Config.Config<A>;
  readonly optional: boolean;
}

function varString(key: string, desc: string, def?: string): EnvVar<string> {
  const c = def !== undefined
    ? Config.string(key).pipe(Config.withDefault(def))
    : Config.string(key).pipe(Config.option, Config.map(Option.getOrUndefined));
  return { key, description: desc, default: def, type: "string", config: c as any, optional: def !== undefined };
}

function varInt(key: string, desc: string, def?: number): EnvVar<number> {
  const c = def !== undefined
    ? Config.int(key).pipe(Config.withDefault(def))
    : Config.int(key).pipe(Config.option, Config.map(Option.getOrUndefined));
  return { key, description: desc, default: def?.toString(), type: "integer", config: c as any, optional: def !== undefined };
}

function varBool(key: string, desc: string, def?: boolean): EnvVar<boolean> {
  const c = def !== undefined
    ? Config.boolean(key).pipe(Config.withDefault(def))
    : Config.boolean(key).pipe(Config.option, Config.map(Option.getOrUndefined));
  return { key, description: desc, default: def?.toString(), type: "boolean", config: c as any, optional: def !== undefined };
}

function varPort(key: string, desc: string): EnvVar<number> {
  const c = Config.port(key).pipe(Config.option, Config.map(Option.getOrUndefined));
  return { key, description: desc, default: undefined, type: "port", config: c as any, optional: true };
}

function varLogLevel(key: string, desc: string, def?: string): EnvVar<string> {
  const c = def !== undefined
    ? Config.logLevel(key).pipe(Config.withDefault(def))
    : Config.logLevel(key).pipe(Config.option, Config.map(Option.getOrUndefined));
  return { key, description: desc, default: def, type: "log-level", config: c as any, optional: def !== undefined };
}

function varUrl(key: string, desc: string): EnvVar<string> {
  const c = Config.url(key).pipe(Config.option, Config.map(Option.getOrUndefined));
  return { key, description: desc, default: undefined, type: "URL", config: c as any, optional: true };
}

export const ALL_ENV_VARS: ReadonlyArray<EnvVar<any>> = [
  varString("T3CODE_HOME", "Base directory for server state"),
  varString("T3CODE_MODE", 'Runtime mode: web or desktop'),
  varPort("T3CODE_PORT", "HTTP/WebSocket server port (default 3773)"),
  varString("T3CODE_HOST", "Host/interface to bind"),
  varLogLevel("T3CODE_LOG_LEVEL", "Server log level", "Info"),
  varLogLevel("T3CODE_TRACE_MIN_LEVEL", "Minimum trace log level", "Info"),
  varBool("T3CODE_TRACE_TIMING_ENABLED", "Enable trace timing", true),
  varString("T3CODE_TRACE_FILE", "Trace output file path"),
  varInt("T3CODE_TRACE_MAX_BYTES", "Max trace file size in bytes", 10485760),
  varInt("T3CODE_TRACE_MAX_FILES", "Max trace file count", 10),
  varInt("T3CODE_TRACE_BATCH_WINDOW_MS", "Trace batch window in ms", 200),
  varUrl("T3CODE_OTLP_TRACES_URL", "OTLP endpoint for traces"),
  varUrl("T3CODE_OTLP_METRICS_URL", "OTLP endpoint for metrics"),
  varInt("T3CODE_OTLP_EXPORT_INTERVAL_MS", "OTLP export interval in ms", 10000),
  varString("T3CODE_OTLP_SERVICE_NAME", "OTLP service name", "t3-server"),
  varBool("T3CODE_NO_BROWSER", "Disable automatic browser opening"),
  varBool("T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD", "Auto-create project for CWD"),
  varBool("T3CODE_LOG_WS_EVENTS", "Log WebSocket push traffic"),
  varString("VITE_DEV_SERVER_URL", "Dev web URL to proxy to"),
  varBool("T3CODE_TAILSCALE_SERVE", "Enable Tailscale Serve"),
  varPort("T3CODE_TAILSCALE_SERVE_PORT", "HTTPS port for Tailscale Serve"),
  varInt("T3CODE_BOOTSTRAP_FD", "File descriptor for bootstrap secrets"),
];

export interface ValidationError {
  readonly key: string;
  readonly message: string;
}

export interface EnvValidationSummary {
  readonly valid: boolean;
  readonly missing: ReadonlyArray<ValidationError>;
  readonly invalid: ReadonlyArray<ValidationError>;
  readonly table: string;
}

export const validateAllEnv = Effect.fn(function* (): EnvValidationSummary {
  const errors: Array<ValidationError> = [];
  const registered: Array<{ key: string; value: string }> = [];

  for (const ev of ALL_ENV_VARS) {
    const result = yield* Effect.either(ev.config as any);
    if (result._tag === "Right") {
      const val = result.right;
      if (val !== undefined && val !== null) {
        registered.push({ key: ev.key, value: String(val) });
      }
    } else {
      errors.push({ key: ev.key, message: "Missing or invalid: expected " + ev.type });
    }
  }

  const missing = errors;
  const invalid: Array<ValidationError> = [];
  const valid = missing.length === 0;
  const W = 38;
  const lines: Array<string> = [];
  lines.push("-".repeat(72));
  lines.push("  T3 Code Server - Environment Variable Validation");
  lines.push("-".repeat(72));
  lines.push("  Variable".padEnd(W) + "  Value / Status");
  lines.push("-".repeat(72));
  for (const ev of ALL_ENV_VARS) {
    const row = registered.find((r) => r.key === ev.key);
    if (row) {
      const val = row.value.length > 40 ? row.value.slice(0, 37) + "..." : row.value;
      const dflt = ev.default !== undefined ? "(default)" : "";
      lines.push("  " + ev.key.padEnd(W) + "  " + val + " " + dflt);
    } else if (ev.optional) {
      lines.push("  " + ev.key.padEnd(W) + "  (optional, not set)");
    } else {
      lines.push("  " + ev.key.padEnd(W) + "  MISSING - " + ev.description);
    }
  }
  lines.push("-".repeat(72));
  if (valid) {
    lines.push("  All required env vars are present and valid.");
  } else {
    lines.push("  " + String(missing.length) + " env var(s) missing or invalid:");
    for (const err of missing) {
      const ev = ALL_ENV_VARS.find((e) => e.key === err.key);
      const desc = ev ? ev.description : "unknown";
      lines.push("       - " + err.key + ": " + desc);
    }
    lines.push("  Server will not start until all required env vars are configured.");
  }
  lines.push("-".repeat(72));
  return { valid, missing, invalid, table: lines.join("\n") };
});

export const validateAndExitIfInvalid = Effect.fn(function* () {
  const summary = yield* validateAllEnv;
  yield* Console.log(summary.table);
  if (!summary.valid) {
    return yield* Effect.dieMessage("Environment validation failed.");
  }
});

export const validateAndPrint = Effect.fn(function* () {
  const summary = yield* validateAllEnv;
  yield* Console.log(summary.table);
  return summary.valid;
});
