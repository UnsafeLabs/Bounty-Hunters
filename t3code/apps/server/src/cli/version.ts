import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };

const getRuntimeName = (): string => {
  if (typeof Bun !== "undefined") return "bun";
  return "node";
};

const getRuntimeVersion = (): string => {
  if (typeof Bun !== "undefined") return Bun.version;
  return process.version.replace(/^v/, "");
};

const getPlatformString = (): string => {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform} ${arch}`;
};

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Show version information"),
  Command.withHandler(() =>
    Effect.sync(() => {
      const runtime = getRuntimeName();
      const runtimeVersion = getRuntimeVersion();
      const platform = getPlatformString();
      process.stdout.write(
        `t3code v${packageJson.version} (${runtime} ${runtimeVersion}, ${platform})\n`,
      );
    }),
  ),
);
