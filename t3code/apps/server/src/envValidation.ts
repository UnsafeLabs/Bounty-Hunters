/**
 * Startup environment validation for the T3 Code server.
 *
 * Reads the known `T3CODE_*` / `VITE_*` variables, type-checks every explicitly
 * set value with an Effect Schema, and reports a human-readable table. This
 * runs before any service initializes so a typo like `T3CODE_PORT=abc` fails
 * fast with a clear message instead of a cryptic runtime error later.
 *
 * Design note: every variable below is optional-with-default (matching the
 * existing `Config.withDefault` behavior), so a missing variable is never an
 * error. An explicitly set but unparseable value IS an error and fails
 * startup with exit code 1. Changing any default into a hard requirement
 * would break existing installs, so that is deliberately not done here.
 *
 * @module EnvValidation
 */
import * as Schema from "effect/Schema";

export type EnvVarStatus = "ok" | "default" | "invalid";

export interface EnvVarSpec {
  readonly name: string;
  readonly expected: string;
  readonly description: string;
  readonly schema: Schema.Schema<any>;
  /** Extra integer check applied after schema decode. */
  readonly integer?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly defaultNote: string;
}

export interface EnvVarResult {
  readonly name: string;
  readonly expected: string;
  readonly status: EnvVarStatus;
  readonly detail: string;
}

const LogLevelSchema = Schema.Literals([
  "All",
  "Trace",
  "Debug",
  "Info",
  "Warning",
  "Error",
  "Fatal",
  "None",
]);

const BooleanStringSchema = Schema.Literals(["true", "false", "1", "0"]);

const IntStringSchema = Schema.NumberFromString;

const ModeSchema = Schema.Literals(["web", "desktop"]);

export const ENV_VAR_SPECS: ReadonlyArray<EnvVarSpec> = [
  {
    name: "T3CODE_LOG_LEVEL",
    expected: "All|Trace|Debug|Info|Warning|Error|Fatal|None",
    description: "Server log verbosity",
    schema: LogLevelSchema,
    defaultNote: "Info",
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    expected: "All|Trace|Debug|...|None",
    description: "Minimum level written to the trace file",
    schema: LogLevelSchema,
    defaultNote: "Info",
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    expected: "true|false|1|0",
    description: "Record timing spans in traces",
    schema: BooleanStringSchema,
    defaultNote: "true",
  },
  {
    name: "T3CODE_TRACE_FILE",
    expected: "path",
    description: "Override trace file location",
    schema: Schema.String,
    defaultNote: "<stateDir>/logs/server.trace.ndjson",
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    expected: "int >= 1",
    description: "Max bytes per trace file",
    schema: IntStringSchema,
    integer: true,
    min: 1,
    defaultNote: "10485760",
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    expected: "int >= 1",
    description: "Max rotated trace files",
    schema: IntStringSchema,
    integer: true,
    min: 1,
    defaultNote: "10",
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    expected: "int >= 0",
    description: "Trace batching window (ms)",
    schema: IntStringSchema,
    integer: true,
    min: 0,
    defaultNote: "200",
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    expected: "URL",
    description: "OTLP traces endpoint",
    schema: Schema.URLFromString,
    defaultNote: "(unset)",
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    expected: "URL",
    description: "OTLP metrics endpoint",
    schema: Schema.URLFromString,
    defaultNote: "(unset)",
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    expected: "int >= 1",
    description: "OTLP export interval (ms)",
    schema: IntStringSchema,
    integer: true,
    min: 1,
    defaultNote: "10000",
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    expected: "string",
    description: "OTLP service name",
    schema: Schema.String,
    defaultNote: "t3-server",
  },
  {
    name: "T3CODE_MODE",
    expected: "web|desktop",
    description: "Runtime mode",
    schema: ModeSchema,
    defaultNote: "web",
  },
  {
    name: "T3CODE_PORT",
    expected: "int 1-65535",
    description: "HTTP/WebSocket port",
    schema: IntStringSchema,
    integer: true,
    min: 1,
    max: 65535,
    defaultNote: "3773 or auto",
  },
  {
    name: "T3CODE_HOST",
    expected: "string",
    description: "Bind host/interface",
    schema: Schema.String,
    defaultNote: "(auto)",
  },
  {
    name: "T3CODE_HOME",
    expected: "path",
    description: "Base directory override",
    schema: Schema.String,
    defaultNote: "(platform default)",
  },
  {
    name: "VITE_DEV_SERVER_URL",
    expected: "URL",
    description: "Dev web URL to proxy",
    schema: Schema.URLFromString,
    defaultNote: "(unset)",
  },
  {
    name: "T3CODE_NO_BROWSER",
    expected: "true|false|1|0",
    description: "Disable auto-open browser",
    schema: BooleanStringSchema,
    defaultNote: "false",
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    expected: "int >= 0",
    description: "FD for bootstrap secrets",
    schema: IntStringSchema,
    integer: true,
    min: 0,
    defaultNote: "(unset)",
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    expected: "true|false|1|0",
    description: "Auto-create project from cwd",
    schema: BooleanStringSchema,
    defaultNote: "mode-dependent",
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    expected: "true|false|1|0",
    description: "Log outbound WS traffic",
    schema: BooleanStringSchema,
    defaultNote: "false",
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    expected: "true|false|1|0",
    description: "Expose via Tailscale Serve",
    schema: BooleanStringSchema,
    defaultNote: "false",
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    expected: "int 1-65535",
    description: "Tailscale Serve HTTPS port",
    schema: IntStringSchema,
    integer: true,
    min: 1,
    max: 65535,
    defaultNote: "443",
  },
];

