import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  calculatePercentile,
  calculatePercentiles,
  aggregateWindow,
  addToCircularBuffer,
  MetricsAggregator,
  type RpcMetric,
} from "./metricsAggregator"

describe("calculatePercentile", () => {
  it("should return 0 for empty array", () => expect(calculatePercentile([], 50)).toBe(0))
  it("should return single value", () => expect(calculatePercentile([42], 50)).toBe(42))
  it("should calculate correct percentiles", () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(calculatePercentile(sorted, 0)).toBe(10)
    expect(calculatePercentile(sorted, 50)).toBe(30)
    expect(calculatePercentile(sorted, 100)).toBe(50)
  })
})

describe("calculatePercentiles", () => {
  it("should return zeros for empty array", () => expect(calculatePercentiles([])).toEqual({ p50: 0, p95: 0, p99: 0 }))
  it("should calculate correct percentiles", () => {
    const result = calculatePercentiles([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(result.p50).toBeGreaterThan(0)
    expect(result.p95).toBeGreaterThan(result.p50)
  })
})

describe("aggregateWindow", () => {
  const createMetric = (method: string, latencyMs: number, isError: boolean): RpcMetric => ({
    method, latencyMs, isError, timestamp: Date.now(),
  })

  it("should aggregate empty metrics", () => {
    const result = aggregateWindow([], 0, 60000)
    expect(result.totalRequests).toBe(0)
    expect(result.errorRate).toBe(0)
  })

  it("should calculate correct totals", () => {
    const metrics = [createMetric("getUser", 100, false), createMetric("getUser", 200, true), createMetric("createPost", 150, false)]
    const result = aggregateWindow(metrics, 0, 60000)
    expect(result.totalRequests).toBe(3)
    expect(result.totalErrors).toBe(1)
  })

  it("should group by method correctly", () => {
    const metrics = [createMetric("getUser", 100, false), createMetric("getUser", 200, true), createMetric("createPost", 150, false)]
    const result = aggregateWindow(metrics, 0, 60000)
    expect(Object.keys(result.methods)).toHaveLength(2)
    expect(result.methods["getUser"].requestCount).toBe(2)
  })
})

describe("addToCircularBuffer", () => {
  it("should add items up to capacity", () => {
    let buffer: number[] = []
    buffer = addToCircularBuffer(buffer, 1, 3)
    expect(buffer).toEqual([1])
    buffer = addToCircularBuffer(buffer, 2, 3)
    expect(buffer).toEqual([1, 2])
    buffer = addToCircularBuffer(buffer, 3, 3)
    expect(buffer).toEqual([1, 2, 3])
  })

  it("should remove oldest items when at capacity", () => {
    const buffer = addToCircularBuffer([1, 2, 3], 4, 3)
    expect(buffer).toEqual([2, 3, 4])
  })
})

describe("MetricsAggregator", () => {
  const runTest = <A>(effect: Effect.Effect<A>) =>
    Effect.runPromise(effect.pipe(Effect.provide(MetricsAggregator.Default)))

  it("should record metrics", async () => {
    await runTest(Effect.gen(function* () {
      const aggregator = yield* MetricsAggregator
      yield* aggregator.record({ method: "getUser", latencyMs: 100, isError: false, timestamp: Date.now() })
      const state = yield* aggregator.getState
      expect(state.currentWindow).toHaveLength(1)
    }))
  })

  it("should rotate window correctly", async () => {
    await runTest(Effect.gen(function* () {
      const aggregator = yield* MetricsAggregator
      yield* aggregator.record({ method: "getUser", latencyMs: 100, isError: false, timestamp: Date.now() })
      yield* aggregator.record({ method: "createPost", latencyMs: 200, isError: true, timestamp: Date.now() })
      const window = yield* aggregator.rotateWindow
      expect(window.totalRequests).toBe(2)
      expect(window.totalErrors).toBe(1)
    }))
  })
})
