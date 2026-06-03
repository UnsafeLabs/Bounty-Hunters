import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

// Runtime Mode Literals
export const RuntimeMode = Schema.Literals(["web", "desktop"]);

// Port Validation from string
export const PortFromString = Schema.NumberFromString.check(
  Schema.isBetween({ minimum: 0, maximum: 65535 })
);

// Custom Boolean string parser
export const BooleanFromString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transformOrFail({
      decode: (s) => {
        const val = s.toLowerCase().trim();
        if (val === "true" || val === "1") return Effect.succeed(true);
        if (val === "false" || val === "0") return Effect.succeed(false);
        return Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(s), {
            message: "Expected a boolean string ('true' or 'false')",
          })
        );
      },
      encode: (b) => Effect.succeed(String(b)),
    }),
  ),
);

// Log Level Literals
export const LogLevelSchema = Schema.Literals(["All", "Trace", "Debug", "Info", "Warning", "Error", "Fatal", "None"]);

export interface EnvVarDef {
  readonly name: string;
  readonly required: boolean;
  readonly typeDescription: string;
  readonly description: string;
  readonly defaultValue?: string;
  readonly schema?: Schema.Schema<any, any, any>;
}

export const ENV_VAR_DEFS: readonly EnvVarDef[] = [
  {
    name: "T3CODE_MODE",
    required: true,
    typeDescription: '"web" | "desktop"',
    description: "Runtime mode of the server.",
    schema: RuntimeMode,
  },
  {
    name: "T3CODE_HOME",
    required: true,
    typeDescription: "string",
    description: "Base directory path for server configuration and state.",
    schema: Schema.String.check(Schema.isNonEmpty()),
  },
  {
    name: "T3CODE_PORT",
    required: false,
    typeDescription: "integer (0-65535)",
    description: "Port for the HTTP/WebSocket server.",
    defaultValue: "3773",
    schema: PortFromString,
  },
  {
    name: "T3CODE_LOG_LEVEL",
    required: false,
    typeDescription: '"All" | "Trace" | "Debug" | "Info" | "Warning" | "Error" | "Fatal" | "None"',
    description: "Minimum log level for console outputs.",
    defaultValue: "Info",
    schema: LogLevelSchema,
  },
  {
    name: "T3CODE_TRACE_MIN_LEVEL",
    required: false,
    typeDescription: '"All" | "Trace" | "Debug" | "Info" | "Warning" | "Error" | "Fatal" | "None"',
    description: "Minimum log level for traces.",
    defaultValue: "Info",
    schema: LogLevelSchema,
  },
  {
    name: "T3CODE_TRACE_TIMING_ENABLED",
    required: false,
    typeDescription: "boolean",
    description: "Enable or disable trace timing metrics.",
    defaultValue: "true",
    schema: BooleanFromString,
  },
  {
    name: "T3CODE_TRACE_FILE",
    required: false,
    typeDescription: "string",
    description: "Custom path for the server trace file.",
    schema: Schema.String,
  },
  {
    name: "T3CODE_TRACE_MAX_BYTES",
    required: false,
    typeDescription: "integer",
    description: "Maximum bytes per trace file before rotation.",
    defaultValue: "10485760 (10MB)",
    schema: Schema.NumberFromString,
  },
  {
    name: "T3CODE_TRACE_MAX_FILES",
    required: false,
    typeDescription: "integer",
    description: "Maximum number of rotated trace files to keep.",
    defaultValue: "10",
    schema: Schema.NumberFromString,
  },
  {
    name: "T3CODE_TRACE_BATCH_WINDOW_MS",
    required: false,
    typeDescription: "integer",
    description: "Batching window in milliseconds for trace exports.",
    defaultValue: "200",
    schema: Schema.NumberFromString,
  },
  {
    name: "T3CODE_OTLP_TRACES_URL",
    required: false,
    typeDescription: "URL",
    description: "OTLP endpoint URL for trace export.",
    schema: Schema.URLFromString,
  },
  {
    name: "T3CODE_OTLP_METRICS_URL",
    required: false,
    typeDescription: "URL",
    description: "OTLP endpoint URL for metrics export.",
    schema: Schema.URLFromString,
  },
  {
    name: "T3CODE_OTLP_EXPORT_INTERVAL_MS",
    required: false,
    typeDescription: "integer",
    description: "Interval in milliseconds for OTLP export.",
    defaultValue: "10000",
    schema: Schema.NumberFromString,
  },
  {
    name: "T3CODE_OTLP_SERVICE_NAME",
    required: false,
    typeDescription: "string",
    description: "Service name reported in OTLP traces.",
    defaultValue: "t3-server",
    schema: Schema.String,
  },
  {
    name: "T3CODE_HOST",
    required: false,
    typeDescription: "string",
    description: "Host or interface IP to bind the listener to.",
    schema: Schema.String,
  },
  {
    name: "VITE_DEV_SERVER_URL",
    required: false,
    typeDescription: "URL",
    description: "Dev server URL to redirect/proxy to.",
    schema: Schema.URLFromString,
  },
  {
    name: "T3CODE_NO_BROWSER",
    required: false,
    typeDescription: "boolean",
    description: "Disable automatic browser opening on startup.",
    defaultValue: "false (desktop defaults to true)",
    schema: BooleanFromString,
  },
  {
    name: "T3CODE_BOOTSTRAP_FD",
    required: false,
    typeDescription: "integer",
    description: "File descriptor to read bootstrap config from.",
    schema: Schema.NumberFromString,
  },
  {
    name: "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    required: false,
    typeDescription: "boolean",
    description: "Auto-bootstrap project structure if missing from CWD.",
    defaultValue: "true (desktop defaults to false)",
    schema: BooleanFromString,
  },
  {
    name: "T3CODE_LOG_WS_EVENTS",
    required: false,
    typeDescription: "boolean",
    description: "Log WebSocket push event metadata.",
    defaultValue: "false (defaults to true if devUrl is set)",
    schema: BooleanFromString,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE",
    required: false,
    typeDescription: "boolean",
    description: "Expose server via Tailscale Serve.",
    defaultValue: "false",
    schema: BooleanFromString,
  },
  {
    name: "T3CODE_TAILSCALE_SERVE_PORT",
    required: false,
    typeDescription: "integer (0-65535)",
    description: "Port for Tailscale Serve.",
    defaultValue: "443",
    schema: PortFromString,
  },
];

