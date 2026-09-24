import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

/** Width of a single aggregation window. */
export const WINDOW_DURATION_MS = 60_000;

/** Number of windows kept for trend analysis (one hour of 1-minute windows). */
export const MAX_WINDOWS = 60;

/** A single observed RPC call, as reported by the instrumentation layer. */
export interface RpcMetricRecord {
  readonly method: string;
  readonly durationMs: number;
  readonly error: boolean;
}

/** A record stamped with the time it was observed. */
export interface MetricSample extends RpcMetricRecord {
  readonly recordedAtMs: number;
}

export interface MethodAggregate {
  readonly method: string;
  readonly requests: number;
  readonly errorCount: number;
  readonly errorRatePercent: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly throughputPerSecond: number;
}

export interface MetricsWindow {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly requests: number;
  readonly errorCount: number;
  readonly errorRatePercent: number;
  readonly methods: ReadonlyArray<MethodAggregate>;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const isoFromEpochMs = (epochMilliseconds: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(epochMilliseconds));

const sortAscending = (values: ReadonlyArray<number>): ReadonlyArray<number> =>
  [...values].sort((left, right) => left - right);

/**
 * Nearest-rank percentile over an already sorted array. Returns `0` for an
 * empty sample set and clamps the quantile into `[0, 1]`.
 */
export function percentile(sortedValues: ReadonlyArray<number>, quantile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const clamped = Math.min(Math.max(quantile, 0), 1);
  const rank = Math.ceil(clamped * sortedValues.length) - 1;
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank));
  return sortedValues[index] ?? 0;
}

/** Aggregates raw samples covering `[startedAtMs, endedAtMs)` into one window. */
export function aggregateWindow(
  startedAtMs: number,
  endedAtMs: number,
  samples: ReadonlyArray<MetricSample>,
): MetricsWindow {
  const durationMs = Math.max(0, endedAtMs - startedAtMs);
  const byMethod = new Map<string, MetricSample[]>();

  for (const sample of samples) {
    const bucket = byMethod.get(sample.method);
    if (bucket === undefined) {
      byMethod.set(sample.method, [sample]);
    } else {
      bucket.push(sample);
    }
  }

  const methods = [...byMethod.entries()]
    .map(([method, methodSamples]): MethodAggregate => {
      const durations = sortAscending(methodSamples.map((sample) => sample.durationMs));
      const errorCount = methodSamples.filter((sample) => sample.error).length;
      const requests = methodSamples.length;

      return {
        method,
        requests,
        errorCount,
        errorRatePercent: round2((errorCount / requests) * 100),
        p50Ms: round2(percentile(durations, 0.5)),
        p95Ms: round2(percentile(durations, 0.95)),
        p99Ms: round2(percentile(durations, 0.99)),
        throughputPerSecond: durationMs > 0 ? round2(requests / (durationMs / 1000)) : 0,
      };
    })
    .sort((left, right) => left.method.localeCompare(right.method));

  const errorCount = samples.filter((sample) => sample.error).length;

  return {
    startedAt: isoFromEpochMs(startedAtMs),
    endedAt: isoFromEpochMs(endedAtMs),
    durationMs: round2(durationMs),
    requests: samples.length,
    errorCount,
    errorRatePercent: samples.length > 0 ? round2((errorCount / samples.length) * 100) : 0,
    methods,
  };
}

export interface SlidingWindowOptions {
  /** Number of samples per window. */
  readonly windowSize: number;
  /** How many samples the window advances between emissions. */
  readonly stepSize?: number;
  /** Fixed window width; defaults to the span between the first and last sample. */
  readonly windowDurationMs?: number;
}

/**
 * Builds overlapping windows over a sample stream. Windows advance by
 * `stepSize` samples, so consecutive windows share samples: with a window size
 * of 3 and a step of 1 over `[a, b, c, d]` the emitted windows are
 * `[a, b, c]` and `[b, c, d]`.
 */
