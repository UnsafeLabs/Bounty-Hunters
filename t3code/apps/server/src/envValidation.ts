import * as Schema from "effect/Schema";

type EnvVarKind =
  | "boolean"
  | "integer"
  | "log-level"
  | "mode"
  | "number"
  | "port"
  | "string"
  | "url";

interface ServerEnvSpec {
  readonly name: string;
  readonly kind: EnvVarKind;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly defaultValue?: string;
  readonly expected: string;
  readonly description: string;
}

export type EnvValidationStatus = "default" | "invalid" | "missing" | "valid";

export interface EnvValidationRow {
  readonly name: string;
  readonly status: EnvValidationStatus;
  readonly expected: string;
  readonly received: string | undefined;
  readonly defaultValue: string | undefined;
  readonly required: boolean;
  readonly description: string;
}

export interface EnvValidationResult {
  readonly ok: boolean;
  readonly rows: ReadonlyArray<EnvValidationRow>;
  readonly issues: ReadonlyArray<EnvValidationRow>;
}

export const ServerEnvSchema = Schema.Struct({
  T3CODE_LOG_LEVEL: Schema.optional(Schema.String),
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
  T3CODE_MODE: Schema.optional(Schema.String),
  T3CODE_PORT: Schema.optional(Schema.String),
  T3CODE_HOST: Schema.optional(Schema.String),
  T3CODE_HOME: Schema.optional(Schema.String),
  VITE_DEV_SERVER_URL: Schema.optional(Schema.String),
  T3CODE_NO_BROWSER: Schema.optional(Schema.String),
  T3CODE_BOOTSTRAP_FD: Schema.optional(Schema.String),
  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: Schema.optional(Schema.String),
  T3CODE_LOG_WS_EVENTS: Schema.optional(Schema.String),
  T3CODE_TAILSCALE_SERVE: Schema.optional(Schema.String),
  T3CODE_TAILSCALE_SERVE_PORT: Schema.optional(Schema.String),
  T3CODE_TELEMETRY_ENABLED: Schema.optional(Schema.String),
  T3CODE_POSTHOG_KEY: Schema.optional(Schema.String),
  T3CODE_POSTHOG_HOST: Schema.optional(Schema.String),
  T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: Schema.optional(Schema.String),
  T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS: Schema.optional(Schema.String),
  T3CODE_BITBUCKET_API_BASE_URL: Schema.optional(Schema.String),
  T3CODE_BITBUCKET_ACCESS_TOKEN: Schema.optional(Schema.String),
  T3CODE_BITBUCKET_EMAIL: Schema.optional(Schema.String),
  T3CODE_BITBUCKET_API_TOKEN: Schema.optional(Schema.String),
});

export type ServerEnvShape = typeof ServerEnvSchema.Type;

const decodeServerEnv = Schema.decodeUnknownSync(ServerEnvSchema);

const LogLevels = new Set([
  "all",
  "fatal",
  "error",
  "warning",
  "warn",
  "info",
  "debug",
  "trace",
  "none",
]);

