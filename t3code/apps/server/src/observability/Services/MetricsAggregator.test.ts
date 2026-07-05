import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import {
  calculatePercentile,
  makeMetricsAggregator,
  selectSlidingWindowBuffer,
  type AggregatedMetricsWindow,
} from "./MetricsAggregator.ts";

const getMethod = (windows: ReadonlyArray<AggregatedMetricsWindow>, method: string) =>
  windows.flatMap((window) => window.methods).find((entry) => entry.method === method);

const makeTestAggregator = (options?: Parameters<typeof makeMetricsAggregator>[0]) =>
  makeMetricsAggregator({
    autoRotate: false,
    ...options,
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()));

describe("MetricsAggregator", () => {
  it("calculates nearest-rank percentiles from a sorted array", () => {
    const sortedValues = [10, 20, 30, 40, 100];

    assert.equal(calculatePercentile(sortedValues, 50), 30);
    assert.equal(calculatePercentile(sortedValues, 95), 100);
    assert.equal(calculatePercentile(sortedValues, 99), 100);
  });

  it.effect("aggregates latency percentiles, error rate, and throughput per method", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeTestAggregator();

      for (const durationMs of [10, 20, 30, 40, 100]) {
        yield* aggregator.recordRpc({
          method: "rpc.metrics.aggregate",
          outcome: durationMs === 100 ? "failure" : "success",
          durationMs,
          observedAtMs: 1_000,
        });
      }

      const windows = yield* aggregator.snapshotAt(1_000);
      const method = getMethod(windows, "rpc.metrics.aggregate");

      assert.equal(method?.requestCount, 5);
      assert.equal(method?.successCount, 4);
      assert.equal(method?.failureCount, 1);
      assert.equal(method?.errorRate, 20);
      assert.equal(method?.throughput, 5 / 60);
      assert.deepStrictEqual(method?.latencyMs, {
        p50: 30,
        p95: 100,
        p99: 100,
      });
    }),
  );

  it.effect("rotates windows and returns the latest bounded sliding buffer", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeTestAggregator({
        windowMs: 1_000,
        windowCount: 3,
      });

      for (const observedAtMs of [0, 1_000, 2_000, 3_000, 4_000]) {
        yield* aggregator.recordRpc({
          method: "rpc.metrics.rotate",
          outcome: "success",
          durationMs: observedAtMs / 1_000 + 1,
          observedAtMs,
        });
      }

      const windows = yield* aggregator.snapshotAt(4_000);

      assert.equal(windows.length, 3);
      assert.deepStrictEqual(
        windows.map((window) => window.startMs),
        [2_000, 3_000, 4_000],
      );
      assert.equal(windows[2]?.methods[0]?.requestCount, 1);
      assert.equal(windows[2]?.startedAt, "1970-01-01T00:00:04.000Z");
    }),
  );

  it.effect("keeps request counts while bounding retained latency samples", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeTestAggregator({
        maxLatencySamplesPerMethod: 3,
      });

      for (const durationMs of [10, 20, 30, 40, 50]) {
        yield* aggregator.recordRpc({
          method: "rpc.metrics.samples",
          outcome: "success",
          durationMs,
          observedAtMs: 500,
        });
      }

      const windows = yield* aggregator.snapshotAt(500);
      const method = getMethod(windows, "rpc.metrics.samples");

      assert.equal(method?.requestCount, 5);
      assert.equal(method?.retainedSampleCount, 3);
      assert.deepStrictEqual(method?.latencyMs, {
        p50: 40,
        p95: 50,
        p99: 50,
      });
    }),
  );

  it.effect("uses Effect.Stream.sliding to select overlapping window slices", () =>
    Effect.gen(function* () {
      const latest = yield* selectSlidingWindowBuffer([1, 2, 3, 4, 5], 3);

      assert.deepStrictEqual(latest, [3, 4, 5]);
    }),
  );
});