export const slidingWindowAggregates =
  (options: SlidingWindowOptions) =>
  (samples: Stream.Stream<MetricSample>): Stream.Stream<MetricsWindow> =>
    samples.pipe(
      Stream.slidingSize(options.windowSize, options.stepSize ?? 1),
      Stream.map((window) => {
        const first = window[0];
        const last = window[window.length - 1];
        if (first === undefined || last === undefined) {
          return aggregateWindow(0, 0, []);
        }

        const startedAtMs = first.recordedAtMs;
        const endedAtMs =
          options.windowDurationMs === undefined
            ? last.recordedAtMs
            : startedAtMs + options.windowDurationMs;

        return aggregateWindow(startedAtMs, endedAtMs, window);
      }),
    );

export interface MetricsAggregatorShape {
  /** Records a finished RPC call into the active window. */
  readonly record: (sample: RpcMetricRecord) => Effect.Effect<void>;
  /** Closes the active window early, e.g. before reading a snapshot. */
  readonly flush: Effect.Effect<void>;
  /** Completed windows, oldest first, capped at {@link MAX_WINDOWS}. */
  readonly windows: Effect.Effect<ReadonlyArray<MetricsWindow>>;
  /** The most recently completed window, if any. */
  readonly latest: Effect.Effect<MetricsWindow | undefined>;
}

export class MetricsAggregator extends Context.Service<
  MetricsAggregator,
  MetricsAggregatorShape
>()("t3/observability/MetricsAggregator") {}

/** Rotation cadence of the background window loop. */
export const windowRotationSchedule: Schedule.Schedule<number> = Schedule.spaced(WINDOW_DURATION_MS);

interface AggregatorState {
  readonly pending: ReadonlyArray<MetricSample>;
  readonly windowStartedAtMs: number | null;
  readonly windows: ReadonlyArray<MetricsWindow>;
}

const EMPTY_STATE: AggregatorState = {
  pending: [],
  windowStartedAtMs: null,
  windows: [],
};

const closeWindow = (nowMs: number, current: AggregatorState): AggregatorState => {
  if (current.pending.length === 0) {
    return current;
  }

  const window = aggregateWindow(current.windowStartedAtMs ?? nowMs, nowMs, current.pending);

  return {
    pending: [],
    windowStartedAtMs: null,
    windows: [...current.windows, window].slice(-MAX_WINDOWS),
  };
};

export const makeMetricsAggregator: Effect.Effect<MetricsAggregatorShape> = Effect.gen(
  function* () {
    const state = yield* Ref.make<AggregatorState>(EMPTY_STATE);

    const record = (sample: RpcMetricRecord): Effect.Effect<void> =>
      Effect.gen(function* () {
        const recordedAtMs = yield* Clock.currentTimeMillis;

        yield* Ref.update(state, (current) => {
          // Close the active window lazily once its minute has elapsed so the
          // history stays correct even if the rotation loop is not running.
          const windowStartedAtMs = current.windowStartedAtMs;
          const active =
            windowStartedAtMs !== null &&
            recordedAtMs - windowStartedAtMs >= WINDOW_DURATION_MS
              ? closeWindow(windowStartedAtMs + WINDOW_DURATION_MS, current)
              : current;

          return {
            ...active,
            pending: [...active.pending, { ...sample, recordedAtMs }],
            windowStartedAtMs: active.windowStartedAtMs ?? recordedAtMs,
          };
        });
      });

    const flush: Effect.Effect<void> = Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      yield* Ref.update(state, (current) => closeWindow(nowMs, current));
    });

    return {
      record,
      flush,
      windows: Ref.get(state).pipe(Effect.map((current) => current.windows)),
      latest: Ref.get(state).pipe(
        Effect.map((current) => current.windows[current.windows.length - 1]),
      ),
    } satisfies MetricsAggregatorShape;
  },
);

/**
 * Live aggregator. Also starts the rotation loop so partly filled windows are
 * emitted on the minute boundary even when traffic stops.
 */
export const MetricsAggregatorLive = Layer.effect(MetricsAggregator)(
  Effect.gen(function* () {
    const aggregator = yield* makeMetricsAggregator;
    yield* Effect.forkScoped(Effect.repeat(aggregator.flush, windowRotationSchedule));

    return aggregator;
  }),
);
