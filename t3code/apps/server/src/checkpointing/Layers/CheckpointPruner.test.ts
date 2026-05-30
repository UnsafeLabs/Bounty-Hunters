import {
  CheckpointRef,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_RETENTION_DAY_MS,
  DEFAULT_MINIMUM_CHECKPOINTS_PER_THREAD,
  selectPrunableCheckpoints,
} from "../Services/CheckpointPruner.ts";

const nowEpochMillis = Date.UTC(2026, 4, 30, 0, 0, 0);
const cutoffEpochMillis = nowEpochMillis - 7 * CHECKPOINT_RETENTION_DAY_MS;
const threadId = ThreadId.make("thread-prune");

function iso(daysAgo: number): string {
  return DateTime.formatIso(
    DateTime.makeUnsafe(nowEpochMillis - daysAgo * CHECKPOINT_RETENTION_DAY_MS),
  );
}

function checkpoint(turn: number, daysAgo: number): OrchestrationCheckpointSummary {
  return {
    turnId: TurnId.make(`turn-${turn}`),
    checkpointTurnCount: turn,
    checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/thread-prune/turn/${turn}`),
    status: "ready",
    files: [
      {
        path: `file-${turn}.ts`,
        kind: "modified",
        additions: turn,
        deletions: 0,
      },
    ],
    assistantMessageId: MessageId.make(`assistant-${turn}`),
    completedAt: iso(daysAgo),
  };
}

describe("selectPrunableCheckpoints", () => {
  it("removes checkpoints older than retention while preserving the three newest per thread", () => {
    const prunable = selectPrunableCheckpoints({
      threadId,
      cutoffEpochMillis,
      checkpoints: [
        checkpoint(1, 30),
        checkpoint(2, 29),
        checkpoint(3, 28),
        checkpoint(4, 27),
        checkpoint(5, 26),
      ],
    });

    expect(prunable.map((entry) => entry.checkpointTurnCount)).toEqual([1, 2]);
  });

  it("does not prune checkpoints newer than the retention cutoff", () => {
    const prunable = selectPrunableCheckpoints({
      threadId,
      cutoffEpochMillis,
      checkpoints: [checkpoint(1, 5), checkpoint(2, 4), checkpoint(3, 3), checkpoint(4, 2)],
    });

    expect(prunable).toEqual([]);
  });

  it("allows callers to raise the minimum preservation count", () => {
    const prunable = selectPrunableCheckpoints({
      threadId,
      cutoffEpochMillis,
      minimumCheckpointsPerThread: DEFAULT_MINIMUM_CHECKPOINTS_PER_THREAD + 1,
      checkpoints: [
        checkpoint(1, 30),
        checkpoint(2, 29),
        checkpoint(3, 28),
        checkpoint(4, 27),
        checkpoint(5, 26),
      ],
    });

    expect(prunable.map((entry) => entry.checkpointTurnCount)).toEqual([1]);
  });
});
