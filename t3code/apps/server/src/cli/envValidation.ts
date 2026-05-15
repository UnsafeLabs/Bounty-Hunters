import * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";

import { RuntimeMode } from "../config.ts";

export interface EnvVarSpec {
  readonly name: string;
  readonly description: string;
  readonly expected: string;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly schema: Schema.Decoder<unknown>;
  readonly validate?: (value: string) => string | undefined;
}

export interface EnvValidationIssue {
  readonly name: string;
  readonly kind: "missing" | "invalid";
  readonly expected: string;
  readonly description: string;
  readonly received: string | undefined;
}

export interface EnvValidationResult {
  readonly valid: boolean;
  readonly issues: readonly EnvValidationIssue[];
  readonly specs: readonly EnvVarSpec[];
}

const LogLevelSchema = Schema.Literals([
  "All",
  "Fatal",
  "Error",
  "Warning",
  "Info",
  "Debug",
  "Trace",
  "None",
]);
const BooleanStringSchema = Schema.Literals(["true", "false"]);

const isIntegerInRange =
  (min: number, max: number) =>
  (value: string): string | undefined => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return `expected integer from ${min} to ${max}`;
    }
    return undefined;
  };

const isPositiveInteger = (value: string): string | undefined => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return "expected positive integer";
  }
  return undefined;
};

const isHttpUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "expected absolute http(s) URL";
    }
    return undefined;
  } catch {
    return "expected absolute http(s) URL";
  }
};

const isNonEmpty = (value: string): string | undefined =>
  value.trim().length > 0 ? undefined : "expected non-empty string";

export const SERVER_ENV_VAR_SPECS = [
  {
    name: "T3CODE_LOG_LEVEL",
    description: "Minimum console log level.",
    expected: "one of All, Fatal, Error, Warning, Info, Debug, Trace, None",
    required: false,
    defaultValue: "Info",
    schema: LogLevelSchema,
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    description: "Minimum level written to the trace log.",
    expected: "one of All, Fatal, Error, Warning, Info, Debug, Trace, None",
    required: false,
    defaultValue: "Info",
    schema: LogLevelSchema,
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    description: "Enable trace timing fields.",
    expected: "true or false",
    required: false,
    defaultValue: "true",
    schema: BooleanStringSchema,
  },
  {
    name: "T3CODE_TRACE_FILE",
    description: "Override path for the server trace file.",
    expected: "non-empty path",
    required: false,
    schema: Schema.String,
    validate: isNonEmpty,
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    description: "Maximum bytes per trace file.",
    expected: "positive integer",
    required: false,
    defaultValue: "10485760",
    schema: Schema.String,
    validate: isPositiveInteger,
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    description: "Maximum number of rotated trace files.",
    expected: "positive integer",
    required: false,
    defaultValue: "10",
    schema: Schema.String,
    validate: isPositiveInteger,
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    description: "Trace batching window in milliseconds.",
    expected: "positive integer",
    required: false,
    defaultValue: "200",
    schema: Schema.String,
    validate: isPositiveInteger,
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    description: "OTLP traces endpoint URL.",
    expected: "absolute http(s) URL",
    required: false,
    schema: Schema.URLFromString,
    validate: isHttpUrl,
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    description: "OTLP metrics endpoint URL.",
    expected: "absolute http(s) URL",
    required: false,
    schema: Schema.URLFromString,
    validate: isHttpUrl,
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    description: "OTLP export interval in milliseconds.",
    expected: "positive integer",
    required: false,
    defaultValue: "10000",
    schema: Schema.String,
    validate: isPositiveInteger,
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    description: "Service name attached to OTLP telemetry.",
    expected: "non-empty string",
    required: false,
    defaultValue: "t3-server",
    schema: Schema.String,
    validate: isNonEmpty,
  },
  {
    name: "T3CODE_MODE",
    description: "Runtime mode.",
    expected: "web or desktop",
    required: false,
    defaultValue: "web",
    schema: RuntimeMode,
  },
  {
    name: "T3CODE_PORT",
    description: "HTTP/WebSocket server port.",
    expected: "integer from 0 to 65535",
    required: false,
    defaultValue: "3773 or next available port",
    schema: Schema.String,
    validate: isIntegerInRange(0, 65_535),
  },
  {
    name: "T3CODE_HOST",
    description: "Host/interface to bind.",
    expected: "non-empty host string",
    required: false,
    defaultValue: "127.0.0.1 in desktop mode, otherwise system default",
    schema: Schema.String,
    validate: isNonEmpty,
  },
  {
    name: "T3CODE_HOME",
    description: "Base directory for server state.",
    expected: "non-empty path",
    required: false,
    defaultValue: "platform-specific app data directory",
    schema: Schema.String,
    validate: isNonEmpty,
  },
  {
    name: "VITE_DEV_SERVER_URL",
    description: "Development web URL to proxy.",
    expected: "absolute http(s) URL",
    required: false,
    schema: Schema.URLFromString,
    validate: isHttpUrl,
  },
  {
    name: "T3CODE_NO_BROWSER",
    description: "Disable automatic browser opening.",
    expected: "true or false",
    required: false,
    defaultValue: "false in web mode, true in desktop/headless mode",
    schema: BooleanStringSchema,
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    description: "File descriptor containing desktop bootstrap settings.",
    expected: "positive integer",
    required: false,
    schema: Schema.String,
    validate: isPositiveInteger,
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    description: "Create a startup project for the current directory.",
    expected: "true or false",
    required: false,
    defaultValue: "true in web mode, false in headless startup",
    schema: BooleanStringSchema,
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    description: "Log outbound WebSocket push events.",
    expected: "true or false",
    required: false,
    defaultValue: "true with a dev URL, otherwise false",
    schema: BooleanStringSchema,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    description: "Enable Tailscale Serve setup.",
    expected: "true or false",
    required: false,
    defaultValue: "false",
    schema: BooleanStringSchema,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    description: "HTTPS port for Tailscale Serve.",
    expected: "integer from 0 to 65535",
    required: false,
    defaultValue: "443",
    schema: Schema.String,
    validate: isIntegerInRange(0, 65_535),
  },
] satisfies readonly EnvVarSpec[];

