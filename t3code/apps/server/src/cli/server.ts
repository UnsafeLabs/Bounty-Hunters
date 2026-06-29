import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { runServer } from "../server.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";
import {
  assertValidServerEnvironment,
  formatServerEnvironmentValidationTable,
  ServerEnvironmentValidationError,
} from "./envValidation.ts";

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const normalizedValidateConfig = flags.validateConfig ?? Option.none();
    const validation = yield* Effect.try({
      try: () => assertValidServerEnvironment(),
      catch: (error) => error,
    });
    const config = yield* resolveServerConfig(flags, logLevel, options);
    if (Option.getOrElse(normalizedValidateConfig, () => false)) {
      yield* Console.log(formatServerEnvironmentValidationTable(validation));
      return;
    }
    return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
  }).pipe(
    Effect.catchIf(
      (error): error is ServerEnvironmentValidationError =>
        error instanceof ServerEnvironmentValidationError,
      (error) =>
        Effect.gen(function* () {
          yield* Console.error(
            formatServerEnvironmentValidationTable(error.result, {
              onlyProblems: true,
            }),
          );
          return yield* Effect.fail(error);
        }),
    ),
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
