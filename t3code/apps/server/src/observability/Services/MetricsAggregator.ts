import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import type { ObservabilityOutcome } from "../Attributes.ts";

const DEFAULT_WINDOW_SIZE_MS = 60_000;
const DEFAULT_WINDOW_STEP_MS = 60_000;
const DEFAULT_WINDOW_COUNT = 60;
const DEFAULT_MAX_SAMPLES = 100_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

export interface RpcMetricSample {
  readonly method: string;
  readonly outcome: ObservabilityOutcome;
  readonly durationMs: number;
  readonly timestampMs: number;
}

export interface AggregatedMethodMetrics {
  readonly method: string;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly throughputPerSecond: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface AggregatedMetricWindow {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly sampleCount: number;
  readonly methods: ReadonlyArray<AggregatedMethodMetrics>;
}

export interface MetricsAggregationOptions {
  readonly nowMs: number;
  readonly windowSizeMs?: number;
  readonly windowStepMs?: number;
  readonly windowCount?: number;
}

export interface MetricsAggregatorLiveOptions extends Omit<MetricsAggregationOptions, "nowMs"> {
  readonly maxSamples?: number;
  readonly pruneIntervalMs?: number;
}

interface NormalizedMetricsAggregationOptions {
  readonly nowMs: number;
  readonly windowSizeMs: number;
  readonly windowStepMs: number;
  readonly windowCount: number;
  readonly slicesPerWindow: number;
}

export interface MetricsAggregatorShape {
  readonly recordRpcSample: (sample: RpcMetricSample) => Effect.Effect<void>;
  readonly snapshot: (nowMs?: number) => Effect.Effect<ReadonlyArray<AggregatedMetricWindow>>;
  readonly prune: (nowMs?: number) => Effect.Effect<void>;
}

export class MetricsAggregator extends Context.Service<MetricsAggregator, MetricsAggregatorShape>()(
  "t3/observability/Services/MetricsAggregator",
) {}

const finitePositiveInteger = (value: number | undefined, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
};

const aggregationOptionsFromLiveOptions = (
  nowMs: number,
  options: MetricsAggregatorLiveOptions,
): MetricsAggregationOptions => ({
  nowMs,
  ...(options.windowCount !== undefined ? { windowCount: options.windowCount } : {}),
  ...(options.windowSizeMs !== undefined ? { windowSizeMs: options.windowSizeMs } : {}),
  ...(options.windowStepMs !== undefined ? { windowStepMs: options.windowStepMs } : {}),
});

const formatTimestamp = (epochMillis: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(epochMillis));

const normalizeOptions = (
  options: MetricsAggregationOptions,
): NormalizedMetricsAggregationOptions => {
  const nowMs = finitePositiveInteger(options.nowMs, 0);
  const windowSizeMs = finitePositiveInteger(options.windowSizeMs, DEFAULT_WINDOW_SIZE_MS);
  const rawWindowStepMs = finitePositiveInteger(options.windowStepMs, DEFAULT_WINDOW_STEP_MS);
  const windowStepMs = Math.min(rawWindowStepMs, windowSizeMs);
  const windowCount = finitePositiveInteger(options.windowCount, DEFAULT_WINDOW_COUNT);
  const slicesPerWindow = Math.max(1, Math.ceil(windowSizeMs / windowStepMs));

  return {
    nowMs,
    windowSizeMs: slicesPerWindow * windowStepMs,
    windowStepMs,
    windowCount,
    slicesPerWindow,
  };
};

const normalizeSample = (sample: RpcMetricSample): RpcMetricSample => ({
  method: sample.method.trim() || "unknown",
  outcome: sample.outcome,
  durationMs: Number.isFinite(sample.durationMs) ? Math.max(0, sample.durationMs) : 0,
  timestampMs: Number.isFinite(sample.timestampMs) ? Math.trunc(sample.timestampMs) : 0,
});

const percentile = (values: ReadonlyArray<number>, percentileRank: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
};

const aggregateMethodMetrics = (
  samples: ReadonlyArray<RpcMetricSample>,
  windowDurationMs: number,
): ReadonlyArray<AggregatedMethodMetrics> => {
  const samplesByMethod = new Map<string, Array<RpcMetricSample>>();
  for (const sample of samples) {
    const existing = samplesByMethod.get(sample.method);
    if (existing) {
      existing.push(sample);
    } else {
      samplesByMethod.set(sample.method, [sample]);
    }
  }

  const windowDurationSeconds = Math.max(1, windowDurationMs / 1_000);
  return [...samplesByMethod.entries()]
    .map(([method, methodSamples]) => {
      const durations = methodSamples.map((sample) => sample.durationMs);
      const errorCount = methodSamples.filter((sample) => sample.outcome !== "success").length;
      return {
        method,
        requestCount: methodSamples.length,
        errorCount,
        errorRate: (errorCount / methodSamples.length) * 100,
        throughputPerSecond: methodSamples.length / windowDurationSeconds,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        p99Ms: percentile(durations, 99),
      } satisfies AggregatedMethodMetrics;
    })
    .toSorted((left, right) => left.method.localeCompare(right.method));
};

const makeTimeSlices = (
  options: NormalizedMetricsAggregationOptions,
): ReadonlyArray<{ readonly startedAtMs: number; readonly endedAtMs: number }> => {
  const latestClosedWindowEndMs =
    Math.floor(options.nowMs / options.windowStepMs) * options.windowStepMs;
  const latestWindowEndMs =
    latestClosedWindowEndMs === options.nowMs
      ? latestClosedWindowEndMs
      : latestClosedWindowEndMs + options.windowStepMs;
  const sliceCount = options.windowCount + options.slicesPerWindow - 1;
  const earliestSliceStartMs = latestWindowEndMs - sliceCount * options.windowStepMs;

  return Array.from({ length: sliceCount }, (_, index) => {
    const startedAtMs = earliestSliceStartMs + index * options.windowStepMs;
    return {
      startedAtMs,
      endedAtMs: startedAtMs + options.windowStepMs,
    };
  });
};

export const aggregateRpcMetricSamples = (
  samples: ReadonlyArray<RpcMetricSample>,
  options: MetricsAggregationOptions,
): Effect.Effect<ReadonlyArray<AggregatedMetricWindow>> =>
  Effect.gen(function* () {
    const normalizedOptions = normalizeOptions(options);
    const normalizedSamples = samples.map(normalizeSample);
    const slices = makeTimeSlices(normalizedOptions);
    const slidingSlices = yield* Stream.runCollect(
      Stream.fromIterable(slices).pipe(Stream.sliding(normalizedOptions.slicesPerWindow)),
    );

    return Array.from(slidingSlices, (sliceGroup) => {
      const group = Array.from(sliceGroup);
      const firstSlice = group[0] ?? slices[0];
      const lastSlice = group[group.length - 1] ?? slices[slices.length - 1];
      const startedAtMs = firstSlice?.startedAtMs ?? 0;
      const endedAtMs = lastSlice?.endedAtMs ?? startedAtMs + normalizedOptions.windowSizeMs;
      const windowSamples = normalizedSamples.filter(
        (sample) => sample.timestampMs >= startedAtMs && sample.timestampMs < endedAtMs,
      );

      return {
        startedAt: formatTimestamp(startedAtMs),
        endedAt: formatTimestamp(endedAtMs),
        startedAtMs,
        endedAtMs,
        sampleCount: windowSamples.length,
        methods: aggregateMethodMetrics(windowSamples, endedAtMs - startedAtMs),
      } satisfies AggregatedMetricWindow;
    }).slice(-normalizedOptions.windowCount);
  });

const retentionMsFor = (options: MetricsAggregatorLiveOptions): number => {
  const normalizedOptions = normalizeOptions(aggregationOptionsFromLiveOptions(0, options));
  return (
    (normalizedOptions.windowCount + normalizedOptions.slicesPerWindow - 1) *
    normalizedOptions.windowStepMs
  );
};

const makeMetricsAggregator = (options: MetricsAggregatorLiveOptions = {}) =>
  Effect.gen(function* () {
    const samplesRef = yield* Ref.make<ReadonlyArray<RpcMetricSample>>([]);
    const maxSamples = finitePositiveInteger(options.maxSamples, DEFAULT_MAX_SAMPLES);
    const pruneIntervalMs = finitePositiveInteger(
      options.pruneIntervalMs,
      DEFAULT_PRUNE_INTERVAL_MS,
    );
    const retentionMs = retentionMsFor(options);

    const pruneSamples = (nowMs: number) =>
      Ref.update(samplesRef, (samples) => {
        const cutoffMs = nowMs - retentionMs;
        return samples.filter((sample) => sample.timestampMs >= cutoffMs).slice(-maxSamples);
      });

    const prune: MetricsAggregatorShape["prune"] = (nowMs) =>
      Effect.gen(function* () {
        const resolvedNowMs = nowMs ?? (yield* Clock.currentTimeMillis);
        yield* pruneSamples(resolvedNowMs);
      });

    const recordRpcSample: MetricsAggregatorShape["recordRpcSample"] = (sample) =>
      Ref.update(samplesRef, (samples) => [...samples, normalizeSample(sample)].slice(-maxSamples));

    const snapshot: MetricsAggregatorShape["snapshot"] = (nowMs) =>
      Effect.gen(function* () {
        const resolvedNowMs = nowMs ?? (yield* Clock.currentTimeMillis);
        yield* pruneSamples(resolvedNowMs);
        const samples = yield* Ref.get(samplesRef);
        return yield* aggregateRpcMetricSamples(
          samples,
          aggregationOptionsFromLiveOptions(resolvedNowMs, options),
        );
      });

    yield* Effect.forkScoped(
      prune().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("metrics.aggregator.prune-failed", { cause }),
        ),
        Effect.repeat(Schedule.spaced(Duration.millis(pruneIntervalMs))),
      ),
    );

    return {
      recordRpcSample,
      snapshot,
      prune,
    } satisfies MetricsAggregatorShape;
  });

export const makeMetricsAggregatorLive = (options?: MetricsAggregatorLiveOptions) =>
  Layer.effect(MetricsAggregator, makeMetricsAggregator(options));

export const MetricsAggregatorLive = makeMetricsAggregatorLive();
