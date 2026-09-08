import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { formatValidationTable, validateProcessEnv } from "../envValidation.ts";
import { runServer } from "../server.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

class InvalidConfigError extends Data.TaggedError("InvalidConfigError")<{
  readonly failures: number;
}> {}

const failInvalidConfig = (failures: number) => {
  process.exitCode = 1;
  return Effect.fail(new InvalidConfigError({ failures }));
};

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const report = validateProcessEnv();
    if (Option.getOrElse(flags.validateConfig ?? Option.none(), () => false)) {
      yield* Console.log(formatValidationTable(report.rows));
      if (!report.ok) {
        return yield* failInvalidConfig(report.rows.filter((r) => r.status === "invalid").length);
      }
      return;
    }
    if (!report.ok) {
      yield* Console.log(formatValidationTable(report.rows));
      return yield* failInvalidConfig(report.rows.filter((r) => r.status === "invalid").length);
    }
    const logLevel = yield* GlobalFlag.LogLevel;
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
