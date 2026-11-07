/**
 * EnvValidation - Environment variable validation at server startup.
 *
 * Validates all required and optional environment variables using Effect Schema
 * before any services are initialized. Produces a formatted error table for
 * missing or invalid variables.
 *
 * @module EnvValidation
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface EnvVarSpec {
  readonly name: string;
  readonly required: boolean;
  readonly type: string;
  readonly description: string;
  readonly defaultValue?: string;
}

export interface EnvValidationError {
  readonly name: string;
  readonly issue: "missing" | "invalid_type" | "invalid_value";
  readonly expected: string;
  readonly received: string | undefined;
  readonly description: string;
}

export interface EnvValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<EnvValidationError>;
  readonly warnings: ReadonlyArray<string>;
}

const REQUIRED_ENV_VARS: ReadonlyArray<EnvVarSpec> = [
  {
    name: "T3_SERVER_PORT",
    required: false,
    type: "number",
    description: "HTTP server port (default: 3773)",
    defaultValue: "3773",
  },
  {
    name: "T3_SERVER_HOST",
    required: false,
    type: "string",
    description: "HTTP server bind host (default: localhost only)",
  },
  {
    name: "T3_LOG_LEVEL",
    required: false,
    type: "LogLevel",
    description: "Minimum log level: trace|debug|info|warning|error (default: info)",
    defaultValue: "info",
  },
  {
    name: "T3_OTLP_TRACES_URL",
    required: false,
    type: "url",
    description: "OTLP traces exporter endpoint URL",
  },
  {
    name: "T3_OTLP_METRICS_URL",
    required: false,
    type: "url",
    description: "OTLP metrics exporter endpoint URL",
  },
  {
    name: "T3_OTLP_SERVICE_NAME",
    required: false,
    type: "string",
    description: "Service name for OTLP resource attributes",
    defaultValue: "t3-server",
  },
  {
    name: "T3_MODE",
    required: false,
    type: "web|desktop",
    description: "Runtime mode (default: web)",
    defaultValue: "web",
  },
  {
    name: "T3_BASE_DIR",
    required: true,
    type: "string (path)",
    description: "Base directory for server state and configuration",
  },
  {
    name: "T3_CWD",
    required: false,
    type: "string (path)",
    description: "Working directory for project operations",
  },
  {
    name: "T3_STATIC_DIR",
    required: false,
    type: "string (path)",
    description: "Static file serving directory for web UI",
  },
  {
    name: "T3_DEV_URL",
    required: false,
    type: "url",
    description: "Development server URL for hot reload",
  },
  {
    name: "T3_NO_BROWSER",
    required: false,
    type: "boolean",
    description: "Disable automatic browser opening (default: false)",
    defaultValue: "false",
  },
  {
    name: "T3_DB_POOL_MIN",
    required: false,
    type: "number",
    description: "Minimum SQLite connection pool size (default: 1)",
    defaultValue: "1",
  },
  {
    name: "T3_DB_POOL_MAX",
    required: false,
    type: "number",
    description: "Maximum SQLite connection pool size (default: 5)",
    defaultValue: "5",
  },
  {
    name: "COMPRESSION_GZIP_LEVEL",
    required: false,
    type: "number (0-9)",
    description: "Gzip compression level (default: 6)",
    defaultValue: "6",
  },
  {
    name: "COMPRESSION_BROTLI_QUALITY",
    required: false,
    type: "number (0-11)",
    description: "Brotli compression quality (default: 4)",
    defaultValue: "4",
  },
  {
    name: "COMPRESSION_THRESHOLD",
    required: false,
    type: "number",
    description: "Minimum bytes for compression (default: 1024)",
    defaultValue: "1024",
  },
];

const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const isValidLogLevel = (value: string): boolean =>
  ["trace", "debug", "info", "warning", "error", "fatal"].includes(value.toLowerCase());

const isValidMode = (value: string): boolean => ["web", "desktop"].includes(value.toLowerCase());

const isValidBoolean = (value: string): boolean =>
  ["true", "false", "0", "1", "yes", "no"].includes(value.toLowerCase());

const validateEnvVar = (spec: EnvVarSpec, env: Record<string, string | undefined>): EnvValidationError | null => {
  const value = env[spec.name];

  if (value === undefined || value === "") {
    if (spec.required) {
      return {
        name: spec.name,
        issue: "missing",
        expected: spec.type,
        received: undefined,
        description: spec.description,
      };
    }
    return null;
  }

  switch (spec.type) {
    case "number":
    case "number (0-9)":
    case "number (0-11)": {
      const num = Number(value);
      if (isNaN(num)) {
        return {
          name: spec.name,
          issue: "invalid_type",
          expected: spec.type,
          received: value,
          description: spec.description,
        };
      }
      if (spec.type === "number (0-9)" && (num < 0 || num > 9)) {
        return {
          name: spec.name,
          issue: "invalid_value",
          expected: "0-9",
          received: value,
          description: spec.description,
        };
      }
      if (spec.type === "number (0-11)" && (num < 0 || num > 11)) {
        return {
          name: spec.name,
          issue: "invalid_value",
          expected: "0-11",
          received: value,
          description: spec.description,
        };
      }
      break;
    }
    case "url":
      if (!isValidUrl(value)) {
        return {
          name: spec.name,
          issue: "invalid_type",
          expected: "valid URL",
          received: value,
          description: spec.description,
        };
      }
      break;
    case "LogLevel":
      if (!isValidLogLevel(value)) {
        return {
          name: spec.name,
          issue: "invalid_value",
          expected: "trace|debug|info|warning|error|fatal",
          received: value,
          description: spec.description,
        };
      }
      break;
    case "web|desktop":
      if (!isValidMode(value)) {
        return {
          name: spec.name,
          issue: "invalid_value",
          expected: "web|desktop",
          received: value,
          description: spec.description,
        };
      }
      break;
    case "boolean":
      if (!isValidBoolean(value)) {
        return {
          name: spec.name,
          issue: "invalid_type",
          expected: "boolean (true/false/0/1)",
          received: value,
          description: spec.description,
        };
      }
      break;
  }

  return null;
};

export const validateEnvironment = (
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): EnvValidationResult => {
  const errors: Array<EnvValidationError> = [];
  const warnings: Array<string> = [];

  for (const spec of REQUIRED_ENV_VARS) {
    const error = validateEnvVar(spec, env);
    if (error) {
      errors.push(error);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};

export const formatValidationTable = (result: EnvValidationResult): string => {
  if (result.valid && result.warnings.length === 0) {
    return "✓ All environment variables validated successfully.";
  }

  const lines: Array<string> = [];

  if (result.errors.length > 0) {
    lines.push("✗ Environment variable validation failed:\n");
    lines.push("┌─────────────────────────────┬──────────────┬──────────────────────┬──────────────────────────────────────────┐");
    lines.push("│ Variable                    │ Issue        │ Expected             │ Description                              │");
    lines.push("├─────────────────────────────┼──────────────┼──────────────────────┼──────────────────────────────────────────┤");

    for (const error of result.errors) {
      const name = error.name.padEnd(27);
      const issue = error.issue.padEnd(12);
      const expected = error.expected.padEnd(20);
      const received = error.received ? ` (got: ${error.received})` : "";
      const desc = error.description.slice(0, 40).padEnd(40);
      lines.push(`│ ${name} │ ${issue} │ ${expected} │ ${desc} │`);
      if (received) {
        lines.push(`│                             │              │ Received:${received.padEnd(9)} │                                          │`);
      }
    }

    lines.push("└─────────────────────────────┴──────────────┴──────────────────────┴──────────────────────────────────────────┘");
  }

  if (result.warnings.length > 0) {
    lines.push("\nWarnings:");
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }

  return lines.join("\n");
};

export const validateAndExit = (
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    const result = validateEnvironment(env);
    if (!result.valid) {
      console.error(formatValidationTable(result));
      console.error("\nServer startup aborted due to invalid environment configuration.");
      process.exit(1);
    }
  });

export const getEnvVarSpecs = (): ReadonlyArray<EnvVarSpec> => REQUIRED_ENV_VARS;