export const ServerEnvSpecs: ReadonlyArray<ServerEnvSpec> = [
  {
    name: "T3CODE_LOG_LEVEL",
    kind: "log-level",
    defaultValue: "Info",
    expected: "log level",
    description: "Minimum level emitted to the server console.",
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    kind: "log-level",
    defaultValue: "Info",
    expected: "log level",
    description: "Minimum level written to the structured trace file.",
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    kind: "boolean",
    defaultValue: "true",
    expected: "true or false",
    description: "Enables timing fields in server trace output.",
  },
  {
    name: "T3CODE_TRACE_FILE",
    kind: "string",
    expected: "file path",
    description: "Optional override for the server trace file path.",
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    kind: "integer",
    defaultValue: String(10 * 1024 * 1024),
    expected: "positive integer",
    description: "Maximum size of each trace file before rotation.",
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    kind: "integer",
    defaultValue: "10",
    expected: "positive integer",
    description: "Maximum number of rotated trace files to keep.",
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    kind: "integer",
    defaultValue: "200",
    expected: "positive integer milliseconds",
    description: "Batch window for trace writes.",
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    kind: "url",
    expected: "absolute URL",
    description: "Optional OTLP traces endpoint.",
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    kind: "url",
    expected: "absolute URL",
    description: "Optional OTLP metrics endpoint.",
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    kind: "integer",
    defaultValue: "10000",
    expected: "positive integer milliseconds",
    description: "OTLP export interval.",
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    kind: "string",
    defaultValue: "t3-server",
    expected: "non-empty string",
    description: "Service name attached to telemetry exports.",
  },
  {
    name: "T3CODE_MODE",
    kind: "mode",
    defaultValue: "web",
    expected: "web or desktop",
    description: "Runtime mode for server startup defaults.",
  },
  {
    name: "T3CODE_PORT",
    kind: "port",
    defaultValue: "3773 or available port",
    expected: "port 1-65535",
    description: "HTTP and WebSocket listener port.",
  },
  {
    name: "T3CODE_HOST",
    kind: "string",
    expected: "host or IP address",
    description: "Optional host/interface to bind.",
  },
  {
    name: "T3CODE_HOME",
    kind: "string",
    expected: "directory path",
    description: "Optional base directory for server state.",
  },
  {
    name: "VITE_DEV_SERVER_URL",
    kind: "url",
    expected: "absolute URL",
    description: "Optional web dev server URL.",
  },
  {
    name: "T3CODE_NO_BROWSER",
    kind: "boolean",
    defaultValue: "desktop mode true, web mode false",
    expected: "true or false",
    description: "Disables automatic browser opening.",
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    kind: "integer",
    expected: "non-negative integer",
    description: "Optional file descriptor for desktop bootstrap secrets.",
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    kind: "boolean",
    defaultValue: "true in web mode",
    expected: "true or false",
    description: "Creates a startup project for the current directory when missing.",
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    kind: "boolean",
    defaultValue: "true when dev URL is set",
    expected: "true or false",
    description: "Logs outbound WebSocket push events.",
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    kind: "boolean",
    defaultValue: "false",
    expected: "true or false",
    description: "Enables Tailscale Serve setup.",
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    kind: "port",
    defaultValue: "443",
    expected: "port 1-65535",
    description: "HTTPS port used for Tailscale Serve.",
  },
  {
    name: "T3CODE_TELEMETRY_ENABLED",
    kind: "boolean",
    defaultValue: "true",
    expected: "true or false",
    description: "Enables anonymous PostHog telemetry.",
  },
  {
    name: "T3CODE_POSTHOG_KEY",
    kind: "string",
    sensitive: true,
    defaultValue: "bundled PostHog project key",
    expected: "non-empty string",
    description: "Project key used for telemetry events.",
  },
  {
    name: "T3CODE_POSTHOG_HOST",
    kind: "url",
    defaultValue: "https://us.i.posthog.com",
    expected: "absolute URL",
    description: "PostHog ingestion host.",
  },
  {
    name: "T3CODE_TELEMETRY_FLUSH_BATCH_SIZE",
    kind: "integer",
    defaultValue: "20",
    expected: "positive integer",
    description: "Maximum telemetry events sent per flush.",
  },
  {
    name: "T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS",
    kind: "integer",
    defaultValue: "1000",
    expected: "positive integer",
    description: "Maximum telemetry events buffered in memory.",
  },
  {
    name: "T3CODE_BITBUCKET_API_BASE_URL",
    kind: "url",
    defaultValue: "https://api.bitbucket.org/2.0",
    expected: "absolute URL",
    description: "Bitbucket Cloud API base URL.",
  },
  {
    name: "T3CODE_BITBUCKET_ACCESS_TOKEN",
    kind: "string",
    sensitive: true,
    expected: "non-empty string",
    description: "Optional Bitbucket bearer access token.",
  },
  {
    name: "T3CODE_BITBUCKET_EMAIL",
    kind: "string",
    sensitive: true,
    expected: "non-empty string",
    description: "Optional Bitbucket account email for API-token auth.",
  },
  {
    name: "T3CODE_BITBUCKET_API_TOKEN",
    kind: "string",
    sensitive: true,
    expected: "non-empty string",
    description: "Optional Bitbucket API token used with T3CODE_BITBUCKET_EMAIL.",
  },
];

