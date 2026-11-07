import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { MetricsAggregator, MetricsAggregatorLive } from "./MetricsAggregator.ts";

const runTest = <A>(effect: Effect.Effect<A, never, MetricsAggregator>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(MetricsAggregatorLive)));

describe("MetricsAggregator", () => {
  describe("record and getWindows", () => {
    it("should record a sample and return it in the current window", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("test.method", 1_000_000, false);
          const windows = yield* aggregator.getWindows;
          return windows;
        }),
      );

      expect(result.length).toBe(1);
      const window = result[0]!;
      expect(window.methods["test.method"]).toBeDefined();
      expect(window.methods["test.method"]!.totalCount).toBe(1);
      expect(window.methods["test.method"]!.errorCount).toBe(0);
    });

    it("should track multiple methods independently", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("method.a", 100, false);
          yield* aggregator.record("method.b", 200, true);
          yield* aggregator.record("method.a", 150, false);
          return yield* aggregator.getWindows;
        }),
      );

      const window = result[0]!;
      expect(window.methods["method.a"]!.totalCount).toBe(2);
      expect(window.methods["method.a"]!.errorCount).toBe(0);
      expect(window.methods["method.b"]!.totalCount).toBe(1);
      expect(window.methods["method.b"]!.errorCount).toBe(1);
    });
  });

  describe("getAggregated - percentile calculation", () => {
    it("should compute p50/p95/p99 from latency samples", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
          for (const s of samples) {
            yield* aggregator.record("rpc.test", s, false);
          }
          return yield* aggregator.getAggregated;
        }),
      );

      const window = result[0]!;
      const metrics = window.methods["rpc.test"]!;
      expect(metrics.p50Ns).toBe(50);
      expect(metrics.p95Ns).toBe(100);
      expect(metrics.p99Ns).toBe(100);
    });

    it("should return 0 for empty samples", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          return yield* aggregator.getAggregated;
        }),
      );

      expect(result.length).toBe(0);
    });

    it("should handle single sample correctly", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("rpc.single", 42, false);
          return yield* aggregator.getAggregated;
        }),
      );

      const metrics = result[0]!.methods["rpc.single"]!;
      expect(metrics.p50Ns).toBe(42);
      expect(metrics.p95Ns).toBe(42);
      expect(metrics.p99Ns).toBe(42);
    });
  });

  describe("error rate", () => {
    it("should calculate error rate as percentage", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("rpc.mixed", 100, false);
          yield* aggregator.record("rpc.mixed", 100, false);
          yield* aggregator.record("rpc.mixed", 100, true);
          yield* aggregator.record("rpc.mixed", 100, true);
          return yield* aggregator.getAggregated;
        }),
      );

      const metrics = result[0]!.methods["rpc.mixed"]!;
      expect(metrics.errorRate).toBe(50);
      expect(metrics.totalCount).toBe(4);
      expect(metrics.errorCount).toBe(2);
    });

    it("should return 0 error rate when no errors", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("rpc.ok", 100, false);
          yield* aggregator.record("rpc.ok", 100, false);
          return yield* aggregator.getAggregated;
        }),
      );

      expect(result[0]!.methods["rpc.ok"]!.errorRate).toBe(0);
    });
  });

  describe("throughput", () => {
    it("should calculate throughput as requests per second", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("rpc.throughput", 100, false);
          yield* aggregator.record("rpc.throughput", 100, false);
          yield* aggregator.record("rpc.throughput", 100, false);
          return yield* aggregator.getAggregated;
        }),
      );

      const metrics = result[0]!.methods["rpc.throughput"]!;
      expect(metrics.throughput).toBeGreaterThan(0);
      expect(metrics.totalCount).toBe(3);
    });
  });

  describe("circular buffer bounds", () => {
    it("should retain at most 60 windows", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          const windows = yield* aggregator.getWindows;
          return windows.length;
        }),
      );

      expect(result).toBeLessThanOrEqual(60);
    });
  });

  describe("reset", () => {
    it("should clear all windows and current data", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("rpc.test", 100, false);
          yield* aggregator.reset;
          const windows = yield* aggregator.getWindows;
          const aggregated = yield* aggregator.getAggregated;
          return { windows, aggregated };
        }),
      );

      expect(result.windows.length).toBe(0);
      expect(result.aggregated.length).toBe(0);
    });
  });

  describe("window timestamps", () => {
    it("should set startTimeMs and endTimeMs on windows", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          yield* aggregator.record("rpc.test", 100, false);
          return yield* aggregator.getWindows;
        }),
      );

      const window = result[0]!;
      expect(window.startTimeMs).toBeLessThan(window.endTimeMs);
      expect(window.endTimeMs - window.startTimeMs).toBe(60_000);
    });
  });

  describe("memory safety", () => {
    it("should bound memory regardless of sample volume", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const aggregator = yield* MetricsAggregator;
          for (let i = 0; i < 10_000; i++) {
            yield* aggregator.record("rpc.flood", i, i % 10 === 0);
          }
          const aggregated = yield* aggregator.getAggregated;
          const windows = yield* aggregator.getWindows;
          return { aggregated, windowCount: windows.length };
        }),
      );

      expect(result.windowCount).toBeLessThanOrEqual(61);
      expect(result.aggregated.length).toBeLessThanOrEqual(61);
    });
  });
});
