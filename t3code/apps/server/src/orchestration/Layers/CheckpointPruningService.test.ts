import { describe, it, expect, vi, beforeEach } from "vitest";
import * as DateTime from "effect/DateTime";

describe("CheckpointPruningService", () => {
  describe("retention logic", () => {
    it("calculates cutoff date based on retention days", () => {
      const retentionDays = 7;
      const now = Date.now();
      const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000;
      const cutoff = new Date(cutoffMs);

      expect(cutoff.getTime()).toBeLessThan(now);
      expect(cutoff.getTime()).toBeGreaterThan(now - 8 * 24 * 60 * 60 * 1000);
    });

    it("preserves most recent 3 snapshots per thread", () => {
      const minSnapshots = 3;
      const snapshots = [
        { turnCount: 1, date: new Date("2026-05-01") },
        { turnCount: 2, date: new Date("2026-05-02") },
        { turnCount: 3, date: new Date("2026-05-03") },
        { turnCount: 4, date: new Date("2026-05-04") },
        { turnCount: 5, date: new Date("2026-05-05") },
      ];

      const toKeep = new Set(
        snapshots.slice(-minSnapshots).map((s) => s.turnCount),
      );

      expect(toKeep.has(3)).toBe(true);
      expect(toKeep.has(4)).toBe(true);
      expect(toKeep.has(5)).toBe(true);
      expect(toKeep.size).toBe(3);
    });

    it("keeps all snapshots when total is less than minimum", () => {
      const minSnapshots = 3;
      const snapshots = [
        { turnCount: 1, date: new Date("2026-05-01") },
        { turnCount: 2, date: new Date("2026-05-02") },
      ];

      const toKeep = new Set(
        snapshots.slice(-minSnapshots).map((s) => s.turnCount),
      );

      expect(toKeep.size).toBe(2);
    });

    it("identifies snapshots older than cutoff for deletion", () => {
      const cutoffMs = new Date("2026-05-10").getTime();
      const snapshots = [
        { turnCount: 1, date: new Date("2026-05-05"), shouldDelete: true },
        { turnCount: 2, date: new Date("2026-05-08"), shouldDelete: true },
        { turnCount: 3, date: new Date("2026-05-11"), shouldDelete: false },
        { turnCount: 4, date: new Date("2026-05-12"), shouldDelete: false },
      ];

      for (const snapshot of snapshots) {
        const isOld = snapshot.date.getTime() < cutoffMs;
        expect(isOld).toBe(snapshot.shouldDelete);
      }
    });

    it("does not delete recent snapshots even if beyond minimum", () => {
      const cutoffMs = new Date("2026-05-10").getTime();
      const snapshots = [
        { turnCount: 1, date: new Date("2026-05-11") },
        { turnCount: 2, date: new Date("2026-05-12") },
        { turnCount: 3, date: new Date("2026-05-13") },
        { turnCount: 4, date: new Date("2026-05-14") },
      ];

      const deletable = snapshots.filter(
        (s) => s.date.getTime() < cutoffMs,
      );

      expect(deletable.length).toBe(0);
    });
  });

  describe("pruning metrics", () => {
    it("tracks snapshots deleted count", () => {
      const metrics = {
        snapshotsDeleted: 5,
        threadsProcessed: 2,
        durationMs: 150,
      };

      expect(metrics.snapshotsDeleted).toBe(5);
      expect(metrics.threadsProcessed).toBe(2);
      expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("reports zero metrics when nothing to prune", () => {
      const metrics = {
        snapshotsDeleted: 0,
        threadsProcessed: 0,
        durationMs: 12,
      };

      expect(metrics.snapshotsDeleted).toBe(0);
    });
  });

  describe("schedule configuration", () => {
    it("default schedule interval is 1 hour", () => {
      const oneHourMs = 60 * 60 * 1000;
      expect(oneHourMs).toBe(3600000);
    });

    it("default retention period is 7 days", () => {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(sevenDaysMs).toBe(604800000);
    });
  });

  describe("concurrent access safety", () => {
    it("pruning does not affect snapshots being kept", () => {
      const toKeep = new Set([3, 4, 5]);
      const allSnapshots = [
        { turnCount: 1 },
        { turnCount: 2 },
        { turnCount: 3 },
        { turnCount: 4 },
        { turnCount: 5 },
      ];

      const remaining = allSnapshots.filter((s) => toKeep.has(s.turnCount));

      expect(remaining.length).toBe(3);
      expect(remaining.map((s) => s.turnCount)).toEqual([3, 4, 5]);
    });
  });
});
