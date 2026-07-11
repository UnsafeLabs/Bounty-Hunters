/**
 * Environment variable validation for server startup.
 *
 * Validates known T3CODE_* / VITE_* settings before any database connections
 * or network listeners are created. Supports `--validate-config`.
 *
 * @module EnvValidation
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type EnvVarKind = "string" | "int" | "port" | "boolean" | "logLevel" | "mode" | "url";

export interface EnvVarSpec {
  readonly name: string;
  readonly kind: EnvVarKind;
  readonly required: boolean;
  readonly defaultValue: string | undefined;
  readonly description: string;
  readonly expectedFormat: string;
}

/** Catalog of server environment variables (required + optional with defaults). */
export const SERVER_ENV_SPECS: ReadonlyArray<EnvVarSpec> = [
  {
    name: "T3CODE_LOG_LEVEL",
    kind: "logLevel",
    required: false,
    defaultValue: "Info",
    description: "Minimum log level for server logs",
    expectedFormat: "All|Fatal|Error|Warn|Info|Debug|Trace",
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    kind: "logLevel",
    required: false,
    defaultValue: "Info",
    description: "Minimum level written to the trace file",
    expectedFormat: "All|Fatal|Error|Warn|Info|Debug|Trace",
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    kind: "boolean",
    required: false,
    defaultValue: "true",
    description: "Enable timing fields in trace output",
    expectedFormat: "true|false|1|0",
  },
  {
    name: "T3CODE_TRACE_FILE",
    kind: "string",
    required: false,
    defaultValue: undefined,
    description: "Override path for the NDJSON trace file",
    expectedFormat: "filesystem path",
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    kind: "int",
    required: false,
    defaultValue: String(10 * 1024 * 1024),
    description: "Max bytes per rotated trace file",
    expectedFormat: "positive integer",
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    kind: "int",
    required: false,
    defaultValue: "10",
    description: "Max rotated trace files to retain",
    expectedFormat: "positive integer",
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    kind: "int",
    required: false,
    defaultValue: "200",
    description: "Trace batch flush window in milliseconds",
    expectedFormat: "non-negative integer",
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    kind: "url",
    required: false,
    defaultValue: undefined,
    description: "OTLP HTTP traces export endpoint",
    expectedFormat: "absolute URL",
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    kind: "url",
    required: false,
    defaultValue: undefined,
    description: "OTLP HTTP metrics export endpoint",
    expectedFormat: "absolute URL",
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    kind: "int",
    required: false,
    defaultValue: "10000",
    description: "OTLP export interval in milliseconds",
    expectedFormat: "positive integer",
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    kind: "string",
    required: false,
    defaultValue: "t3-server",
    description: "OTLP resource service name",
    expectedFormat: "non-empty string",
  },
  {
    name: "T3CODE_MODE",
    kind: "mode",
    required: false,
    defaultValue: "web",
    description: "Runtime mode",
    expectedFormat: "web|desktop",
  },
  {
    name: "T3CODE_PORT",
    kind: "port",
    required: false,
    defaultValue: "auto (from 3773)",
    description: "HTTP/WebSocket listen port",
    expectedFormat: "integer 1-65535",
  },
  {
    name: "T3CODE_HOST",
    kind: "string",
    required: false,
    defaultValue: undefined,
    description: "Bind host/interface",
    expectedFormat: "hostname or IP",
  },
  {
    name: "T3CODE_HOME",
    kind: "string",
    required: false,
    defaultValue: undefined,
    description: "Base directory for state and userdata",
    expectedFormat: "filesystem path",
  },
  {
    name: "VITE_DEV_SERVER_URL",
    kind: "url",
    required: false,
    defaultValue: undefined,
    description: "Dev web URL to proxy/redirect to",
    expectedFormat: "absolute URL",
  },
  {
    name: "T3CODE_NO_BROWSER",
    kind: "boolean",
    required: false,
    defaultValue: undefined,
    description: "Disable automatic browser opening",
    expectedFormat: "true|false|1|0",
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    kind: "int",
    required: false,
    defaultValue: undefined,
    description: "File descriptor for one-time bootstrap secrets",
    expectedFormat: "non-negative integer",
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    kind: "boolean",
    required: false,
    defaultValue: undefined,
    description: "Create a project for cwd on startup when missing",
    expectedFormat: "true|false|1|0",
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    kind: "boolean",
    required: false,
    defaultValue: undefined,
    description: "Log outbound WebSocket push traffic",
    expectedFormat: "true|false|1|0",
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    kind: "boolean",
    required: false,
    defaultValue: "false",
    description: "Enable Tailscale Serve HTTPS exposure",
    expectedFormat: "true|false|1|0",
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    kind: "port",
    required: false,
    defaultValue: "443",
    description: "HTTPS port for Tailscale Serve",
    expectedFormat: "integer 1-65535",
  },
] as const;

