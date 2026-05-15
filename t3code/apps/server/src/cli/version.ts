import * as Console from "effect/Console";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

export function runtimeLabel(versions: NodeJS.ProcessVersions = process.versions): string {
  const bunVersion = versions.bun;
  if (typeof bunVersion === "string" && bunVersion.length > 0) {
    return `bun ${bunVersion}`;
  }
  return `node ${versions.node}`;
}

export function formatVersionInfo(input: {
  readonly version: string;
  readonly runtime: string;
  readonly platform: NodeJS.Platform | string;
  readonly arch: NodeJS.Architecture | string;
}): string {
  return `t3code v${input.version} (${input.runtime}, ${input.platform} ${input.arch})`;
}

export const currentVersionInfo = () =>
  formatVersionInfo({
    version: packageJson.version,
    runtime: runtimeLabel(),
    platform: process.platform,
    arch: process.arch,
  });

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print T3 Code version and runtime details."),
  Command.withHandler(() => Console.log(currentVersionInfo())),
);
