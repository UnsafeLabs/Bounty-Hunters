import * as Effect from "effect/Effect";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { runServer } from "../server.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";
import { validateEnvVars, formatValidationTable } from "./env-validation.ts";

const validateConfigFlag = Flag.boolean("validate-config").pipe(
  Flag.withDescription("Validate environment variables and exit without starting the server."),
);

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
    readonly validateConfig?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;

    // Validate env vars before starting
    const envResult = validateEnvVars();
    if (!envResult.valid) {
      const table = formatValidationTable(envResult);
      yield* Effect.logError(table);
      return yield* Effect.fail(new Error("Environment variable validation failed"));
    }

    // If --validate-config, print success and exit
    if (options?.validateConfig) {
      const table = formatValidationTable(envResult);
      yield* Effect.logInfo(table);
      return;
    }

    const config = yield* resolveServerConfig(flags, logLevel, options);
    return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
  });

export const startCommand = Command.make("start", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the T3 Code server."),
  Command.withHandler((flags) => runServerCommand(flags)),
);

export const serveCommand = Command.make("serve", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription(
    "Run the T3 Code server without opening a browser and print headless pairing details.",
  ),
  Command.withHandler((flags) =>
    runServerCommand(flags, {
      startupPresentation: "headless",
      forceAutoBootstrapProjectFromCwd: false,
    }),
  ),
);

export const validateConfigCommand = Command.make("validate-config", {
  ...sharedServerCommandFlags,
  "validate-config": validateConfigFlag,
}).pipe(
  Command.withDescription("Validate environment variables and exit without starting the server."),
  Command.withHandler((flags) => runServerCommand(flags, { validateConfig: true })),
);
