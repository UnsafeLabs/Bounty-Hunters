import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";

import { CheckpointPrunerLive } from "../checkpointing/Layers/CheckpointPruner.ts";
import { CheckpointStoreLive } from "../checkpointing/Layers/CheckpointStore.ts";
import {
  CheckpointPruner,
  type CheckpointPruneResult,
} from "../checkpointing/Services/CheckpointPruner.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProjectionCheckpointRepositoryLive } from "../persistence/Layers/ProjectionCheckpoints.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../project/Layers/RepositoryIdentityResolver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerLocationFlags } from "./config.ts";

const retentionDaysFlag = Flag.integer("days").pipe(
  Flag.withDescription("Delete checkpoints older than this many days."),
  Flag.withDefault(7),
);

const minimumKeepFlag = Flag.integer("keep").pipe(
  Flag.withDescription("Minimum recent checkpoints to keep per thread."),
  Flag.withDefault(3),
);

const CheckpointCliRuntimeLive = CheckpointPrunerLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      ProjectionCheckpointRepositoryLive,
      OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provide(RepositoryIdentityResolverLive)),
      CheckpointStoreLive.pipe(Layer.provide(VcsDriverRegistry.layer)),
    ),
  ),
  Layer.provideMerge(SqlitePersistenceLayerLive),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const runCheckpointPrune = (flags: {
  readonly baseDir: CliServerFlags["baseDir"];
  readonly devUrl: CliServerFlags["devUrl"];
  readonly days: number;
  readonly keep: number;
}) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveServerConfig(
      {
        mode: Option.none(),
        port: Option.none(),
        host: Option.none(),
        baseDir: flags.baseDir,
        cwd: Option.none(),
        devUrl: flags.devUrl,
        noBrowser: Option.none(),
        bootstrapFd: Option.none(),
        autoBootstrapProjectFromCwd: Option.none(),
        logWebSocketEvents: Option.none(),
        tailscaleServeEnabled: Option.none(),
        tailscaleServePort: Option.none(),
      },
      logLevel,
      {
        startupPresentation: "headless",
        forceAutoBootstrapProjectFromCwd: false,
      },
    );
    const pruneEffect = Effect.gen(function* () {
      const pruner = yield* CheckpointPruner;
      return yield* pruner.prune({
        retentionDays: flags.days,
        minimumCheckpointsPerThread: flags.keep,
      });
    }).pipe(
      Effect.provide(
        CheckpointCliRuntimeLive.pipe(
          Layer.provide(Layer.succeed(ServerConfig, config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
        ),
      ),
    ) as Effect.Effect<CheckpointPruneResult>;
    const result = yield* pruneEffect;

    yield* Console.log(
      [
        `Deleted ${result.snapshotsDeleted} checkpoint snapshot(s).`,
        `Cleared ${result.metadataRowsCleared} projection row(s).`,
        `Scanned ${result.threadsScanned} thread(s) across ${result.workspacesScanned} workspace(s).`,
        `Estimated bytes freed: ${result.estimatedBytesFreed}.`,
        `Duration: ${result.durationMs}ms.`,
        result.failures > 0 ? `Failures: ${result.failures}.` : "Failures: 0.",
      ].join("\n"),
    );
  });

const checkpointPruneCommand = Command.make("prune", {
  ...sharedServerLocationFlags,
  days: retentionDaysFlag,
  keep: minimumKeepFlag,
}).pipe(
  Command.withDescription("Prune old checkpoint snapshots while preserving recent snapshots."),
  Command.withHandler(runCheckpointPrune),
);

const checkpointCommandWithRuntime = Command.make("checkpoint").pipe(
  Command.withDescription("Manage checkpoint snapshots."),
  Command.withSubcommands([checkpointPruneCommand]),
);

export const checkpointCommand = checkpointCommandWithRuntime as Command.Command<
  "checkpoint",
  {},
  {},
  never,
  never
>;
