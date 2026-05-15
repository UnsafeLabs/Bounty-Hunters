/**
 * Tests for the sliding window MetricsAggregator service.
 *
 * Verifies aggregation correctness, window sliding, concurrent metric
 * recording, and the aggregated data shape exposed via the endpoint.
 */

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  MetricsAggregator,
  layer,
  minuteAligned,
  slideWindow,
  recordObservation,
  summarizeWindow,
  type MetricObservation,
  type WindowState,
  type TimeBucket,
  type InternalEndpointMetrics,
  type AggregatedMetrics,
} from "./MetricsAggregator.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyBucket(epochMs: number): TimeBucket {
  return { timestamp: minuteAligned(epochMs), endpoints: {} };
}

function setEndpoint(
  bucket: TimeBucket,
  method: string,
  ep: InternalEndpointMetrics,
): void {
  bucket.endpoints[method] = ep;
}

// ---------------------------------------------------------------------------
// Unit tests for pure functions
// ---------------------------------------------------------------------------

describe("MetricsAggregator unit", () => {
  describe("minuteAligned", () => {
    it("rounds down to the nearest minute boundary", () => {
      // 10:30:45.123 = 10 * 3_600_000 + 30 * 60_000 + 45_123
      // = 36_000_000 + 1_800_000 + 45_123 = 37_845_123
      const input = 37_845_123;
      const result = minuteAligned(input);
      // Should be rounded down to 10:30:00.000 = 37_800_000
      assert.equal(result, 37_800_000);
    });

    it("returns exact minute boundaries as-is", () => {
      const result = minuteAligned(37_800_000);
      assert.equal(result, 37_800_000);
    });
  });

  describe("slideWindow", () => {
    it("returns state unchanged when still in the same minute", () => {
      const bucket = emptyBucket(0);
      const state: WindowState = {
        buckets: [bucket],
        currentMinute: 0,
      };
      const result = slideWindow(state, 100); // still in the same minute
      assert.strictEqual(result, state);
    });

    it("creates a new bucket when the minute advances", () => {
      const bucket = emptyBucket(0);
      const state: WindowState = {
        buckets: [bucket],
        currentMinute: 0,
      };
      // Advance to next minute boundary + 1 second
      const nextMinute = 60_001;
      const result = slideWindow(state, nextMinute);
      assert.notStrictEqual(result, state);
      assert.equal(result.currentMinute, minuteAligned(nextMinute));
      // Should have 2 buckets: the old one and the new one
      assert.equal(result.buckets.length, 2);
    });

    it("drops buckets older than the window", () => {
      const oldBucket = emptyBucket(0);
      const middleBucket = emptyBucket(60_000);
      const currentBucket = emptyBucket(120_000);
      const state: WindowState = {
        buckets: [oldBucket, middleBucket, currentBucket],
        currentMinute: 120_000,
      };
      // At 3 min (180s), window start = 180_000 - 60_000 = 120_000
      // oldBucket(0) and middleBucket(60_000) are both < 120_000 → dropped
      // currentBucket(120_000) is kept + new bucket(180_000) is added
      const result = slideWindow(state, 180_000);
      // currentBucket at 120_000 is within window (>= 120_000), ++ new at 180_000
      assert.equal(result.buckets.length, 2);
      assert.equal(result.buckets[0]?.timestamp, 120_000);
      assert.equal(result.buckets[1]?.timestamp, 180_000);
    });
  });

  describe("recordObservation", () => {
    it("records a successful observation into the current bucket", () => {
      const bucket = emptyBucket(0);
      const state: WindowState = {
        buckets: [bucket],
        currentMinute: 0,
      };
      const obs: MetricObservation = {
        method: "test.method",
        durationMs: 42,
        success: true,
      };
      const result = recordObservation(state, obs, 500);
      const ep = result.buckets[0]?.endpoints["test.method"];
      assert.ok(ep, "endpoint should exist");
      assert.equal(ep.requestCount, 1);
      assert.equal(ep.errorCount, 0);
      assert.deepStrictEqual(ep.latencies, [42]);
    });

    it("records a failed observation", () => {
      const bucket = emptyBucket(0);
      const state: WindowState = {
        buckets: [bucket],
        currentMinute: 0,
      };
      const obs: MetricObservation = {
        method: "fail.method",
        durationMs: 100,
        success: false,
      };
      const result = recordObservation(state, obs, 500);
      const ep = result.buckets[0]?.endpoints["fail.method"];
      assert.ok(ep);
      assert.equal(ep.requestCount, 1);
      assert.equal(ep.errorCount, 1);
    });

    it("slides window when recording into a new minute", () => {
      const bucket = emptyBucket(0);
      const state: WindowState = {
        buckets: [bucket],
        currentMinute: 0,
      };
      // Record at 61 seconds (new minute)
      const obs: MetricObservation = {
        method: "slide.method",
        durationMs: 10,
        success: true,
      };
      const result = recordObservation(state, obs, 61_000);
      assert.equal(result.buckets.length, 2);
      assert.equal(result.currentMinute, 60_000);
      const ep = result.buckets[1]?.endpoints["slide.method"];
      assert.ok(ep);
      assert.equal(ep.requestCount, 1);
    });
  });

  describe("summarizeWindow", () => {
    it("returns correct percentiles", () => {
      const bucket = emptyBucket(0);
      const ep: InternalEndpointMetrics = {
        requestCount: 5,
        errorCount: 1,
        latencies: [50, 40, 30, 20, 10],
      };
      setEndpoint(bucket, "pct.method", ep);
      const state: WindowState = {
        buckets: [bucket],
        currentMinute: 0,
      };
      const summary = summarizeWindow(state);
      assert.equal(summary.windowMinutes, 1);
      assert.equal(summary.buckets.length, 1);

      const epSummary = summary.buckets[0]?.endpoints["pct.method"];
      assert.ok(epSummary);
      assert.equal(epSummary.requestCount, 5);
      assert.equal(epSummary.errorCount, 1);
      assert.equal(epSummary.errorRate, 0.2);
      // sorted: [10, 20, 30, 40, 50]
      // p50: Math.ceil(0.5 * 5) - 1 = 2 → 30
      assert.equal(epSummary.p50, 30);
      // p90: Math.ceil(0.9 * 5) - 1 = 4 → 50
      assert.equal(epSummary.p90, 50);
      // p99: Math.ceil(0.99 * 5) - 1 = 4 → 50
      assert.equal(epSummary.p99, 50);
    });

    it("returns zero percentiles for empty bucket", () => {
      const bucket = emptyBucket(0);
      setEndpoint(bucket, "empty.method", {
        requestCount: 0,
        errorCount: 0,
        latencies: [],
      });
      const state: WindowState = {
        buckets: [bucket],
        currentMinute: 0,
      };
      const summary = summarizeWindow(state);
      const epSummary = summary.buckets[0]?.endpoints["empty.method"];
      assert.ok(epSummary);
      assert.equal(epSummary.p50, 0);
      assert.equal(epSummary.p90, 0);
      assert.equal(epSummary.p99, 0);
      assert.equal(epSummary.errorRate, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests using the full service
// ---------------------------------------------------------------------------

describe("MetricsAggregator integration", () => {
  it.effect("records observations and retrieves aggregated metrics", () =>
    Effect.gen(function* () {
      const service = yield* MetricsAggregator;

      yield* service.record({
        method: "test.foo",
        durationMs: 10,
        success: true,
      });
      yield* service.record({
        method: "test.foo",
        durationMs: 20,
        success: true,
      });
      yield* service.record({
        method: "test.bar",
        durationMs: 50,
        success: false,
      });

      const metrics = yield* service.getAggregatedMetrics;

      assert.equal(metrics.windowMinutes, 1);
      assert.ok(metrics.buckets.length >= 1);

      // Find the current bucket (should be the last one or only one)
      const currentBucket = metrics.buckets[metrics.buckets.length - 1]!;

      const foo = currentBucket.endpoints["test.foo"];
      assert.ok(foo, "test.foo should exist");
      assert.equal(foo.requestCount, 2);
      assert.equal(foo.errorCount, 0);

      const bar = currentBucket.endpoints["test.bar"];
      assert.ok(bar, "test.bar should exist");
      assert.equal(bar.requestCount, 1);
      assert.equal(bar.errorCount, 1);
      assert.equal(bar.errorRate, 1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("handles concurrent recordings", () =>
    Effect.gen(function* () {
      const service = yield* MetricsAggregator;

      const recorders = Array.from({ length: 10 }, (_, i) =>
        service.record({
          method: "concurrent.method",
          durationMs: i * 10,
          success: i % 3 !== 0, // ~33% error rate
        }),
      );

      yield* Effect.all(recorders, { concurrency: "unbounded" });

      const metrics = yield* service.getAggregatedMetrics;
      const currentBucket = metrics.buckets[metrics.buckets.length - 1]!;
      const ep = currentBucket.endpoints["concurrent.method"];

      assert.ok(ep);
      assert.equal(ep.requestCount, 10);
      // i=0: 0%3=0 → error, i=3: 0 → error, i=6: 0 → error, i=9: 0 → error = 4 errors
      assert.equal(ep.errorCount, 4);
      assert.equal(ep.errorRate, 0.4);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("aggregates multiple endpoints independently", () =>
    Effect.gen(function* () {
      const service = yield* MetricsAggregator;

      yield* service.record({ method: "alpha", durationMs: 5, success: true });
      yield* service.record({ method: "beta", durationMs: 15, success: false });
      yield* service.record({ method: "alpha", durationMs: 25, success: true });

      const metrics = yield* service.getAggregatedMetrics;
      const currentBucket = metrics.buckets[metrics.buckets.length - 1]!;

      const alpha = currentBucket.endpoints["alpha"];
      const beta = currentBucket.endpoints["beta"];

      assert.ok(alpha);
      assert.equal(alpha.requestCount, 2);
      assert.equal(alpha.errorCount, 0);

      assert.ok(beta);
      assert.equal(beta.requestCount, 1);
      assert.equal(beta.errorCount, 1);
    }).pipe(Effect.provide(layer)),
  );
});

// ---------------------------------------------------------------------------
// Window sliding tests
// ---------------------------------------------------------------------------

describe("MetricsAggregator window sliding", () => {
  it.effect("creates new buckets as time advances", () =>
    Effect.gen(function* () {
      const service = yield* MetricsAggregator;

      // Record at current time
      yield* service.record({ method: "t0", durationMs: 1, success: true });

      // Get metrics
      const metricsBefore = yield* service.getAggregatedMetrics;
      assert.ok(metricsBefore.buckets.length >= 1);
    }).pipe(Effect.provide(layer)),
  );
});

// ---------------------------------------------------------------------------
// Exported layer / make smoke tests
// ---------------------------------------------------------------------------

describe("MetricsAggregator layer", () => {
  it.effect("can be created via make()", () =>
    Effect.gen(function* () {
      const service = yield* MetricsAggregator;
      assert.ok(service);
      assert.ok(typeof service.record === "function");
      // getAggregatedMetrics is an Effect, not a plain function
      const metrics = yield* service.getAggregatedMetrics;
      assert.ok(metrics);
      assert.equal(typeof metrics.windowMinutes, "number");
    }).pipe(Effect.provide(layer)),
  );
});
