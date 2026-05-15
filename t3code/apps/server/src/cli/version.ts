import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import packageJson from "../package.json" with { type: "json" };

const runtimeInfo = Effect.gen(function* () {
  const runtime = typeof Bun !== "undefined"
    ? `bun ${Bun.version}`
    : typeof process !== "undefined"
      ? `node ${process.version}`
      : "unknown";
  const platform = typeof process !== "undefined"
    ? `${process.platform} ${process.arch}`
    : "unknown";
  return { runtime, platform };
});

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Output version, runtime, and platform information."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const info = yield* runtimeInfo;
      yield* Console.log(
        `t3 v${packageJson.version} (${info.runtime}, ${info.platform})`,
      );
    }),
  ),
);
