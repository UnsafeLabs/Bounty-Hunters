import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };

const runtimeVersion = (): string => {
  const versions = process.versions as NodeJS.ProcessVersions & { readonly bun?: string };

  if (versions.bun) {
    return `bun ${versions.bun}`;
  }

  return `node ${versions.node}`;
};

export const formatVersionInfo = (version: string = packageJson.version): string =>
  `t3code v${version} (${runtimeVersion()}, ${process.platform} ${process.arch})`;

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Print T3 Code version, runtime, platform, and architecture."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      yield* Console.log(formatVersionInfo());
    }),
  ),
);
