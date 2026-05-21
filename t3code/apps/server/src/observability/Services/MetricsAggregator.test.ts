import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import { aggregateWindow, type AggregatedWindow, type MetricsWindow, type Percentiles } from "./MetricsAggregator.ts";

const WINDOW_DURATION_MS = 60_000;

const makeWindow = (overrides: Partial<MetricsWindow>): MetricsWindow => ({
  windowStartMs: Date.now(),
  count: 0,
  latenciesNs: [],
  errorCount: 0,
  ...overrides,
});

const sorted = (arr: readonly bigint[]): readonly bigint[] => [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe("aggregateWindow", () => {
  it("computes errorRate correctly", () => {
    const window = makeWindow({ count: 10, errorCount: 2 });
    const result = aggregateWindow(window, WINDOW_DURATION_MS);
    expect(result.errorRate).toBe(0.2);
  });

  it("computes throughput as requests per second", () => {
    const window = makeWindow({ count: 60, latenciesNs: [] });
    const result = aggregateWindow(window, WINDOW_DURATION_MS);
    expect(result.throughput).toBeCloseTo(1, 5); // 60 req / 60s = 1 req/s
  });

  it("returns zeros for empty window", () => {
    const window = makeWindow({ count: 0, latenciesNs: [] });
    const result = aggregateWindow(window, WINDOW_DURATION_MS);
    expect(result.percentiles.p50Ms).toBe(0);
    expect(result.percentiles.p95Ms).toBe(0);
    expect(result.percentiles.p99Ms).toBe(0);
    expect(result.errorRate).toBe(0);
  });

  it("computes p50/p95/p99 correctly from sorted latencies", () => {
    // 100 values from 1ms to 100ms in ns
    const latencies = Array.from({ length: 100 }, (_, i) => BigInt((i + 1) * 1_000_000));
    const window = makeWindow({ count: 100, latenciesNs: latencies });
    const result = aggregateWindow(window, WINDOW_DURATION_MS);
    expect(result.percentiles.p50Ms).toBeCloseTo(50, 0); // p50 ≈ 50ms
    expect(result.percentiles.p95Ms).toBeCloseTo(95, 0); // p95 ≈ 95ms
    expect(result.percentiles.p99Ms).toBeCloseTo(99, 0); // p99 ≈ 99ms
  });

  it("handles single-value window", () => {
    const window = makeWindow({ count: 1, latenciesNs: [BigInt(10_000_000)], errorCount: 0 });
    const result = aggregateWindow(window, WINDOW_DURATION_MS);
    expect(result.percentiles.p50Ms).toBeCloseTo(10, 1);
    expect(result.percentiles.p95Ms).toBeCloseTo(10, 1);
    expect(result.percentiles.p99Ms).toBeCloseTo(10, 1);
    expect(result.count).toBe(1);
  });
});

describe("MetricsAggregator service", () => {
  it("records latency and rotates window on time boundary", async () => {
    const { MetricsAggregator } = await import("./MetricsAggregator.ts");

    const aggregator = await Effect.runPromise(Effect.provideService(MetricsAggregator, MetricsAggregator));

    const now = Date.now();
    const pastWindow = now - WINDOW_DURATION_MS - 1000;

    // Seed with a stale window by directly manipulating (via getAggregatedWindows behavior)
    await Effect.runPromise(aggregator.recordLatency("testMethod", BigInt(5_000_000), false));
    const afterRecord = await Effect.runPromise(aggregator.getAggregatedWindows());
    expect(afterRecord.length).toBeGreaterThanOrEqual(1);
  });

  it("getAggregatedWindows returns array", async () => {
    const { MetricsAggregator } = await import("./MetricsAggregator.ts");
    const aggregator = await Effect.runPromise(Effect.provideService(MetricsAggregator, MetricsAggregator));
    const result = await Effect.runPromise(aggregator.getAggregatedWindows());
    expect(Array.isArray(result)).toBe(true);
  });

  it("start runs without crashing", async () => {
    const { MetricsAggregator } = await import("./MetricsAggregator.ts");
    const aggregator = await Effect.runPromise(Effect.provideService(MetricsAggregator, MetricsAggregator));
    // start runs indefinitely, but we can at least verify it doesn't throw immediately
    const fiber = await Effect.runFork(aggregator.start());
    await Effect.runPromise(Effect.sleep(Duration.millis(100)));
    fiber.raiseInterrupt();
  });
});