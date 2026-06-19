/**
 * Environment variable validation for server startup.
 *
 * Validates all required environment variables before the server starts,
 * providing clear error messages for missing or invalid configuration.
 */

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as LogLevel from "effect/LogLevel";
import * as Schema from "effect/Schema";

import { RuntimeMode, type StartupPresentation } from "../config.ts";

// ---------------------------------------------------------------------------
// Env var schema definitions
// ---------------------------------------------------------------------------

const EnvVarSchema = Schema.Struct({
  // Required
  T3CODE_PORT: Schema.optional(Schema.String),
  T3CODE_HOST: Schema.optional(Schema.String),
  T3CODE_HOME: Schema.optional(Schema.String),
  T3CODE_MODE: Schema.optional(Schema.String),
  T3CODE_LOG_LEVEL: Schema.optional(Schema.String),
  T3CODE_DEV_SERVER_URL: Schema.optional(Schema.String),

  // Optional with defaults
  T3CODE_NO_BROWSER: Schema.optional(Schema.String),
  T3CODE_LOG_WS_EVENTS: Schema.optional(Schema.String),
  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: Schema.optional(Schema.String),
  T3CODE_BOOTSTRAP_FD: Schema.optional(Schema.String),
  T3CODE_TAILSCALE_SERVE: Schema.optional(Schema.String),
  T3CODE_TAILSCALE_SERVE_PORT: Schema.optional(Schema.String),
  T3CODE_TRACE_MIN_LEVEL: Schema.optional(Schema.String),
  T3CODE_TRACE_TIMING_ENABLED: Schema.optional(Schema.String),
  T3CODE_TRACE_FILE: Schema.optional(Schema.String),
  T3CODE_TRACE_MAX_BYTES: Schema.optional(Schema.String),
  T3CODE_TRACE_MAX_FILES: Schema.optional(Schema.String),
  T3CODE_TRACE_BATCH_WINDOW_MS: Schema.optional(Schema.String),
  T3CODE_OTLP_TRACES_URL: Schema.optional(Schema.String),
  T3CODE_OTLP_METRICS_URL: Schema.optional(Schema.String),
  T3CODE_OTLP_EXPORT_INTERVAL_MS: Schema.optional(Schema.String),
  T3CODE_OTLP_SERVICE_NAME: Schema.optional(Schema.String),
});

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export interface ValidationError {
  readonly variable: string;
  readonly expected: string;
  readonly received: string | undefined;
  readonly description: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<ValidationError>;
  readonly warnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------

const ENV_VAR_DESCRIPTIONS: Record<string, { description: string; expected: string; required: boolean }> = {
  T3CODE_PORT: {
    description: "Port for the HTTP/WebSocket server",
    expected: "integer (1-65535)",
    required: false,
  },
  T3CODE_HOST: {
    description: "Host/interface to bind",
    expected: "string (e.g., 127.0.0.1, 0.0.0.0)",
    required: false,
  },
  T3CODE_HOME: {
    description: "Base directory path for server state",
    expected: "string (absolute path)",
    required: false,
  },
  T3CODE_MODE: {
    description: "Runtime mode",
    expected: "web | desktop",
    required: false,
  },
  T3CODE_LOG_LEVEL: {
    description: "Minimum log level",
    expected: "Trace | Debug | Info | Warning | Error | Fatal | All | None",
    required: false,
  },
  T3CODE_DEV_SERVER_URL: {
    description: "Dev web URL to proxy/redirect to",
    expected: "valid URL",
    required: false,
  },
  T3CODE_NO_BROWSER: {
    description: "Disable automatic browser opening",
    expected: "true | false",
    required: false,
  },
  T3CODE_LOG_WS_EVENTS: {
    description: "Emit server-side logs for WebSocket push traffic",
    expected: "true | false",
    required: false,
  },
  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: {
    description: "Auto-create project for cwd on startup",
    expected: "true | false",
    required: false,
  },
  T3CODE_BOOTSTRAP_FD: {
    description: "File descriptor for bootstrap secrets",
    expected: "integer",
    required: false,
  },
  T3CODE_TAILSCALE_SERVE: {
    description: "Enable Tailscale Serve",
    expected: "true | false",
    required: false,
  },
  T3CODE_TAILSCALE_SERVE_PORT: {
    description: "HTTPS port for Tailscale Serve",
    expected: "integer (1-65535)",
    required: false,
  },
  T3CODE_TRACE_MIN_LEVEL: {
    description: "Minimum trace log level",
    expected: "Trace | Debug | Info | Warning | Error | Fatal",
    required: false,
  },
  T3CODE_TRACE_TIMING_ENABLED: {
    description: "Enable trace timing",
    expected: "true | false",
    required: false,
  },
  T3CODE_TRACE_FILE: {
    description: "Trace output file path",
    expected: "string (file path)",
    required: false,
  },
  T3CODE_TRACE_MAX_BYTES: {
    description: "Maximum trace file size in bytes",
    expected: "integer",
    required: false,
  },
  T3CODE_TRACE_MAX_FILES: {
    description: "Maximum number of trace files",
    expected: "integer",
    required: false,
  },
  T3CODE_TRACE_BATCH_WINDOW_MS: {
    description: "Trace batch window in milliseconds",
    expected: "integer",
    required: false,
  },
  T3CODE_OTLP_TRACES_URL: {
    description: "OTLP traces endpoint URL",
    expected: "valid URL",
    required: false,
  },
  T3CODE_OTLP_METRICS_URL: {
    description: "OTLP metrics endpoint URL",
    expected: "valid URL",
    required: false,
  },
  T3CODE_OTLP_EXPORT_INTERVAL_MS: {
    description: "OTLP export interval in milliseconds",
    expected: "integer",
    required: false,
  },
  T3CODE_OTLP_SERVICE_NAME: {
    description: "OTLP service name",
    expected: "string",
    required: false,
  },
};

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

function validatePort(value: string | undefined, name: string): ValidationError | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    return {
      variable: name,
      expected: "integer (1-65535)",
      received: value,
      description: ENV_VAR_DESCRIPTIONS[name]?.description ?? "",
    };
  }
  return null;
}

