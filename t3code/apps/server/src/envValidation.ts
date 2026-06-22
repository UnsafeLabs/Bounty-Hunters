import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Schema from "effect/Schema";

const envVarDefs = [
  { name: "T3CODE_LOG_LEVEL", type: "LogLevel", default: "Info" },
  { name: "T3CODE_TRACE_MIN_LEVEL", type: "LogLevel", default: "Info" },
  { name: "T3CODE_TRACE_TIMING_ENABLED", type: "boolean", default: "true" },
  { name: "T3CODE_OTLP_SERVICE_NAME", type: "string", default: "t3-server" },
  { name: "T3CODE_PORT", type: "port", default: "none (auto)" },
  { name: "T3CODE_HOST", type: "string", default: "none" },
  { name: "T3CODE_HOME", type: "string", default: "none" },
  { name: "T3CODE_MODE", type: "string", default: "none" },
  { name: "T3CODE_NO_BROWSER", type: "boolean", default: "none" },
  { name: "T3CODE_TAILSCALE_SERVE", type: "boolean", default: "none" },
  { name: "T3CODE_TAILSCALE_SERVE_PORT", type: "port", default: "none" },
  { name: "VITE_DEV_SERVER_URL", type: "URL", default: "none" },
];

interface ValidationEntry {
  name: string;
  type: string;
  value: string;
  default: string;
  status: "ok" | "missing" | "invalid";
  error?: string;
}

interface ValidationSummary {
  okCount: number;
  missingCount: number;
  invalidCount: number;
}

export const validateConfig: Effect.Effect<ValidationSummary, never> = Effect.gen(function* () {
  const results: Array<ValidationEntry> = [];
  for (const def of envVarDefs) {
    const raw = process.env[def.name];
    if (raw === undefined || raw === "") {
      results.push({
        name: def.name,
        type: def.type,
        value: "(not set)",
        default: def.default,
        status: "missing",
      });
    } else {
      results.push({
        name: def.name,
        type: def.type,
        value: raw,
        default: def.default,
        status: "ok",
      });
    }
  }

  const missing = results.filter((r) => r.status === "missing");
  const invalid = results.filter((r) => r.status === "invalid");
  const ok = results.filter((r) => r.status === "ok");

  yield* Console.log("=== Environment Configuration Validation ===");

  yield* Console.log("Variables with values:");
  for (const entry of ok) {
    yield* Console.log(`  [OK]      ${entry.name} = ${entry.value}`);
  }

  if (missing.length > 0) {
    yield* Console.log("Missing variables (using defaults):");
    for (const entry of missing) {
      yield* Console.log(`  [MISSING] ${entry.name} (default: ${entry.default})`);
    }
  }

  if (invalid.length > 0) {
    yield* Console.log("Invalid variables:");
    for (const entry of invalid) {
      yield* Console.log(`  [INVALID] ${entry.name} = ${entry.value}`);
      if (entry.error) {
        yield* Console.log(`            Error: ${entry.error}`);
      }
    }
  }

  yield* Console.log(`Summary: ${ok.length} ok, ${missing.length} missing (using defaults), ${invalid.length} invalid`);
  yield* Console.log("===========================================");

  return { okCount: ok.length, missingCount: missing.length, invalidCount: invalid.length };
});

export const EnvValidationSchema = Schema.Struct({
  T3CODE_LOG_LEVEL: Schema.String.pipe(Schema.optional),
  T3CODE_TRACE_MIN_LEVEL: Schema.String.pipe(Schema.optional),
  T3CODE_TRACE_TIMING_ENABLED: Schema.String.pipe(Schema.optional),
  T3CODE_OTLP_SERVICE_NAME: Schema.String.pipe(Schema.optional),
  T3CODE_PORT: Schema.NumberFromString.pipe(Schema.optional),
  T3CODE_HOST: Schema.String.pipe(Schema.optional),
  T3CODE_HOME: Schema.String.pipe(Schema.optional),
  T3CODE_MODE: Schema.String.pipe(Schema.optional),
  T3CODE_NO_BROWSER: Schema.String.pipe(Schema.optional),
  T3CODE_TAILSCALE_SERVE: Schema.String.pipe(Schema.optional),
  T3CODE_TAILSCALE_SERVE_PORT: Schema.NumberFromString.pipe(Schema.optional),
  VITE_DEV_SERVER_URL: Schema.String.pipe(Schema.optional),
});
