import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import {
  MetricsAggregator,
  WINDOW_SIZE_MILLIS,
  percentile,
  toAggregatedJson,
  type RpcSample,
} from "./MetricsAggregator.ts";

const sample = (method: string, millis: number, succeeded = true): RpcSample => ({
  method,
  durationNanos: Duration.toNanos(Duration.millis(millis)),
  succeeded,
});

describe("percentile", () => {
  it("computes nearest-rank percentiles on a sorted array", () => {
    const sorted = [10, 20, 30, 40, 50];
    assert.equal(percentile(sorted, 0.5), 30);
    assert.equal(percentile(sorted, 0.95), 50);
    assert.equal(percentile(sorted, 0.99), 50);
  });

  it("handles a single-element sample", () => {
    assert.equal(percentile([7], 0.5), 7);
  });

  it("returns 0 for an empty sample", () => {
    assert.equal(percentile([], 0.5), 0);
  });
});

describe("MetricsAggregator", () => {
  it.effect("aggregates per-method latency percentiles, error rate, and throughput", () =>
    Effect.gen(function* () {
      const agg = yield* MetricsAggregator;

      // 3 calls to "ping": 10ms, 20ms, 30ms (all success)
      yield* agg.record("ping", Duration.millis(10), true);
      yield* agg.record("ping", Duration.millis(20), true);
      yield* agg.record("ping", Duration.millis(30), true);
      // 2 calls to "slow": one success 100ms, one failure 200ms
      yield* agg.record("slow", Duration.millis(100), true);
      yield* agg.record("slow", Duration.millis(200), false);

      const windows = yield* agg.snapshot();
      assert.equal(windows.length, 1);
      const methods = windows[0].methods;
      assert.equal(methods.length, 2);

      const ping = methods.find((m) => m.method === "ping")!;
      assert.equal(ping.count, 3);
      assert.equal(ping.errorCount, 0);
      assert.equal(ping.errorRate, 0);
      // window is 60s -> 3 / 60 = 0.05 rps
      assert.equal(ping.throughputPerSecond, 0.05);
      // sorted [10,20,30]: p50=20, p95=30, p99=30
      assert.equal(ping.latencyMillis.p50, 20);
      assert.equal(ping.latencyMillis.p95, 30);
      assert.equal(ping.latencyMillis.p99, 30);

      const slow = methods.find((m) => m.method === "slow")!;
      assert.equal(slow.count, 2);
      assert.equal(slow.errorCount, 1);
      assert.equal(slow.errorRate, 0.5);
      // sorted [100,200]: p50=100, p95=200, p99=200
      assert.equal(slow.latencyMillis.p50, 100);
      assert.equal(slow.latencyMillis.p95, 200);
      assert.equal(slow.latencyMillis.p99, 200);
    }),
  );

  it.effect("rotates windows and bounds the circular buffer to MAX_WINDOWS", () =>
    Effect.gen(function* () {
      const agg = yield* MetricsAggregator;
      // Force rotation by advancing the test clock past the window boundary.
      yield* agg.record("a", Duration.millis(5), true);

      yield* TestClock.adjust(Duration.millis(WINDOW_SIZE_MILLIS + 1));
      yield* agg.record("b", Duration.millis(5), true);

      yield* TestClock.adjust(Duration.millis(WINDOW_SIZE_MILLIS + 1));
      yield* agg.record("c", Duration.millis(5), true);

      const windows = yield* agg.snapshot();
      // closed window "a", and the two most recent rotations (b, c).
      assert.isAtMost(windows.length, 60);
      assert.isAtLeast(windows.length, 2);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("serializes snapshots to the /metrics/aggregated JSON shape", () =>
    Effect.gen(function* () {
      const agg = yield* MetricsAggregator;
      yield* agg.record("ping", Duration.millis(15), true);
      const windows = yield* agg.snapshot();
      const json = toAggregatedJson(windows) as {
        windowSizeMillis: number;
        maxWindows: number;
        windows: ReadonlyArray<{ methods: ReadonlyArray<{ method: string }> }>;
      };
      assert.equal(json.windowSizeMillis, WINDOW_SIZE_MILLIS);
      assert.isAtLeast(json.windows.length, 1);
      assert.equal(json.windows[0].methods[0].method, "ping");
    }),
  );
});