function validateBoolean(value: string | undefined, name: string): ValidationError | null {
  if (value === undefined) return null;
  const lower = value.toLowerCase();
  if (lower !== "true" && lower !== "false" && lower !== "1" && lower !== "0") {
    return {
      variable: name,
      expected: "true | false",
      received: value,
      description: ENV_VAR_DESCRIPTIONS[name]?.description ?? "",
    };
  }
  return null;
}

function validateUrl(value: string | undefined, name: string): ValidationError | null {
  if (value === undefined) return null;
  try {
    new URL(value);
    return null;
  } catch {
    return {
      variable: name,
      expected: "valid URL",
      received: value,
      description: ENV_VAR_DESCRIPTIONS[name]?.description ?? "",
    };
  }
}

function validateLogLevel(value: string | undefined, name: string): ValidationError | null {
  if (value === undefined) return null;
  const valid = ["Trace", "Debug", "Info", "Warning", "Error", "Fatal", "All", "None"];
  if (!valid.includes(value)) {
    return {
      variable: name,
      expected: valid.join(" | "),
      received: value,
      description: ENV_VAR_DESCRIPTIONS[name]?.description ?? "",
    };
  }
  return null;
}

function validateMode(value: string | undefined, name: string): ValidationError | null {
  if (value === undefined) return null;
  if (value !== "web" && value !== "desktop") {
    return {
      variable: name,
      expected: "web | desktop",
      received: value,
      description: ENV_VAR_DESCRIPTIONS[name]?.description ?? "",
    };
  }
  return null;
}

