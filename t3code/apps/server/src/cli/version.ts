import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { Command } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
const platform = `${process.platform} ${process.arch}`;

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Show detailed version information."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      yield* Console.log(`t3code v${packageJson.version} (${runtime}, ${platform})`);
    }),
  ),
);
