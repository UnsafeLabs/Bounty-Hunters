import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { ObservabilityOutcome } from "../Attributes.ts";

export const AGGREGATED_METRICS_PATH = "/metrics/aggregated";
export const METRICS_AGGREGATION_WINDOW_MS = 60_000;
export const METRICS_AGGREGATION_WINDOW_COUNT = 60;
export const METRICS_AGGREGATION_MAX_LATENCY_SAMPLES_PER_METHOD = 10_000;

export interface RpcMetricObservation {
  readonly method: string;
  readonly outcome: ObservabilityOutcome;
  readonly durationMs: number;
  readonly observedAtMs?: number;
}

export interface AggregatedMethodMetrics {
  readonly method: string;
  readonly requestCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly interruptCount: number;
  readonly errorRate: number;
  readonly throughput: number;
  readonly latencyMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly retainedSampleCount: number;
}

export interface AggregatedMetricsWindow {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly methods: ReadonlyArray<AggregatedMethodMetrics>;
}

export interface MetricsAggregatorOptions {
  readonly windowMs?: number;
  readonly windowCount?: number;
  readonly maxLatencySamplesPerMethod?: number;
  readonly autoRotate?: boolean;
}

export interface MetricsAggregatorShape {
  readonly recordRpc: (observation: RpcMetricObservation) => Effect.Effect<void>;
  readonly getWindows: Effect.Effect<ReadonlyArray<AggregatedMetricsWindow>>;
  readonly snapshotAt: (nowMs: number) => Effect.Effect<ReadonlyArray<AggregatedMetricsWindow>>;
}

export class MetricsAggregator extends Context.Service<MetricsAggregator, MetricsAggregatorShape>()(
  "t3/observability/Services/MetricsAggregator",
) {}

interface ResolvedMetricsAggregatorOptions {
  readonly windowMs: number;
  readonly windowCount: number;
  readonly maxLatencySamplesPerMethod: number;
  readonly autoRotate: boolean;
}

interface MethodAccumulator {
  readonly requestCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly interruptCount: number;
  readonly latencySamplesMs: ReadonlyArray<number>;
}

interface MetricsAggregatorState {
  readonly currentWindowStartMs: number;
  readonly current: Readonly<Record<string, MethodAccumulator>>;
  readonly completedWindows: ReadonlyArray<AggregatedMetricsWindow>;
}

const emptyAccumulators: Readonly<Record<string, MethodAccumulator>> = {};

const positiveIntegerOrDefault = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));

const resolveOptions = (options?: MetricsAggregatorOptions): ResolvedMetricsAggregatorOptions => ({
  windowMs: positiveIntegerOrDefault(options?.windowMs, METRICS_AGGREGATION_WINDOW_MS),
  windowCount: positiveIntegerOrDefault(options?.windowCount, METRICS_AGGREGATION_WINDOW_COUNT),
  maxLatencySamplesPerMethod: positiveIntegerOrDefault(
    options?.maxLatencySamplesPerMethod,
    METRICS_AGGREGATION_MAX_LATENCY_SAMPLES_PER_METHOD,
  ),
  autoRotate: options?.autoRotate ?? true,
});

const normalizeTimestampMs = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const normalizeDurationMs = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const windowStartFor = (timestampMs: number, windowMs: number): number =>
  Math.floor(normalizeTimestampMs(timestampMs) / windowMs) * windowMs;

const formatTimestampIso = (timestampMs: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(timestampMs));

const makeInitialState = (
  nowMs: number,
  options: ResolvedMetricsAggregatorOptions,
): MetricsAggregatorState => ({
  currentWindowStartMs: windowStartFor(nowMs, options.windowMs),
  current: emptyAccumulators,
  completedWindows: [],
});

export function calculatePercentile(
  sortedValues: ReadonlyArray<number>,
  percentile: number,
): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1),
  );
  return sortedValues[index] ?? 0;
}

