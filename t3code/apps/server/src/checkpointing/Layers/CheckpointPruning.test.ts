import { CheckpointRef, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointPruning } from "../Services/CheckpointPruning.ts";
import { CheckpointPruningLive, selectSnapshotsToPrune } from "./CheckpointPruning.ts";
import { ProjectionCheckpointRepositoryLive } from "../../persistence/Layers/ProjectionCheckpoints.ts";
import { ProjectionCheckpointRepository } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";

const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const seedCheckpoint = (
  threadId: string,
  turnCount: number,
  completedAt: string,
  filesPayload = `{"turn":${turnCount}}`,
) =>
  Effect.gen(function* () {
    const repo = yield* ProjectionCheckpointRepository;
    yield* repo.upsert({
      threadId: ThreadId.make(threadId),
      turnId: TurnId.make(`turn-${threadId}-${turnCount}`),
      checkpointTurnCount: turnCount,
      checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${threadId}/turn/${turnCount}`),
      status: "ready",
      files: [],
      assistantMessageId: MessageId.make(`assistant-${threadId}-${turnCount}`),
      completedAt,
    });
    // Inflate the row so pruning measurably frees bytes / shrinks the DB.
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE projection_turns SET checkpoint_files_json = ${filesPayload} WHERE thread_id = ${threadId} AND checkpoint_turn_count = ${turnCount}`;
    yield* sql`INSERT OR IGNORE INTO checkpoint_diff_blobs (thread_id, from_turn_count, to_turn_count, diff, created_at) VALUES (${threadId}, ${Math.max(0, turnCount - 1)}, ${turnCount}, ${`diff-payload-${threadId}-${turnCount}-${filesPayload}`}, ${completedAt})`;
  });

const countCheckpoints = (threadId: string) =>
  Effect.gen(function* () {
    const repo = yield* ProjectionCheckpointRepository;
    return (yield* repo.listByThreadId({ threadId: ThreadId.make(threadId) })).length;
  });

const testLayer = Layer.mergeAll(
  CheckpointPruningLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  ProjectionCheckpointRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  SqlitePersistenceMemory,
);

it.layer(testLayer)("CheckpointPruning", (it) => {
  it.effect("deletes snapshots older than the retention period", () =>
    Effect.gen(function* () {
      const threadId = `thread-retention-${Date.now()}`;
      const big = `{"blob":"${"x".repeat(2000)}"}`;
      for (let turn = 0; turn < 5; turn += 1) {
        // Turns 0-1 are 30 days old (prunable), turns 2-4 are fresh.
        yield* seedCheckpoint(threadId, turn, turn < 2 ? daysAgoIso(30) : daysAgoIso(0), big);
      }
      const pruning = yield* CheckpointPruning;
      const result = yield* pruning.pruneSnapshots({ retentionDays: 7 });
      assert.isAtLeast(result.snapshotsDeleted, 1);
      assert.isAtLeast(result.bytesFreed, 1);
      assert.isAtLeast(result.durationMs, 0);
      const remaining = yield* countCheckpoints(threadId);
      // 5 seeded - 2 old = 3 preserved (also satisfies min-keep).
      assert.strictEqual(remaining, 3);
    }),
  );

  it.effect("always preserves the 3 most recent snapshots per session", () =>
    Effect.gen(function* () {
      const threadId = `thread-minkeep-${Date.now()}`;
      for (let turn = 0; turn < 5; turn += 1) {
        yield* seedCheckpoint(threadId, turn, daysAgoIso(30));
      }
      const pruning = yield* CheckpointPruning;
      const result = yield* pruning.pruneSnapshots({ retentionDays: 7 });
      assert.isAtLeast(result.snapshotsDeleted, 1);
      const remaining = yield* countCheckpoints(threadId);
      assert.strictEqual(remaining, 3);
      const repo = yield* ProjectionCheckpointRepository;
      const rows = yield* repo.listByThreadId({ threadId: ThreadId.make(threadId) });
      const turns = rows.map((row) => row.checkpointTurnCount).sort((a, b) => a - b);
      assert.deepStrictEqual(turns, [2, 3, 4]);
    }),
  );

  it.effect("selectSnapshotsToPrune keeps young snapshots and min recent", () => {
    const nowMs = Date.parse("2026-09-14T00:00:00.000Z");
    const rows = [0, 1, 2, 3, 4].map((turn) => ({
      threadId: "t",
      turnCount: turn,
      completedAt:
        turn < 2 ? "2026-01-01T00:00:00.000Z" : "2026-09-13T00:00:00.000Z",
      ref: `ref-${turn}`,
      filesJson: "[]",
    }));
    const victims = selectSnapshotsToPrune({
      rows,
      nowMs,
      retentionDays: 7,
      minSnapshotsPerSession: 3,
    });
    // Most recent 3 (turns 4,3,2) protected; of the rest only old ones pruned.
    assert.deepStrictEqual(victims.map((v) => v.turnCount).sort(), [0, 1]);
  });

  it.effect("selectSnapshotsToPrune protects 3 most recent per session, not globally", () => {
    const nowMs = Date.parse("2026-09-14T00:00:00.000Z");
    const old = "2026-01-01T00:00:00.000Z";
    const rows = [
      ...[0, 1, 2, 3].map((turn) => ({
        threadId: "a",
        turnCount: turn,
        completedAt: old,
        ref: `ref-a-${turn}`,
        filesJson: "[]",
      })),
      ...[0, 1, 2, 3].map((turn) => ({
        threadId: "b",
        turnCount: turn,
        completedAt: old,
        ref: `ref-b-${turn}`,
        filesJson: "[]",
      })),
    ];
    const victims = selectSnapshotsToPrune({
      rows,
      nowMs,
      retentionDays: 7,
      minSnapshotsPerSession: 3,
    });
    // Per session: turn 0 pruned, turns 1-3 protected.
    assert.deepStrictEqual(
      victims.map((v) => `${v.threadId}:${v.turnCount}`).sort(),
      ["a:0", "b:0"],
    );
  });

  it.effect("handles concurrent checkpoint access during pruning without errors", () =>
    Effect.gen(function* () {
      const threadId = `thread-concurrent-${Date.now()}`;
      for (let turn = 0; turn < 6; turn += 1) {
        yield* seedCheckpoint(threadId, turn, turn < 3 ? daysAgoIso(30) : daysAgoIso(0));
      }
      const pruning = yield* CheckpointPruning;
      const repo = yield* ProjectionCheckpointRepository;
      const readers = Effect.forEach(
        Array.from({ length: 10 }, () => repo.listByThreadId({ threadId: ThreadId.make(threadId) })),
        (x) => x,
        { concurrency: 10 },
      );
      const [pruneResult, readResults] = yield* Effect.all(
        [pruning.pruneSnapshots({ retentionDays: 7 }), readers],
        { concurrency: 2 },
      );
      assert.isAtLeast(pruneResult.snapshotsDeleted, 1);
      assert.strictEqual(readResults.length, 10);
      const remaining = yield* countCheckpoints(threadId);
      assert.isAtLeast(remaining, 3);
    }),
  );
});
