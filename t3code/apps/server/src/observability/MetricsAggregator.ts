import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

export const METRICS_AGGREGATED_PATH = "/metrics/aggregated";

const DEFAULT_WINDOW_SIZE_MS = 60_000;
const DEFAULT_BUCKET_SIZE_MS = 60_000;
const DEFAULT_RETAINED_WINDOW_COUNT = 60;
const DEFAULT_MAX_LATENCY_SAMPLES_PER_METHOD_BUCKET = 20_000;

export interface RpcMetricObservation {
  readonly method: string;
  readonly latencyMs: number;
  readonly failed: boolean;
}

export interface TimedRpcMetricObservation extends RpcMetricObservation {
  readonly timestampMs: number;
}

interface MutableMethodBucket {
  requestCount: number;
  errorCount: number;
  latenciesMs: Array<number>;
}

export interface RpcMetricMethodBucket {
  readonly method: string;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly latenciesMs: ReadonlyArray<number>;
}

export interface RpcMetricBucket {
  readonly bucketStartMs: number;
  readonly bucketEndMs: number;
  readonly methods: ReadonlyArray<RpcMetricMethodBucket>;
}

export interface AggregatedRpcMethodMetrics {
  readonly method: string;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly throughput: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
}

export interface AggregatedRpcMetricWindow {
  readonly timestamp: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly methods: ReadonlyArray<AggregatedRpcMethodMetrics>;
}

interface MetricsAggregatorState {
  readonly buckets: ReadonlyArray<RpcMetricBucket>;
  readonly windows: ReadonlyArray<AggregatedRpcMetricWindow>;
  readonly lastAggregatedWindowStartMs: number | null;
}

export interface MetricsAggregatorShape {
  readonly record: (observation: RpcMetricObservation) => Effect.Effect<void>;
  readonly recordAt: (observation: TimedRpcMetricObservation) => Effect.Effect<void>;
  readonly rotate: Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<AggregatedRpcMetricWindow>>;
}

export class MetricsAggregator extends Context.Service<MetricsAggregator, MetricsAggregatorShape>()(
  "t3/observability/MetricsAggregator",
) {}

export interface MetricsAggregatorOptions {
  readonly windowSizeMs?: number;
  readonly bucketSizeMs?: number;
  readonly retainedWindowCount?: number;
  readonly maxLatencySamplesPerMethodBucket?: number;
}

interface ResolvedMetricsAggregatorOptions {
  readonly windowSizeMs: number;
  readonly bucketSizeMs: number;
  readonly retainedWindowCount: number;
  readonly maxLatencySamplesPerMethodBucket: number;
}

const resolveOptions = (
  options: MetricsAggregatorOptions = {},
): ResolvedMetricsAggregatorOptions => {
  const windowSizeMs = Math.max(1, Math.trunc(options.windowSizeMs ?? DEFAULT_WINDOW_SIZE_MS));
  const bucketSizeMs = Math.max(1, Math.trunc(options.bucketSizeMs ?? DEFAULT_BUCKET_SIZE_MS));
  return {
    windowSizeMs,
    bucketSizeMs,
    retainedWindowCount: Math.max(
      1,
      Math.trunc(options.retainedWindowCount ?? DEFAULT_RETAINED_WINDOW_COUNT),
    ),
    maxLatencySamplesPerMethodBucket: Math.max(
      1,
      Math.trunc(
        options.maxLatencySamplesPerMethodBucket ?? DEFAULT_MAX_LATENCY_SAMPLES_PER_METHOD_BUCKET,
      ),
    ),
  };
};

const floorToBucketStart = (timestampMs: number, bucketSizeMs: number): number =>
  Math.floor(timestampMs / bucketSizeMs) * bucketSizeMs;

const toIso = (timestampMs: number): string => DateTime.formatIso(DateTime.makeUnsafe(timestampMs));

export const percentileFromSorted = (
  sortedValues: ReadonlyArray<number>,
  percentile: number,
): number => {
  if (sortedValues.length === 0) {
    return 0;
  }

  const normalizedPercentile = Math.min(100, Math.max(0, percentile));
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((normalizedPercentile / 100) * sortedValues.length) - 1),
  );
  return sortedValues[index] ?? 0;
};

