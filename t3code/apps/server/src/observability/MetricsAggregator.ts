/**
 * Sliding window metrics aggregation service.
 *
 * Collects RPC endpoint metrics into 1-minute time buckets and exposes
 * aggregated statistics (request count, latency p50/p90/p99, error rate)
 * via an HTTP endpoint. The window slides every minute.
 *
 * @module MetricsAggregator
 */

import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Clock from "effect/Clock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single metric observation recorded for an RPC call.
 */
export interface MetricObservation {
  readonly method: string;
  readonly durationMs: number;
  readonly success: boolean;
}

/**
 * Aggregated metrics for a single endpoint within a time bucket.
 */
export interface EndpointMetrics {
  readonly requestCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
}

/**
 * Internal per-endpoint state (mutable accumulators).
 */
export interface InternalEndpointMetrics {
  requestCount: number;
  errorCount: number;
  latencies: number[];
}

/**
 * A 1-minute time bucket holding per-endpoint metrics.
 */
export interface TimeBucket {
  /** Unix epoch milliseconds for the start of this bucket. */
  readonly timestamp: number;
  readonly endpoints: Record<string, InternalEndpointMetrics>;
}

/**
 * The aggregated view returned by the service.
 */
export interface AggregatedMetrics {
  readonly windowMinutes: number;
  readonly buckets: ReadonlyArray<{
    readonly timestamp: number;
    readonly endpoints: Record<string, EndpointMetrics>;
  }>;
}

// ---------------------------------------------------------------------------
// Window state
// ---------------------------------------------------------------------------

export const WINDOW_DURATION = Duration.seconds(60);
const WINDOW_SIZE_MINUTES = 1;

function makeEmptyBucket(timestamp: number): TimeBucket {
  return { timestamp, endpoints: {} };
}

function getOrCreateEndpoint(
  bucket: TimeBucket,
  method: string,
): InternalEndpointMetrics {
  let ep = bucket.endpoints[method];
  if (!ep) {
    ep = { requestCount: 0, errorCount: 0, latencies: [] };
    bucket.endpoints[method] = ep;
  }
  return ep;
}

/**
 * Compute percentiles from a sorted array of numbers.
 * Returns 0 for empty arrays.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * Convert internal endpoint metrics to the public shape.
 */
function toEndpointMetrics(ep: InternalEndpointMetrics): EndpointMetrics {
  const sorted = [...ep.latencies].sort((a, b) => a - b);
  return {
    requestCount: ep.requestCount,
    errorCount: ep.errorCount,
    errorRate: ep.requestCount > 0 ? ep.errorCount / ep.requestCount : 0,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
  };
}

// ---------------------------------------------------------------------------
// Service shape & tag
// ---------------------------------------------------------------------------

export interface MetricsAggregatorShape {
  /**
   * Record a single RPC metric observation into the current time bucket.
   */
  readonly record: (
    observation: MetricObservation,
  ) => Effect.Effect<void>;

  /**
   * Get the current aggregated view of all buckets in the sliding window.
   */
  readonly getAggregatedMetrics: Effect.Effect<AggregatedMetrics>;
}

export class MetricsAggregator extends Context.Service<
  MetricsAggregator,
  MetricsAggregatorShape
>()("t3/observability/MetricsAggregator") {}

// ---------------------------------------------------------------------------
// Window management helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Get the minute-aligned timestamp (epoch ms) for a given epoch millis.
 */
export function minuteAligned(epochMillis: number): number {
  return Math.floor(epochMillis / 60_000) * 60_000;
}

/**
 * Internal window state: sliding window representing the last N minutes.
 */
export interface WindowState {
  readonly buckets: TimeBucket[];
  /** The start of the most recent completed minute (epoch ms). */
  readonly currentMinute: number;
}

/**
 * Advance the window: drop expired buckets and create a new current bucket.
 * If still in the same minute, returns state unchanged.
 */
