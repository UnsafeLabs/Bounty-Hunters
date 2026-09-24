import { assert, describe, it } from "@effect/vitest";
import { assertTrue } from "@effect/vitest/utils";
import * as Duration from "effect/Duration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as TestClock from "effect/testing/TestClock";

import { metricsAggregatedRouteLayer } from "../http.ts";
import {
  aggregateWindow,
  MAX_WINDOWS,
  makeMetricsAggregator,
  MetricsAggregator,
  MetricsAggregatorLive,
  percentile,
  slidingWindowAggregates,
  WINDOW_DURATION_MS,
  type MetricSample,
} from "./MetricsAggregator.ts";
import { observeRpcEffect } from "./RpcInstrumentation.ts";

const sample = (
  method: string,
  durationMs: number,
  recordedAtMs: number,
  error = false,
): MetricSample => ({ method, durationMs, error, recordedAtMs });

describe("percentile", () => {
  it("returns 0 for an empty sample set", () => {
    assert.equal(percentile([], 0.5), 0);
  });

  it("uses the nearest rank over a sorted array", () => {
    const sorted = [10, 20, 30, 40];
    assert.equal(percentile(sorted, 0.5), 20);
    assert.equal(percentile(sorted, 0.95), 40);
    assert.equal(percentile(sorted, 0.99), 40);
  });

  it("clamps quantiles outside [0, 1]", () => {
    assert.equal(percentile([1, 2, 3], -1), 1);
    assert.equal(percentile([1, 2, 3], 5), 3);
  });

  it("picks a sensible rank for large sample sets", () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
    assert.equal(percentile(sorted, 0.5), 50);
    assert.equal(percentile(sorted, 0.95), 95);
    assert.equal(percentile(sorted, 0.99), 99);
  });
});

describe("aggregateWindow", () => {
  it("returns an empty aggregate when no samples fall in the window", () => {
    const window = aggregateWindow(1_000, 2_000, []);

    assert.equal(window.requests, 0);
    assert.equal(window.errorCount, 0);
    assert.equal(window.errorRatePercent, 0);
    assert.equal(window.durationMs, 1_000);
    assert.deepEqual(window.methods, []);
  });

  it("computes per-method latency, error rate and throughput", () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, index) =>
        sample("rpc.a", index + 1, index * 100, index === 9),
      ),
      sample("rpc.b", 100, 0),
      sample("rpc.b", 200, 1_000),
    ];

    const window = aggregateWindow(0, WINDOW_DURATION_MS, samples);

    assert.equal(window.requests, 12);
    assert.equal(window.errorCount, 1);
    assert.equal(window.errorRatePercent, 8.33);
    assert.equal(window.startedAt, "1970-01-01T00:00:00.000Z");
    assert.equal(window.endedAt, "1970-01-01T00:01:00.000Z");

    const [methodA, methodB] = window.methods;
    assert.equal(methodA?.method, "rpc.a");
    assert.equal(methodA?.requests, 10);
    assert.equal(methodA?.errorCount, 1);
    assert.equal(methodA?.errorRatePercent, 10);
    assert.equal(methodA?.p50Ms, 5);
    assert.equal(methodA?.p95Ms, 10);
    assert.equal(methodA?.p99Ms, 10);
    assert.equal(methodA?.throughputPerSecond, 0.17);

    assert.equal(methodB?.method, "rpc.b");
    assert.equal(methodB?.requests, 2);
    assert.equal(methodB?.errorRatePercent, 0);
    assert.equal(methodB?.p50Ms, 100);
    assert.equal(methodB?.p95Ms, 200);
    assert.equal(methodB?.throughputPerSecond, 0.03);
  });
});

describe("slidingWindowAggregates", () => {
  it.effect("emits overlapping windows that share samples", () => {
    const samples = [
      sample("rpc.a", 10, 0),
      sample("rpc.a", 20, 1_000),
      sample("rpc.a", 30, 2_000),
      sample("rpc.a", 40, 3_000),
    ];

    return Effect.gen(function* () {
      const windows = yield* Stream.fromIterable(samples).pipe(
        slidingWindowAggregates({ windowSize: 3, stepSize: 1 }),
        Stream.runCollect,
      );

      const collected = [...windows];
      assert.equal(collected.length, 2);
      assert.deepEqual(
        collected.map((window) => window.requests),
        [3, 3],
      );

      assert.equal(collected[0]?.startedAt, "1970-01-01T00:00:00.000Z");
      assert.equal(collected[0]?.endedAt, "1970-01-01T00:00:02.000Z");
      assert.equal(collected[0]?.methods[0]?.throughputPerSecond, 1.5);
      assert.equal(collected[1]?.startedAt, "1970-01-01T00:00:01.000Z");
      assert.equal(collected[1]?.endedAt, "1970-01-01T00:00:03.000Z");
    });
  });

  it.effect("honours an explicit window duration", () => {
    const samples = [
      sample("rpc.a", 10, 0),
      sample("rpc.a", 20, 10),
      sample("rpc.a", 30, 20),
      sample("rpc.a", 40, 30),
    ];

    return Effect.gen(function* () {
      const windows = yield* Stream.fromIterable(samples).pipe(
        slidingWindowAggregates({ windowSize: 2, stepSize: 2, windowDurationMs: WINDOW_DURATION_MS }),
        Stream.runCollect,
      );

      const collected = [...windows];
      assert.equal(collected.length, 2);
      for (const window of collected) {
        assert.equal(window.durationMs, WINDOW_DURATION_MS);
        assert.equal(window.methods[0]?.throughputPerSecond, 0.03);
      }
    });
  });
});

