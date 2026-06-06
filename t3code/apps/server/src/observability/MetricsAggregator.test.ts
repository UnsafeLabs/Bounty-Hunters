import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import {
  aggregateWindow,
  computeSlidingWindows,
  type MethodMetricsWindow,
  MetricsAggregator,
  MetricsAggregatorLive,
  percentile,
} from "./MetricsAggregator.ts";
import { observeRpcEffect } from "./RpcInstrumentation.ts";

describe("MetricsAggregator", () => {
  it("calculates percentiles with a sorted array approach", () => {
    const values = [100, 10, 500, 200, 50];

    assert.equal(percentile(values, 50), 100);
    assert.equal(percentile(values, 95), 500);
    assert.equal(percentile(values, 99), 500);
  });

  it("aggregates per-method latency, error rate, and throughput", () => {
    const window = aggregateWindow(
      [
        {
          method: "thread.send",
          durationMs: 10,
          outcome: "success",
          timestampMs: 1_000,
        },
        {
          method: "thread.send",
          durationMs: 30,
          outcome: "failure",
          timestampMs: 2_000,
        },
        {
          method: "thread.list",
          durationMs: 20,
          outcome: "success",
          timestampMs: 3_000,
        },
      ],
      0,
    );

    assert.equal(window.methods.length, 2);
    const send = window.methods.find((method) => method.method === "thread.send");
    assert.equal(send?.requestCount, 2);
    assert.equal(send?.errorCount, 1);
    assert.equal(send?.errorRate, 50);
    assert.equal(send?.throughput, 2 / 60);
    assert.equal(send?.p50LatencyMs, 10);
    assert.equal(send?.p95LatencyMs, 30);
  });

  it("uses Effect.Stream.sliding to build exactly 60 bounded windows", () => {
    const windows = computeSlidingWindows(
      [
        {
          method: "thread.send",
          durationMs: 25,
          outcome: "success",
          timestampMs: 3_600_000 - 1,
        },
      ],
      3_600_000,
    );

    assert.equal(windows.length, 60);
    assert.equal(windows.at(-1)?.methods[0]?.method, "thread.send");
  });

  it.effect("rotates windows and keeps the circular buffer bounded", () =>
    Effect.gen(function* () {
      const aggregator = yield* MetricsAggregator;

      for (let index = 0; index < 65; index += 1) {
        yield* aggregator.recordRpc({
          method: "thread.send",
          durationMs: index,
          outcome: "success",
        });
        yield* TestClock.adjust(Duration.minutes(1));
        yield* aggregator.rotate;
      }

      const windows = yield* aggregator.snapshot;
      assert.equal(windows.length, 60);
      assert.equal(windows.some((window) => window.methods.length === 1), true);
    }).pipe(Effect.provide(Layer.mergeAll(MetricsAggregatorLive, TestClock.layer()))),
  );

  it.effect("records observed RPC calls into the aggregated metrics service", () =>
    Effect.gen(function* () {
      const aggregator = yield* MetricsAggregator;
      const fiber = yield* observeRpcEffect(
        "thread.send",
        Effect.sleep(Duration.millis(25)).pipe(Effect.as("ok")),
      ).pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(25));
      assert.equal(yield* Fiber.join(fiber), "ok");

      const windows = yield* aggregator.snapshot;
      const activeWindow = windows.at(-1);
      const method = activeWindow?.methods.find(
        (entry: MethodMetricsWindow) => entry.method === "thread.send",
      );
      assert.equal(method?.requestCount, 1);
      assert.equal(method?.p50LatencyMs, 25);
    }).pipe(Effect.provide(Layer.mergeAll(MetricsAggregatorLive, TestClock.layer()))),
  );
});
