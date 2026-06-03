import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print detailed version and environment information."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.versions.node}`;
      const platform = process.platform;
      const arch = process.arch;
      yield* Console.log(`t3code v${packageJson.version} (${runtime}, ${platform} ${arch})`);
    }),
  ),
);