export interface ValidationResult {
  readonly def: EnvVarDef;
  readonly value: string | undefined;
  readonly status: "valid" | "missing" | "invalid" | "default_used";
  readonly error?: string;
}

export const validateEnvironment = (env: Record<string, string | undefined>): ValidationResult[] => {
  return ENV_VAR_DEFS.map((def) => {
    const rawVal = env[def.name];
    if (rawVal === undefined || rawVal === "") {
      if (def.required) {
        return {
          def,
          value: rawVal,
          status: "missing",
          error: "Missing required environment variable",
        };
      }
      return {
        def,
        value: rawVal,
        status: "default_used",
      };
    }

    if (def.schema) {
      try {
        Schema.decodeUnknownSync(def.schema)(rawVal);
        return {
          def,
          value: rawVal,
          status: "valid",
        };
      } catch (e: any) {
        let errMsg = e.message || String(e);
        // Simplify error messages from effect schema for nice clean table printing
        if (errMsg.includes("Expected")) {
          const match = errMsg.match(/Expected (.*?),/);
          if (match && match[1]) {
            errMsg = `Expected ${match[1]}`;
          }
        }
        return {
          def,
          value: rawVal,
          status: "invalid",
          error: errMsg,
        };
      }
    }

    return {
      def,
      value: rawVal,
      status: "valid",
    };
  });
};

export const printValidationTable = (results: ValidationResult[]): void => {
  const headers = ["Variable", "Req?", "Expected Type", "Default", "Status / Value", "Description"];
  
  const rows = results.map((r) => {
    let statusText = "";
    if (r.status === "valid") {
      statusText = `Valid: ${r.value}`;
    } else if (r.status === "missing") {
      statusText = "❌ MISSING";
    } else if (r.status === "invalid") {
      statusText = `❌ INVALID (Expected ${r.def.typeDescription}, got: "${r.value}")`;
    } else if (r.status === "default_used") {
      statusText = `Default: ${r.def.defaultValue ?? "-"}`;
    }

    return [
      r.def.name,
      r.def.required ? "Yes" : "No",
      r.def.typeDescription,
      r.def.defaultValue ?? "-",
      statusText,
      r.def.description,
    ];
  });

  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, colIdx) => {
    return Math.max(...allRows.map((row) => String(row[colIdx]).length));
  });

  const drawLine = (left: string, mid: string, right: string, cap: string) => {
    return left + colWidths.map((w) => cap.repeat(w + 2)).join(mid) + right;
  };

  const drawRow = (row: string[]) => {
    return "│ " + row.map((cell, colIdx) => cell.padEnd(colWidths[colIdx]!)).join(" │ ") + " │";
  };

  console.log(drawLine("┌", "┬", "┐", "─"));
  console.log(drawRow(headers));
  console.log(drawLine("├", "┼", "┤", "─"));
  for (const row of rows) {
    console.log(drawRow(row));
  }
  console.log(drawLine("└", "┴", "┘", "─"));
};

export const runConfigValidationOrExit = (flags: {
  readonly validateConfig?: Option.Option<boolean>;
}): Effect.Effect<void> =>
  Effect.sync(() => {
    const isValidateOnly = Option.getOrElse(flags.validateConfig ?? Option.none(), () => false);
    const results = validateEnvironment(process.env);
    const hasFailures = results.some((r) => r.status === "missing" || r.status === "invalid");

    if (hasFailures || isValidateOnly) {
      console.log("\nEnvironment configuration validation:");
      printValidationTable(results);
      
      if (hasFailures) {
        console.error("❌ Environment validation failed. Missing or invalid variables.\n");
        // Avoid calling process.exit in test runs to prevent test runners from exiting
        if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
          process.exit(1);
        } else {
          throw new Error("Environment validation failed");
        }
      } else {
        console.log("✅ Environment validation succeeded!\n");
        if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
          process.exit(0);
        }
      }
    }
  });
