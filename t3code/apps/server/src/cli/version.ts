import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };

const platform = typeof process !== "undefined"
  ? process.platform
  : typeof navigator !== "undefined"
    ? "unknown"
    : "unknown";

const arch = typeof process !== "undefined"
  ? process.arch
  : "unknown";

const runtime = typeof Bun !== "undefined"
  ? un 
  : 
ode ;

const versionString = ${packageJson.name ?? "t3code"} v (,  );

const versionHandler = Effect.fn(function* () {
  yield* Console.log(versionString);
});

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Output version, runtime, platform, and architecture info."),
  Command.withHandler(() => versionHandler),
);
