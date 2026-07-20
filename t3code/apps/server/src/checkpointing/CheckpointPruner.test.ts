import {
  CheckpointPruner,
  parsePruneDays,
  selectSnapshotsToPrune,
  formatPruneReport,
  DEFAULT_KEEP_PER_SESSION,
} from "./CheckpointPruner.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const day = 24 * 60 * 60 * 1000;
const now = 1_700_000_000_000;

const snaps = [
  { id: "a1", sessionId: "s1", createdAt: now - 10 * day, sizeBytes: 100 },
  { id: "a2", sessionId: "s1", createdAt: now - 9 * day, sizeBytes: 100 },
  { id: "a3", sessionId: "s1", createdAt: now - 8 * day, sizeBytes: 100 },
  { id: "a4", sessionId: "s1", createdAt: now - 1 * day, sizeBytes: 50 }, // recent
  { id: "b1", sessionId: "s2", createdAt: now - 30 * day, sizeBytes: 200 },
  { id: "b2", sessionId: "s2", createdAt: now - 20 * day, sizeBytes: 200 },
  { id: "b3", sessionId: "s2", createdAt: now - 15 * day, sizeBytes: 200 },
  { id: "b4", sessionId: "s2", createdAt: now - 14 * day, sizeBytes: 200 },
];

// keep 3 newest per session even if old
const { deleteIds, keepIds } = selectSnapshotsToPrune(snaps, {
  retentionDays: 7,
  keepPerSession: 3,
  now,
});
// s1 newest 3: a4,a3,a2 protected; a1 old unprotected => delete
assert(keepIds.has("a4") && keepIds.has("a3") && keepIds.has("a2"), "s1 keep 3");
assert(deleteIds.has("a1"), "s1 oldest deleted");
// s2 all older than 7d but keep 3 newest b4,b3,b2; delete b1
assert(keepIds.has("b4") && keepIds.has("b3") && keepIds.has("b2"), "s2 keep 3");
assert(deleteIds.has("b1"), "s2 oldest deleted");
assert(DEFAULT_KEEP_PER_SESSION === 3, "default keep 3");

// In-memory store prune
const store = {
  data: snaps.slice(),
  list() {
    return this.data;
  },
  deleteMany(ids: string[]) {
    const set = new Set(ids);
    const before = this.data.length;
    this.data = this.data.filter((s) => !set.has(s.id));
    return before - this.data.length;
  },
};
const pruner = new CheckpointPruner(store);
const result = await pruner.prune({ retentionDays: 7, now });
assert(result.snapshots_deleted === 2, `deleted 2 got ${result.snapshots_deleted}`);
assert(result.bytes_freed === 300, `bytes ${result.bytes_freed}`);
assert(result.duration_ms >= 0, "duration");
assert(store.data.length === 6, "remaining");

// CLI --days
assert(parsePruneDays(["checkpoint:prune", "--days", "14"]) === 14, "days 14");
assert(parsePruneDays(["checkpoint:prune"]) === 7, "default days");
const report = formatPruneReport(result);
assert(report.includes("snapshots_deleted=2"), "report");

// Concurrent: two prunes do not throw
await Promise.all([
  pruner.prune({ retentionDays: 7, now }),
  pruner.prune({ retentionDays: 7, now }),
]);

console.log("CheckpointPruner tests: passed");
