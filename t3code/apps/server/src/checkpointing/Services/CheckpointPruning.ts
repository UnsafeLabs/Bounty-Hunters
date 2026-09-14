/**
 * CheckpointPruning - Retention policy service for checkpoint snapshots.
 *
 * Removes projected checkpoint snapshots older than a configurable retention
 * period while always preserving the most recent snapshots per session
 * (thread). Backed by SQLite projection tables (`projection_turns` +
 * `checkpoint_diff_blobs`) so pruning decreases database size.
 *
 * @module CheckpointPruning
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export const DEFAULT_RETENTION_DAYS = 7;
export const MIN_SNAPSHOTS_PER_SESSION = 3;
export const PRUNE_INTERVAL_HOURS = 1;

export interface PruneSnapshotsInput {
  readonly retentionDays?: number;
  readonly minSnapshotsPerSession?: number;
}

export interface PruneSnapshotsResult {
  readonly snapshotsDeleted: number;
  readonly bytesFreed: number;
  readonly durationMs: number;
  readonly sessionsScanned: number;
}

export interface StartScheduledPruningInput {
  readonly retentionDays?: number;
  readonly minSnapshotsPerSession?: number;
}

/**
 * CheckpointPruningShape - Service API for checkpoint snapshot retention.
 */
export interface CheckpointPruningShape {
  /**
   * Delete snapshots older than the retention period.
   *
   * Keeps at least `minSnapshotsPerSession` (default 3) most recent snapshots
   * per session (thread) regardless of age. Safe for concurrent checkpoint
   * reads/writes: each session is pruned inside a transaction and missing rows
   * are tolerated.
   */
  readonly pruneSnapshots: (
    input?: PruneSnapshotsInput,
  ) => Effect.Effect<PruneSnapshotsResult, ProjectionRepositoryError>;

  /**
   * Start hourly automatic pruning in the background.
   *
   * Uses `Effect.Schedule.fixed` with a 1-hour interval and never blocks the
   * caller; failures are logged and the schedule continues.
   */
  readonly startScheduledPruning: (
    input?: StartScheduledPruningInput,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

/**
 * CheckpointPruning - Service tag for checkpoint snapshot pruning.
 */
export class CheckpointPruning extends Context.Service<
  CheckpointPruning,
  CheckpointPruningShape
>()("t3/checkpointing/Services/CheckpointPruning") {}
