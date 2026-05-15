import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

import { ProjectionCheckpointRepository } from "../../persistence/Services/ProjectionCheckpoints.ts";
import {
  CheckpointPruningError,
  CheckpointPruningService,
  defaultPruningConfig,
  type CheckpointPruningConfig,
  type CheckpointPruningServiceShape,
  type PruningMetrics,
} from "../Services/CheckpointPruningService.ts";

const toPruningError =
  (message: string) =>
  (cause: unknown) =>
    new CheckpointPruningError(message, cause);

export const makeCheckpointPruningService = Effect.gen(function* () {
  const checkpointRepo = yield* ProjectionCheckpointRepository;

  const pruneSnapshots: CheckpointPruningServiceShape["pruneSnapshots"] = (
    configOverrides,
  ) =>
    Effect.gen(function* () {
      const startMs = yield* Clock.currentTimeMillis;
      const config: CheckpointPruningConfig = {
        ...defaultPruningConfig,
        ...configOverrides,
      };

      const cutoffDate = yield* Effect.sync(() =>
        DateTime.unsafeMake(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000),
      );

      const threads = yield* checkpointRepo.listOlderThan({ cutoff: cutoffDate }).pipe(
        Effect.mapError(toPruningError("Failed to query old checkpoints")),
      );

      let totalDeleted = 0;
      let threadsProcessed = 0;

      for (const thread of threads) {
        const allCheckpoints = yield* checkpointRepo.listByThreadId({
          threadId: thread.threadId,
        });

        if (allCheckpoints.length <= config.minSnapshotsPerThread) {
          continue;
        }

        const toKeep = new Set(
          allCheckpoints
            .slice(-config.minSnapshotsPerThread)
            .map((c) => c.checkpointTurnCount),
        );

        const toDelete = allCheckpoints.filter(
          (c) =>
            !toKeep.has(c.checkpointTurnCount) &&
            new Date(c.completedAt).getTime() < cutoffDate.epochMilliseconds,
        );

        if (toDelete.length > 0) {
          yield* checkpointRepo.deleteByThreadId({ threadId: thread.threadId }).pipe(
            Effect.mapError(toPruningError("Failed to delete old checkpoints")),
          );
          const kept = allCheckpoints.filter((c) => !toDelete.includes(c));
          for (const checkpoint of kept) {
            yield* checkpointRepo.upsert(checkpoint);
          }
          totalDeleted += toDelete.length;
        }

        threadsProcessed++;
      }

      const endMs = yield* Clock.currentTimeMillis;

      const metrics: PruningMetrics = {
        snapshotsDeleted: totalDeleted,
        threadsProcessed,
        durationMs: endMs - startMs,
      };

      yield* Effect.logInfo("Checkpoint pruning completed").pipe(
        Effect.annotateLogs(metrics),
      );

      return metrics;
    });

  const startScheduled: CheckpointPruningServiceShape["startScheduled"] = () =>
    Effect.gen(function* () {
      const fiber = yield* pruneSnapshots().pipe(
        Effect.retry(Schedule.exponential(Duration.seconds(1), 2)),
        Effect.repeat(Schedule.fixed(defaultPruningConfig.scheduleInterval)),
        Effect.forkDaemon,
      );

      yield* Effect.addFinalizer(() => Fiber.interrupt(fiber));
    });

  return { pruneSnapshots, startScheduled } satisfies CheckpointPruningServiceShape;
});

export const CheckpointPruningServiceLive = Layer.effect(
  CheckpointPruningService,
  makeCheckpointPruningService,
);
