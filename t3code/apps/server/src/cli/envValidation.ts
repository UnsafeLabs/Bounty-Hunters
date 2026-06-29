import * as Schema from "effect/Schema";

export const EnvValidationStatus = Schema.Literals(["ok", "missing", "invalid", "default"]);
export type EnvValidationStatus = typeof EnvValidationStatus.Type;

export const EnvValidationEntry = Schema.Struct({
  name: Schema.String,
  status: EnvValidationStatus,
  expected: Schema.String,
  description: Schema.String,
  required: Schema.Boolean,
  received: Schema.optional(Schema.String),
  defaultValue: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
export type EnvValidationEntry = typeof EnvValidationEntry.Type;

export const EnvValidationResult = Schema.Struct({
  valid: Schema.Boolean,
  entries: Schema.Array(EnvValidationEntry),
});
export type EnvValidationResult = typeof EnvValidationResult.Type;

interface EnvVariableSpec {
  readonly name: string;
  readonly expected: string;
  readonly description: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
  readonly validate: (value: string) => string | undefined;
}

const ok = () => undefined;
const nonEmpty = (value: string) => (value.trim().length > 0 ? undefined : "value is empty");
const integer =
  (minimum?: number, maximum?: number) =>
  (value: string): string | undefined => {
    if (!/^-?\d+$/.test(value)) return "expected an integer";
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) return "expected a safe integer";
    if (minimum !== undefined && parsed < minimum) return `expected >= ${minimum}`;
    if (maximum !== undefined && parsed > maximum) return `expected <= ${maximum}`;
    return undefined;
  };
const oneOf =
  (values: readonly string[]) =>
  (value: string): string | undefined =>
    values.includes(value) ? undefined : `expected one of ${values.join(", ")}`;
const boolean = (value: string): string | undefined =>
  /^(true|false|1|0|yes|no|on|off)$/i.test(value)
    ? undefined
    : "expected boolean: true/false, 1/0, yes/no, or on/off";
const url = (value: string): string | undefined => {
  try {
    new URL(value);
    return undefined;
  } catch {
    return "expected a valid absolute URL";
  }
};

export const serverEnvironmentVariableSpecs: readonly EnvVariableSpec[] = [
  {
    name: "T3CODE_LOG_LEVEL",
    expected: "All | Fatal | Error | Warn | Warning | Info | Debug | Trace | None",
    description: "Minimum process log level.",
    defaultValue: "Info",
    validate: oneOf(["All", "Fatal", "Error", "Warn", "Warning", "Info", "Debug", "Trace", "None"]),
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    expected: "All | Fatal | Error | Warn | Warning | Info | Debug | Trace | None",
    description: "Minimum trace event level.",
    defaultValue: "Info",
    validate: oneOf(["All", "Fatal", "Error", "Warn", "Warning", "Info", "Debug", "Trace", "None"]),
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    expected: "boolean",
    description: "Enable trace timing fields.",
    defaultValue: "true",
    validate: boolean,
  },
  {
    name: "T3CODE_TRACE_FILE",
    expected: "file path",
    description: "Override server trace file path.",
    validate: nonEmpty,
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    expected: "integer >= 1",
    description: "Maximum bytes per trace file.",
    defaultValue: String(10 * 1024 * 1024),
    validate: integer(1),
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    expected: "integer >= 1",
    description: "Maximum retained trace files.",
    defaultValue: "10",
    validate: integer(1),
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    expected: "integer >= 0",
    description: "Trace batching window in milliseconds.",
    defaultValue: "200",
    validate: integer(0),
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    expected: "absolute URL",
    description: "OTLP traces endpoint.",
    validate: url,
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    expected: "absolute URL",
    description: "OTLP metrics endpoint.",
    validate: url,
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    expected: "integer >= 1",
    description: "OTLP export interval in milliseconds.",
    defaultValue: "10000",
    validate: integer(1),
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    expected: "non-empty string",
    description: "OTLP service.name resource attribute.",
    defaultValue: "t3-server",
    validate: nonEmpty,
  },
  {
    name: "T3CODE_MODE",
    expected: "web | desktop",
    description: "Runtime mode.",
    defaultValue: "web",
    validate: oneOf(["web", "desktop"]),
  },
  {
    name: "T3CODE_PORT",
    expected: "port 1-65535",
    description: "HTTP/WebSocket listen port.",
    defaultValue: "auto",
    validate: integer(1, 65535),
  },
  {
    name: "T3CODE_HOST",
    expected: "hostname or IP address",
    description: "HTTP/WebSocket bind host.",
    validate: nonEmpty,
  },
  {
    name: "T3CODE_HOME",
    expected: "directory path",
    description: "Base directory for runtime state.",
    defaultValue: "platform default",
    validate: nonEmpty,
  },
  {
    name: "VITE_DEV_SERVER_URL",
    expected: "absolute URL",
    description: "Development web server URL.",
    validate: url,
  },
  {
    name: "T3CODE_NO_BROWSER",
    expected: "boolean",
    description: "Disable automatic browser opening.",
    defaultValue: "depends on mode",
    validate: boolean,
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    expected: "integer >= 0",
    description: "File descriptor for desktop bootstrap envelope.",
    validate: integer(0),
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    expected: "boolean",
    description: "Create a startup project for the current working directory.",
    defaultValue: "depends on mode",
    validate: boolean,
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    expected: "boolean",
    description: "Log outbound WebSocket event traffic.",
    defaultValue: "enabled for dev URL",
    validate: boolean,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    expected: "boolean",
    description: "Enable Tailscale Serve setup.",
    defaultValue: "false",
    validate: boolean,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    expected: "port 1-65535",
    description: "HTTPS port for Tailscale Serve.",
    defaultValue: "443",
    validate: integer(1, 65535),
  },
];

export class ServerEnvironmentValidationError extends Error {
  readonly _tag = "ServerEnvironmentValidationError";

  constructor(readonly result: EnvValidationResult) {
    super(formatServerEnvironmentValidationTable(result, { onlyProblems: true }));
    this.name = "ServerEnvironmentValidationError";
  }
}

export const validateServerEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): EnvValidationResult => {
  const entries = serverEnvironmentVariableSpecs.map((spec): EnvValidationEntry => {
    const raw = env[spec.name];
    const required = spec.required === true;
    const value = raw?.trim();
    if (value === undefined || value.length === 0) {
      if (required) {
        return {
          name: spec.name,
          status: "missing",
          expected: spec.expected,
          description: spec.description,
          required,
          defaultValue: spec.defaultValue,
          message: "required variable is not set",
        };
      }
      return {
        name: spec.name,
        status: spec.defaultValue !== undefined ? "default" : "ok",
        expected: spec.expected,
        description: spec.description,
        required,
        defaultValue: spec.defaultValue,
      };
    }

    const message = spec.validate(value);
    if (message !== undefined) {
      return {
        name: spec.name,
        status: "invalid",
        expected: spec.expected,
        description: spec.description,
        required,
        received: raw,
        defaultValue: spec.defaultValue,
        message,
      };
    }

    return {
      name: spec.name,
      status: "ok",
      expected: spec.expected,
      description: spec.description,
      required,
      received: raw,
      defaultValue: spec.defaultValue,
    };
  });

  return {
    valid: entries.every((entry) => entry.status !== "missing" && entry.status !== "invalid"),
    entries,
  };
};

