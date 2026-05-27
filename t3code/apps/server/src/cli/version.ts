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

export const getVersionInfo = (version = packageJson.version): VersionInfo => {
  const versions = process.versions as NodeJS.ProcessVersions & { readonly bun?: string };
  const runtimeName = versions.bun === undefined ? "node" : "bun";

  return {
    version,
    runtimeName,
    runtimeVersion: versions.bun ?? versions.node,
    platform: process.platform,
    arch: process.arch,
  };
};

const formatRuntimeInfo = (info: VersionInfo) =>
  `${info.runtimeName} ${info.runtimeVersion}, ${info.platform} ${info.arch}`;

export const formatCliVersionOption = (info: VersionInfo) =>
  `${info.version} (${formatRuntimeInfo(info)})`;

export const formatVersionInfo = (info: VersionInfo) =>
  `t3code v${info.version} (${formatRuntimeInfo(info)})`;

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print detailed T3 Code CLI version information."),
  Command.withHandler(() => Console.log(formatVersionInfo(getVersionInfo()))),
);
