import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";

import { CheckpointPrunerLive } from "../checkpointing/Layers/CheckpointPruner.ts";
import { CheckpointPruner } from "../checkpointing/Services/CheckpointPruner.ts";
import { ServerConfig } from "../config.ts";
import { ProjectionCheckpointRepositoryLive } from "../persistence/Layers/ProjectionCheckpoints.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { resolveCliAuthConfig, type CliAuthLocationFlags } from "./config.ts";

const daysFlag = Flag.integer("days").pipe(
  Flag.withDescription("Retention period in days. Defaults to 7."),
  Flag.optional,
);

const checkpointRepositoryLayer = ProjectionCheckpointRepositoryLive.pipe(
  Layer.provide(SqlitePersistenceLayerLive),
);

const checkpointRuntimeLayer = CheckpointPrunerLive.pipe(
  Layer.provide(checkpointRepositoryLayer),
);

const runCheckpointPrune = (
  flags: CliAuthLocationFlags & { readonly days: Option.Option<number> },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const result = yield* Effect.gen(function* () {
      const pruner = yield* CheckpointPruner;
      const retentionDays = Option.getOrUndefined(flags.days);
      return yield* pruner.pruneSnapshots(
        retentionDays === undefined ? {} : { retentionDays },
      );
    }).pipe(
      Effect.provide(
        checkpointRuntimeLayer.pipe(Layer.provide(Layer.succeed(ServerConfig, config))),
      ),
    );
    yield* Console.log(
      `Pruned ${result.snapshotsDeleted} checkpoint snapshots; freed approximately ` +
        `${result.bytesFreed} bytes in ${result.durationMs}ms (retention: ${result.retentionDays} days).`,
    );
  });

const pruneCommand = Command.make("prune", {
  baseDir: Flag.string("base-dir").pipe(Flag.withDescription("Base directory path."), Flag.optional),
  days: daysFlag,
}).pipe(
  Command.withDescription("Prune old checkpoint snapshots from SQLite projections."),
  Command.withHandler((flags) => runCheckpointPrune(flags) as Effect.Effect<void, never, never>),
);

export const checkpointCommand = Command.make("checkpoint").pipe(
  Command.withDescription("Manage checkpoint snapshots."),
  Command.withSubcommands([pruneCommand]),
) as unknown as Command.Command<"checkpoint", unknown, unknown, never, never>;