export const formatServerEnvironmentValidationTable = (
  result: EnvValidationResult,
  options: { readonly onlyProblems?: boolean } = {},
): string => {
  const entries = options.onlyProblems
    ? result.entries.filter((entry) => entry.status === "missing" || entry.status === "invalid")
    : result.entries;
  const rows = [
    ["Variable", "Status", "Expected", "Value", "Description"],
    ...entries.map((entry) => [
      entry.name,
      entry.status,
      entry.expected,
      entry.received ?? entry.defaultValue ?? "<unset>",
      entry.message ?? entry.description,
    ]),
  ];
  const widths = rows[0]?.map((_, index) =>
    Math.max(...rows.map((row) => row[index]?.length ?? 0)),
  );
  const render = (row: readonly string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ");
  const separator = (widths ?? []).map((width) => "-".repeat(width)).join("-|-");
  const rendered = [render(rows[0] ?? []), separator, ...rows.slice(1).map(render)];
  return [
    result.valid ? "Server environment validation passed." : "Server environment validation failed.",
    ...rendered,
  ].join("\n");
};

export const assertValidServerEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): EnvValidationResult => {
  const result = validateServerEnvironment(env);
  if (!result.valid) {
    throw new ServerEnvironmentValidationError(result);
  }
  return result;
};
