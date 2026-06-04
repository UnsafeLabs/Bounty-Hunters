import * as Console from "effect/Console";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

export function getRuntimeLabel(): string {
  const bunVersion = process.versions.bun;
  return bunVersion !== undefined ? `bun ${bunVersion}` : `node ${process.versions.node}`;
}

export function formatVersionInfo(input: {
  readonly version: string;
  readonly runtime: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
}): string {
  return `t3 v${input.version} (${input.runtime}, ${input.platform} ${input.arch})`;
}

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print T3 Code version and runtime details."),
  Command.withHandler(() =>
    Console.log(
      formatVersionInfo({
        version: packageJson.version,
        runtime: getRuntimeLabel(),
        platform: process.platform,
        arch: process.arch,
      }),
    ),
  ),
);