const decodeWithSchema = (schema: Schema.Schema<any>, raw: string): string | undefined => {
  // All specs below are pure decoders (no services required); the cast only
  // satisfies the Decoder<unknown, never> parameter of decodeUnknownSync.
  const decoder = schema as unknown as Schema.Decoder<unknown, never>;
  try {
    Schema.decodeUnknownSync(decoder)(raw);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (message.split("\n")[0] ?? message).slice(0, 160);
  }
};

export const validateEnvVars = (
  env: Record<string, string | undefined>,
): { readonly rows: ReadonlyArray<EnvVarResult>; readonly ok: boolean } => {
  const rows = ENV_VAR_SPECS.map((spec): EnvVarResult => {
    const raw = env[spec.name];
    if (raw === undefined || raw.trim() === "") {
      return {
        name: spec.name,
        expected: spec.expected,
        status: "default",
        detail: `default (${spec.defaultNote})`,
      };
    }
    const schemaError = decodeWithSchema(spec.schema, raw);
    if (schemaError !== undefined) {
      return {
        name: spec.name,
        expected: spec.expected,
        status: "invalid",
        detail: `got ${JSON.stringify(raw)}: ${schemaError}`,
      };
    }
    const numeric = Number(raw);
    if (
      (spec.integer === true || spec.min !== undefined || spec.max !== undefined) &&
      !Number.isFinite(numeric)
    ) {
      return {
        name: spec.name,
        expected: spec.expected,
        status: "invalid",
        detail: `got ${JSON.stringify(raw)}: not a number`,
      };
    }
    if (spec.integer === true && !Number.isInteger(numeric)) {
      return {
        name: spec.name,
        expected: spec.expected,
        status: "invalid",
        detail: `got ${JSON.stringify(raw)}: not an integer`,
      };
    }
    if (spec.min !== undefined && numeric < spec.min) {
      return {
        name: spec.name,
        expected: spec.expected,
        status: "invalid",
        detail: `got ${raw}: below minimum ${spec.min}`,
      };
    }
    if (spec.max !== undefined && numeric > spec.max) {
      return {
        name: spec.name,
        expected: spec.expected,
        status: "invalid",
        detail: `got ${raw}: above maximum ${spec.max}`,
      };
    }
    return { name: spec.name, expected: spec.expected, status: "ok", detail: JSON.stringify(raw) };
  });
  return { rows, ok: rows.every((row) => row.status !== "invalid") };
};

export const validateProcessEnv = (env: NodeJS.ProcessEnv = process.env) =>
  validateEnvVars(env as Record<string, string | undefined>);

export const formatValidationTable = (rows: ReadonlyArray<EnvVarResult>): string => {
  const nameW = Math.max(8, ...rows.map((r) => r.name.length));
  const expW = Math.max(8, ...rows.map((r) => r.expected.length));
  const lines = rows.map((row) => {
    const mark = row.status === "ok" ? "OK " : row.status === "default" ? "---" : "FAIL";
    return `${mark} ${row.name.padEnd(nameW)}  ${row.expected.padEnd(expW)}  ${row.detail}`;
  });
  const fails = rows.filter((r) => r.status === "invalid").length;
  const summary =
    fails === 0
      ? `config OK (${rows.length - rows.filter((r) => r.status === "default").length} set, rest defaults)`
      : `${fails} invalid variable(s) - fix them or unset to use defaults`;
  return ["Environment configuration:", ...lines, summary].join("\n");
};
