/**
 * CheckpointPruningLive - SQLite-backed checkpoint snapshot retention.
 *
 * Pruning policy:
 * - Snapshots older than `retentionDays` (default 7) are deleted.
 * - The `minSnapshotsPerSession` (default 3) most recent snapshots per session
 *   (thread) are always preserved regardless of age.
 * - Hourly automatic pruning runs via `Effect.Schedule.fixed` without blocking.
 * - Metrics (`snapshots_deleted`, `bytes_freed`, `duration_ms`) are logged via
 *   the observability layer and recorded as Effect metrics.
 *
 * @module CheckpointPruningLive
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  checkpointPruneBytesFreedTotal,
  checkpointPruneDuration,
  checkpointPruneSnapshotsTotal,
} from "../../observability/checkpointPruneMetrics.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import {
  CheckpointPruning,
  DEFAULT_RETENTION_DAYS,
  MIN_SNAPSHOTS_PER_SESSION,
  type CheckpointPruningShape,
  type PruneSnapshotsInput,
  type PruneSnapshotsResult,
} from "../Services/CheckpointPruning.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PRUNE_CONCURRENCY = 8;

interface SnapshotRow {
  readonly threadId: string;
  readonly turnCount: number;
  readonly completedAt: string;
  readonly ref: string | null;
  readonly filesJson: string;
}

const normalizeRetentionDays = (input?: number): number => {
  if (input === undefined) return DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(input) || input < 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(input);
};

const normalizeMinKeep = (input?: number): number => {
  if (input === undefined) return MIN_SNAPSHOTS_PER_SESSION;
  if (!Number.isFinite(input) || input < 0) return MIN_SNAPSHOTS_PER_SESSION;
  return Math.floor(input);
};

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

export const selectSnapshotsToPrune = (input: {
  readonly rows: ReadonlyArray<SnapshotRow>;
  readonly nowMs: number;
  readonly retentionDays: number;
  readonly minSnapshotsPerSession: number;
}): ReadonlyArray<SnapshotRow> => {
  const cutoffMs = input.nowMs - input.retentionDays * MS_PER_DAY;
  const keepPerSession = Math.max(0, Math.floor(input.minSnapshotsPerSession));
  const bySession = new Map<string, Array<SnapshotRow>>();
  for (const row of input.rows) {
    const group = bySession.get(row.threadId);
    if (group) group.push(row);
    else bySession.set(row.threadId, [row]);
  }
  const protectedRows = new Set<SnapshotRow>();
  for (const group of bySession.values()) {
    group.sort((a, b) => b.turnCount - a.turnCount);
    for (let i = 0; i < keepPerSession && i < group.length; i++) {
      const row = group[i];
      if (row !== undefined) protectedRows.add(row);
    }
  }
  return input.rows.filter((row) => {
    if (protectedRows.has(row)) return false;
    const completedMs = Date.parse(row.completedAt);
    if (Number.isNaN(completedMs)) return false;
    return completedMs < cutoffMs;
  });
};

const makeCheckpointPruning = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listSessionIds = Effect.gen(function* () {
    const rows = yield* sql<{ readonly threadId: string }>`
      SELECT DISTINCT thread_id AS "threadId"
      FROM projection_turns
      WHERE checkpoint_turn_count IS NOT NULL
    `;
    return rows.map((row) => row.threadId);
  }).pipe(Effect.mapError(toPersistenceSqlError("CheckpointPruning.listSessionIds:query")));

  const listSnapshotsForSession = (threadId: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly threadId: string;
        readonly turnCount: number;
        readonly completedAt: string | null;
        readonly ref: string | null;
        readonly filesJson: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          checkpoint_turn_count AS "turnCount",
          completed_at AS "completedAt",
          checkpoint_ref AS "ref",
          checkpoint_files_json AS "filesJson"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count DESC
      `;
      return rows.flatMap((row): ReadonlyArray<SnapshotRow> =>
        row.completedAt === null || row.turnCount === null
          ? []
          : [
              {
                threadId: row.threadId,
                turnCount: row.turnCount,
                completedAt: row.completedAt,
                ref: row.ref,
                filesJson: row.filesJson ?? "[]",
              },
            ],
      );
    }).pipe(Effect.mapError(toPersistenceSqlError("CheckpointPruning.listSnapshots:query")));

  const deleteSnapshot = (row: SnapshotRow) =>
    Effect.gen(function* () {
      const blobs = yield* sql<{ readonly diff: string }>`
        SELECT diff AS "diff"
        FROM checkpoint_diff_blobs
        WHERE thread_id = ${row.threadId}
          AND (from_turn_count = ${row.turnCount} OR to_turn_count = ${row.turnCount})
      `;
      const blobBytes = blobs.reduce((total, entry) => total + byteLength(entry.diff ?? ""), 0);
      const rowBytes =
        byteLength(row.filesJson) + byteLength(row.ref ?? "") + blobBytes;

      yield* sql`
        DELETE FROM checkpoint_diff_blobs
        WHERE thread_id = ${row.threadId}
          AND (from_turn_count = ${row.turnCount} OR to_turn_count = ${row.turnCount})
      `;
      yield* sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${row.threadId}
          AND checkpoint_turn_count = ${row.turnCount}
      `;
      return rowBytes;
    }).pipe(Effect.mapError(toPersistenceSqlError("CheckpointPruning.deleteSnapshot:query")));

  const pruneSession = (
    threadId: string,
    nowMs: number,
    retentionDays: number,
    minKeep: number,
  ) =>
    Effect.gen(function* () {
      const rows = yield* listSnapshotsForSession(threadId);
      const victims = selectSnapshotsToPrune({
        rows,
        nowMs,
        retentionDays,
        minSnapshotsPerSession: minKeep,
      });
      if (victims.length === 0) return { deleted: 0, bytesFreed: 0 };
      let bytesFreed = 0;
      // Each session prunes inside a transaction so concurrent checkpoint
      // captures/reads never observe partial state and never fail.
      yield* sql.withTransaction(
        Effect.forEach(victims, (row) =>
          deleteSnapshot(row).pipe(Effect.map((bytes) => {
            bytesFreed += bytes;
          })),
        ),
      ).pipe(Effect.mapError(toPersistenceSqlError("CheckpointPruning.pruneSession:transaction")));
      return { deleted: victims.length, bytesFreed };
    });

  const pruneSnapshots: CheckpointPruningShape["pruneSnapshots"] = (input?: PruneSnapshotsInput) =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const retentionDays = normalizeRetentionDays(input?.retentionDays);
      const minKeep = normalizeMinKeep(input?.minSnapshotsPerSession);
      const nowMs = yield* Clock.currentTimeMillis;

      const sessionIds = yield* listSessionIds;
      const perSession = yield* Effect.forEach(sessionIds, (threadId) =>
        pruneSession(threadId, nowMs, retentionDays, minKeep).pipe(
          // Tolerate races with concurrent checkpoint writes: a session that
          // changed mid-prune logs a warning instead of failing the batch.
          Effect.catchAllCause((cause) =>
            Effect.logWarning("checkpoint.prune.session-skipped", { threadId, cause }).pipe(
              Effect.as({ deleted: 0, bytesFreed: 0 }),
            ),
          ),
        ),
      { concurrency: PRUNE_CONCURRENCY });

      const snapshotsDeleted = perSession.reduce((total, entry) => total + entry.deleted, 0);
      const bytesFreed = perSession.reduce((total, entry) => total + entry.bytesFreed, 0);
      const endedAt = yield* Clock.currentTimeMillis;
      const durationMs = Math.max(0, endedAt - startedAt);

      yield* Metric.update(checkpointPruneSnapshotsTotal, snapshotsDeleted);
      yield* Metric.update(checkpointPruneBytesFreedTotal, bytesFreed);
      yield* Metric.update(checkpointPruneDuration, Duration.millis(durationMs));

      yield* Effect.logInfo("checkpoint.prune.complete", {
        snapshots_deleted: snapshotsDeleted,
        bytes_freed: bytesFreed,
        duration_ms: durationMs,
        sessions_scanned: sessionIds.length,
        retention_days: retentionDays,
        min_snapshots_per_session: minKeep,
      });

      const result: PruneSnapshotsResult = {
        snapshotsDeleted,
        bytesFreed,
        durationMs,
        sessionsScanned: sessionIds.length,
      };
      return result;
    }).pipe(Effect.withSpan("CheckpointPruning.pruneSnapshots"));

  const startScheduledPruning: CheckpointPruningShape["startScheduledPruning"] = (input) =>
    Effect.gen(function* () {
      const retentionDays = normalizeRetentionDays(input?.retentionDays);
      const minKeep = normalizeMinKeep(input?.minSnapshotsPerSession);
      yield* Effect.forkScoped(
        pruneSnapshots({ retentionDays, minSnapshotsPerSession: minKeep }).pipe(
          Effect.catchAllCause((cause) =>
            Effect.logWarning("checkpoint.prune.scheduled-failed", { cause }),
          ),
          Effect.repeat(Schedule.fixed("1 hour")),
        ),
      );
      yield* Effect.logInfo("checkpoint.prune.schedule-started", {
        interval: "1 hour",
        retention_days: retentionDays,
        min_snapshots_per_session: minKeep,
      });
    });

  return { pruneSnapshots, startScheduledPruning } satisfies CheckpointPruningShape;
});

export const CheckpointPruningLive = Layer.effect(CheckpointPruning, makeCheckpointPruning);
