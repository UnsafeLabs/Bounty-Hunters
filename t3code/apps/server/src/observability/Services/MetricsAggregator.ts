/**
 * MetricsAggregator - Sliding window metrics aggregation service.
 *
 * Collects RPC and domain metrics into 1-minute sliding windows, computing
 * per-method p50/p95/p99 latency percentiles, error rates, and throughput.
 * Maintains a circular buffer of the last 60 windows for 1-hour trend data.
 *
 * @module MetricsAggregator
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

const WINDOW_SIZE_MS = 60_000;
const MAX_WINDOWS = 60;

export interface MethodWindowMetrics {
  readonly method: string;
  readonly latencySamplesNs: ReadonlyArray<number>;
  readonly totalCount: number;
  readonly errorCount: number;
}

export interface WindowBucket {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly methods: Readonly<Record<string, MethodWindowMetrics>>;
}

export interface AggregatedWindowMetrics {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly methods: Readonly<Record<string, {
    readonly p50Ns: number;
    readonly p95Ns: number;
    readonly p99Ns: number;
    readonly errorRate: number;
    readonly throughput: number;
    readonly totalCount: number;
    readonly errorCount: number;
  }>>;
}

export interface MetricsAggregatorShape {
  readonly record: (
    method: string,
    durationNs: number,
    isError: boolean,
  ) => Effect.Effect<void>;
  readonly getAggregated: () => Effect.Effect<ReadonlyArray<AggregatedWindowMetrics>>;
  readonly getWindows: () => Effect.Effect<ReadonlyArray<WindowBucket>>;
  readonly reset: () => Effect.Effect<void>;
}

export class MetricsAggregator extends Context.Service<MetricsAggregator, MetricsAggregatorShape>()(
  "t3/observability/MetricsAggregator",
) {}

interface MutableWindowBucket {
  startTimeMs: number;
  endTimeMs: number;
  methods: Record<string, {
    latencySamplesNs: Array<number>;
    totalCount: number;
    errorCount: number;
  }>;
}

interface AggregatorState {
  windows: Array<MutableWindowBucket>;
  currentWindow: MutableWindowBucket;
}

const createEmptyWindow = (startTimeMs: number): MutableWindowBucket => ({
  startTimeMs,
  endTimeMs: startTimeMs + WINDOW_SIZE_MS,
  methods: {},
});

const computePercentile = (sortedSamples: ReadonlyArray<number>, percentile: number): number => {
  if (sortedSamples.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedSamples.length) - 1;
  return sortedSamples[Math.max(0, index)]!;
};

const sortNumbers = (arr: ReadonlyArray<number>): Array<number> =>
  [...arr].sort((a, b) => a - b);

const aggregateWindow = (window: WindowBucket): AggregatedWindowMetrics => {
  const methods: Record<string, AggregatedWindowMetrics["methods"][string]> = {};
  const windowDurationSec = (window.endTimeMs - window.startTimeMs) / 1000;

  for (const [method, metrics] of Object.entries(window.methods)) {
    const sorted = sortNumbers(metrics.latencySamplesNs);
    methods[method] = {
      p50Ns: computePercentile(sorted, 50),
      p95Ns: computePercentile(sorted, 95),
      p99Ns: computePercentile(sorted, 99),
      errorRate: metrics.totalCount > 0
        ? (metrics.errorCount / metrics.totalCount) * 100
        : 0,
      throughput: windowDurationSec > 0
        ? metrics.totalCount / windowDurationSec
        : 0,
      totalCount: metrics.totalCount,
      errorCount: metrics.errorCount,
    };
  }

  return {
    startTimeMs: window.startTimeMs,
    endTimeMs: window.endTimeMs,
    methods,
  };
};

const rotateWindow = (state: AggregatorState, nowMs: number): AggregatorState => {
  const frozenCurrent: WindowBucket = {
    startTimeMs: state.currentWindow.startTimeMs,
    endTimeMs: state.currentWindow.endTimeMs,
    methods: Object.fromEntries(
      Object.entries(state.currentWindow.methods).map(([method, m]) => [
        method,
        {
          method,
          latencySamplesNs: [...m.latencySamplesNs],
          totalCount: m.totalCount,
          errorCount: m.errorCount,
        },
      ]),
    ),
  };

  const newWindows = [...state.windows, frozenCurrent];
  if (newWindows.length > MAX_WINDOWS) {
    newWindows.splice(0, newWindows.length - MAX_WINDOWS);
  }

  return {
    windows: newWindows,
    currentWindow: createEmptyWindow(nowMs),
  };
};

const makeLive = Effect.gen(function* () {
  const stateRef = yield* Ref.make<AggregatorState>({
    windows: [],
    currentWindow: createEmptyWindow(Date.now()),
  });

  const recordSample = (method: string, durationNs: number, isError: boolean) =>
    Ref.update(stateRef, (state) => {
      const nowMs = Date.now();
      let currentState = state;

      if (nowMs >= state.currentWindow.endTimeMs) {
        currentState = rotateWindow(state, nowMs);
      }

      const window = currentState.currentWindow;
      const existing = window.methods[method];
      if (existing) {
        existing.latencySamplesNs.push(durationNs);
        existing.totalCount += 1;
        if (isError) existing.errorCount += 1;
      } else {
        window.methods[method] = {
          latencySamplesNs: [durationNs],
          totalCount: 1,
          errorCount: isError ? 1 : 0,
        };
      }

      return currentState;
    });

  const getWindows = Ref.get(stateRef).pipe(
    Effect.map((state) => {
      const allWindows: Array<WindowBucket> = [...state.windows];
      if (Object.keys(state.currentWindow.methods).length > 0) {
        allWindows.push({
          startTimeMs: state.currentWindow.startTimeMs,
          endTimeMs: state.currentWindow.endTimeMs,
          methods: Object.fromEntries(
            Object.entries(state.currentWindow.methods).map(([method, m]) => [
              method,
              {
                method,
                latencySamplesNs: [...m.latencySamplesNs],
                totalCount: m.totalCount,
                errorCount: m.errorCount,
              },
            ]),
          ),
        });
      }
      return allWindows;
    }),
  );

  const getAggregated = getWindows.pipe(
    Effect.map((windows) => windows.map(aggregateWindow)),
  );

  const reset = Ref.set(stateRef, {
    windows: [],
    currentWindow: createEmptyWindow(Date.now()),
  });

  const windowRotationStream = Stream.fromSchedule(
    Schedule.spaced(`${WINDOW_SIZE_MS} millis`),
  ).pipe(
    Stream.mapEffect(() =>
      Ref.update(stateRef, (state) => {
        const nowMs = Date.now();
        if (nowMs >= state.currentWindow.endTimeMs) {
          return rotateWindow(state, nowMs);
        }
        return state;
      })
    ),
  );

  yield* Stream.runDrain(windowRotationStream).pipe(
    Effect.forkDaemon,
    Effect.asUnit,
  );

  return {
    record: recordSample,
    getAggregated,
    getWindows,
    reset,
  } satisfies MetricsAggregatorShape;
});

export const MetricsAggregatorLive = Layer.effect(MetricsAggregator, makeLive);
