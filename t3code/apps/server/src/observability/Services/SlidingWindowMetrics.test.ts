import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as Scope from "effect/Scope";

import { SlidingWindowMetrics, makeSlidingWindowMetrics } from "./SlidingWindowMetrics.ts";

const hasGaugeSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
): boolean =>
  snapshots.some(
    (snapshot) => snapshot.id === id && snapshot.type === "Gauge",
  );

describe("SlidingWindowMetrics", () => {
  it.effect("records events and updates rate metrics", () =>
    Effect.gen(function* () {
      const metrics = yield* makeSlidingWindowMetrics.pipe(
        Effect.provide(Scope.makeLayer),
      );

      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        yield* metrics.recordEvent({ timestamp: now - i * 1000, isError: i === 0 });
      }

      const snapshots = yield* Metric.snapshot;
      assert.equal(
        hasGaugeSnapshot(snapshots, "t3_sliding_request_rate_1m"),
        true,
      );
      assert.equal(
        hasGaugeSnapshot(snapshots, "t3_sliding_error_rate_1m"),
        true,
      );
      assert.equal(
        hasGaugeSnapshot(snapshots, "t3_sliding_request_rate_5m"),
        true,
      );
      assert.equal(
        hasGaugeSnapshot(snapshots, "t3_sliding_request_rate_15m"),
        true,
      );
    }),
  );

  it.effect("has latency histogram with configured boundaries", () =>
    Effect.gen(function* () {
      const metrics = yield* makeSlidingWindowMetrics.pipe(
        Effect.provide(Scope.makeLayer),
      );

      yield* metrics.recordEvent({ timestamp: Date.now(), isError: false });

      const snapshots = yield* Metric.snapshot;
      const histograms = snapshots.filter((s) => s.id === "t3_sliding_request_latency");
      assert.equal(histograms.length, 1);
    }),
  );
});
