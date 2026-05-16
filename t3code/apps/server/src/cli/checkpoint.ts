import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig } from "../config.ts";
import { CheckpointStoreLive } from "../checkpointing/Layers/CheckpointStore.ts";
import { CheckpointStore } from "../checkpointing/Services/CheckpointStore.ts";
import { VcsDriverRegistry } from "../vcs/VcsDriverRegistry.ts";
import { VcsProcess } from "../vcs/VcsProcess.ts";
import { resolveCliAuthConfig, type CliAuthLocationFlags } from "./config.ts";

const runWithCheckpointStore = <A, E>(
  flags: CliAuthLocationFlags,
  run: (checkpointStore: CheckpointStore) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const minimumLogLevel = logLevel;
    return yield* Effect.gen(function* () {
      const checkpointStore = yield* CheckpointStore;
      return yield* run(checkpointStore);
    }).pipe(
      Effect.provide(
        CheckpointStoreLive.pipe(
          Layer.provideMerge(VcsDriverRegistry.layer),
          Layer.provideMerge(VcsProcess.layer),
          Layer.provide(Layer.succeed(ServerConfig, config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
        ),
      ),
    );
  });

const daysFlag = Flag.integer("days").pipe(
  Flag.withDescription("Retention period in days (default: 7). Snapshots older than this are pruned."),
  Flag.withDefault(7),
  Flag.optional,
);

const cwdArg = Argument.string("cwd").pipe(
  Argument.withDescription("Working directory of the repository to prune checkpoints in."),
  Argument.optional,
);

const checkpointPruneCommand = Command.make("prune", {
  days: daysFlag,
  cwd: cwdArg,
}).pipe(
  Command.withDescription("Prune old checkpoint snapshots beyond the retention period."),
  Command.withHandler((flags) =>
    runWithCheckpointStore(
      { baseDir: Option.none() },
      (checkpointStore) =>
        Effect.gen(function* () {
          const cwd = Option.getOrElse(flags.cwd, () => process.cwd());
          const days = Option.getOrElse(flags.days, () => 7);

          const result = yield* checkpointStore.pruneSnapshots({
            cwd,
            retentionDays: days,
          });

          yield* Console.log(
            [
              `Pruned ${result.snapshotsDeleted} checkpoint snapshot(s).`,
              `Freed approximately ${(result.bytesFreed / 1024).toFixed(1)} KB.`,
              `Completed in ${result.durationMs} ms.`,
            ].join("\n"),
          );
        }),
    ),
  ),
);

export const checkpointCommand = Command.make("checkpoint").pipe(
  Command.withDescription("Manage checkpoints."),
  Command.withSubcommands([checkpointPruneCommand]),
);
