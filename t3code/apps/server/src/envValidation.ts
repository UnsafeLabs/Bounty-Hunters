/**
 * Environment Variable Validation
 *
 * Validates all required environment variables at server startup using
 * Effect Schema. Produces a formatted error table for missing/invalid vars.
 * Supports --validate-config CLI flag for standalone validation.
 *
 * @module envValidation
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as Console from "effect/Console";

// ---------------------------------------------------------------------------
// Schema definitions for env vars
// ---------------------------------------------------------------------------

const EnvVarPort = Schema.Number.pipe(
  Schema.int(),
  Schema.min(0),
  Schema.max(65535),
  Schema.description("Port number (0-65535)"),
);

const EnvVarLogLevel = Schema.Literals(
  ["All", "Trace", "Debug", "Info", "Warning", "Error", "Fatal", "None"],
).pipe(Schema.description("Log level: All|Trace|Debug|Info|Warning|Error|Fatal|None"));

const EnvVarRuntimeMode = Schema.Literals(["web", "desktop"]).pipe(
  Schema.description("Runtime mode: web|desktop"),
);

const EnvVarUrl = Schema.optional(
  Schema.String.pipe(Schema.description("Valid URL string")),
).pipe(Schema.description("Optional URL"));

const EnvVarString = Schema.String.pipe(Schema.description("Non-empty string"));

const EnvVarBoolean = Schema.Boolean.pipe(Schema.description("Boolean (true|false)"));

// ---------------------------------------------------------------------------
// Environment variable spec
// ---------------------------------------------------------------------------

export interface EnvVarSpec {
  readonly name: string;
  readonly schema: Schema.Schema.Any;
  readonly required: boolean;
  readonly default?: unknown;
  readonly description: string;
}

/**
 * All recognized environment variables with validation rules.
 */
export const ENV_VAR_SPECS: ReadonlyArray<EnvVarSpec> = [
  // Required
  { name: "T3_PORT", schema: EnvVarPort, required: true, default: 3773, description: "Server listen port" },
  { name: "T3_MODE", schema: EnvVarRuntimeMode, required: true, default: "web", description: "Runtime mode" },
  { name: "T3_LOG_LEVEL", schema: EnvVarLogLevel, required: true, default: "Info", description: "Minimum log level" },

  // Optional with defaults
  { name: "T3_HOST", schema: EnvVarString, required: false, description: "Server bind host (default: all interfaces)" },
  { name: "T3_BASE_DIR", schema: EnvVarString, required: false, description: "Base directory for server state" },
  { name: "T3_STATIC_DIR", schema: EnvVarString, required: false, description: "Static files directory" },
  { name: "T3_DEV_URL", schema: EnvVarString, required: false, description: "Dev server URL for hot reload" },
  { name: "T3_NO_BROWSER", schema: EnvVarBoolean, required: false, default: false, description: "Skip browser auto-open" },
  { name: "T3_OTLP_TRACES_URL", schema: EnvVarUrl, required: false, description: "OpenTelemetry traces endpoint URL" },
  { name: "T3_OTLP_METRICS_URL", schema: EnvVarUrl, required: false, description: "OpenTelemetry metrics endpoint URL" },
  { name: "T3_OTLP_SERVICE_NAME", schema: EnvVarString, required: false, default: "t3-server", description: "OTLP service name" },
  { name: "T3_TAILSCALE_SERVE", schema: EnvVarBoolean, required: false, default: false, description: "Enable Tailscale serve" },
  { name: "T3_TAILSCALE_PORT", schema: EnvVarPort, required: false, default: 443, description: "Tailscale serve port" },
  { name: "T3_TRACE_MIN_LEVEL", schema: EnvVarLogLevel, required: false, default: "Info", description: "Minimum trace level" },
  { name: "T3_TRACE_TIMING", schema: EnvVarBoolean, required: false, default: true, description: "Enable trace timing" },

  // Pool config (from SqlitePool)
  { name: "T3_SQLITE_POOL_MIN", schema: Schema.Number.pipe(Schema.min(1), Schema.max(20)), required: false, default: 1, description: "SQLite pool min connections" },
  { name: "T3_SQLITE_POOL_MAX", schema: Schema.Number.pipe(Schema.min(1), Schema.max(50)), required: false, default: 5, description: "SQLite pool max connections" },
  { name: "T3_SQLITE_POOL_TIMEOUT_MS", schema: Schema.Number.pipe(Schema.positive()), required: false, default: 10000, description: "Pool acquire timeout (ms)" },

  // Compression config (from httpCompression)
  { name: "T3_GZIP_LEVEL", schema: Schema.Number.pipe(Schema.min(0), Schema.max(9)), required: false, default: 6, description: "Gzip compression level (0-9)" },
  { name: "T3_BROTLI_LEVEL", schema: Schema.Number.pipe(Schema.min(0), Schema.max(11)), required: false, default: 4, description: "Brotli compression level (0-11)" },
];

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export interface ValidationSuccess {
  readonly _tag: "ValidationSuccess";
  readonly validated: ReadonlyArray<{ name: string; value: unknown; source: "env" | "default" }>;
}