const aggregateMethodMetrics = (
  methods: ReadonlyArray<RpcMetricMethodBucket>,
  windowSizeMs: number,
): ReadonlyArray<AggregatedRpcMethodMetrics> => {
  const byMethod = new Map<
    string,
    {
      requestCount: number;
      errorCount: number;
      latenciesMs: Array<number>;
    }
  >();

  for (const methodBucket of methods) {
    const current =
      byMethod.get(methodBucket.method) ??
      ({
        requestCount: 0,
        errorCount: 0,
        latenciesMs: [],
      } satisfies {
        requestCount: number;
        errorCount: number;
        latenciesMs: Array<number>;
      });
    current.requestCount += methodBucket.requestCount;
    current.errorCount += methodBucket.errorCount;
    current.latenciesMs.push(...methodBucket.latenciesMs);
    byMethod.set(methodBucket.method, current);
  }

  return Array.from(byMethod.entries())
    .map(([method, metric]) => {
      const sortedLatenciesMs = metric.latenciesMs.toSorted((left, right) => left - right);
      const requestCount = metric.requestCount;
      return {
        method,
        requestCount,
        errorCount: metric.errorCount,
        errorRate: requestCount === 0 ? 0 : (metric.errorCount / requestCount) * 100,
        throughput: requestCount / (windowSizeMs / 1_000),
        p50LatencyMs: percentileFromSorted(sortedLatenciesMs, 50),
        p95LatencyMs: percentileFromSorted(sortedLatenciesMs, 95),
        p99LatencyMs: percentileFromSorted(sortedLatenciesMs, 99),
      } satisfies AggregatedRpcMethodMetrics;
    })
    .toSorted((left, right) => left.method.localeCompare(right.method));
};

const emptyBucket = (bucketStartMs: number, bucketSizeMs: number): RpcMetricBucket => ({
  bucketStartMs,
  bucketEndMs: bucketStartMs + bucketSizeMs,
  methods: [],
});

const fillBucketGaps = (
  buckets: ReadonlyArray<RpcMetricBucket>,
  bucketSizeMs: number,
): ReadonlyArray<RpcMetricBucket> => {
  const sortedBuckets = buckets.toSorted((left, right) => left.bucketStartMs - right.bucketStartMs);
  const first = sortedBuckets[0];
  const last = sortedBuckets[sortedBuckets.length - 1];
  if (!first || !last) {
    return [];
  }

  const byStart = new Map(sortedBuckets.map((bucket) => [bucket.bucketStartMs, bucket]));
  const filled: Array<RpcMetricBucket> = [];
  for (
    let bucketStartMs = first.bucketStartMs;
    bucketStartMs <= last.bucketStartMs;
    bucketStartMs += bucketSizeMs
  ) {
    filled.push(byStart.get(bucketStartMs) ?? emptyBucket(bucketStartMs, bucketSizeMs));
  }
  return filled;
};

const aggregateBucketWindow = (
  buckets: ReadonlyArray<RpcMetricBucket>,
  windowSizeMs: number,
): AggregatedRpcMetricWindow => {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) {
    throw new Error("Cannot aggregate an empty metrics window.");
  }

  const windowStartMs = first.bucketStartMs;
  const windowEndMs = windowStartMs + windowSizeMs;
  return {
    timestamp: toIso(windowEndMs),
    windowStart: toIso(windowStartMs),
    windowEnd: toIso(windowEndMs),
    windowStartMs,
    windowEndMs,
    methods: aggregateMethodMetrics(
      buckets.flatMap((bucket) => bucket.methods),
      windowSizeMs,
    ),
  };
};

export const aggregateSlidingMetricBuckets = (
  buckets: ReadonlyArray<RpcMetricBucket>,
  options: {
    readonly windowSizeMs?: number;
    readonly bucketSizeMs?: number;
  } = {},
): Effect.Effect<ReadonlyArray<AggregatedRpcMetricWindow>> => {
  const windowSizeMs = Math.max(1, Math.trunc(options.windowSizeMs ?? DEFAULT_WINDOW_SIZE_MS));
  const bucketSizeMs = Math.max(1, Math.trunc(options.bucketSizeMs ?? DEFAULT_BUCKET_SIZE_MS));
  const windowBucketCount = Math.max(1, Math.ceil(windowSizeMs / bucketSizeMs));
  const filledBuckets = fillBucketGaps(buckets, bucketSizeMs);

  return Stream.fromIterable(filledBuckets).pipe(
    Stream.sliding(windowBucketCount),
    Stream.map((chunk) => aggregateBucketWindow(Array.from(chunk), windowSizeMs)),
    Stream.runCollect,
    Effect.map((windows) => Array.from(windows)),
  );
};

const appendObservationToBucket = (
  bucket: RpcMetricBucket,
  observation: TimedRpcMetricObservation,
  maxLatencySamplesPerMethodBucket: number,
): RpcMetricBucket => {
  const methods = new Map<string, MutableMethodBucket>(
    bucket.methods.map((method) => [
      method.method,
      {
        requestCount: method.requestCount,
        errorCount: method.errorCount,
        latenciesMs: [...method.latenciesMs],
      },
    ]),
  );
  const methodBucket =
    methods.get(observation.method) ??
    ({
      requestCount: 0,
      errorCount: 0,
      latenciesMs: [],
    } satisfies MutableMethodBucket);

  methodBucket.requestCount += 1;
  if (observation.failed) {
    methodBucket.errorCount += 1;
  }
  if (methodBucket.latenciesMs.length < maxLatencySamplesPerMethodBucket) {
    methodBucket.latenciesMs.push(observation.latencyMs);
  }
  methods.set(observation.method, methodBucket);

  return {
    ...bucket,
    methods: Array.from(methods.entries())
      .map(
        ([method, metrics]): RpcMetricMethodBucket => ({
          method,
          requestCount: metrics.requestCount,
          errorCount: metrics.errorCount,
          latenciesMs: metrics.latenciesMs,
        }),
      )
      .toSorted((left, right) => left.method.localeCompare(right.method)),
  };
};

