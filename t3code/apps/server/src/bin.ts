import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Console from "effect/Console";
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

const detectRuntime = () => {
  const bunVersion = (
    globalThis as typeof globalThis & { readonly Bun?: { readonly version: string } }
  ).Bun?.version;
  return bunVersion ? `bun ${bunVersion}` : `node ${process.versions.node}`;
};

const formatVersionInfo = () =>
  `t3 v${packageJson.version} (${detectRuntime()}, ${process.platform} ${process.arch})`;

const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print T3 Code version and runtime information."),
  Command.withHandler(() => Console.log(formatVersionInfo())),
);

export const cli = Command.make("t3", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the T3 Code server."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([
    startCommand,
    serveCommand,
    authCommand,
    projectCommand,
    versionCommand,
  ]),
);

if (import.meta.main) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
