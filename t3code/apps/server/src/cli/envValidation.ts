import { PortSchema } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { RuntimeMode } from "../config.ts";

export type EnvironmentValidationStatus = "default" | "invalid" | "missing" | "optional" | "set";

export interface EnvironmentVariableDefinition {
  readonly name: string;
  readonly required: boolean;
  readonly expected: string;
  readonly description: string;
  readonly defaultValue?: string;
  readonly schema: Schema.Decoder<unknown>;
  readonly decode: (input: unknown) => Exit.Exit<unknown, Schema.SchemaError>;
}

type EnvironmentVariableDefinitionInput = Omit<EnvironmentVariableDefinition, "decode">;

export interface EnvironmentValidationRow {
  readonly name: string;
  readonly required: boolean;
  readonly expected: string;
  readonly description: string;
  readonly defaultValue: string | undefined;
  readonly status: EnvironmentValidationStatus;
  readonly receivedValue: string | undefined;
}

export interface EnvironmentValidationResult {
  readonly ok: boolean;
  readonly rows: ReadonlyArray<EnvironmentValidationRow>;
}

export class EnvironmentValidationError extends Schema.TaggedErrorClass<EnvironmentValidationError>()(
  "EnvironmentValidationError",
  {
    message: Schema.String,
  },
) {}

const LogLevelString = Schema.Literals([
  "All",
  "Fatal",
  "Error",
  "Warn",
  "Info",
  "Debug",
  "Trace",
  "None",
  "all",
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "none",
]);

const BooleanString = Schema.Literals(["true", "false"]);
const IntegerString = Schema.NumberFromString.check(Schema.isInt());
const decodePortSchema = Schema.decodeUnknownExit(PortSchema);
const PortString = Schema.NumberFromString.check(Schema.isInt()).check(
  Schema.makeFilter((value) =>
    Exit.isSuccess(decodePortSchema(value))
      ? undefined
      : "expected an integer port between 1 and 65535",
  ),
);

const ENVIRONMENT_VARIABLE_DEFINITION_INPUTS: ReadonlyArray<EnvironmentVariableDefinitionInput> = [
  {
    name: "T3CODE_LOG_LEVEL",
    required: false,
    expected: "log level: All|Fatal|Error|Warn|Info|Debug|Trace|None",
    description: "Server console log level.",
    defaultValue: "Info",
    schema: LogLevelString,
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    required: false,
    expected: "log level: All|Fatal|Error|Warn|Info|Debug|Trace|None",
    description: "Minimum level written to the server trace file.",
    defaultValue: "Info",
    schema: LogLevelString,
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    required: false,
    expected: "boolean: true|false",
    description: "Enable timing fields in server traces.",
    defaultValue: "true",
    schema: BooleanString,
  },
  {
    name: "T3CODE_TRACE_FILE",
    required: false,
    expected: "path string",
    description: "Override the server trace file path.",
    schema: Schema.String,
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    required: false,
    expected: "integer",
    description: "Maximum trace file size before rotation.",
    defaultValue: String(10 * 1024 * 1024),
    schema: IntegerString,
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    required: false,
    expected: "integer",
    description: "Maximum number of rotated trace files to keep.",
    defaultValue: "10",
    schema: IntegerString,
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    required: false,
    expected: "integer milliseconds",
    description: "Trace batching window in milliseconds.",
    defaultValue: "200",
    schema: IntegerString,
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    required: false,
    expected: "URL",
    description: "OTLP traces collector endpoint.",
    schema: Schema.URLFromString,
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    required: false,
    expected: "URL",
    description: "OTLP metrics collector endpoint.",
    schema: Schema.URLFromString,
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    required: false,
    expected: "integer milliseconds",
    description: "OTLP export interval in milliseconds.",
    defaultValue: "10000",
    schema: IntegerString,
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    required: false,
    expected: "string",
    description: "Service name attached to OTLP telemetry.",
    defaultValue: "t3-server",
    schema: Schema.String,
  },
  {
    name: "T3CODE_MODE",
    required: false,
    expected: "web|desktop",
    description: "Runtime mode.",
    defaultValue: "web",
    schema: RuntimeMode,
  },
  {
    name: "T3CODE_PORT",
    required: false,
    expected: "integer port 1-65535",
    description: "HTTP/WebSocket server port.",
    defaultValue: "first available at or above 3773",
    schema: PortString,
  },
  {
    name: "T3CODE_HOST",
    required: false,
    expected: "host/interface string",
    description: "Host/interface for the server listener.",
    schema: Schema.String,
  },
  {
    name: "T3CODE_HOME",
    required: false,
    expected: "path string",
    description: "Base directory for server state and logs.",
    defaultValue: "platform default",
    schema: Schema.String,
  },
  {
    name: "VITE_DEV_SERVER_URL",
    required: false,
    expected: "URL",
    description: "Dev web URL to proxy or redirect to.",
    schema: Schema.URLFromString,
  },
  {
    name: "T3CODE_NO_BROWSER",
    required: false,
    expected: "boolean: true|false",
    description: "Disable automatic browser opening.",
    schema: BooleanString,
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    required: false,
    expected: "integer file descriptor",
    description: "File descriptor for desktop bootstrap settings.",
    schema: IntegerString,
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    required: false,
    expected: "boolean: true|false",
    description: "Create a project for the current directory on startup.",
    defaultValue: "true in web mode, false in headless mode",
    schema: BooleanString,
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    required: false,
    expected: "boolean: true|false",
    description: "Emit server-side logs for WebSocket push traffic.",
    defaultValue: "true when dev URL is configured, otherwise false",
    schema: BooleanString,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    required: false,
    expected: "boolean: true|false",
    description: "Configure Tailscale Serve for Tailnet HTTPS exposure.",
    defaultValue: "false",
    schema: BooleanString,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    required: false,
    expected: "integer port 1-65535",
    description: "HTTPS port for Tailscale Serve.",
    defaultValue: "443",
    schema: PortString,
  },
];

