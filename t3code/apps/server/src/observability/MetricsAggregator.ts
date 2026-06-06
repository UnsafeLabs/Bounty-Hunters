import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

const WINDOW_SIZE_MS = 60_000;
const WINDOW_CAPACITY = 60;

export interface RpcMetricSample {
  readonly method: string;
  readonly durationMs: number;
  readonly outcome: "success" | "failure" | "defect" | "interrupt";
  readonly timestampMs: number;
}

export interface MethodMetricsWindow {
  readonly method: string;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly throughput: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
}

export interface AggregatedMetricsWindow {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly methods: ReadonlyArray<MethodMetricsWindow>;
}

export interface MetricsAggregatorShape {
  readonly recordRpc: (sample: Omit<RpcMetricSample, "timestampMs">) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<AggregatedMetricsWindow>>;
  readonly rotate: Effect.Effect<void>;
}

interface AggregatorState {
  readonly activeStartedAtMs: number;
  readonly activeSamples: ReadonlyArray<RpcMetricSample>;
  readonly windows: ReadonlyArray<AggregatedMetricsWindow>;
}

export const MetricsAggregator = Context.Reference<MetricsAggregatorShape>(
  "t3/server/observability/MetricsAggregator",
  {
    defaultValue: () => ({
      recordRpc: () => Effect.void,
      snapshot: Effect.succeed([]),
      rotate: Effect.void,
    }),
  },
);

export const percentile = (values: ReadonlyArray<number>, percentileRank: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const clampedRank = Math.min(100, Math.max(0, percentileRank));
  const index = Math.ceil((clampedRank / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
};

const buildMethodWindow = (
  method: string,
  samples: ReadonlyArray<RpcMetricSample>,
): MethodMetricsWindow => {
  const latencies = samples.map((sample) => sample.durationMs);
  const errorCount = samples.filter((sample) => sample.outcome !== "success").length;
  const requestCount = samples.length;

  return {
    method,
    requestCount,
    errorCount,
    errorRate: requestCount === 0 ? 0 : (errorCount / requestCount) * 100,
    throughput: requestCount / (WINDOW_SIZE_MS / 1_000),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
  };
};

export const aggregateWindow = (
  samples: ReadonlyArray<RpcMetricSample>,
  startedAtMs: number,
): AggregatedMetricsWindow => {
  const byMethod = new Map<string, Array<RpcMetricSample>>();
  for (const sample of samples) {
    const current = byMethod.get(sample.method);
    if (current) {
      current.push(sample);
    } else {
      byMethod.set(sample.method, [sample]);
    }
  }

  const methods = [...byMethod.entries()]
    .map(([method, methodSamples]) => buildMethodWindow(method, methodSamples))
    .sort((left, right) => left.method.localeCompare(right.method));

  return {
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(startedAtMs + WINDOW_SIZE_MS).toISOString(),
    methods,
  };
};

export const computeSlidingWindows = (
  samples: ReadonlyArray<RpcMetricSample>,
  nowMs: number,
): ReadonlyArray<AggregatedMetricsWindow> => {
  const windowStarts = Array.from({ length: WINDOW_CAPACITY + 1 }, (_value, index) =>
    Math.floor(nowMs / WINDOW_SIZE_MS) * WINDOW_SIZE_MS - (WINDOW_CAPACITY - index) * WINDOW_SIZE_MS,
  );

  return Stream.runCollect(
    Stream.fromIterable(windowStarts).pipe(
      Stream.sliding(2),
      Stream.map((windowBounds) => {
        const startedAtMs = windowBounds[0];
        const endedAtMs = windowBounds[1] ?? startedAtMs + WINDOW_SIZE_MS;
        return aggregateWindow(
          samples.filter(
            (sample) => sample.timestampMs >= startedAtMs && sample.timestampMs < endedAtMs,
          ),
          startedAtMs,
        );
      }),
    ),
  ).pipe(Effect.runSync);
};

const rotateState = (state: AggregatorState, nowMs: number): AggregatorState => {
  const windowStartedAtMs = Math.floor(state.activeStartedAtMs / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;
  const sealedWindow = aggregateWindow(state.activeSamples, windowStartedAtMs);
  const nextWindowStartedAtMs = Math.floor(nowMs / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;

  return {
    activeStartedAtMs: nextWindowStartedAtMs,
    activeSamples: state.activeSamples.filter(
      (sample) => sample.timestampMs >= nextWindowStartedAtMs,
    ),
    windows: [...state.windows, sealedWindow].slice(-WINDOW_CAPACITY),
  };
};

const make = Effect.gen(function* () {
  const nowMs = yield* Clock.currentTimeMillis;
  const state = yield* Ref.make<AggregatorState>({
    activeStartedAtMs: Math.floor(nowMs / WINDOW_SIZE_MS) * WINDOW_SIZE_MS,
    activeSamples: [],
    windows: [],
  });

  const rotate = Clock.currentTimeMillis.pipe(
    Effect.flatMap((nowMs) => Ref.update(state, (current) => rotateState(current, nowMs))),
  );

  yield* rotate.pipe(
    Effect.repeat(Schedule.spaced(Duration.minutes(1))),
    Effect.forkScoped,
  );

  return {
    recordRpc: (sample) =>
      Effect.gen(function* () {
        const timestampMs = yield* Clock.currentTimeMillis;
        yield* Ref.update(state, (current) => {
          const nextState =
            timestampMs >= current.activeStartedAtMs + WINDOW_SIZE_MS
              ? rotateState(current, timestampMs)
              : current;
          const nextSamples = [
            ...nextState.activeSamples,
            {
              ...sample,
              timestampMs,
            },
          ].filter((entry) => timestampMs - entry.timestampMs < WINDOW_SIZE_MS * WINDOW_CAPACITY);

          return {
            ...nextState,
            activeSamples: nextSamples,
          };
        });
      }),
    snapshot: Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const current = yield* Ref.get(state);
      const activeWindowStartedAtMs =
        Math.floor(current.activeStartedAtMs / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;
      const activeWindow = aggregateWindow(current.activeSamples, activeWindowStartedAtMs);
      return [...current.windows, activeWindow].slice(-WINDOW_CAPACITY);
    }),
    rotate,
  } satisfies MetricsAggregatorShape;
});

export const MetricsAggregatorLive = Layer.effect(MetricsAggregator, make);
