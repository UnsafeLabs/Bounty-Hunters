import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { runServer } from "../server.ts";
import {
  type CliServerFlags,
  formatServerEnvironmentValidation,
  resolveServerConfig,
  sharedServerCommandFlags,
  validateServerEnvironment,
} from "./config.ts";

class ServerEnvironmentValidationError extends Data.TaggedError(
  "ServerEnvironmentValidationError",
)<{
  readonly message: string;
}> {}

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const validation = validateServerEnvironment(process.env);
    const shouldValidateOnly = Option.getOrElse(flags.validateConfig, () => false);

    if (validation.hasErrors) {
      yield* Console.log(formatServerEnvironmentValidation(validation));
      return yield* new ServerEnvironmentValidationError({
        message: "Server environment validation failed before startup.",
      });
    }

    if (shouldValidateOnly) {
      yield* Console.log(formatServerEnvironmentValidation(validation));
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