function validateInteger(value: string | undefined, name: string): ValidationError | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return {
      variable: name,
      expected: "integer",
      received: value,
      description: ENV_VAR_DESCRIPTIONS[name]?.description ?? "",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

export function validateEnvVars(): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  const env = process.env;

  // Validate port
  const portError = validatePort(env.T3CODE_PORT, "T3CODE_PORT");
  if (portError) errors.push(portError);

  // Validate mode
  const modeError = validateMode(env.T3CODE_MODE, "T3CODE_MODE");
  if (modeError) errors.push(modeError);

  // Validate log level
  const logLevelError = validateLogLevel(env.T3CODE_LOG_LEVEL, "T3CODE_LOG_LEVEL");
  if (logLevelError) errors.push(logLevelError);

  // Validate trace min level
  const traceLevelError = validateLogLevel(env.T3CODE_TRACE_MIN_LEVEL, "T3CODE_TRACE_MIN_LEVEL");
  if (traceLevelError) errors.push(traceLevelError);

  // Validate URLs
  const devUrlError = validateUrl(env.T3CODE_DEV_SERVER_URL, "T3CODE_DEV_SERVER_URL");
  if (devUrlError) errors.push(devUrlError);

  const otlpTracesError = validateUrl(env.T3CODE_OTLP_TRACES_URL, "T3CODE_OTLP_TRACES_URL");
  if (otlpTracesError) errors.push(otlpTracesError);

  const otlpMetricsError = validateUrl(env.T3CODE_OTLP_METRICS_URL, "T3CODE_OTLP_METRICS_URL");
  if (otlpMetricsError) errors.push(otlpMetricsError);

  // Validate booleans
  for (const name of ["T3CODE_NO_BROWSER", "T3CODE_LOG_WS_EVENTS", "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD", "T3CODE_TAILSCALE_SERVE", "T3CODE_TRACE_TIMING_ENABLED"]) {
    const error = validateBoolean(env[name], name);
    if (error) errors.push(error);
  }

  // Validate integers
  for (const name of ["T3CODE_BOOTSTRAP_FD", "T3CODE_TAILSCALE_SERVE_PORT", "T3CODE_TRACE_MAX_BYTES", "T3CODE_TRACE_MAX_FILES", "T3CODE_TRACE_BATCH_WINDOW_MS", "T3CODE_OTLP_EXPORT_INTERVAL_MS"]) {
    const error = validateInteger(env[name], name);
    if (error) errors.push(error);
  }

  // Warnings for optional vars with defaults
  if (env.T3CODE_OTLP_SERVICE_NAME === undefined) {
    warnings.push("T3CODE_OTLP_SERVICE_NAME not set, using default: t3-server");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Formatted error output
// ---------------------------------------------------------------------------

export function formatValidationTable(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════════════════════╗");
  lines.push("║                    ENVIRONMENT VARIABLE VALIDATION REPORT                    ║");
  lines.push("╚══════════════════════════════════════════════════════════════════════════════╝");
  lines.push("");

  if (result.valid) {
    lines.push("  ✅ All environment variables are valid.");
  } else {
    lines.push(`  ❌ ${result.errors.length} validation error(s) found:`);
    lines.push("");
    lines.push("  ┌─────────────────────┬──────────────────────────┬──────────────────────────┐");
    lines.push("  │ Variable            │ Expected                 │ Received                 │");
    lines.push("  ├─────────────────────┼──────────────────────────┼──────────────────────────┤");

    for (const error of result.errors) {
      const variable = error.variable.padEnd(19).slice(0, 19);
      const expected = error.expected.padEnd(24).slice(0, 24);
      const received = (error.received ?? "<undefined>").padEnd(24).slice(0, 24);
      lines.push(`  │ ${variable} │ ${expected} │ ${received} │`);
    }

    lines.push("  └─────────────────────┴──────────────────────────┴──────────────────────────┘");
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("  ⚠️  Warnings:");
    for (const warning of result.warnings) {
      lines.push(`     - ${warning}`);
    }
  }

  lines.push("");

  // Document optional vars with defaults
  lines.push("  📋 Optional environment variables with defaults:");
  lines.push("  ┌─────────────────────────────────────┬────────────────────────────────────┐");
  lines.push("  │ Variable                            │ Default                            │");
  lines.push("  ├─────────────────────────────────────┼────────────────────────────────────┤");
  lines.push("  │ T3CODE_LOG_LEVEL                    │ Info                               │");
  lines.push("  │ T3CODE_TRACE_MIN_LEVEL              │ Info                               │");
  lines.push("  │ T3CODE_TRACE_TIMING_ENABLED         │ true                               │");
  lines.push("  │ T3CODE_TRACE_MAX_BYTES              │ 10485760 (10 MB)                   │");
  lines.push("  │ T3CODE_TRACE_MAX_FILES              │ 10                                 │");
  lines.push("  │ T3CODE_TRACE_BATCH_WINDOW_MS        │ 200                                │");
  lines.push("  │ T3CODE_OTLP_EXPORT_INTERVAL_MS      │ 10000                              │");
  lines.push("  │ T3CODE_OTLP_SERVICE_NAME            │ t3-server                          │");
  lines.push("  │ T3CODE_TAILSCALE_SERVE_PORT         │ 443                                │");
  lines.push("  └─────────────────────────────────────┴────────────────────────────────────┘");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Effect-based validation (for use in server startup)
// ---------------------------------------------------------------------------

export const validateEnvVarsEffect: Effect.Effect<ValidationResult, never> = Effect.sync(() =>
  validateEnvVars(),
);

export const exitIfInvalid: Effect.Effect<never, never> = Effect.gen(function* () {
  const result = yield* validateEnvVarsEffect;
  if (!result.valid) {
    const table = formatValidationTable(result);
    yield* Effect.logError(table);
    yield* Effect.fail(new Error("Environment variable validation failed"));
  }
});