export type EnvIssueKind = "missing" | "invalid";

export interface EnvValidationIssue {
  readonly name: string;
  readonly kind: EnvIssueKind;
  readonly expectedFormat: string;
  readonly received: string;
  readonly description: string;
}

export interface EnvValidationResult {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<EnvValidationIssue>;
  readonly optionalWithDefaults: ReadonlyArray<EnvVarSpec>;
}

const LOG_LEVELS = new Set(["All", "Fatal", "Error", "Warn", "Info", "Debug", "Trace"]);
const MODES = new Set(["web", "desktop"]);
const BOOL_TRUE = new Set(["true", "1", "yes", "on"]);
const BOOL_FALSE = new Set(["false", "0", "no", "off"]);

const parseBoolean = (raw: string): boolean | null => {
  const normalized = raw.trim().toLowerCase();
  if (BOOL_TRUE.has(normalized)) return true;
  if (BOOL_FALSE.has(normalized)) return false;
  return null;
};

const parseIntStrict = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
};

const parsePort = (raw: string): number | null => {
  const n = parseIntStrict(raw);
  if (n === null || n < 1 || n > 65535) return null;
  return n;
};

const parseUrl = (raw: string): string | null => {
  try {
    // Absolute URL only
    const url = new URL(raw.trim());
    if (!url.protocol.startsWith("http")) return null;
    return url.toString();
  } catch {
    return null;
  }
};

/** Returns null when the value is valid for the kind; otherwise an error detail. */
export const validateEnvValue = (
  kind: EnvVarKind,
  raw: string,
): { ok: true; value: unknown } | { ok: false; detail: string } => {
  switch (kind) {
    case "string": {
      if (raw.trim().length === 0) {
        return { ok: false, detail: "empty string" };
      }
      return { ok: true, value: raw };
    }
    case "int": {
      const n = parseIntStrict(raw);
      if (n === null) return { ok: false, detail: "not an integer" };
      return { ok: true, value: n };
    }
    case "port": {
      const n = parsePort(raw);
      if (n === null) return { ok: false, detail: "not a port in 1-65535" };
      return { ok: true, value: n };
    }
    case "boolean": {
      const b = parseBoolean(raw);
      if (b === null) return { ok: false, detail: "not a boolean" };
      return { ok: true, value: b };
    }
    case "logLevel": {
      const v = raw.trim();
      // Effect Config.logLevel is case-sensitive on known labels; accept exact set.
      if (!LOG_LEVELS.has(v)) return { ok: false, detail: "unknown log level" };
      return { ok: true, value: v };
    }
    case "mode": {
      const v = raw.trim().toLowerCase();
      if (!MODES.has(v)) return { ok: false, detail: "unknown mode" };
      return { ok: true, value: v };
    }
    case "url": {
      const u = parseUrl(raw);
      if (u === null) return { ok: false, detail: "not an absolute http(s) URL" };
      return { ok: true, value: u };
    }
  }
};

export const validateEnvironment = (
  env: NodeJS.Dict<string> = process.env,
  specs: ReadonlyArray<EnvVarSpec> = SERVER_ENV_SPECS,
): EnvValidationResult => {
  const issues: EnvValidationIssue[] = [];

  for (const spec of specs) {
    const raw = env[spec.name];
    const present = raw !== undefined && raw !== "";

    if (!present) {
      if (spec.required) {
        issues.push({
          name: spec.name,
          kind: "missing",
          expectedFormat: spec.expectedFormat,
          received: "(unset)",
          description: spec.description,
        });
      }
      continue;
    }

    const result = validateEnvValue(spec.kind, raw);
    if (!result.ok) {
      issues.push({
        name: spec.name,
        kind: "invalid",
        expectedFormat: `${spec.expectedFormat} (${result.detail})`,
        received: JSON.stringify(raw),
        description: spec.description,
      });
    }
  }

  const optionalWithDefaults = specs.filter((s) => !s.required);

  return {
    ok: issues.length === 0,
    issues,
    optionalWithDefaults,
  };
};

