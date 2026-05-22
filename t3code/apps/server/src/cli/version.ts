import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import packageJson from "../package.json" with { type: "json" };

const getVersionString = Effect.sync(() => {
  const runtime = process.release?.name ?? "node";
  const runtimeVersion = process.version;
  const platform = process.platform;
  const arch = process.arch;
  return `t3 v${packageJson.version} (${runtime} ${runtimeVersion}, ${platform} ${arch})`;
});

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print version information."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const line = yield* getVersionString;
      yield* Console.log(line);
    }),
  ),
);
