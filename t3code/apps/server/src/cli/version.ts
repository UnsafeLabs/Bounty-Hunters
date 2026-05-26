import * as Console from "effect/Console";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

export type CliVersionRuntimeInfo = {
  readonly name: "bun" | "node";
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
};

export const getCliVersionRuntimeInfo = (): CliVersionRuntimeInfo => {
  const bunRuntime = (globalThis as { readonly Bun?: { readonly version?: string } }).Bun;
  return {
    name: bunRuntime ? "bun" : "node",
    version: bunRuntime?.version ?? process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };
};

export const formatCliVersionValue = (
  version: string = packageJson.version,
  runtime: CliVersionRuntimeInfo = getCliVersionRuntimeInfo(),
) => `${version} (${runtime.name} ${runtime.version}, ${runtime.platform} ${runtime.arch})`;

export const formatCliVersionInfo = (
  version: string = packageJson.version,
  runtime: CliVersionRuntimeInfo = getCliVersionRuntimeInfo(),
) => `t3code v${formatCliVersionValue(version, runtime)}`;

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print T3 Code version information."),
  Command.withHandler(() => Console.log(formatCliVersionInfo())),
);
