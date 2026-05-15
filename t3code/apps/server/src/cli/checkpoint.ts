import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";

import { CheckpointStoreLive } from "../checkpointing/Layers/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import {
  CheckpointSnapshotPruner,
  CheckpointSnapshotPrunerLive,
  DEFAULT_CHECKPOINT_SNAPSHOT_RETENTION_DAYS,
} from "../orchestration/checkpoint/CheckpointSnapshotPruner.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { projectLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

const daysFlag = Flag.integer("days").pipe(
  Flag.withDescription("Retention period in days for checkpoint snapshots."),
  Flag.withDefault(DEFAULT_CHECKPOINT_SNAPSHOT_RETENTION_DAYS),
);

const CheckpointStoreCliLayer = CheckpointStoreLive.pipe(Layer.provide(VcsDriverRegistry.layer));

const CheckpointPruneCliLayer = CheckpointSnapshotPrunerLive.pipe(
  Layer.provideMerge(CheckpointStoreCliLayer),
  Layer.provideMerge(SqlitePersistenceLayerLive),
  Layer.provideMerge(VcsProcess.layer),
);

const runCheckpointPruneCommand = (flags: CliAuthLocationFlags & { readonly days: number }) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);

    return yield* Effect.gen(function* () {
      const pruner = yield* CheckpointSnapshotPruner;
      const result = yield* pruner.pruneSnapshots({ retentionDays: flags.days });
      yield* Console.log(
        `Pruned ${result.snapshotsDeleted} checkpoint snapshots; freed ${result.bytesFreed} bytes in ${result.durationMs}ms.`,
      );
    }).pipe(
      Effect.provide(
        CheckpointPruneCliLayer.pipe(Layer.provide(Layer.succeed(ServerConfig, config))),
      ),
    );
  });

export const checkpointPruneCommand = Command.make("checkpoint:prune", {
  ...projectLocationFlags,
  days: daysFlag,
}).pipe(
  Command.withDescription("Prune old checkpoint snapshots."),
  Command.withHandler((flags) => runCheckpointPruneCommand(flags)),
);
