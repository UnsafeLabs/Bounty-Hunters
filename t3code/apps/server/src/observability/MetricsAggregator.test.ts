import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  aggregateRpcMetricSamples,
  makeMetricsAggregatorLive,
  MetricsAggregator,
} from "./Services/MetricsAggregator.ts";

describe("MetricsAggregator", () => {
  it.effect("calculates per-method percentiles, error rate, and throughput", () =>
    Effect.gen(function* () {
      const windows = yield* aggregateRpcMetricSamples(
        [
          {
            method: "server.echo",
            outcome: "success",
            durationMs: 10,
            timestampMs: 60_000,
          },
          {
            method: "server.echo",
            outcome: "failure",
            durationMs: 20,
            timestampMs: 61_000,
          },
          {
            method: "server.echo",
            outcome: "success",
            durationMs: 30,
            timestampMs: 62_000,
          },
          {
            method: "server.echo",
            outcome: "success",
            durationMs: 40,
            timestampMs: 63_000,
          },
          {
            method: "server.echo",
            outcome: "success",
            durationMs: 50,
            timestampMs: 64_000,
          },
        ],
        {
          nowMs: 120_000,
          windowCount: 1,
          windowSizeMs: 60_000,
          windowStepMs: 60_000,
        },
      );

      const methodMetrics = windows[0]?.methods[0];
      assert.equal(windows.length, 1);
      assert.equal(windows[0]?.sampleCount, 5);
      assert.equal(methodMetrics?.method, "server.echo");
      assert.equal(methodMetrics?.requestCount, 5);
      assert.equal(methodMetrics?.errorCount, 1);
      assert.equal(methodMetrics?.errorRate, 20);
      assert.equal(methodMetrics?.throughputPerSecond, 5 / 60);
      assert.equal(methodMetrics?.p50Ms, 30);
      assert.equal(methodMetrics?.p95Ms, 50);
      assert.equal(methodMetrics?.p99Ms, 50);
    }),
  );

  it.effect("uses Effect.Stream.sliding to build overlapping windows", () =>
    Effect.gen(function* () {
      const windows = yield* aggregateRpcMetricSamples(
        [
          {
            method: "server.first",
            outcome: "success",
            durationMs: 10,
            timestampMs: 60_000,
          },
          {
            method: "server.second",
            outcome: "success",
            durationMs: 20,
            timestampMs: 90_000,
          },
        ],
        {
          nowMs: 120_000,
          windowCount: 3,
          windowSizeMs: 60_000,
          windowStepMs: 30_000,
        },
      );

      assert.equal(windows.length, 3);
      assert.deepEqual(
        windows.map((window) => [window.startedAtMs, window.endedAtMs, window.sampleCount]),
        [
          [0, 60_000, 0],
          [30_000, 90_000, 1],
          [60_000, 120_000, 2],
        ],
      );
    }),
  );

  it.effect("retains exactly the configured number of windows", () =>
    Effect.gen(function* () {
      const windows = yield* aggregateRpcMetricSamples(
        Array.from({ length: 120 }, (_, index) => ({
          method: "server.rotate",
          outcome: "success" as const,
          durationMs: index,
          timestampMs: index * 60_000,
        })),
        {
          nowMs: 120 * 60_000,
          windowCount: 60,
          windowSizeMs: 60_000,
          windowStepMs: 60_000,
        },
      );

      assert.equal(windows.length, 60);
      assert.equal(windows[0]?.startedAtMs, 60 * 60_000);
      assert.equal(windows[59]?.endedAtMs, 120 * 60_000);
    }),
  );

  it.effect("bounds retained samples regardless of request volume", () =>
    Effect.gen(function* () {
      const metricsAggregator = yield* MetricsAggregator;

      for (let index = 0; index < 10; index += 1) {
        yield* metricsAggregator.recordRpcSample({
          method: "server.bounded",
          outcome: "success",
          durationMs: index,
          timestampMs: index * 1_000,
        });
      }

      const windows = yield* metricsAggregator.snapshot(10_000);
      const retainedSampleCount = windows.reduce((count, window) => count + window.sampleCount, 0);

      assert.equal(windows.length, 2);
      assert.isAtMost(retainedSampleCount, 3);
    }).pipe(
      Effect.provide(
        makeMetricsAggregatorLive({
          maxSamples: 3,
          pruneIntervalMs: 60_000,
          windowCount: 2,
          windowSizeMs: 10_000,
          windowStepMs: 10_000,
        }),
      ),
    ),
  );
});
