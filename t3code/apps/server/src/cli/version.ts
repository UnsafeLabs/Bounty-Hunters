import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import packageJson from "../package.json" with { type: "json" };

function getRuntimeInfo(): string {
  // Detect runtime
  let runtime = "unknown";
  let runtimeVersion = "";

  if (typeof globalThis.Bun !== "undefined") {
    runtime = "bun";
    runtimeVersion = globalThis.Bun.version;
  } else if (typeof process !== "undefined") {
    runtime = "node";
    runtimeVersion = process.version;
  }

  // Get platform and architecture
  const platform = typeof process !== "undefined" ? process.platform : "unknown";
  const arch = typeof process !== "undefined" ? process.arch : "unknown";

  return `t3 v${packageJson.version} (${runtime} ${runtimeVersion}, ${platform} ${arch})`;
}

export const versionCommand = Command.make("version").pipe(
  Command.withDescription("Display version, runtime, and platform information."),
  Command.withHandler(() =>
    Effect.gen(function* () {
      yield* Console.log(getRuntimeInfo());
    })
  ),
);
