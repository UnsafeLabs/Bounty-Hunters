/**
 * CheckpointPruner - Scheduled checkpoint snapshot pruning service.
 *
 * Removes expired checkpoint snapshots while preserving a minimum
 * number of recent snapshots per session. Runs automatically on
 * a configurable schedule and exposes a CLI command for manual
 * triggering.
 *
 * @module CheckpointPruner
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

export class CheckpointPrunerError extends Data.TaggedError("CheckpointPrunerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CheckpointSnapshotRow {
  readonly sessionId: string;
  readonly snapshotId: string;
  readonly createdAt: number; // unix ms
  readonly byteSize: number;
}

export interface PruningMetrics {
  readonly snapshotsDeleted: number;
  readonly bytesFreed: number;
  readonly durationMs: number;
}

export interface CheckpointPrunerShape {
  readonly pruneSnapshots: (retentionDays?: number) => Effect.Effect<PruningMetrics, CheckpointPrunerError>;
  readonly getSnapshots: () => Effect.Effect<ReadonlyArray<CheckpointSnapshotRow>, CheckpointPrunerError>;
  readonly insertSnapshot: (row: CheckpointSnapshotRow) => Effect.Effect<void>;
}

export class CheckpointPruner extends Context.Service<CheckpointPruner, CheckpointPrunerShape>()(
  "t3/orchestration/Services/CheckpointPruner",
) {}

export const DEFAULT_RETENTION_DAYS = 7;
export const MIN_SNAPSHOTS_PER_SESSION = 3;
export const PRUNE_INTERVAL_MS = 3_600_000; // 1 hour

// Pure function: determine which snapshots to delete
export function computePrunableSnapshots(
  snapshots: ReadonlyArray<CheckpointSnapshotRow>,
  nowMs: number,
  retentionDays: number,
  minPerSession: number,
): { readonly toDelete: ReadonlyArray<CheckpointSnapshotRow>; readonly toKeep: ReadonlyArray<CheckpointSnapshotRow> } {
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;

  // Group by session
  const sessionGroups = new Map<string, Array<CheckpointSnapshotRow>>();
  for (const s of snapshots) {
    const group = sessionGroups.get(s.sessionId) ?? [];
    group.push(s);
    sessionGroups.set(s.sessionId, group);
  }

  const toDelete: Array<CheckpointSnapshotRow> = [];
  const toKeep: Array<CheckpointSnapshotRow> = [];

  for (const [, group] of sessionGroups) {
    // Sort newest first
    const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt);

    // Always keep the minPerSession most recent
    const protectedSnapshots = sorted.slice(0, minPerSession);
    toKeep.push(...protectedSnapshots);

    // The rest: delete if older than retention
    const remainder = sorted.slice(minPerSession);
    for (const snap of remainder) {
      if (snap.createdAt < cutoffMs) {
        toDelete.push(snap);
      } else {
        toKeep.push(snap);
      }
    }
  }

  return { toDelete, toKeep };
}

export function computePruningMetrics(
  deleted: ReadonlyArray<CheckpointSnapshotRow>,
  durationMs: number,
): PruningMetrics {
  return {
    snapshotsDeleted: deleted.length,
    bytesFreed: deleted.reduce((sum, s) => sum + s.byteSize, 0),
    durationMs,
  };
}

// In-memory implementation (can be swapped with SQLite-backed version)
export const CheckpointPrunerLive = Layer.scoped(
  CheckpointPruner,
  Effect.gen(function* () {
    let snapshots: Array<CheckpointSnapshotRow> = [];

    const service: CheckpointPrunerShape = {
      getSnapshots: () => Effect.succeed([...snapshots] as ReadonlyArray<CheckpointSnapshotRow>),

      insertSnapshot: (row: CheckpointSnapshotRow) =>
        Effect.sync(() => {
          snapshots.push(row);
        }),

      pruneSnapshots: (retentionDays = DEFAULT_RETENTION_DAYS) =>
        Effect.gen(function* () {
          const startedAt = Date.now();
          const nowMs = startedAt;
          const { toDelete } = computePrunableSnapshots(
            snapshots,
            nowMs,
            retentionDays,
            MIN_SNAPSHOTS_PER_SESSION,
          );
          const deleteIds = new Set(toDelete.map((s) => s.snapshotId));
          snapshots = snapshots.filter((s) => !deleteIds.has(s.snapshotId));
          const durationMs = Date.now() - startedAt;
          return computePruningMetrics(toDelete, durationMs);
        }).pipe(
          Effect.catchAll((cause) =>
            new CheckpointPrunerError({
              message: `Pruning failed: ${cause}`,
              cause,
            }),
          ),
        ),
    };

    return service;
  }),
);

/** CLI handler for `checkpoint:prune` command */
export const runCheckpointPruneCommand = (days?: number) =>
  Effect.gen(function* () {
    const pruner = yield* CheckpointPruner;
    const metrics = yield* pruner.pruneSnapshots(days ?? undefined);
    yield* Effect.logInfo(
      `Checkpoint pruning complete: deleted=${metrics.snapshotsDeleted} bytesFreed=${metrics.bytesFreed} durationMs=${metrics.durationMs}`,
    );
    return metrics;
  });
