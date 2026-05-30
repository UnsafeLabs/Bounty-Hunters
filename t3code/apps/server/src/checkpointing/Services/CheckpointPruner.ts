import {
  CheckpointRef,
  type OrchestrationCheckpointSummary,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export const DEFAULT_CHECKPOINT_RETENTION_DAYS = 7;
export const DEFAULT_MINIMUM_CHECKPOINTS_PER_THREAD = 3;
export const CHECKPOINT_RETENTION_DAY_MS = 24 * 60 * 60 * 1000;

export interface CheckpointPruneInput {
  readonly retentionDays?: number;
  readonly minimumCheckpointsPerThread?: number;
  readonly nowEpochMillis?: number;
}

export interface CheckpointPruneResult {
  readonly retentionDays: number;
  readonly minimumCheckpointsPerThread: number;
  readonly cutoffEpochMillis: number;
  readonly threadsScanned: number;
  readonly workspacesScanned: number;
  readonly snapshotsDeleted: number;
  readonly metadataRowsCleared: number;
  readonly estimatedBytesFreed: number;
  readonly durationMs: number;
  readonly failures: number;
}

export interface CheckpointPruneCandidate {
  readonly threadId: ThreadId;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
  readonly completedAt: string;
  readonly estimatedBytes: number;
}

export interface SelectPrunableCheckpointsInput {
  readonly threadId: ThreadId;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly cutoffEpochMillis: number;
  readonly minimumCheckpointsPerThread?: number;
}

const checkpointCompletedAtEpochMillis = (
  checkpoint: Pick<OrchestrationCheckpointSummary, "completedAt">,
) =>
  DateTime.make(checkpoint.completedAt).pipe(
    Option.match({
      onNone: () => Number.NaN,
      onSome: DateTime.toEpochMillis,
    }),
  );

const estimateCheckpointBytes = (checkpoint: OrchestrationCheckpointSummary): number =>
  new TextEncoder().encode(
    JSON.stringify({
      checkpointRef: checkpoint.checkpointRef,
      status: checkpoint.status,
      files: checkpoint.files,
      assistantMessageId: checkpoint.assistantMessageId,
    }),
  ).byteLength;

export function selectPrunableCheckpoints(
  input: SelectPrunableCheckpointsInput,
): ReadonlyArray<CheckpointPruneCandidate> {
  const minimumCheckpointsPerThread =
    input.minimumCheckpointsPerThread ?? DEFAULT_MINIMUM_CHECKPOINTS_PER_THREAD;
  const sortedCheckpoints = [...input.checkpoints].sort((left, right) => {
    if (left.checkpointTurnCount !== right.checkpointTurnCount) {
      return left.checkpointTurnCount - right.checkpointTurnCount;
    }
    return checkpointCompletedAtEpochMillis(left) - checkpointCompletedAtEpochMillis(right);
  });
  const preservedRefs = new Set(
    sortedCheckpoints
      .slice(Math.max(0, sortedCheckpoints.length - minimumCheckpointsPerThread))
      .map((checkpoint) => checkpoint.checkpointRef),
  );

  return sortedCheckpoints
    .filter((checkpoint) => {
      if (preservedRefs.has(checkpoint.checkpointRef)) {
        return false;
      }
      const completedAtEpochMillis = checkpointCompletedAtEpochMillis(checkpoint);
      return Number.isFinite(completedAtEpochMillis)
        ? completedAtEpochMillis < input.cutoffEpochMillis
        : false;
    })
    .map((checkpoint) => ({
      threadId: input.threadId,
      checkpointTurnCount: checkpoint.checkpointTurnCount,
      checkpointRef: checkpoint.checkpointRef,
      completedAt: checkpoint.completedAt,
      estimatedBytes: estimateCheckpointBytes(checkpoint),
    }));
}

export interface CheckpointPrunerShape {
  readonly prune: (input?: CheckpointPruneInput) => Effect.Effect<CheckpointPruneResult>;
}

export class CheckpointPruner extends Context.Service<CheckpointPruner, CheckpointPrunerShape>()(
  "t3/checkpointing/Services/CheckpointPruner",
) {}