const appendWindow = (
  windows: ReadonlyArray<AggregatedMetricsWindow>,
  window: AggregatedMetricsWindow,
  windowCount: number,
): ReadonlyArray<AggregatedMetricsWindow> => {
  const next = [...windows, window];
  return next.length <= windowCount ? next : next.slice(next.length - windowCount);
};

export const selectSlidingWindowBuffer = <A>(
  windows: ReadonlyArray<A>,
  windowCount: number,
): Effect.Effect<ReadonlyArray<A>> => {
  const boundedWindowCount = positiveIntegerOrDefault(
    windowCount,
    METRICS_AGGREGATION_WINDOW_COUNT,
  );
  if (windows.length <= boundedWindowCount) {
    return Effect.succeed(windows);
  }

  return Stream.fromIterable(windows).pipe(
    Stream.sliding(boundedWindowCount),
    Stream.runLast,
    Effect.map((lastWindow) =>
      Array.from(Option.getOrElse(lastWindow, (): ReadonlyArray<A> => [])),
    ),
  );
};

const aggregateMethod = (
  method: string,
  accumulator: MethodAccumulator,
  durationMs: number,
): AggregatedMethodMetrics => {
  const sortedLatencySamples = accumulator.latencySamplesMs.toSorted((left, right) => left - right);
  const errorCount = accumulator.failureCount + accumulator.interruptCount;

  return {
    method,
    requestCount: accumulator.requestCount,
    successCount: accumulator.successCount,
    failureCount: accumulator.failureCount,
    interruptCount: accumulator.interruptCount,
    errorRate: accumulator.requestCount === 0 ? 0 : (errorCount / accumulator.requestCount) * 100,
    throughput: durationMs <= 0 ? 0 : accumulator.requestCount / (durationMs / 1000),
    latencyMs: {
      p50: calculatePercentile(sortedLatencySamples, 50),
      p95: calculatePercentile(sortedLatencySamples, 95),
      p99: calculatePercentile(sortedLatencySamples, 99),
    },
    retainedSampleCount: accumulator.latencySamplesMs.length,
  };
};

const buildWindowSnapshot = (
  startMs: number,
  endMs: number,
  accumulators: Readonly<Record<string, MethodAccumulator>>,
): AggregatedMetricsWindow => {
  const durationMs = Math.max(0, endMs - startMs);

  return {
    startedAt: formatTimestampIso(startMs),
    endedAt: formatTimestampIso(endMs),
    startMs,
    endMs,
    durationMs,
    methods: Object.entries(accumulators)
      .map(([method, accumulator]) => aggregateMethod(method, accumulator, durationMs))
      .toSorted((left, right) => left.method.localeCompare(right.method)),
  };
};

const rollStateForward = (
  state: MetricsAggregatorState,
  nowMs: number,
  options: ResolvedMetricsAggregatorOptions,
): MetricsAggregatorState => {
  const targetWindowStartMs = windowStartFor(nowMs, options.windowMs);
  if (targetWindowStartMs <= state.currentWindowStartMs) {
    return state;
  }

  const elapsedWindows = Math.floor(
    (targetWindowStartMs - state.currentWindowStartMs) / options.windowMs,
  );
  const droppedAllKnownWindows = elapsedWindows > options.windowCount;
  const firstWindowStartMs = droppedAllKnownWindows
    ? targetWindowStartMs - options.windowCount * options.windowMs
    : state.currentWindowStartMs;

  let completedWindows: ReadonlyArray<AggregatedMetricsWindow> = droppedAllKnownWindows
    ? []
    : [...state.completedWindows];
  for (
    let windowStartMs = firstWindowStartMs;
    windowStartMs < targetWindowStartMs;
    windowStartMs += options.windowMs
  ) {
    const accumulators =
      windowStartMs === state.currentWindowStartMs ? state.current : emptyAccumulators;
    completedWindows = appendWindow(
      completedWindows,
      buildWindowSnapshot(windowStartMs, windowStartMs + options.windowMs, accumulators),
      options.windowCount,
    );
  }

  return {
    currentWindowStartMs: targetWindowStartMs,
    current: emptyAccumulators,
    completedWindows,
  };
};

