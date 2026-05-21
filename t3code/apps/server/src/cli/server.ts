import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { runServer } from "../server.ts";
import {
  type CliServerFlags,
  resolveServerConfig,
  sharedServerCommandFlags,
  validateEnvironmentVars,
} from "./config.ts";

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;

    // Validate config and exit early if --validate-config is set
    if (Option.isSome(flags.validateConfig) && flags.validateConfig) {
      const { valid, results } = validateEnvironmentVars();
      console.log("\n=== Environment Variable Validation ===\n");
      for (const r of results) {
        const status = r.error
          ? `\x1b[31mINVALID\x1b[0m: ${r.error}`
          : r.present
            ? "\x1b[32mOK\x1b[0m"
            : r.required
              ? "\x1b[31mMISSING (required)\x1b[0m"
              : "\x1b[33mnot set\x1b[0m";
        console.log(`  ${r.key.padEnd(40)} ${status} — ${r.description}`);
      }
      console.log("");
      if (!valid) {
        console.log("Validation FAILED. Missing or invalid required variables.\n");
        process.exit(1);
      } else {
        console.log("Validation PASSED. All required variables are present and valid.\n");
        process.exit(0);
      }
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
