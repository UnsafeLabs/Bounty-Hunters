import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import * as NetService from "@t3tools/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import { authCommand } from "./cli/auth.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { projectCommand } from "./cli/project.ts";
import { runServerCommand, serveCommand, startCommand } from "./cli/server.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

function getRuntimeLabel(): string {
  // @ts-expect-error Bun global
  if (typeof Bun !== "undefined") {
    // @ts-expect-error Bun global
    return `bun ${Bun.version}`;
  }
  return `node ${process.version}`;
}

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print detailed version information"),
  Command.withHandler(() => {
    const runtime = getRuntimeLabel();
    const platform = process.platform;
    const arch = process.arch;
    const label = `t3code v${packageJson.version} (${runtime}, ${platform} ${arch})`;
    return Effect.sync(() => {
      console.log(label);
    });
  }),
);

export const cli = Command.make("t3", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the T3 Code server."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([startCommand, serveCommand, authCommand, projectCommand, versionCommand]),
);

if (import.meta.main) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
