import * as Console from "effect/Console";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

export interface VersionInfo {
  readonly version: string;
  readonly runtimeName: "bun" | "node";
  readonly runtimeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
}

export const getVersionInfo = (): VersionInfo => {
  const versions = process.versions as NodeJS.ProcessVersions & { readonly bun?: string };
  const runtimeName = versions.bun === undefined ? "node" : "bun";

  return {
    version: packageJson.version,
    runtimeName,
    runtimeVersion: versions.bun ?? versions.node,
    platform: process.platform,
    arch: process.arch,
  };
};

export const formatVersionInfo = (info: VersionInfo) =>
  `t3code v${info.version} (${info.runtimeName} ${info.runtimeVersion}, ${info.platform} ${info.arch})`;

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print detailed T3 Code CLI version information."),
  Command.withHandler(() => Console.log(formatVersionInfo(getVersionInfo()))),
);
