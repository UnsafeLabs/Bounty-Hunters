import { CheckpointRef } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import type { CheckpointStoreError } from "../../checkpointing/Errors.ts";
import {
  checkpointBytesFreed,
  checkpointPruneDuration,
  checkpointSnapshotsDeleted,
  metricAttributes,
} from "../../observability/Metrics.ts";
import { toPersistenceSqlError, type ProjectionRepositoryError } from "../../persistence/Errors.ts";

export const DEFAULT_CHECKPOINT_SNAPSHOT_RETENTION_DAYS = 7;
export const DEFAULT_CHECKPOINT_SNAPSHOT_MINIMUM_PER_SESSION = 3;
export const CHECKPOINT_SNAPSHOT_PRUNE_INTERVAL = Duration.hours(1);

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

interface CheckpointSnapshotRow {
  readonly rowId: number;
  readonly threadId: string;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: string;
  readonly completedAt: string;
  readonly workspaceRoot: string | null;
  readonly worktreePath: string | null;
  readonly byteSize: number;
}

export interface PruneSnapshotsInput {
  readonly retentionDays?: number;
  readonly minimumPerSession?: number;
  readonly nowMs?: number;
}

export interface PruneSnapshotsResult {
  readonly snapshotsDeleted: number;
  readonly bytesFreed: number;
  readonly durationMs: number;
  readonly retentionDays: number;
  readonly minimumPerSession: number;
  readonly cutoffIso: string;
}

export class CheckpointPruneInputError extends Data.TaggedError("CheckpointPruneInputError")<{
  readonly message: string;
}> {}

export type CheckpointSnapshotPruneError =
  | CheckpointPruneInputError
  | CheckpointStoreError
  | ProjectionRepositoryError;

export interface CheckpointSnapshotPrunerShape {
  readonly pruneSnapshots: (
    input?: PruneSnapshotsInput,
  ) => Effect.Effect<PruneSnapshotsResult, CheckpointSnapshotPruneError>;
}

export class CheckpointSnapshotPruner extends Context.Service<
  CheckpointSnapshotPruner,
  CheckpointSnapshotPrunerShape
>()("t3/orchestration/checkpoint/CheckpointSnapshotPruner") {}

function normalizeNonNegativeInteger(input: {
  readonly value: number | undefined;
  readonly defaultValue: number;
  readonly name: string;
}): Effect.Effect<number, CheckpointPruneInputError> {
  const value = input.value ?? input.defaultValue;
  if (!Number.isInteger(value) || value < 0) {
    return Effect.fail(
      new CheckpointPruneInputError({
        message: `${input.name} must be a non-negative integer.`,
      }),
    );
  }
  return Effect.succeed(value);
}

function completedAtMillis(row: CheckpointSnapshotRow): number | null {
  const millis = Date.parse(row.completedAt);
  return Number.isFinite(millis) ? millis : null;
}

function groupByThread(
  rows: ReadonlyArray<CheckpointSnapshotRow>,
): Map<string, ReadonlyArray<CheckpointSnapshotRow>> {
  const grouped = new Map<string, Array<CheckpointSnapshotRow>>();
  for (const row of rows) {
    const threadRows = grouped.get(row.threadId) ?? [];
    threadRows.push(row);
    grouped.set(row.threadId, threadRows);
  }
  return grouped;
}

