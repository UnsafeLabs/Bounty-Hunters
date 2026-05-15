import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import {
  aggregateSlidingMetricBuckets,
  MetricsAggregator,
  makeMetricsAggregatorTestLayer,
  percentileFromSorted,
  type RpcMetricBucket,
} from "./MetricsAggregator.ts";

const makeBucket = (
  bucketStartMs: number,
  latenciesMs: ReadonlyArray<number>,
  options?: {
    readonly method?: string;
    readonly errorCount?: number;
    readonly bucketSizeMs?: number;
  },
): RpcMetricBucket => ({
  bucketStartMs,
  bucketEndMs: bucketStartMs + (options?.bucketSizeMs ?? 30_000),
  methods: [
    {
      method: options?.method ?? "server.getConfig",
      requestCount: latenciesMs.length,
      errorCount: options?.errorCount ?? 0,
      latenciesMs,
    },
  ],
});

describe("MetricsAggregator", () => {
  it("calculates percentiles from a sorted latency array", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    assert.equal(percentileFromSorted(sorted, 50), 50);
    assert.equal(percentileFromSorted(sorted, 95), 100);
    assert.equal(percentileFromSorted(sorted, 99), 100);
  });

  it.effect("aggregates overlapping sliding windows with Effect.Stream.sliding", () =>
    Effect.gen(function* () {
      const windows = yield* aggregateSlidingMetricBuckets(
        [
          makeBucket(0, [10], { bucketSizeMs: 30_000 }),
          makeBucket(30_000, [20], { bucketSizeMs: 30_000 }),
          makeBucket(60_000, [30], { bucketSizeMs: 30_000 }),
        ],
        {
          windowSizeMs: 60_000,
          bucketSizeMs: 30_000,
        },
      );

      assert.equal(windows.length, 2);
      assert.deepEqual(
        windows.map((window) => window.windowStartMs),
        [0, 30_000],
      );
      assert.deepEqual(
        windows.map((window) => window.methods[0]?.requestCount),
        [2, 2],
      );
      assert.deepEqual(
        windows.map((window) => window.methods[0]?.p50LatencyMs),
        [10, 20],
      );
    }),
  );

  it.effect("rotates windows and retains exactly the configured circular buffer size", () =>
    Effect.gen(function* () {
      const aggregator = yield* MetricsAggregator;

      for (let index = 0; index < 61; index += 1) {
        yield* aggregator.recordAt({
          method: "server.getConfig",
          latencyMs: index,
          failed: index % 10 === 0,
          timestampMs: index * 60_000,
        });
      }

      yield* TestClock.adjust(Duration.minutes(62));
      yield* aggregator.rotate;

      const windows = yield* aggregator.snapshot;
      assert.equal(windows.length, 60);
      assert.equal(windows[0]?.windowStartMs, 60_000);
      assert.equal(windows[59]?.windowStartMs, 60 * 60_000);
      assert.equal(windows[9]?.methods[0]?.errorRate, 100);
      assert.equal(windows[9]?.methods[0]?.throughput, 1 / 60);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeMetricsAggregatorTestLayer({
            retainedWindowCount: 60,
            windowSizeMs: 60_000,
            bucketSizeMs: 60_000,
          }),
          TestClock.layer(),
        ),
      ),
    ),
  );
});
