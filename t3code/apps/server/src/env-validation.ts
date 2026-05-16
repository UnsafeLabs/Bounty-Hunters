/**
 * Environment variable validation for T3 Code server.
 *
 * Validates all required environment variables at startup before
 * initializing any services. Prints a clear table of missing or
 * invalid variables with expected types and descriptions.
 *
 * @module EnvValidation
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Console from "effect/Console";

/**
 * Environment variable definition with validation schema.
 */
interface EnvVarDef {
  readonly key: string;
  readonly schema: Schema.Schema<any>;
  readonly required: boolean;
  readonly description: string;
  readonly defaultValue?: string;
}

/**
 * All environment variables used by the server.
 */
const ENV_VARS: readonly EnvVarDef[] = [
  {
    key: "NODE_ENV",
    schema: Schema.Literal("development", "production", "test"),
    required: false,
    description: "Runtime environment",
    defaultValue: "development",
  },
  {
    key: "PORT",
    schema: Schema.NumberFromString.pipe(Schema.int(), Schema.positive()),
    required: false,
    description: "Server port number",
    defaultValue: "3773",
  },
  {
    key: "HOST",
    schema: Schema.String,
    required: false,
    description: "Server host address",
  },
  {
    key: "DATABASE_URL",
    schema: Schema.String,
    required: false,
    description: "Database connection URL",
  },
  {
    key: "LOG_LEVEL",
    schema: Schema.Literal("Debug", "Info", "Warning", "Error", "None"),
    required: false,
    description: "Logging level",
    defaultValue: "Info",
  },
  {
    key: "OTLP_TRACES_URL",
    schema: Schema.String,
    required: false,
    description: "OpenTelemetry traces endpoint URL",
  },
  {
    key: "OTLP_METRICS_URL",
    schema: Schema.String,
    required: false,
    description: "OpenTelemetry metrics endpoint URL",
  },
  {
    key: "TAILSCALE_AUTH_KEY",
    schema: Schema.String,
    required: false,
    description: "Tailscale authentication key for serve mode",
  },
];

/**
 * Validation result for a single environment variable.
 */
interface ValidationResult {
  readonly key: string;
  readonly valid: boolean;
  readonly value: string | undefined;
  readonly error?: string;
  readonly expected: string;
  readonly description: string;
  readonly required: boolean;
}

/**
 * Get the expected format description for a schema.
 */
function getSchemaDescription(schema: Schema.Schema<any>): string {
  if (schema === Schema.String) return "string";
  if (schema === Schema.Number) return "number";
  if (schema === Schema.Boolean) return "boolean";

  // Check for Literal types
  const ast = schema.ast;
  if (ast._tag === "Enums" || ast._tag === "Literal") {
    return `one of: ${JSON.stringify(ast.values || [])}`;
  }

  return "valid value";
}

/**
 * Validate a single environment variable.
 */
function validateEnvVar(def: EnvVarDef): ValidationResult {
  const value = process.env[def.key];

  // Check if required variable is missing
  if (def.required && (value === undefined || value === "")) {
    return {
      key: def.key,
      valid: false,
      value,
      error: "Missing required variable",
      expected: getSchemaDescription(def.schema),
      description: def.description,
      required: true,
    };
  }

  // Skip validation for optional missing variables
  if (value === undefined || value === "") {
    return {
      key: def.key,
      valid: true,
      value,
      expected: getSchemaDescription(def.schema),
      description: def.description,
      required: false,
    };
  }

  // Validate the value against schema
  const result = Schema.decodeUnknownEither(def.schema)(value);
  if (result._tag === "Left") {
    return {
      key: def.key,
      valid: false,
      value,
      error: `Invalid value: ${result.left.message}`,
      expected: getSchemaDescription(def.schema),
      description: def.description,
      required: def.required,
    };
  }

  return {
    key: def.key,
    valid: true,
    value,
    expected: getSchemaDescription(def.schema),
    description: def.description,
    required: def.required,
  };
}

