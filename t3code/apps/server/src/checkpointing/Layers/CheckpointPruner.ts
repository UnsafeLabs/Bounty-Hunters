import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { CheckpointPruner, type CheckpointPrunerShape } from "../Services/CheckpointPruner.ts";
import { ProjectionCheckpointRepository } from "../../persistence/Services/ProjectionCheckpoints.ts";

const DEFAULT_RETENTION_DAYS = 7;
const MINIMUM_SNAPSHOTS_PER_THREAD = 3;

function normalizeRetentionDays(days?: number): number {
  if (days === undefined) return DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(days) || days < 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(days);
}

const makeCheckpointPruner = Effect.gen(function* () {
  const checkpoints = yield* ProjectionCheckpointRepository;

  const pruneSnapshots: CheckpointPrunerShape["pruneSnapshots"] = (input = {}) =>
    Effect.gen(function* () {
      const retentionDays = normalizeRetentionDays(input.retentionDays);
      const startedAt = Date.now();
      const now = yield* DateTime.now;
      const cutoff = DateTime.subtractDuration(now, Duration.days(retentionDays));
      const result = yield* checkpoints.pruneSnapshots({
        olderThan: DateTime.formatIso(cutoff),
        keepPerThread: MINIMUM_SNAPSHOTS_PER_THREAD,
      });
      const durationMs = Date.now() - startedAt;
      yield* Effect.logInfo("checkpoint snapshots pruned", {
        snapshots_deleted: result.snapshotsDeleted,
        bytes_freed: result.bytesFreed,
        duration_ms: durationMs,
        retention_days: retentionDays,
      });
      return {
        snapshotsDeleted: result.snapshotsDeleted,
        bytesFreed: result.bytesFreed,
        durationMs,
        retentionDays,
      };
    });

  return { pruneSnapshots } satisfies CheckpointPrunerShape;
});

export const CheckpointPrunerLive = Layer.effect(CheckpointPruner, makeCheckpointPruner);

export const CheckpointPruningSchedulerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const pruner = yield* CheckpointPruner;
    yield* Effect.forkScoped(
      pruner.pruneSnapshots().pipe(
        Effect.repeat(Schedule.fixed(Duration.hours(1))),
        Effect.catch((cause: unknown) => Effect.logError("checkpoint pruning failed", { cause })),
      ),
    );
  }),
);
