import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";

export class CheckpointPruningError extends Error {
  readonly _tag = "CheckpointPruningError";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export const PruningMetrics = Schema.Struct({
  snapshotsDeleted: Schema.Number,
  threadsProcessed: Schema.Number,
  durationMs: Schema.Number,
});
export type PruningMetrics = typeof PruningMetrics.Type;

export interface CheckpointPruningConfig {
  readonly retentionDays: number;
  readonly minSnapshotsPerThread: number;
  readonly scheduleInterval: Duration.Duration;
}

export const defaultPruningConfig: CheckpointPruningConfig = {
  retentionDays: 7,
  minSnapshotsPerThread: 3,
  scheduleInterval: Duration.hours(1),
};

export interface CheckpointPruningServiceShape {
  readonly pruneSnapshots: (
    config?: Partial<CheckpointPruningConfig>,
  ) => Effect.Effect<PruningMetrics, CheckpointPruningError>;

  readonly startScheduled: () => Effect.Effect<void, never>;
}

export class CheckpointPruningService extends Context.Service<
  CheckpointPruningService,
  CheckpointPruningServiceShape
>()("t3/orchestration/Services/CheckpointPruningService") {}
