import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print detailed version information including runtime and platform."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const output = `t3code v${packageJson.version} (${runtime}, ${process.platform} ${process.arch})`;
      yield* Console.log(output);
    }),
  ),
);