const isSensitiveName = (name: string): boolean => /TOKEN|SECRET|KEY|PASSWORD/i.test(name);

const displayReceived = (name: string, value: string | undefined): string => {
  if (value === undefined) return "<missing>";
  if (isSensitiveName(name)) return "<redacted>";
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
};

export function validateEnvironmentVariables(
  env: NodeJS.ProcessEnv,
  specs: readonly EnvVarSpec[] = SERVER_ENV_VAR_SPECS,
): EnvValidationResult {
  const issues: EnvValidationIssue[] = [];

  for (const spec of specs) {
    const raw = env[spec.name];
    if (raw === undefined || raw.length === 0) {
      if (spec.required) {
        issues.push({
          name: spec.name,
          kind: "missing",
          expected: spec.expected,
          description: spec.description,
          received: undefined,
        });
      }
      continue;
    }

    const customIssue = spec.validate?.(raw);
    let schemaIssue: string | undefined;
    try {
      SchemaParser.decodeUnknownSync(spec.schema)(raw);
    } catch {
      schemaIssue = spec.expected;
    }
    if (schemaIssue !== undefined || customIssue !== undefined) {
      issues.push({
        name: spec.name,
        kind: "invalid",
        expected: customIssue ?? schemaIssue ?? spec.expected,
        description: spec.description,
        received: raw,
      });
    }
  }

  return { valid: issues.length === 0, issues, specs };
}

const table = (headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: readonly string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ");
  return [
    formatRow(headers),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map(formatRow),
  ].join("\n");
};

export function formatEnvironmentValidationReport(
  result: EnvValidationResult,
  env: NodeJS.ProcessEnv,
): string {
  const lines = [
    result.valid ? "Configuration validation passed." : "Configuration validation failed.",
  ];

  if (result.issues.length > 0) {
    lines.push(
      "",
      table(
        ["Variable", "Problem", "Expected", "Received", "Description"],
        result.issues.map((issue) => [
          issue.name,
          issue.kind,
          issue.expected,
          displayReceived(issue.name, issue.received),
          issue.description,
        ]),
      ),
    );
  }

  lines.push(
    "",
    "Environment variables:",
    table(
      ["Variable", "Required", "Expected", "Default", "Current"],
      result.specs.map((spec) => [
        spec.name,
        spec.required ? "yes" : "no",
        spec.expected,
        spec.defaultValue ?? "",
        displayReceived(spec.name, env[spec.name]),
      ]),
    ),
  );

  return lines.join("\n");
}