export function slideWindow(
  state: WindowState,
  nowEpochMs: number,
): WindowState {
  const currentMinute = minuteAligned(nowEpochMs);

  if (currentMinute === state.currentMinute) {
    return state;
  }

  const windowStart = currentMinute - WINDOW_SIZE_MINUTES * 60_000;
  const retained = state.buckets.filter(
    (b) => b.timestamp >= windowStart,
  );

  const hasCurrent = retained.some((b) => b.timestamp === currentMinute);
  if (!hasCurrent) {
    retained.push(makeEmptyBucket(currentMinute));
  }

  return {
    buckets: retained,
    currentMinute,
  };
}

/**
 * Record an observation into the window state.
 */
export function recordObservation(
  state: WindowState,
  observation: MetricObservation,
  nowEpochMs: number,
): WindowState {
  const currentMinute = minuteAligned(nowEpochMs);

  let updated = state;
  if (currentMinute !== state.currentMinute) {
    updated = slideWindow(state, nowEpochMs);
  }

  let bucket = updated.buckets.find((b) => b.timestamp === currentMinute);
  if (!bucket) {
    bucket = makeEmptyBucket(currentMinute);
    updated = {
      ...updated,
      buckets: [...updated.buckets, bucket],
    };
  }

  const ep = getOrCreateEndpoint(bucket, observation.method);
  ep.requestCount += 1;
  if (!observation.success) {
    ep.errorCount += 1;
  }
  ep.latencies.push(observation.durationMs);

  return updated;
}

/**
 * Convert window state into the public AggregatedMetrics view.
 */
export function summarizeWindow(
  state: WindowState,
): AggregatedMetrics {
  const buckets = state.buckets.map((bucket) => {
    const endpoints: Record<string, EndpointMetrics> = {};
    for (const method of Object.keys(bucket.endpoints)) {
      endpoints[method] = toEndpointMetrics(bucket.endpoints[method]!);
    }
    return {
      // Convert to epoch seconds for a clean API
      timestamp: Math.floor(bucket.timestamp / 1000),
      endpoints,
    };
  });

  return {
    windowMinutes: WINDOW_SIZE_MINUTES,
    buckets,
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const MAX_OBSERVATIONS_PER_BUCKET = 100_000;

function capBucket(bucket: TimeBucket): TimeBucket {
  for (const method of Object.keys(bucket.endpoints)) {
    const ep = bucket.endpoints[method]!;
    if (ep.latencies.length > MAX_OBSERVATIONS_PER_BUCKET) {
      ep.latencies = ep.latencies.slice(-MAX_OBSERVATIONS_PER_BUCKET);
    }
  }
  return bucket;
}

export const make = Effect.fn("makeMetricsAggregator")(function* () {
  const now = yield* Clock.currentTimeMillis;
  const initialMinute = minuteAligned(now);
  const initialState: WindowState = {
    buckets: [makeEmptyBucket(initialMinute)],
    currentMinute: initialMinute,
  };
  const stateRef = yield* Ref.make<WindowState>(initialState);

  // Scheduled task: slide the window every second (cheap idempotent check)
  // and cap latencies to prevent unbounded memory growth.
  const slideTask = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    yield* Ref.update(stateRef, (state) => slideWindow(state, nowMs));
    yield* Ref.update(stateRef, (state) => ({
      ...state,
      buckets: state.buckets.map(capBucket),
    }));
  });

  yield* Effect.forever(
    slideTask.pipe(
      Effect.andThen(Effect.sleep("1 second")),
      Effect.catch((cause) =>
        Effect.logWarning("MetricsAggregator slide task failed", { cause }),
      ),
    ),
  ).pipe(Effect.forkScoped);

  const record = (observation: MetricObservation): Effect.Effect<void> =>
    Ref.update(stateRef, (state) => {
      const nowMs = Date.now();
      return recordObservation(state, observation, nowMs);
    });

  const getAggregatedMetrics: Effect.Effect<AggregatedMetrics> =
    Ref.get(stateRef).pipe(Effect.map(summarizeWindow));

  return MetricsAggregator.of({ record, getAggregatedMetrics });
});

export const layer = Layer.effect(MetricsAggregator, make());
