import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface PruneCheckpointSnapshotsInput {
  readonly retentionDays?: number;
}

export interface PruneCheckpointSnapshotsResult {
  readonly snapshotsDeleted: number;
  readonly bytesFreed: number;
  readonly durationMs: number;
  readonly retentionDays: number;
}

export interface CheckpointPrunerShape {
  readonly pruneSnapshots: (
    input?: PruneCheckpointSnapshotsInput,
  ) => Effect.Effect<PruneCheckpointSnapshotsResult, ProjectionRepositoryError>;
}

export class CheckpointPruner extends Context.Service<CheckpointPruner, CheckpointPrunerShape>()(
  "t3/checkpointing/Services/CheckpointPruner",
) {}