describe("MetricsAggregator", () => {
  it.effect("aggregates recorded calls when a window is flushed", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeMetricsAggregator;

      yield* aggregator.record({ method: "rpc.a", durationMs: 10, error: false });
      yield* aggregator.record({ method: "rpc.a", durationMs: 30, error: true });
      yield* TestClock.adjust(Duration.seconds(5));
      yield* aggregator.flush;

      const windows = yield* aggregator.windows;
      assert.equal(windows.length, 1);
      assert.equal(windows[0]?.requests, 2);
      assert.equal(windows[0]?.errorRatePercent, 50);
      assert.equal(windows[0]?.durationMs, 5_000);
      assert.equal(windows[0]?.startedAt, "1970-01-01T00:00:00.000Z");
      assert.equal(windows[0]?.endedAt, "1970-01-01T00:00:05.000Z");
      assert.equal(windows[0]?.methods[0]?.p50Ms, 10);
      assert.equal(windows[0]?.methods[0]?.throughputPerSecond, 0.4);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("closes a window once its minute elapses", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeMetricsAggregator;

      yield* aggregator.record({ method: "rpc.a", durationMs: 10, error: false });
      yield* TestClock.adjust(Duration.minutes(1));
      yield* aggregator.record({ method: "rpc.a", durationMs: 20, error: false });

      const rotated = yield* aggregator.windows;
      assert.equal(rotated.length, 1);
      assert.equal(rotated[0]?.endedAt, "1970-01-01T00:01:00.000Z");

      yield* aggregator.flush;
      const flushed = yield* aggregator.windows;
      assert.equal(flushed.length, 2);
      assert.equal(flushed[1]?.requests, 1);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("retains exactly MAX_WINDOWS windows", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeMetricsAggregator;

      for (let index = 0; index < 5; index += 1) {
        yield* aggregator.record({ method: "rpc.old", durationMs: 1, error: false });
      }
      yield* aggregator.flush;

      for (let index = 0; index < MAX_WINDOWS; index += 1) {
        yield* aggregator.record({ method: "rpc.new", durationMs: 1, error: false });
        yield* aggregator.flush;
      }

      const windows = yield* aggregator.windows;
      assert.equal(windows.length, MAX_WINDOWS);
      assert.ok(windows.every((window) => window.requests === 1));
      assert.equal(windows.every((window) => window.methods[0]?.method === "rpc.new"), true);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reports no latest window until one has been flushed", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeMetricsAggregator;

      assert.equal(yield* aggregator.latest, undefined);

      yield* aggregator.record({ method: "rpc.a", durationMs: 5, error: false });
      yield* aggregator.flush;

      const latest = yield* aggregator.latest;
      assert.equal(latest?.requests, 1);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

describe("MetricsAggregatorLive", () => {
  it.effect("rotates windows on the schedule", () =>
    Effect.gen(function* () {
      const aggregator = yield* MetricsAggregator;

      yield* aggregator.record({ method: "rpc.live", durationMs: 5, error: false });

      yield* TestClock.adjust(Duration.minutes(1));
      yield* Effect.yieldNow;

      const windows = yield* aggregator.windows;
      assert.equal(windows.length, 1);
      assert.equal(windows[0]?.methods[0]?.method, "rpc.live");
    }).pipe(Effect.provide(Layer.mergeAll(MetricsAggregatorLive, TestClock.layer()))),
  );
});

describe("RPC instrumentation sampling", () => {
  it.effect("records successful RPC effects into the aggregator", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeMetricsAggregator;
      const provideAggregator = Effect.provideService(MetricsAggregator, aggregator);

      const result = yield* observeRpcEffect("rpc.test.ok", Effect.succeed("ok")).pipe(
        provideAggregator,
      );
      yield* aggregator.flush.pipe(provideAggregator);

      assert.equal(result, "ok");
      const windows = yield* aggregator.windows;
      assert.equal(windows.length, 1);
      assert.equal(windows[0]?.errorCount, 0);
      assert.equal(windows[0]?.methods[0]?.method, "rpc.test.ok");
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("marks failed RPC effects as errors", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeMetricsAggregator;
      const provideAggregator = Effect.provideService(MetricsAggregator, aggregator);

      yield* observeRpcEffect("rpc.test.fail", Effect.fail("boom")).pipe(
        provideAggregator,
        Effect.flip,
      );
      yield* aggregator.flush.pipe(provideAggregator);

      const windows = yield* aggregator.windows;
      assert.equal(windows[0]?.requests, 1);
      assert.equal(windows[0]?.errorRatePercent, 100);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

describe("GET /metrics/aggregated", () => {
  it.effect("returns the completed windows as a JSON array", () =>
    Effect.gen(function* () {
      const aggregator = yield* makeMetricsAggregator;
      yield* aggregator.record({ method: "rpc.http", durationMs: 12, error: false });
      yield* aggregator.flush;

      const { handler, dispose } = HttpRouter.toWebHandler(metricsAggregatedRouteLayer, {
        disableLogger: true,
      });

      const request = new Request("http://localhost/metrics/aggregated");
      const context = Context.make(MetricsAggregator, aggregator);
      const response = yield* Effect.promise(() => handler(request, context));
      const text = yield* Effect.promise(() => response.text());

      yield* Effect.promise(() => dispose());

      assert.strictEqual(response.status, 200, text);
      assertTrue(text.startsWith("["));
      assertTrue(text.includes('"method":"rpc.http"'));
      assertTrue(text.includes('"startedAt":"1970-01-01T00:00:00.000Z"'));
      assertTrue(text.includes('"requests":1'));
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