function resolveWorkspaceCwd(row: CheckpointSnapshotRow): string | undefined {
  return row.worktreePath ?? row.workspaceRoot ?? undefined;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const checkpointStore = yield* CheckpointStore;

  const listCheckpointRows = () =>
    sql<CheckpointSnapshotRow>`
      SELECT
        turns.row_id AS "rowId",
        turns.thread_id AS "threadId",
        turns.checkpoint_turn_count AS "checkpointTurnCount",
        turns.checkpoint_ref AS "checkpointRef",
        turns.completed_at AS "completedAt",
        projects.workspace_root AS "workspaceRoot",
        threads.worktree_path AS "worktreePath",
        (
          length(coalesce(turns.checkpoint_ref, '')) +
          length(coalesce(turns.checkpoint_status, '')) +
          length(coalesce(turns.checkpoint_files_json, '')) +
          coalesce((
            SELECT sum(length(diff))
            FROM checkpoint_diff_blobs AS blobs
            WHERE blobs.thread_id = turns.thread_id
              AND (
                blobs.from_turn_count = turns.checkpoint_turn_count
                OR blobs.to_turn_count = turns.checkpoint_turn_count
              )
          ), 0)
        ) AS "byteSize"
      FROM projection_turns AS turns
      LEFT JOIN projection_threads AS threads
        ON threads.thread_id = turns.thread_id
      LEFT JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE turns.checkpoint_turn_count IS NOT NULL
        AND turns.checkpoint_ref IS NOT NULL
        AND turns.completed_at IS NOT NULL
      ORDER BY turns.thread_id ASC, turns.checkpoint_turn_count ASC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("CheckpointSnapshotPruner.listCheckpointRows:query")),
    );

  const clearCheckpointRows = (rows: ReadonlyArray<CheckpointSnapshotRow>) => {
    if (rows.length === 0) {
      return Effect.void;
    }

    return sql
      .withTransaction(
        Effect.forEach(
          rows,
          (row) =>
            Effect.all(
              [
                sql`
                UPDATE projection_turns
                SET
                  checkpoint_turn_count = NULL,
                  checkpoint_ref = NULL,
                  checkpoint_status = NULL,
                  checkpoint_files_json = '[]'
                WHERE row_id = ${row.rowId}
              `,
                sql`
                DELETE FROM checkpoint_diff_blobs
                WHERE thread_id = ${row.threadId}
                  AND (
                    from_turn_count = ${row.checkpointTurnCount}
                    OR to_turn_count = ${row.checkpointTurnCount}
                  )
              `,
              ],
              { discard: true },
            ),
          { discard: true },
        ),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlError("CheckpointSnapshotPruner.clearCheckpointRows:query"),
        ),
      );
  };

  const pruneSnapshots: CheckpointSnapshotPrunerShape["pruneSnapshots"] = Effect.fn(
    "CheckpointSnapshotPruner.pruneSnapshots",
  )(function* (input = {}) {
    const startedAtMs = yield* Clock.currentTimeMillis;
    const retentionDays = yield* normalizeNonNegativeInteger({
      value: input.retentionDays,
      defaultValue: DEFAULT_CHECKPOINT_SNAPSHOT_RETENTION_DAYS,
      name: "retentionDays",
    });
    const minimumPerSession = yield* normalizeNonNegativeInteger({
      value: input.minimumPerSession,
      defaultValue: DEFAULT_CHECKPOINT_SNAPSHOT_MINIMUM_PER_SESSION,
      name: "minimumPerSession",
    });

    const nowMs = input.nowMs ?? (yield* Clock.currentTimeMillis);
    if (!Number.isFinite(nowMs)) {
      return yield* new CheckpointPruneInputError({
        message: "nowMs must be a finite epoch millisecond timestamp.",
      });
    }
    const cutoffMs = nowMs - retentionDays * MS_PER_DAY;
    const cutoffIso = DateTime.formatIso(DateTime.makeUnsafe(cutoffMs));
    const rows = yield* listCheckpointRows();
    const preservedRowIds = new Set<number>();

    for (const threadRows of groupByThread(rows).values()) {
      const latestRows = threadRows
        .toSorted((left, right) => {
          const turnDelta = right.checkpointTurnCount - left.checkpointTurnCount;
          if (turnDelta !== 0) return turnDelta;
          return (completedAtMillis(right) ?? 0) - (completedAtMillis(left) ?? 0);
        })
        .slice(0, minimumPerSession);

      for (const row of latestRows) {
        preservedRowIds.add(row.rowId);
      }
    }

    const candidates = rows.filter((row) => {
      const completedMs = completedAtMillis(row);
      return completedMs !== null && completedMs < cutoffMs && !preservedRowIds.has(row.rowId);
    });

    const rowIdsWithDeletedRefs = new Set<number>();
    const candidatesByCwd = new Map<string, Array<CheckpointSnapshotRow>>();
    for (const row of candidates) {
      const cwd = resolveWorkspaceCwd(row);
      if (!cwd) {
        rowIdsWithDeletedRefs.add(row.rowId);
        continue;
      }
      const cwdRows = candidatesByCwd.get(cwd) ?? [];
      cwdRows.push(row);
      candidatesByCwd.set(cwd, cwdRows);
    }

    for (const [cwd, cwdRows] of candidatesByCwd) {
      const deletedRefs = yield* checkpointStore
        .deleteCheckpointRefs({
          cwd,
          checkpointRefs: cwdRows.map((row) => CheckpointRef.make(row.checkpointRef)),
        })
        .pipe(
          Effect.map(() => true),
          Effect.catch((error) =>
            Effect.logWarning("checkpoint snapshot pruning skipped workspace refs", {
              cwd,
              snapshotCount: cwdRows.length,
              error: error.message,
            }).pipe(Effect.as(false)),
          ),
        );

      if (deletedRefs) {
        for (const row of cwdRows) {
          rowIdsWithDeletedRefs.add(row.rowId);
        }
      }
    }

    const rowsToClear = candidates.filter((row) => rowIdsWithDeletedRefs.has(row.rowId));
    yield* clearCheckpointRows(rowsToClear);

    const endedAtMs = yield* Clock.currentTimeMillis;
    const durationMs = Math.max(0, endedAtMs - startedAtMs);
    const snapshotsDeleted = rowsToClear.length;
    const bytesFreed = rowsToClear.reduce(
      (sum, row) => sum + Math.max(0, Number(row.byteSize) || 0),
      0,
    );
    const metricAttrs = {
      retention_days: retentionDays,
      minimum_per_session: minimumPerSession,
    };

    yield* Metric.update(
      Metric.withAttributes(checkpointSnapshotsDeleted, metricAttributes(metricAttrs)),
      snapshotsDeleted,
    );
    yield* Metric.update(
      Metric.withAttributes(checkpointBytesFreed, metricAttributes(metricAttrs)),
      bytesFreed,
    );
    yield* Metric.update(
      Metric.withAttributes(checkpointPruneDuration, metricAttributes(metricAttrs)),
      Duration.millis(durationMs),
    );

    const result = {
      snapshotsDeleted,
      bytesFreed,
      durationMs,
      retentionDays,
      minimumPerSession,
      cutoffIso,
    } satisfies PruneSnapshotsResult;

    yield* Effect.logInfo("checkpoint snapshot pruning complete", {
      snapshots_deleted: result.snapshotsDeleted,
      bytes_freed: result.bytesFreed,
      duration_ms: result.durationMs,
      retention_days: retentionDays,
      minimum_per_session: minimumPerSession,
      cutoff_iso: cutoffIso,
    });

    return result;
  });

  return {
    pruneSnapshots,
  } satisfies CheckpointSnapshotPrunerShape;
});

export const CheckpointSnapshotPrunerLive = Layer.effect(CheckpointSnapshotPruner, make);
