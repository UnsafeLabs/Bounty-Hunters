import * as Console from "effect/Console";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

export type VersionInfo = {
  readonly version: string;
  readonly runtime: string;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly arch: string;
};

export const formatVersionInfo = (info: VersionInfo) =>
  `t3code v${info.version} (${info.runtime} ${info.runtimeVersion}, ${info.platform} ${info.arch})`;

const detectRuntime = (): Pick<VersionInfo, "runtime" | "runtimeVersion"> => {
  const bunVersion = process.versions.bun;
  if (bunVersion !== undefined) {
    return { runtime: "bun", runtimeVersion: bunVersion };
  }
  return { runtime: "node", runtimeVersion: process.versions.node };
};

const currentVersionInfo = (): VersionInfo => ({
  version: packageJson.version,
  ...detectRuntime(),
  platform: process.platform,
  arch: process.arch,
});

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print the installed T3 Code version and runtime details."),
  Command.withHandler(() => Console.log(formatVersionInfo(currentVersionInfo()))),
);