const appendToCircularBuffer = <A>(
  existing: ReadonlyArray<A>,
  additions: ReadonlyArray<A>,
  retainedCount: number,
): ReadonlyArray<A> => {
  const next = [...existing, ...additions];
  return next.length <= retainedCount ? next : next.slice(next.length - retainedCount);
};

const makeMetricsAggregator = (options?: MetricsAggregatorOptions) =>
  Effect.gen(function* () {
    const resolvedOptions = resolveOptions(options);
    const stateRef = yield* Ref.make<MetricsAggregatorState>({
      buckets: [],
      windows: [],
      lastAggregatedWindowStartMs: null,
    });

    const recordAt = (observation: TimedRpcMetricObservation) =>
      Ref.update(stateRef, (state) => {
        const bucketStartMs = floorToBucketStart(
          observation.timestampMs,
          resolvedOptions.bucketSizeMs,
        );
        const bucketEndMs = bucketStartMs + resolvedOptions.bucketSizeMs;
        const buckets = [...state.buckets];
        const existingIndex = buckets.findIndex((bucket) => bucket.bucketStartMs === bucketStartMs);
        const existingBucket =
          existingIndex >= 0
            ? buckets[existingIndex]!
            : ({
                bucketStartMs,
                bucketEndMs,
                methods: [],
              } satisfies RpcMetricBucket);
        const nextBucket = appendObservationToBucket(
          existingBucket,
          observation,
          resolvedOptions.maxLatencySamplesPerMethodBucket,
        );

        if (existingIndex >= 0) {
          buckets[existingIndex] = nextBucket;
        } else {
          buckets.push(nextBucket);
        }

        return {
          ...state,
          buckets: buckets.toSorted((left, right) => left.bucketStartMs - right.bucketStartMs),
        };
      });

    const rotate = Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const activeBucketStartMs = floorToBucketStart(nowMs, resolvedOptions.bucketSizeMs);
      const windowBucketCount = Math.max(
        1,
        Math.ceil(resolvedOptions.windowSizeMs / resolvedOptions.bucketSizeMs),
      );

      const state = yield* Ref.get(stateRef);
      const completedBuckets = state.buckets.filter(
        (bucket) => bucket.bucketEndMs <= activeBucketStartMs,
      );
      const computedWindows = yield* aggregateSlidingMetricBuckets(completedBuckets, {
        windowSizeMs: resolvedOptions.windowSizeMs,
        bucketSizeMs: resolvedOptions.bucketSizeMs,
      });
      const newWindows = computedWindows.filter(
        (window) =>
          state.lastAggregatedWindowStartMs === null ||
          window.windowStartMs > state.lastAggregatedWindowStartMs,
      );
      const lastNewWindow = newWindows[newWindows.length - 1];
      const retainedBucketStartMs =
        activeBucketStartMs - Math.max(0, windowBucketCount - 1) * resolvedOptions.bucketSizeMs;

      yield* Ref.update(stateRef, (current) => ({
        buckets: current.buckets.filter((bucket) => bucket.bucketStartMs >= retainedBucketStartMs),
        windows: appendToCircularBuffer(
          current.windows,
          newWindows,
          resolvedOptions.retainedWindowCount,
        ),
        lastAggregatedWindowStartMs:
          lastNewWindow?.windowStartMs ?? current.lastAggregatedWindowStartMs,
      }));
    });

    return {
      record: (observation) =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((timestampMs) => recordAt({ ...observation, timestampMs })),
        ),
      recordAt,
      rotate,
      snapshot: Ref.get(stateRef).pipe(Effect.map((state) => state.windows)),
    } satisfies MetricsAggregatorShape;
  });

const scheduleMetricsRotation = (
  aggregator: MetricsAggregatorShape,
  options: ResolvedMetricsAggregatorOptions,
) =>
  Effect.sleep(Duration.millis(options.bucketSizeMs)).pipe(
    Effect.andThen(aggregator.rotate),
    Effect.repeat(Schedule.spaced(Duration.millis(options.bucketSizeMs))),
    Effect.forkScoped,
  );

export const MetricsAggregatorLive = Layer.effect(
  MetricsAggregator,
  Effect.gen(function* () {
    const options = resolveOptions();
    const aggregator = yield* makeMetricsAggregator(options);
    yield* scheduleMetricsRotation(aggregator, options);
    return aggregator;
  }),
);

export const makeMetricsAggregatorTestLayer = (options?: MetricsAggregatorOptions) =>
  Layer.effect(MetricsAggregator, makeMetricsAggregator(options));
