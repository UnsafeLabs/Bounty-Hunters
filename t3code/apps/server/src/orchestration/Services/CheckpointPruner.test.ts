import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  CheckpointPruner,
  CheckpointPrunerLive,
  computePrunableSnapshots,
  computePruningMetrics,
  DEFAULT_RETENTION_DAYS,
  MIN_SNAPSHOTS_PER_SESSION,
  type CheckpointSnapshotRow,
  type PruningMetrics,
} from "./CheckpointPruner.ts";

const makeSnapshot = (
  sessionId: string,
  snapshotId: string,
  createdAtMs: number,
  byteSize = 1024,
): CheckpointSnapshotRow => ({
  sessionId,
  snapshotId,
  createdAt: createdAtMs,
  byteSize,
});

describe("computePrunableSnapshots", () => {
  const now = 1_000_000_000_000; // some reference time
  const day = 86_400_000; // ms per day

  it("deletes snapshots older than retention period beyond minimum", () => {
    const snapshots = [
      // Session A: 5 snapshots, 3 old ones beyond retention
      ...Array.from({ length: 5 }, (_, i) =>
        makeSnapshot("sess-a", `snap-a-${i}`, now - (10 + i) * day),
      ),
      // Session B: 2 snapshots (below minimum, all kept)
      ...Array.from({ length: 2 }, (_, i) =>
        makeSnapshot("sess-b", `snap-b-${i}`, now - 20 * day),
      ),
    ];

    const { toDelete, toKeep } = computePrunableSnapshots(
      snapshots,
      now,
      DEFAULT_RETENTION_DAYS,
      MIN_SNAPSHOTS_PER_SESSION,
    );

    // Session A: the 2 oldest (beyond min 3) and older than 7 days should be deleted
    // The 3 most recent of sess-a are protected even though they're old
    assert.equal(toKeep.filter((s) => s.sessionId === "sess-b").length, 2);
    // All sess-b snapshots kept since < minPerSession
    const deletedFromA = toDelete.filter((s) => s.sessionId === "sess-a");
    const keptFromA = toKeep.filter((s) => s.sessionId === "sess-a");
    assert.equal(keptFromA.length, 3); // most recent 3 protected
    assert.equal(deletedFromA.length, 2); // remaining 2 are old + beyond retention
  });

  it("keeps all snapshots when all are within retention period", () => {
    const snapshots = [
      makeSnapshot("sess-a", "snap-1", now - 1 * day),
      makeSnapshot("sess-a", "snap-2", now - 2 * day),
      makeSnapshot("sess-a", "snap-3", now - 3 * day),
    ];

    const { toDelete } = computePrunableSnapshots(snapshots, now, 7, 3);
    assert.equal(toDelete.length, 0);
  });

  it("preserves exactly minPerSession even when all are ancient", () => {
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      makeSnapshot("sess-x", `snap-${i}`, now - 100 * day - i * day),
    );

    const { toDelete, toKeep } = computePrunableSnapshots(snapshots, now, 7, 3);
    assert.equal(toKeep.length, 3);
    assert.equal(toDelete.length, 7);
    // The 3 most recent (highest createdAt) should be kept
    const keptIds = new Set(toKeep.map((s) => s.snapshotId));
    assert.ok(keptIds.has("snap-0"));
    assert.ok(keptIds.has("snap-1"));
    assert.ok(keptIds.has("snap-2"));
  });

  it("handles empty snapshot list", () => {
    const { toDelete, toKeep } = computePrunableSnapshots([], now, 7, 3);
    assert.equal(toDelete.length, 0);
    assert.equal(toKeep.length, 0);
  });
});

describe("computePruningMetrics", () => {
  it("computes correct metrics", () => {
    const deleted = [
      makeSnapshot("s1", "d1", 0, 2048),
      makeSnapshot("s1", "d2", 0, 4096),
      makeSnapshot("s2", "d3", 0, 1024),
    ];
    const metrics = computePruningMetrics(deleted, 150);
    assert.equal(metrics.snapshotsDeleted, 3);
    assert.equal(metrics.bytesFreed, 7168);
    assert.equal(metrics.durationMs, 150);
  });

  it("returns zeros for empty deletion list", () => {
    const metrics = computePruningMetrics([], 0);
    assert.equal(metrics.snapshotsDeleted, 0);
    assert.equal(metrics.bytesFreed, 0);
    assert.equal(metrics.durationMs, 0);
  });
});

describe("CheckpointPruner service", () => {
  const TestLayer = CheckpointPrunerLive;

  it.effect("inserts and retrieves snapshots", () =>
    Effect.gen(function* () {
      const pruner = yield* CheckpointPruner;
      yield* pruner.insertSnapshot(makeSnapshot("s1", "snap-1", 1000));
      yield* pruner.insertSnapshot(makeSnapshot("s1", "snap-2", 2000));
      const all = yield* pruner.getSnapshots();
      assert.equal(all.length, 2);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("prunes old snapshots beyond retention", () =>
    Effect.gen(function* () {
      const pruner = yield* CheckpointPruner;
      const now = Date.now();

      // Insert 5 snapshots for one session, all very old
      for (let i = 0; i < 5; i++) {
        yield* pruner.insertSnapshot(
          makeSnapshot("s1", `snap-${i}`, now - (20 - i) * 86_400_000),
        );
      }

      const before = yield* pruner.getSnapshots();
      assert.equal(before.length, 5);

      const metrics = yield* pruner.pruneSnapshots(7);
      assert.ok(metrics.snapshotsDeleted >= 2); // at least the 2 oldest beyond min 3

      const after = yield* pruner.getSnapshots();
      assert.ok(after.length <= 3); // at most 3 kept
      assert.ok(metrics.bytesFreed > 0);
      assert.ok(metrics.durationMs >= 0);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("minPrune with custom days parameter", () =>
    Effect.gen(function* () {
      const pruner = yield* CheckpointPruner;
      const now = Date.now();

      // 5 snapshots, 2 days old
      for (let i = 0; i < 5; i++) {
        yield* pruner.insertSnapshot(
          makeSnapshot("s1", `snap-${i}`, now - (5 - i) * 86_400_000),
        );
      }

      // With 1-day retention, snapshots older than 1 day should be pruned (keeping min 3)
      const metrics = yield* pruner.pruneSnapshots(1);
      assert.ok(metrics.snapshotsDeleted >= 2);

      const after = yield* pruner.getSnapshots();
      assert.ok(after.length <= 3);
    }).pipe(Effect.provide(TestLayer)),
  );
});