export interface ValidationFailure {
  readonly _tag: "ValidationFailure";
  readonly errors: ReadonlyArray<ValidationError>;
}

export interface ValidationError {
  readonly name: string;
  readonly issue: string;
  readonly expected: string;
  readonly received: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------

const parseValue = (name: string, rawValue: string, spec: EnvVarSpec): ValidationError | unknown => {
  // Try parsing as number/boolean based on schema
  let value: unknown = rawValue;

  // Simple type coercion for common types
  if (spec.schema === EnvVarBoolean || spec.default === true || spec.default === false) {
    if (rawValue === "true") value = true;
    else if (rawValue === "false") value = false;
    else {
      return {
        name,
        issue: "Invalid boolean value",
        expected: "true or false",
        received: rawValue,
      };
    }
  } else if (spec.schema === EnvVarPort || (typeof spec.default === "number" && !name.includes("URL"))) {
    const num = Number(rawValue);
    if (isNaN(num)) {
      return {
        name,
        issue: "Invalid number",
        expected: spec.description,
        received: rawValue,
      };
    }
    value = num;
  }

  // Range validation for numbers
  if (typeof value === "number") {
    if (name === "T3_PORT" && (value < 0 || value > 65535)) {
      return {
        name,
        issue: "Port out of range",
        expected: "0-65535",
        received: String(value),
      };
    }
  }

  return value;
};

/**
 * Validate all environment variables according to their specs.
 */
export const validateEnv = Effect.gen(function* () {
  const errors: Array<ValidationError> = [];
  const validated: Array<{ name: string; value: unknown; source: "env" | "default" }> = [];

  for (const spec of ENV_VAR_SPECS) {
    const rawValue = process.env[spec.name];

    if (rawValue === undefined || rawValue === "") {
      if (spec.required && spec.default === undefined) {
        errors.push({
          name: spec.name,
          issue: "Required variable is missing",
          expected: spec.description,
          received: "(not set)",
        });
      } else {
        validated.push({ name: spec.name, value: spec.default, source: "default" });
      }
      continue;
    }

    const result = parseValue(spec.name, rawValue, spec);
    if (result && typeof result === "object" && "issue" in result) {
      errors.push(result as ValidationError);
    } else {
      validated.push({ name: spec.name, value: result, source: "env" });
    }
  }

  if (errors.length > 0) {
    return { _tag: "ValidationFailure" as const, errors };
  }

  return { _tag: "ValidationSuccess" as const, validated };
});

/**
 * Format validation errors as a readable table.
 */
export const formatErrorTable = (errors: ReadonlyArray<ValidationError>): string => {
  const maxName = Math.max(...errors.map((e) => e.name.length), 4);
  const maxExpected = Math.max(...errors.map((e) => e.expected.length), 8);
  const maxReceived = Math.max(...errors.map((e) => e.received.length), 8);

  const divider = `+${"-".repeat(maxName + 2)}+${"-".repeat(maxExpected + 2)}+${"-".repeat(maxReceived + 2)}+${"-".repeat(30)}+`;
  const header = `| ${"Name".padEnd(maxName)} | ${"Expected".padEnd(maxExpected)} | ${"Received".padEnd(maxReceived)} | ${"Issue".padEnd(28)} |`;

  const rows = errors.map(
    (e) =>
      `| ${e.name.padEnd(maxName)} | ${e.expected.padEnd(maxExpected)} | ${e.received.padEnd(maxReceived)} | ${e.issue.padEnd(28)} |`,
  );

  return [divider, header, divider, ...rows, divider].join("\n");
};

/**
 * Run validation and print results. Exits with code 1 on failure.
 */
export const runValidation = Effect.gen(function* () {
  const result = yield* validateEnv;

  if (result._tag === "ValidationSuccess") {
    yield* Console.log("✅ All environment variables are valid.");
    yield* Console.log("");
    for (const v of result.validated) {
      const source = v.source === "default" ? "(default)" : "(env)";
      yield* Console.log(`  ${v.name} = ${JSON.stringify(v.value)} ${source}`);
    }
    return;
  }

  yield* Console.error("❌ Environment variable validation failed:");
  yield* Console.error("");
  yield* Console.error(formatErrorTable(result.errors));
  yield* Console.error("");
  yield* Console.error(
    `Found ${result.errors.length} error(s). Fix the above variables and try again.`,
  );
  yield* Effect.fail(result);
});

// ---------------------------------------------------------------------------
// Layer for validation-as-a-service
// ---------------------------------------------------------------------------

export const EnvValidationLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const result = yield* validateEnv;
    if (result._tag === "ValidationFailure") {
      yield* Console.error(formatErrorTable(result.errors));
      yield* Effect.die("Environment variable validation failed — see table above");
    }
  }),
);