const pad = (value: string, width: number) =>
  value.length >= width ? value : value + " ".repeat(width - value.length);

/**
 * Format validation issues (and optional defaults) as a readable ASCII table.
 */
export const formatEnvValidationTable = (result: EnvValidationResult): string => {
  const headers = ["Variable", "Status", "Expected", "Received", "Description"] as const;
  const rows: Array<ReadonlyArray<string>> = [];

  for (const issue of result.issues) {
    rows.push([
      issue.name,
      issue.kind,
      issue.expectedFormat,
      issue.received,
      issue.description,
    ]);
  }

  // Document optional vars with defaults when validation fails or for --validate-config report.
  for (const spec of result.optionalWithDefaults) {
    if (result.issues.some((i) => i.name === spec.name)) continue;
    rows.push([
      spec.name,
      "optional",
      spec.expectedFormat,
      spec.defaultValue !== undefined ? `default: ${spec.defaultValue}` : "(unset ok)",
      spec.description,
    ]);
  }

  const widths = headers.map((h, col) =>
    Math.max(h.length, ...rows.map((r) => (r[col] ?? "").length)),
  );

  const line = (cells: ReadonlyArray<string>) =>
    `| ${cells.map((c, i) => pad(c, widths[i]!)).join(" | ")} |`;

  const separator = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;

  const out = [line([...headers]), separator, ...rows.map((r) => line(r))];
  return out.join("\n");
};

export class EnvValidationError extends Error {
  readonly _tag = "EnvValidationError";
  constructor(readonly result: EnvValidationResult) {
    super(`Environment validation failed:\n${formatEnvValidationTable(result)}`);
    this.name = "EnvValidationError";
  }
}

/**
 * Validate env before any I/O that opens DB sockets or listeners.
 * Fails with EnvValidationError when required vars are missing or types are invalid.
 */
export const validateEnvironmentEffect = (
  env: NodeJS.Dict<string> = process.env,
  specs: ReadonlyArray<EnvVarSpec> = SERVER_ENV_SPECS,
): Effect.Effect<EnvValidationResult, EnvValidationError> =>
  Effect.sync(() => validateEnvironment(env, specs)).pipe(
    Effect.flatMap((result) =>
      result.ok ? Effect.succeed(result) : Effect.fail(new EnvValidationError(result)),
    ),
  );

/** Effect Schema mirror for structured tooling / future Config integration. */
export const ServerEnvSchema = Schema.Struct({
  T3CODE_LOG_LEVEL: Schema.optionalKey(Schema.String),
  T3CODE_TRACE_MIN_LEVEL: Schema.optionalKey(Schema.String),
  T3CODE_TRACE_TIMING_ENABLED: Schema.optionalKey(Schema.String),
  T3CODE_TRACE_FILE: Schema.optionalKey(Schema.String),
  T3CODE_TRACE_MAX_BYTES: Schema.optionalKey(Schema.String),
  T3CODE_TRACE_MAX_FILES: Schema.optionalKey(Schema.String),
  T3CODE_TRACE_BATCH_WINDOW_MS: Schema.optionalKey(Schema.String),
  T3CODE_OTLP_TRACES_URL: Schema.optionalKey(Schema.String),
  T3CODE_OTLP_METRICS_URL: Schema.optionalKey(Schema.String),
  T3CODE_OTLP_EXPORT_INTERVAL_MS: Schema.optionalKey(Schema.String),
  T3CODE_OTLP_SERVICE_NAME: Schema.optionalKey(Schema.String),
  T3CODE_MODE: Schema.optionalKey(Schema.String),
  T3CODE_PORT: Schema.optionalKey(Schema.String),
  T3CODE_HOST: Schema.optionalKey(Schema.String),
  T3CODE_HOME: Schema.optionalKey(Schema.String),
  VITE_DEV_SERVER_URL: Schema.optionalKey(Schema.String),
  T3CODE_NO_BROWSER: Schema.optionalKey(Schema.String),
  T3CODE_BOOTSTRAP_FD: Schema.optionalKey(Schema.String),
  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: Schema.optionalKey(Schema.String),
  T3CODE_LOG_WS_EVENTS: Schema.optionalKey(Schema.String),
  T3CODE_TAILSCALE_SERVE: Schema.optionalKey(Schema.String),
  T3CODE_TAILSCALE_SERVE_PORT: Schema.optionalKey(Schema.String),
});

export type ServerEnvSchema = typeof ServerEnvSchema.Type;