const emptyAccumulator: MethodAccumulator = {
  requestCount: 0,
  successCount: 0,
  failureCount: 0,
  interruptCount: 0,
  latencySamplesMs: [],
};

const recordObservation = (
  state: MetricsAggregatorState,
  observation: Required<RpcMetricObservation>,
  options: ResolvedMetricsAggregatorOptions,
): MetricsAggregatorState => {
  const rolledState = rollStateForward(state, observation.observedAtMs, options);
  const currentAccumulator = rolledState.current[observation.method] ?? emptyAccumulator;
  const nextLatencySamples = [
    ...currentAccumulator.latencySamplesMs,
    normalizeDurationMs(observation.durationMs),
  ].slice(-options.maxLatencySamplesPerMethod);

  const nextAccumulator: MethodAccumulator = {
    requestCount: currentAccumulator.requestCount + 1,
    successCount: currentAccumulator.successCount + (observation.outcome === "success" ? 1 : 0),
    failureCount: currentAccumulator.failureCount + (observation.outcome === "failure" ? 1 : 0),
    interruptCount:
      currentAccumulator.interruptCount + (observation.outcome === "interrupt" ? 1 : 0),
    latencySamplesMs: nextLatencySamples,
  };

  return {
    ...rolledState,
    current: {
      ...rolledState.current,
      [observation.method]: nextAccumulator,
    },
  };
};

const snapshotState = (
  state: MetricsAggregatorState,
  options: ResolvedMetricsAggregatorOptions,
): ReadonlyArray<AggregatedMetricsWindow> => [
  ...state.completedWindows,
  buildWindowSnapshot(
    state.currentWindowStartMs,
    state.currentWindowStartMs + options.windowMs,
    state.current,
  ),
];

export const makeMetricsAggregator = (
  options?: MetricsAggregatorOptions,
): Effect.Effect<MetricsAggregatorShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    const resolvedOptions = resolveOptions(options);
    const nowMs = yield* Clock.currentTimeMillis;
    const stateRef = yield* Ref.make(makeInitialState(nowMs, resolvedOptions));

    const snapshotAt: MetricsAggregatorShape["snapshotAt"] = (snapshotNowMs) =>
      Ref.updateAndGet(stateRef, (state) =>
        rollStateForward(state, snapshotNowMs, resolvedOptions),
      ).pipe(
        Effect.flatMap((state) =>
          selectSlidingWindowBuffer(
            snapshotState(state, resolvedOptions),
            resolvedOptions.windowCount,
          ),
        ),
      );

    const rotate = Clock.currentTimeMillis.pipe(
      Effect.flatMap((rotationNowMs) =>
        Ref.update(stateRef, (state) => rollStateForward(state, rotationNowMs, resolvedOptions)),
      ),
    );

    if (resolvedOptions.autoRotate) {
      yield* Effect.forkScoped(
        rotate.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("metrics.aggregator.rotate-failed", { cause }),
          ),
          Effect.repeat(Schedule.spaced(Duration.millis(resolvedOptions.windowMs))),
        ),
      );
    }

    return {
      recordRpc: (observation) =>
        Effect.gen(function* () {
          const observedAtMs =
            observation.observedAtMs === undefined
              ? yield* Clock.currentTimeMillis
              : normalizeTimestampMs(observation.observedAtMs);
          yield* Ref.update(stateRef, (state) =>
            recordObservation(
              state,
              {
                ...observation,
                observedAtMs,
              },
              resolvedOptions,
            ),
          );
        }),
      getWindows: Clock.currentTimeMillis.pipe(Effect.flatMap(snapshotAt)),
      snapshotAt,
    } satisfies MetricsAggregatorShape;
  });

export const makeMetricsAggregatorLive = (options?: MetricsAggregatorOptions) =>
  Layer.effect(MetricsAggregator, makeMetricsAggregator(options));

export const MetricsAggregatorLive = makeMetricsAggregatorLive();
