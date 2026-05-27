import * as Console from "effect/Console";
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
const cliName = "t3code";

const runtimeLabel = () =>
  typeof process.versions.bun === "string"
    ? `bun ${process.versions.bun}`
    : `node ${process.versions.node}`;

export const cliPackageVersion = packageJson.version;
export const cliVersionString = `${cliName} v${packageJson.version}`;
export const cliRootVersionString = `t3 v${packageJson.version}`;
export const cliDetailedVersionString = (
  runtime = runtimeLabel(),
  platform = process.platform,
  arch = process.arch,
) => `${cliVersionString} (${runtime}, ${platform} ${arch})`;

const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print the installed T3 Code CLI version."),
  Command.withHandler(() => Console.log(cliDetailedVersionString())),
);

export const cli = Command.make("t3", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the T3 Code server."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([startCommand, serveCommand, authCommand, projectCommand, versionCommand]),
);

if (import.meta.main) {
  Command.run(cli, { version: cliPackageVersion }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
