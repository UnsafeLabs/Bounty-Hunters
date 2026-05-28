/**
 * EnvValidation - Environment variable validation at server startup.
 *
 * Defines an Effect Schema for required environment variables and provides
 * a validation function that prints a formatted table of missing or invalid
 * values, then exits with code 1 if any required variable is missing.
 *
 * @module EnvValidation
 */
import * as Config from "effect/Config";
import * as ConfigError from "effect/ConfigError";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

/**
 * Describes a single environment variable expected by the server.
 */
export interface EnvVarSpec {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly defaultValue?: string;
}

/**
 * All environment variables the server recognizes, with descriptions and
 * whether they are required (no usable default) or optional.
 */
export const ALL_ENV_VARS: readonly EnvVarSpec[] = [
  { name: "T3CODE_LOG_LEVEL", description: "Server log level (e.g. Info, Debug, Error)", required: false, defaultValue: "Info" },
  { name: "T3CODE_MODE", description: "Runtime mode (web or desktop)", required: false, defaultValue: "web" },
  { name: "T3CODE_PORT", description: "HTTP/WebSocket server port", required: false, defaultValue: "3773" },
  { name: "T3CODE_HOST", description: "Host/interface to bind", required: false },
  { name: "T3CODE_HOME", description: "Base directory for server state", required: false },
  { name: "T3CODE_NO_BROWSER", description: "Disable automatic browser opening", required: false, defaultValue: "false" },
  { name: "T3CODE_BOOTSTRAP_FD", description: "File descriptor for bootstrap secrets", required: false },
  { name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD", description: "Auto-create project from cwd", required: false, defaultValue: "false" },
  { name: "T3CODE_LOG_WS_EVENTS", description: "Log WebSocket events", required: false, defaultValue: "false" },
  { name: "T3CODE_TAILSCALE_SERVE", description: "Enable Tailscale Serve", required: false, defaultValue: "false" },
  { name: "T3CODE_TAILSCALE_SERVE_PORT", description: "Tailscale Serve HTTPS port", required: false, defaultValue: "443" },
  { name: "T3CODE_TRACE_MIN_LEVEL", description: "Minimum trace log level", required: false, defaultValue: "Info" },
  { name: "T3CODE_TRACE_TIMING_ENABLED", description: "Enable trace timing", required: false, defaultValue: "true" },
  { name: "T3CODE_TRACE_FILE", description: "Trace output file path", required: false },
  { name: "T3CODE_TRACE_MAX_BYTES", description: "Max trace file bytes", required: false, defaultValue: "10485760" },
  { name: "T3CODE_TRACE_MAX_FILES", description: "Max trace file count", required: false, defaultValue: "10" },
  { name: "T3CODE_TRACE_BATCH_WINDOW_MS", description: "Trace batch window in ms", required: false, defaultValue: "200" },
  { name: "T3CODE_OTLP_TRACES_URL", description: "OTLP traces endpoint URL", required: false },
  { name: "T3CODE_OTLP_METRICS_URL", description: "OTLP metrics endpoint URL", required: false },
  { name: "T3CODE_OTLP_EXPORT_INTERVAL_MS", description: "OTLP export interval in ms", required: false, defaultValue: "10000" },
  { name: "T3CODE_OTLP_SERVICE_NAME", description: "OTLP service name", required: false, defaultValue: "t3-server" },
  { name: "VITE_DEV_SERVER_URL", description: "Dev web server URL for Vite/HMR", required: false },
  { name: "T3CODE_DESKTOP_WS_URL", description: "Desktop WebSocket URL", required: false },
  { name: "HOST", description: "Generic host override", required: false },
  { name: "PORT", description: "Generic port override", required: false },
  { name: "VITE_WS_URL", description: "WebSocket URL for Vite", required: false },
  { name: "VITE_HOSTED_APP_URL", description: "Hosted app URL", required: false },
  { name: "VITE_HOSTED_APP_CHANNEL", description: "Hosted app channel", required: false },
  { name: "APP_VERSION", description: "Application version", required: false },
];

interface ValidationResult {
  readonly name: string;
  readonly status: "ok" | "missing" | "invalid";
  readonly message: string;
}

/**
 * Read all configured env vars from the process environment directly and
 * validate them against the known spec list.
 */
export const validateEnvironment = Effect.fn(function* (): Effect.Effect<void> {
  const results: ValidationResult[] = [];

  for (const spec of ALL_ENV_VARS) {
    // Try reading from Config system for proper type coercion
    const configEffect = (() => {
      switch (spec.name) {
        case "T3CODE_LOG_LEVEL":
          return Config.logLevel(spec.name);
        case "T3CODE_MODE":
          return Config.string(spec.name);
        case "T3CODE_PORT":
          return Config.integer(spec.name);
        case "T3CODE_NO_BROWSER":
        case "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD":
        case "T3CODE_LOG_WS_EVENTS":
        case "T3CODE_TAILSCALE_SERVE":
        case "T3CODE_TRACE_TIMING_ENABLED":
          return Config.boolean(spec.name);
        case "T3CODE_TRACE_MAX_BYTES":
        case "T3CODE_TRACE_MAX_FILES":
        case "T3CODE_TRACE_BATCH_WINDOW_MS":
        case "T3CODE_OTLP_EXPORT_INTERVAL_MS":
        case "T3CODE_BOOTSTRAP_FD":
        case "T3CODE_TAILSCALE_SERVE_PORT":
          return Config.integer(spec.name);
        case "VITE_DEV_SERVER_URL":
          return Config.url(spec.name);
        default:
          return Config.string(spec.name);
      }
    })();

    const parsed = yield* configEffect.pipe(
      Effect.catchAll((err: ConfigError.ConfigError) =>
        Effect.succeed({ error: err.message ?? String(err) } as const),
      ),
    );

    if (typeof parsed === "object" && "error" in parsed) {
      results.push({
        name: spec.name,
        status: "invalid",
        message: parsed.error,
      });
    } else if (parsed === undefined || parsed === null) {
      if (spec.required) {
        results.push({
          name: spec.name,
          status: "missing",
          message: "Required but not set",
        });
      }
      // Optional vars with no value are fine — skip
    } else {
      results.push({
        name: spec.name,
        status: "ok",
        message: spec.defaultValue && String(parsed) === spec.defaultValue
          ? `= ${String(parsed)} (default)`
          : `= ${String(parsed)}`,
      });
    }
  }

  // Print validation table
  yield* Console.log("");
  yield* Console.log("╔══════════════════════════════════════════════════════════╗");
  yield* Console.log("║        Environment Variable Validation Report          ║");
  yield* Console.log("╚══════════════════════════════════════════════════════════╝");
  yield* Console.log("");

  const header = `${"Variable".padEnd(38)} ${"Status".padEnd(12)} Value`;
  yield* Console.log(header);
  yield* Console.log("─".repeat(header.length));

  let hasErrors = false;
  for (const r of results) {
    const statusStr = r.status === "ok"
      ? "✓".padEnd(12)
      : r.status === "missing"
        ? "✗ MISSING".padEnd(12)
        : "✗ INVALID".padEnd(12);
    yield* Console.log(`${r.name.padEnd(38)} ${statusStr} ${r.message}`);
    if (r.status !== "ok") hasErrors = true;
  }

  yield* Console.log("");
  yield* Console.log("─".repeat(header.length));
  const okCount = results.filter((r) => r.status === "ok").length;
  const issueCount = results.filter((r) => r.status !== "ok").length;
  yield* Console.log(`Total: ${results.length} vars  |  OK: ${okCount}  |  Issues: ${issueCount}`);

  if (hasErrors) {
    yield* Console.log("");
    yield* Console.log("❌ Required environment variables are missing or invalid.");
    yield* Console.log("   Please set the missing values and restart the server.");
    yield* Console.log("");
    yield* Effect.dieMessage("Environment validation failed");
  } else {
    yield* Console.log("");
    yield* Console.log("✅ All environment variables are valid.");
    yield* Console.log("");
  }
});