/**
 * Format validation results as a table.
 */
function formatValidationTable(results: ValidationResult[]): string {
  const invalid = results.filter((r) => !r.valid);
  if (invalid.length === 0) return "";

  const lines: string[] = [
    "",
    "╔══════════════════════════════════════════════════════════════════════════════╗",
    "║                     ENVIRONMENT VARIABLE VALIDATION ERRORS                  ║",
    "╠══════════════════════════════════════════════════════════════════════════════╣",
  ];

  for (const r of invalid) {
    lines.push(`║ Variable: ${r.key}`);
    lines.push(`║ Status:   ❌ INVALID`);
    lines.push(`║ Got:      ${r.value ?? "(not set)"}`);
    lines.push(`║ Expected: ${r.expected}`);
    lines.push(`║ Error:    ${r.error}`);
    lines.push(`║ Description: ${r.description}`);
    lines.push("╠══════════════════════════════════════════════════════════════════════════════╣");
  }

  lines.push("╚══════════════════════════════════════════════════════════════════════════════╝");
  lines.push("");

  return lines.join("\n");
}

/**
 * Format all environment variables (for --validate-config output).
 */
function formatAllVarsTable(results: ValidationResult[]): string {
  const lines: string[] = [
    "",
    "╔══════════════════════════════════════════════════════════════════════════════╗",
    "║                        ENVIRONMENT VARIABLE STATUS                          ║",
    "╠══════════════════════════════════════════════════════════════════════════════╣",
  ];

  for (const r of results) {
    const status = r.valid ? "✅" : "❌";
    const required = r.required ? "(required)" : "(optional)";
    const defaultVal = r.value === undefined ? " [default]" : "";
    lines.push(`║ ${status} ${r.key} ${required}${defaultVal}`);
    lines.push(`║    Description: ${r.description}`);
    lines.push(`║    Expected: ${r.expected}`);
    if (r.value !== undefined) {
      lines.push(`║    Current: ${r.value}`);
    }
    lines.push("╠══════════════════════════════════════════════════════════════════════════════╣");
  }

  lines.push("╚══════════════════════════════════════════════════════════════════════════════╝");
  lines.push("");

  return lines.join("\n");
}

/**
 * Validate all environment variables.
 *
 * @returns Effect that fails with validation errors if any required vars are missing/invalid
 */
export const validateEnvironment = Effect.gen(function* () {
  const results = ENV_VARS.map(validateEnvVar);
  const invalid = results.filter((r) => !r.valid);
  const requiredInvalid = invalid.filter((r) => r.required);

  // Always print validation results
  if (invalid.length > 0) {
    yield* Console.error(formatValidationTable(results));
  }

  // Fail if any required variables are invalid
  if (requiredInvalid.length > 0) {
    yield* Effect.fail(
      new Error(
        `${requiredInvalid.length} required environment variable(s) missing or invalid. ` +
          `Run with --validate-config to see all variables.`
      )
    );
  }

  return results;
});

/**
 * Validate environment and print full status table (for --validate-config flag).
 *
 * @returns Effect that exits with code 0 if valid, 1 if invalid
 */
export const validateAndPrintAll = Effect.gen(function* () {
  const results = ENV_VARS.map(validateEnvVar);
  const invalid = results.filter((r) => !r.valid);

  yield* Console.log(formatAllVarsTable(results));

  if (invalid.length > 0) {
    yield* Console.error(`❌ Validation failed: ${invalid.length} variable(s) have issues`);
    yield* Effect.sync(() => process.exit(1));
  } else {
    yield* Console.log("✅ All environment variables are valid");
    yield* Effect.sync(() => process.exit(0));
  }
});

/**
 * Check if --validate-config flag is present in process args.
 */
export const isValidateConfigMode = (): boolean => {
  return process.argv.includes("--validate-config");
};