const hasValue = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

const isInteger = (value: string): boolean => {
  if (!/^-?\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed);
};

const isPositiveInteger = (value: string): boolean => isInteger(value) && Number(value) > 0;

const isNonNegativeInteger = (value: string): boolean => isInteger(value) && Number(value) >= 0;

const isNumber = (value: string): boolean => {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed);
};

const isPort = (value: string): boolean => {
  if (!isInteger(value)) return false;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 65535;
};

const isUrl = (value: string): boolean => {
  try {
    return new URL(value).href.length > 0;
  } catch {
    return false;
  }
};

const isValidValue = (spec: ServerEnvSpec, value: string): boolean => {
  switch (spec.kind) {
    case "boolean":
      return value === "true" || value === "false";
    case "integer":
      return spec.name === "T3CODE_BOOTSTRAP_FD"
        ? isNonNegativeInteger(value)
        : isPositiveInteger(value);
    case "log-level":
      return LogLevels.has(value.toLowerCase());
    case "mode":
      return value === "web" || value === "desktop";
    case "number":
      return isNumber(value);
    case "port":
      return isPort(value);
    case "string":
      return value.trim().length > 0;
    case "url":
      return isUrl(value);
  }
};

export const validateServerEnv = (
  env: Record<string, string | undefined> = process.env,
): EnvValidationResult => {
  const decoded = decodeServerEnv(env) as Record<string, string | undefined>;
  const rows = ServerEnvSpecs.map((spec): EnvValidationRow => {
    const received = decoded[spec.name];
    if (!hasValue(received)) {
      return {
        name: spec.name,
        status: spec.required ? "missing" : "default",
        expected: spec.expected,
        received,
        defaultValue: spec.defaultValue,
        required: spec.required === true,
        description: spec.description,
      };
    }

    return {
      name: spec.name,
      status: isValidValue(spec, received) ? "valid" : "invalid",
      expected: spec.expected,
      received,
      defaultValue: spec.defaultValue,
      required: spec.required === true,
      description: spec.description,
    };
  });
  const issues = rows.filter((row) => row.status === "missing" || row.status === "invalid");
  return { ok: issues.length === 0, rows, issues };
};

const normalizeCell = (value: string | undefined): string => {
  if (value === undefined || value.trim() === "") return "-";
  return value.replaceAll("\n", " ");
};

const formatReceivedCell = (row: EnvValidationRow): string => {
  const spec = ServerEnvSpecs.find((candidate) => candidate.name === row.name);
  if (spec?.sensitive && hasValue(row.received)) return "[set]";
  return normalizeCell(row.received);
};

const padCell = (value: string, width: number): string => value.padEnd(width, " ");

export const formatServerEnvValidation = (result: EnvValidationResult): string => {
  const headers = ["Variable", "Status", "Required", "Expected", "Received", "Default"];
  const bodyRows = result.rows.map((row) => [
    row.name,
    row.status,
    row.required ? "yes" : "no",
    row.expected,
    formatReceivedCell(row),
    normalizeCell(row.defaultValue),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...bodyRows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: ReadonlyArray<string>) =>
    row.map((cell, index) => padCell(cell, widths[index] ?? cell.length)).join("  ");

  const lines = [
    `T3 Code environment validation: ${result.ok ? "OK" : "FAILED"}`,
    `Issues: ${result.issues.length}`,
    "Required variables: none currently; optional variables and defaults are listed below.",
    "",
    formatRow(headers),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...bodyRows.map(formatRow),
  ];

  if (!result.ok) {
    lines.push(
      "",
      "Invalid configuration prevents server startup. Fix the rows marked invalid or missing.",
    );
  }

  return lines.join("\n");
};
