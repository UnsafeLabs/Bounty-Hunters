import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";

import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CHECKPOINT_RETENTION_DAY_MS,
  CheckpointPruner,
  DEFAULT_CHECKPOINT_RETENTION_DAYS,
  DEFAULT_MINIMUM_CHECKPOINTS_PER_THREAD,
  selectPrunableCheckpoints,
  type CheckpointPruneCandidate,
  type CheckpointPruneResult,
  type CheckpointPrunerShape,
} from "../Services/CheckpointPruner.ts";
import {
  checkpointPruneBytesFreed,
  checkpointPruneDuration,
  checkpointPruneSnapshotsDeleted,
  metricAttributes,
} from "../../observability/Metrics.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionCheckpointRepository } from "../../persistence/Services/ProjectionCheckpoints.ts";

const groupCandidatesByWorkspace = (
  candidates: ReadonlyArray<CheckpointPruneCandidate & { readonly cwd: string }>,
) => {
  const grouped = new Map<string, Array<CheckpointPruneCandidate & { readonly cwd: string }>>();
  for (const candidate of candidates) {
    const existing = grouped.get(candidate.cwd) ?? [];
    existing.push(candidate);
    grouped.set(candidate.cwd, existing);
  }
  return grouped;
};

const make = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore;
  const checkpointRepository = yield* ProjectionCheckpointRepository;

  const prune: CheckpointPrunerShape["prune"] = Effect.fn("CheckpointPruner.prune")(function* (
    input = {},
  ) {
    const startedAt = yield* Clock.currentTimeNanos;
    const retentionDays = Math.max(0, input.retentionDays ?? DEFAULT_CHECKPOINT_RETENTION_DAYS);
    const minimumCheckpointsPerThread = Math.max(
      0,
      input.minimumCheckpointsPerThread ?? DEFAULT_MINIMUM_CHECKPOINTS_PER_THREAD,
    );
    const nowEpochMillis = input.nowEpochMillis ?? DateTime.toEpochMillis(yield* DateTime.now);
    const cutoffEpochMillis = nowEpochMillis - retentionDays * CHECKPOINT_RETENTION_DAY_MS;
    const snapshotExit = yield* Effect.exit(snapshotQuery.getSnapshot());

    if (Exit.isFailure(snapshotExit)) {
      yield* Effect.logWarning("checkpoint pruning skipped: failed to load projection snapshot", {
        cause: snapshotExit.cause,
      });
      const endedAt = yield* Clock.currentTimeNanos;
      return {
        retentionDays,
        minimumCheckpointsPerThread,
        cutoffEpochMillis,
        threadsScanned: 0,
        workspacesScanned: 0,
        snapshotsDeleted: 0,
        metadataRowsCleared: 0,
        estimatedBytesFreed: 0,
        durationMs: Number((endedAt - startedAt) / 1_000_000n),
        failures: 1,
      } satisfies CheckpointPruneResult;
    }

    const snapshot = snapshotExit.value;
    const projectWorkspaceById = new Map(
      snapshot.projects.map((project) => [project.id, project.workspaceRoot] as const),
    );
    const candidates = snapshot.threads.flatMap((thread) => {
      const cwd = thread.worktreePath ?? projectWorkspaceById.get(thread.projectId);
      if (cwd === undefined) {
        return [];
      }
      return selectPrunableCheckpoints({
        threadId: thread.id,
        checkpoints: thread.checkpoints,
        cutoffEpochMillis,
        minimumCheckpointsPerThread,
      }).map((candidate) => ({ ...candidate, cwd }));
    });
    const candidatesByWorkspace = groupCandidatesByWorkspace(candidates);
    const deletedCandidates: Array<CheckpointPruneCandidate & { readonly cwd: string }> = [];
    let failures = 0;

    for (const [cwd, workspaceCandidates] of candidatesByWorkspace) {
      const deleteExit = yield* Effect.exit(
        checkpointStore.deleteCheckpointRefs({
          cwd,
          checkpointRefs: workspaceCandidates.map((candidate) => candidate.checkpointRef),
        }),
      );
      if (Exit.isSuccess(deleteExit)) {
        deletedCandidates.push(...workspaceCandidates);
      } else {
        failures += 1;
        yield* Effect.logWarning("checkpoint pruning failed to delete checkpoint refs", {
          cwd,
          refs: workspaceCandidates.map((candidate) => candidate.checkpointRef),
          cause: deleteExit.cause,
        });
      }
    }

    let metadataRowsCleared = 0;
    if (deletedCandidates.length > 0) {
      const clearExit = yield* Effect.exit(
        checkpointRepository.deleteByCheckpointRefs({
          checkpointRefs: deletedCandidates.map((candidate) => candidate.checkpointRef),
        }),
      );
      if (Exit.isSuccess(clearExit)) {
        metadataRowsCleared = deletedCandidates.length;
      } else {
        failures += 1;
        yield* Effect.logWarning("checkpoint pruning failed to clear projection metadata", {
          refs: deletedCandidates.map((candidate) => candidate.checkpointRef),
          cause: clearExit.cause,
        });
      }
    }

    const endedAt = yield* Clock.currentTimeNanos;
    const duration = Duration.nanos(endedAt - startedAt);
    const estimatedBytesFreed = deletedCandidates.reduce(
      (sum, candidate) => sum + candidate.estimatedBytes,
      0,
    );
    yield* Metric.update(checkpointPruneSnapshotsDeleted, deletedCandidates.length);
    yield* Metric.update(checkpointPruneBytesFreed, estimatedBytesFreed);
    yield* Metric.update(
      Metric.withAttributes(
        checkpointPruneDuration,
        metricAttributes({ outcome: failures === 0 ? "success" : "partial_failure" }),
      ),
      duration,
    );
    yield* Effect.logInfo("checkpoint pruning complete", {
      retentionDays,
      minimumCheckpointsPerThread,
      threadsScanned: snapshot.threads.length,
      workspacesScanned: candidatesByWorkspace.size,
      snapshotsDeleted: deletedCandidates.length,
      metadataRowsCleared,
      estimatedBytesFreed,
      durationMs: Duration.toMillis(duration),
      failures,
    });

    return {
      retentionDays,
      minimumCheckpointsPerThread,
      cutoffEpochMillis,
      threadsScanned: snapshot.threads.length,
      workspacesScanned: candidatesByWorkspace.size,
      snapshotsDeleted: deletedCandidates.length,
      metadataRowsCleared,
      estimatedBytesFreed,
      durationMs: Duration.toMillis(duration),
      failures,
    } satisfies CheckpointPruneResult;
  });

  return { prune } satisfies CheckpointPrunerShape;
});

export const CheckpointPrunerLive = Layer.effect(CheckpointPruner, make);
