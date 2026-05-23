import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";
import packageJson from "../../package.json" with { type: "json" };

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Show the T3 Code version"),
  Command.withHandler(() =>
    Effect.sync(() => {
      console.log("T3 Code v" + packageJson.version);
      console.log("Runtime: " + (typeof Bun !== "undefined" ? "Bun" : "Node") + " " + process.version);
      console.log("Platform: " + process.platform + " " + process.arch);
    })
  ),
);