export const ENVIRONMENT_VARIABLE_DEFINITIONS: ReadonlyArray<EnvironmentVariableDefinition> =
  ENVIRONMENT_VARIABLE_DEFINITION_INPUTS.map((definition) =>
    Object.assign({}, definition, {
      decode: Schema.decodeUnknownExit(definition.schema),
    }),
  );

const validateVariable = (
  definition: EnvironmentVariableDefinition,
  env: Readonly<Record<string, string | undefined>>,
): EnvironmentValidationRow => {
  const receivedValue = env[definition.name];

  if (receivedValue === undefined) {
    return {
      name: definition.name,
      required: definition.required,
      expected: definition.expected,
      description: definition.description,
      defaultValue: definition.defaultValue,
      status: definition.required
        ? "missing"
        : definition.defaultValue === undefined
          ? "optional"
          : "default",
      receivedValue,
    };
  }

  return {
    name: definition.name,
    required: definition.required,
    expected: definition.expected,
    description: definition.description,
    defaultValue: definition.defaultValue,
    status: Exit.isSuccess(definition.decode(receivedValue)) ? "set" : "invalid",
    receivedValue,
  };
};

export const validateEnvironmentVariables = (
  env: Readonly<Record<string, string | undefined>>,
): EnvironmentValidationResult => {
  const rows = ENVIRONMENT_VARIABLE_DEFINITIONS.map((definition) =>
    validateVariable(definition, env),
  );
  const ok = rows.every((row) => row.status !== "invalid" && row.status !== "missing");
  return { ok, rows };
};

const quoteValue = (value: string | undefined) => {
  if (value === undefined) return "(unset)";
  if (value.length <= 44) return JSON.stringify(value);
  return JSON.stringify(`${value.slice(0, 41)}...`);
};

const rowDisplayValue = (row: EnvironmentValidationRow) => {
  switch (row.status) {
    case "default":
      return `(default ${row.defaultValue ?? ""})`;
    case "optional":
      return "(optional unset)";
    case "missing":
      return "(missing)";
    case "invalid":
    case "set":
      return quoteValue(row.receivedValue);
  }
};

const padRight = (value: string, width: number) => value.padEnd(width, " ");

const formatRows = (rows: ReadonlyArray<EnvironmentValidationRow>) => {
  const tableRows = rows.map((row) => ({
    name: row.name,
    required: row.required ? "yes" : "no",
    expected: row.expected,
    status: row.status,
    value: rowDisplayValue(row),
    description: row.description,
  }));
  const headers = {
    name: "Variable",
    required: "Required",
    expected: "Expected",
    status: "Status",
    value: "Value",
    description: "Description",
  };
  const widths = {
    name: Math.max(headers.name.length, ...tableRows.map((row) => row.name.length)),
    required: Math.max(headers.required.length, ...tableRows.map((row) => row.required.length)),
    expected: Math.max(headers.expected.length, ...tableRows.map((row) => row.expected.length)),
    status: Math.max(headers.status.length, ...tableRows.map((row) => row.status.length)),
    value: Math.max(headers.value.length, ...tableRows.map((row) => row.value.length)),
  };
  const renderRow = (row: typeof headers) =>
    [
      padRight(row.name, widths.name),
      padRight(row.required, widths.required),
      padRight(row.expected, widths.expected),
      padRight(row.status, widths.status),
      padRight(row.value, widths.value),
      row.description,
    ].join("  ");
  const header = renderRow(headers);
  const separator = [
    "-".repeat(widths.name),
    "-".repeat(widths.required),
    "-".repeat(widths.expected),
    "-".repeat(widths.status),
    "-".repeat(widths.value),
    "-".repeat(headers.description.length),
  ].join("  ");
  return [header, separator, ...tableRows.map(renderRow)].join("\n");
};

export const formatEnvironmentValidationTable = (result: EnvironmentValidationResult) =>
  [
    result.ok
      ? "Environment variable validation passed."
      : "Environment variable validation failed.",
    "",
    formatRows(result.rows),
  ].join("\n");

export const validateEnvironmentForStartup = (options?: { readonly printWhenValid?: boolean }) =>
  Effect.gen(function* () {
    const result = validateEnvironmentVariables(process.env);
    if (!result.ok || options?.printWhenValid === true) {
      yield* Console.log(formatEnvironmentValidationTable(result));
    }
    if (!result.ok) {
      return yield* new EnvironmentValidationError({
        message: "Invalid server environment variables.",
      });
    }
  });

export const isValidateConfigEnabled = (value: Option.Option<boolean> | undefined) =>
  Option.getOrElse(value ?? Option.none(), () => false);
