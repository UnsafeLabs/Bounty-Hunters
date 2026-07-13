import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { metricAttributes } from "./Metrics.ts";

/** A single recorded RPC call within a window. */
export interface RpcSample {
  readonly method: string;
  readonly durationNanos: bigint;
  readonly succeeded: boolean;
}

/** Aggregated statistics for one method inside one window. */
export interface MethodWindowStats {
  readonly method: string;
  readonly count: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly throughputPerSecond: number;
  readonly p50Millis: number;
  readonly p95Millis: number;
  readonly p99Millis: number;
}

/** A one-minute sliding window bucket. */
export interface AggregatedWindow {
  readonly windowStartMillis: number;
  readonly methods: ReadonlyArray<MethodWindowStats>;
}

export const WINDOW_SIZE_MILLIS = 60_000;
export const MAX_WINDOWS = 60;

export interface MetricsAggregatorShape {
  /** Record one completed RPC call. */
  readonly record: (
    method: string,
    duration: Duration.Duration,
    succeeded: boolean,
  ) => Effect.Effect<void>;
  /** Snapshot all windows (closed + in-progress) as aggregated stats. */
  readonly snapshot: () => Effect.Effect<ReadonlyArray<AggregatedWindow>>;
  /** A sliding-window stream of aggregated snapshots. */
  readonly aggregatedStream: () => Stream.Stream<ReadonlyArray<AggregatedWindow>>;
}

export class MetricsAggregator extends Context.Service<MetricsAggregator, MetricsAggregatorShape>()(
  "t3code/server/MetricsAggregator",
) {}

/**
 * Compute a percentile (0..1) from a sorted array of millisecond latencies.
 * Uses nearest-rank; returns 0 for an empty sample.
 */
export const percentile = (sortedMillis: ReadonlyArray<number>, p: number): number => {
  if (sortedMillis.length === 0) {
    return 0;
  }
  const rank = Math.max(0, Math.min(sortedMillis.length - 1, Math.ceil(p * sortedMillis.length) - 1));
  return sortedMillis[rank];
};

const aggregateMethod = (
  method: string,
  samples: ReadonlyArray<RpcSample>,
  windowDurationSeconds: number,
): MethodWindowStats => {
  const count = samples.length;
  const errorCount = samples.filter((s) => !s.succeeded).length;
  const sortedMillis = samples
    .map((s) => Number(Duration.toMillis(Duration.nanos(s.durationNanos))))
    .sort((a, b) => a - b);
  const throughputPerSecond = windowDurationSeconds > 0 ? count / windowDurationSeconds : 0;

  return {
    method,
    count,
    errorCount,
    errorRate: count > 0 ? errorCount / count : 0,
    throughputPerSecond,
    p50Millis: percentile(sortedMillis, 0.5),
    p95Millis: percentile(sortedMillis, 0.95),
    p99Millis: percentile(sortedMillis, 0.99),
  };
};

/** Internal per-window accumulator. */
interface WindowBucket {
  readonly windowStartMillis: number;
  readonly byMethod: Map<string, Array<RpcSample>>;
}

/** Build the live implementation of the MetricsAggregator service. */
export const makeMetricsAggregator = Effect.gen(function* () {
  // Circular buffer of the most recent MAX_WINDOWS closed windows.
  const windowsRef = yield* Ref.make<ReadonlyArray<WindowBucket>>([]);
  // The bucket currently being filled.
  const currentRef = yield* Ref.make<WindowBucket | null>(null);

  const windowStartFor = (nowMillis: number): number =>
    Math.floor(nowMillis / WINDOW_SIZE_MILLIS) * WINDOW_SIZE_MILLIS;

  const rotateIfNeeded = (nowMillis: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      const start = windowStartFor(nowMillis);
      const current = yield* Ref.get(currentRef);
      if (current !== null && current.windowStartMillis === start) {
        return;
      }
      // Close the current bucket into the circular buffer.
      if (current !== null) {
        yield* Ref.update(windowsRef, (ws) => {
          const next = [...ws, current];
          return next.length > MAX_WINDOWS ? next.slice(next.length - MAX_WINDOWS) : next;
        });
      }
      yield* Ref.set(currentRef, { windowStartMillis: start, byMethod: new Map() });
    });

  const record: MetricsAggregatorShape["record"] = (method, duration, succeeded) =>
    Effect.gen(function* () {
      const nowMillis = yield* Clock.currentTimeMillis;
      yield* rotateIfNeeded(nowMillis);
      yield* Ref.update(currentRef, (bucket) => {
        if (bucket === null) {
          return bucket;
        }
        const samples = bucket.byMethod.get(method) ?? [];
        const nextSamples = [
          ...samples,
          { method, durationNanos: Option.getOrElse(Duration.toNanos(duration), () => 0n), succeeded },
        ];
        const nextMap = new Map(bucket.byMethod);
        nextMap.set(method, nextSamples);
        return { ...bucket, byMethod: nextMap };
      });
    });

  const snapshot: MetricsAggregatorShape["snapshot"] = () =>
    Effect.gen(function* () {
      const nowMillis = yield* Clock.currentTimeMillis;
      yield* rotateIfNeeded(nowMillis);
      const current = yield* Ref.get(currentRef);
      const closed = yield* Ref.get(windowsRef);
      const all = current === null ? closed : [...closed, current];
      return all.map((bucket) => ({
        windowStartMillis: bucket.windowStartMillis,
        methods: [...bucket.byMethod.entries()].map(([method, samples]) =>
          aggregateMethod(method, samples, WINDOW_SIZE_MILLIS / 1000),
        ),
      }));
    });

  const aggregatedStream: MetricsAggregatorShape["aggregatedStream"] = () =>
    Stream.fromSchedule(Schedule.spaced(Duration.millis(WINDOW_SIZE_MILLIS))).pipe(
      Stream.mapEffect(() => snapshot()),
    );

  return { record, snapshot, aggregatedStream } as const;
});

export const MetricsAggregatorLive = Layer.effect(
  MetricsAggregator,
  makeMetricsAggregator,
);

/** Format windows as the JSON body expected by /metrics/aggregated. */
export const toAggregatedJson = (
  windows: ReadonlyArray<AggregatedWindow>,
): unknown => ({
  windowSizeMillis: WINDOW_SIZE_MILLIS,
  maxWindows: MAX_WINDOWS,
  windows: windows.map((w) => ({
    windowStart: new Date(w.windowStartMillis).toISOString(),
    methods: w.methods.map((m) => ({
      method: m.method,
      count: m.count,
      errorRate: m.errorRate,
      throughputPerSecond: m.throughputPerSecond,
      latencyMillis: {
        p50: m.p50Millis,
        p95: m.p95Millis,
        p99: m.p99Millis,
      },
    })),
  })),
});

/**
 * Build an Effect that produces the JSON body for the `/metrics/aggregated`
 * endpoint. Wire this into the server's HTTP router (the repo's existing
 * `Http`/`Router` layer) by mapping the result to a 200 JSON response. Kept
 * framework-agnostic so it drops into whatever router the app uses.
 */
export const aggregatedJsonEffect = (): Effect.Effect<unknown, never, MetricsAggregator> =>
  Effect.flatMap(Effect.service(MetricsAggregator), (agg) =>
    agg.snapshot().pipe(Effect.map(toAggregatedJson)),
  );
