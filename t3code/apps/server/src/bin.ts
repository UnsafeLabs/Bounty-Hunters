import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
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

export type CliRuntimeInfo = {
  readonly name: "bun" | "node";
  readonly version: string;
};

export const formatVersionInfo = (input: {
  readonly version: string;
  readonly runtime: CliRuntimeInfo;
  readonly platform: string;
  readonly arch: string;
}) =>
  `t3code v${input.version} (${input.runtime.name} ${input.runtime.version}, ${input.platform} ${input.arch})`;

const getRuntimeInfo = (): CliRuntimeInfo => {
  const bunVersion = (globalThis as { readonly Bun?: { readonly version?: string } }).Bun
    ?.version;
  if (typeof bunVersion === "string" && bunVersion.length > 0) {
    return { name: "bun", version: bunVersion };
  }
  return { name: "node", version: process.versions.node };
};

export const getVersionInfo = () =>
  formatVersionInfo({
    version: packageJson.version,
    runtime: getRuntimeInfo(),
    platform: process.platform,
    arch: process.arch,
  });

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print the T3 Code version and runtime information."),
  Command.withHandler(() => Console.log(getVersionInfo())),
);

export const cli = Command.make("t3", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the T3 Code server."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([startCommand, serveCommand, authCommand, projectCommand, versionCommand]),
);

if (import.meta.main) {
  Command.run(cli, { version: getVersionInfo() }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
