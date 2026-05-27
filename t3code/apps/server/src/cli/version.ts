import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print the server version"),
  Command.withHandler(() =>
    Effect.sync(() => {
      // biome-ignore lint/suspicious/noConsole: CLI version output
      console.log(packageJson.version);
    }),
  ),
);
