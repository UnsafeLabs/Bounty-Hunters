import { Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

const version = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch { return "0.0.0"; }
})();

const runtimeInfo = () => {
  const rt = typeof Bun !== "undefined" ? "bun" : "node";
  const ver = rt === "bun" ? (Bun as any).version : process.version;
  const platform = process.platform;
  const arch = process.arch;
  return `t3code v${version} (${rt} ${ver}, ${platform} ${arch})`;
};

const versionFlag = Options.boolean("version").pipe(
  Options.withAlias("V")
);

const versionCmd = Command.make("version", {}, () =>
  Effect.sync(() => {
    console.log(runtimeInfo());
  })
);

const startCmd = Command.make("start", {}, () => Effect.log("start"));
const serveCmd = Command.make("serve", {}, () => Effect.log("serve"));
const authCmd = Command.make("auth", {}, () => Effect.log("auth"));
const projectCmd = Command.make("project", {}, () => Effect.log("project"));

const rootCmd = Command.make("t3", {
  version: versionFlag,
}).pipe(
  Command.withSubcommands([versionCmd, startCmd, serveCmd, authCmd, projectCmd]),
  Command.withHandler(({ version: showVersion }) =>
    Effect.gen(function* () {
      if (showVersion) {
        console.log(runtimeInfo());
        return;
      }
      console.log(runtimeInfo());
    })
  )
);

const cli = Command.run(rootCmd, {
  name: "t3code",
  version,
});

cli(process.argv);