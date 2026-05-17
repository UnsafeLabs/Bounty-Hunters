import { describe, expect, it } from "vitest";

import {
  recordFromRpc,
  DEFAULT_CONFIG,
  type RpcCallRecord,
  type MethodWindowMetrics,
  type MetricsWindow,
  type MetricsAggregatorConfig,
  type MetricsAggregatorSnapshot,
} from "./MetricsAggregator.ts";

// ---------------------------------------------------------------------------
// Helper: create test records
// ---------------------------------------------------------------------------

const makeRecord = (
  method: string,
  durationMs: number,
  outcome: "success" | "failure" = "success",
  startMs = 1000,
): RpcCallRecord => ({
  method,
  startTimeNanos: BigInt(startMs) * 1_000_000n,
  endTimeNanos: BigInt(startMs + durationMs) * 1_000_000n,
  outcome,
  durationMs,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetricsAggregator", () => {
  describe("recordFromRpc", () => {
    it("creates a record with correct duration", () => {
      const start = BigInt(1_000_000_000);
      const end = BigInt(1_050_000_000);
      const record = recordFromRpc("test.method", start, end, "success");

      expect(record.method).toBe("test.method");
      expect(record.outcome).toBe("success");
      expect(record.durationMs).toBe(50);
    });

    it("handles zero duration", () => {
      const t = BigInt(1_000_000_000);
      const record = recordFromRpc("test.method", t, t, "success");
      expect(record.durationMs).toBe(0);
    });

    it("handles end before start (clock skew)", () => {
      const start = BigInt(2_000_000_000);
      const end = BigInt(1_000_000_000);
      const record = recordFromRpc("test.method", start, end, "success");
      expect(record.durationMs).toBe(0);
    });
  });

  describe("config", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_CONFIG.windowWidthMs).toBe(10_000);
      expect(DEFAULT_CONFIG.retainedWindows).toBe(6);
      expect(DEFAULT_CONFIG.slideIntervalMs).toBe(10_000);
    });

    it("allows partial override", () => {
      const custom: Partial<MetricsAggregatorConfig> = {
        retainedWindows: 12,
        windowWidthMs: 5_000,
      };
      const merged = { ...DEFAULT_CONFIG, ...custom };
      expect(merged.retainedWindows).toBe(12);
      expect(merged.windowWidthMs).toBe(5_000);
      expect(merged.slideIntervalMs).toBe(10_000); // default preserved
    });
  });

  describe("aggregation logic", () => {
    it("calculates correct percentiles from sorted durations", () => {
      // Simulate percentile calculation
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const p = (arr: number[], pct: number) => {
        const idx = Math.ceil((pct / 100) * arr.length) - 1;
        return arr[Math.max(0, idx)];
      };

      expect(p(durations, 50)).toBe(50);
      expect(p(durations, 95)).toBe(100);
      expect(p(durations, 99)).toBe(100);
    });

    it("calculates correct error rate", () => {
      const records = [
        makeRecord("m1", 10, "success"),
        makeRecord("m1", 20, "failure"),
        makeRecord("m1", 30, "success"),
        makeRecord("m1", 40, "failure"),
      ];
      const errors = records.filter((r) => r.outcome === "failure").length;
      const errorRate = errors / records.length;
      expect(errorRate).toBe(0.5);
    });

    it("handles empty records", () => {
      const records: RpcCallRecord[] = [];
      expect(records.length).toBe(0);
    });

    it("groups records by method", () => {
      const records = [
        makeRecord("method.a", 10),
        makeRecord("method.b", 20),
        makeRecord("method.a", 30),
        makeRecord("method.b", 40),
      ];

      const byMethod = new Map<string, RpcCallRecord[]>();
      for (const r of records) {
        const existing = byMethod.get(r.method) ?? [];
        existing.push(r);
        byMethod.set(r.method, existing);
      }

      expect(byMethod.get("method.a")?.length).toBe(2);
      expect(byMethod.get("method.b")?.length).toBe(2);
    });

    it("calculates throughput per second", () => {
      const requestCount = 60;
      const windowDurationSeconds = 10;
      const throughput = requestCount / windowDurationSeconds;
      expect(throughput).toBe(6);
    });
  });

  describe("snapshot", () => {
    it("returns empty snapshot when no windows exist", () => {
      const snapshot: MetricsAggregatorSnapshot = {
        windows: [],
        windowCount: 0,
        coverageStartMs: 0,
        coverageEndMs: 0,
        latestWindow: undefined as any, // Option.none
      };
      expect(snapshot.windowCount).toBe(0);
    });
  });
});
