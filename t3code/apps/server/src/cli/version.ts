import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print version information."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const version = packageJson.version;
      const runtime = typeof Bun !== "undefined"
        ? `bun ${Bun.version}`
        : `node ${process.version}`;
      const platform = `${process.platform} ${process.arch}`;
      yield* Console.log(`${packageJson.name} v${version} (${runtime}, ${platform})`);
    }),
  ),
);

export { versionCommand };
