import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Console from "effect/Console";

/**
 * Environment variable validation schema.
 * Validates required and optional environment variables at server startup.
 */

// Required environment variables
const RequiredEnvVars = Schema.Struct({
  T3CODE_HOME: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
});

// Optional environment variables with defaults
const OptionalEnvVars = Schema.Struct({
  T3CODE_PORT: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "3773"),
  ),
  T3CODE_HOST: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "127.0.0.1"),
  ),
  T3CODE_MODE: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "web"),
  ),
  T3CODE_LOG_LEVEL: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "Info"),
  ),
  T3CODE_NO_BROWSER: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "false"),
  ),
  T3CODE_OTLP_TRACES_URL: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
  T3CODE_OTLP_METRICS_URL: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
  T3CODE_OTLP_EXPORT_INTERVAL_MS: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "10000"),
  ),
  T3CODE_OTLP_SERVICE_NAME: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "t3-server"),
  ),
  T3CODE_TAILSCALE_SERVE_ENABLED: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "false"),
  ),
  T3CODE_TAILSCALE_SERVE_PORT: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => "443"),
  ),
  VITE_DEV_SERVER_URL: Schema.optional(Schema.String).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
});

// Full environment schema
export const EnvSchema = Schema.Struct({
  ...RequiredEnvVars.fields,
  ...OptionalEnvVars.fields,
});

export type ValidatedEnv = typeof EnvSchema.Type;

/**
 * Known environment variable definitions for the validation table.
 */
interface EnvVarDef {
  name: string;
  required: boolean;
  type: string;
  default: string;
  description: string;
}

const ENV_VAR_DEFS: readonly EnvVarDef[] = [
  { name: "T3CODE_HOME", required: false, type: "string (path)", default: "~/.t3code", description: "Base directory for server state" },
  { name: "T3CODE_PORT", required: false, type: "integer (1-65535)", default: "3773", description: "HTTP/WebSocket server port" },
  { name: "T3CODE_HOST", required: false, type: "string (hostname)", default: "127.0.0.1", description: "Host/interface to bind" },
  { name: "T3CODE_MODE", required: false, type: "web | desktop", default: "web", description: "Runtime mode" },
  { name: "T3CODE_LOG_LEVEL", required: false, type: "Trace|Debug|Info|Warning|Error", default: "Info", description: "Log verbosity level" },
  { name: "T3CODE_NO_BROWSER", required: false, type: "boolean", default: "false", description: "Disable auto browser opening" },
  { name: "T3CODE_OTLP_TRACES_URL", required: false, type: "string (URL)", default: "", description: "OTLP traces endpoint" },
  { name: "T3CODE_OTLP_METRICS_URL", required: false, type: "string (URL)", default: "", description: "OTLP metrics endpoint" },
  { name: "T3CODE_OTLP_EXPORT_INTERVAL_MS", required: false, type: "integer (ms)", default: "10000", description: "OTLP export interval" },
  { name: "T3CODE_OTLP_SERVICE_NAME", required: false, type: "string", default: "t3-server", description: "OTLP service name" },
  { name: "T3CODE_TAILSCALE_SERVE_ENABLED", required: false, type: "boolean", default: "false", description: "Enable Tailscale serve" },
  { name: "T3CODE_TAILSCALE_SERVE_PORT", required: false, type: "integer", default: "443", description: "Tailscale serve port" },
  { name: "VITE_DEV_SERVER_URL", required: false, type: "string (URL)", default: "", description: "Dev server URL for proxying" },
];

/**
 * Format the validation table for display.
 */
function formatValidationTable(
  errors: Array<{ name: string; issue: string; expected: string; received: string }>,
): string {
  const header = "┌─────────────────────────────────────┬────────────────────────────────┬──────────────────┐\n" +
    "│ Variable                            │ Expected Type                  │ Issue            │\n" +
    "├─────────────────────────────────────┼────────────────────────────────┼──────────────────┤\n";
  const rows = errors.map(e => {
    const namePad = e.name.padEnd(35);
    const expectedPad = e.expected.padEnd(30);
    const issuePad = e.issue.padEnd(16);
    return `│ ${namePad} │ ${expectedPad} │ ${issuePad} │`;
  }).join("\n");
  const footer = "\n└─────────────────────────────────────┴────────────────────────────────┴──────────────────┘";
  return header + rows + footer;
}

/**
 * Validate environment variables at startup.
 * Returns a validated environment object or exits with code 1.
 */
export const validateEnv = Effect.gen(function* () {
  const rawEnv: Record<string, string> = {};

  // Collect known env vars
  for (const def of ENV_VAR_DEFS) {
    const val = process.env[def.name];
    if (val !== undefined) {
      rawEnv[def.name] = val;
    }
  }

  // Parse and validate
  const result = Schema.decodeUnknownEither(EnvSchema)(rawEnv);

  if (result._tag === "Left") {
    const errors = result.left.errors.map((err: SchemaIssue.SchemaIssue) => ({
      name: err.path?.[0]?.toString() ?? "unknown",
      expected: ENV_VAR_DEFS.find(d => d.name === err.path?.[0]?.toString())?.type ?? "unknown",
      issue: err.message,
      received: rawEnv[err.path?.[0]?.toString() ?? ""] ?? "undefined",
    }));

    yield* Console.error("\n❌ Environment variable validation failed:\n");
    yield* Console.error(formatValidationTable(errors));
    yield* Console.error(`\n${errors.length} error(s) found. Server cannot start.\n`);
    yield* Effect.fail(new Error(`Environment validation failed: ${errors.length} error(s)`));
  }

  return result.right;
});

/**
 * Print the full environment variable table (for --validate-config).
 */
export const printEnvTable = Effect.gen(function* () {
  yield* Console.log("\n📋 T3 Code Environment Variable Configuration:\n");
  const header = "┌─────────────────────────────────────┬──────────┬──────────────────────────────┬──────────────────────────────────────────────┐\n" +
    "│ Variable                            │ Required │ Default                      │ Description                                  │\n" +
    "├─────────────────────────────────────┼──────────┼──────────────────────────────┼──────────────────────────────────────────────┤\n";
  const rows = ENV_VAR_DEFS.map(d => {
    const namePad = d.name.padEnd(35);
    const reqPad = (d.required ? "yes" : "no").padEnd(8);
    const defPad = d.default.padEnd(28);
    const descPad = d.description.padEnd(44);
    return `│ ${namePad} │ ${reqPad} │ ${defPad} │ ${descPad} │`;
  }).join("\n");
  const footer = "\n└─────────────────────────────────────┴──────────┴──────────────────────────────┴──────────────────────────────────────────────┘";
  yield* Console.log(header + rows + footer);
  yield* Console.log(`\n${ENV_VAR_DEFS.length} environment variables configured.\n`);
});

/**
 * Run validation only (for --validate-config flag).
 * Exits with 0 if valid, 1 if invalid.
 */
export const runValidateConfig = Effect.gen(function* () {
  yield* printEnvTable;
  const result = yield* Effect.either(validateEnv);
  if (result._tag === "Right") {
    yield* Console.log("✅ All environment variables are valid.\n");
    process.exit(0);
  } else {
    yield* Console.error("❌ Environment validation failed.\n");
    process.exit(1);
  }
});
