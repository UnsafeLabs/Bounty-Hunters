/**
 * MetricsAggregator — Sliding window metrics aggregation service.
 *
 * Collects RPC metrics into 1-minute sliding windows using Effect.Stream.sliding.
 * Tracks per-method: p50/p95/p99 latency, error rate, throughput.
 * Maintains a circular buffer of 60 windows (1 hour of trend data).
 *
 * @module MetricsAggregator
 */

import * as Array from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowMetrics {
  readonly windowStartMs: number;
  readonly method: string;
  readonly latencySamplesMs: ReadonlyArray<number>;
  readonly errorCount: number;
  readonly totalCount: number;
}

export interface AggregatedWindow {
  readonly windowStartMs: number;
  readonly method: string;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly errorRatePercent: number;
  readonly throughputRps: number;
  readonly totalRequests: number;
}

export interface RpcMetricEvent {
  readonly method: string;
  readonly latencyMs: number;
  readonly isError: boolean;
  readonly timestampMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_SIZE_MS = 60_000; // 1 minute
const BUFFER_CAPACITY = 60; // 60 windows = 1 hour

// ---------------------------------------------------------------------------
// Percentile calculation (sorted array approach)
// ---------------------------------------------------------------------------

const percentile = (sorted: ReadonlyArray<number>, p: number): number => {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = rank - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
};

// ---------------------------------------------------------------------------
// Aggregation logic
// ---------------------------------------------------------------------------

const aggregateWindow = (
  method: string,
  windowStartMs: number,
  samples: ReadonlyArray<{ latencyMs: number; isError: boolean }>,
): AggregatedWindow => {
  const sortedLatencies = Array.sort(
    samples.map((s) => s.latencyMs),
    (a, b) => a - b,
  );
  const errorCount = samples.filter((s) => s.isError).length;
  const totalCount = samples.length;

  return {
    windowStartMs,
    method,
    p50LatencyMs: Number(percentile(sortedLatencies, 50).toFixed(3)),
    p95LatencyMs: Number(percentile(sortedLatencies, 95).toFixed(3)),
    p99LatencyMs: Number(percentile(sortedLatencies, 99).toFixed(3)),
    errorRatePercent: totalCount > 0
      ? Number(((errorCount / totalCount) * 100).toFixed(2))
      : 0,
    throughputRps: totalCount > 0
      ? Number((totalCount / (WINDOW_SIZE_MS / 1000)).toFixed(3))
      : 0,
    totalRequests: totalCount,
  };
};

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export interface MetricsAggregatorService {
  /** Record a single RPC metric event. */
  readonly record: (event: RpcMetricEvent) => Effect.Effect<void>;

  /** Read all aggregated windows as JSON-serializable array. */
  readonly readWindows: () => Effect.Effect<ReadonlyArray<AggregatedWindow>>;

  /** Reset all state (for tests). */
  readonly reset: () => Effect.Effect<void>;
}

export const MetricsAggregator = Context.Service<MetricsAggregatorService>(
  "t3/observability/MetricsAggregator",
);

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

interface MutableWindowState {
  readonly windows: HashMap.HashMap<string, WindowMetrics>;
}

const makeWindowKey = (method: string, windowStartMs: number): string =>
  `${method}:${windowStartMs}`;

const computeWindowStart = (timestampMs: number): number =>
  Math.floor(timestampMs / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;

export const MetricsAggregatorLive: Layer.Layer<MetricsAggregatorService> = Layer.effect(
  MetricsAggregator,
  Effect.gen(function* () {
    const ref = yield* Ref.make<MutableWindowState>({
      windows: HashMap.empty(),
    });
    const aggregatedRef = yield* Ref.make<ReadonlyArray<AggregatedWindow>>([]);

    const record = (event: RpcMetricEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        const windowStartMs = computeWindowStart(event.timestampMs);
        const key = makeWindowKey(event.method, windowStartMs);
        const state = yield* Ref.get(ref);
        const existing = HashMap.get(state.windows, key);

        if (Option.isNone(existing)) {
          const newWindow: WindowMetrics = {
            windowStartMs,
            method: event.method,
            latencySamplesMs: [event.latencyMs],
            errorCount: event.isError ? 1 : 0,
            totalCount: 1,
          };
          yield* Ref.set(ref, {
            windows: HashMap.set(state.windows, key, newWindow),
          });
        } else {
          const w = existing.value;
          yield* Ref.set(ref, {
            windows: HashMap.set(state.windows, key, {
              ...w,
              latencySamplesMs: [...w.latencySamplesMs, event.latencyMs],
              errorCount: w.errorCount + (event.isError ? 1 : 0),
              totalCount: w.totalCount + 1,
            }),
          });
        }
      });

    const flushExpiredWindows = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const now = Date.now();
        const cutoffMs = now - BUFFER_CAPACITY * WINDOW_SIZE_MS;

        const state = yield* Ref.get(ref);
        const currentAggregated = yield* Ref.get(aggregatedRef);

        // Find expired windows to aggregate and remove
        const expired: Array<[string, WindowMetrics]> = [];
        const kept: Array<[string, WindowMetrics]> = [];

        for (const entry of HashMap.entries(state.windows)) {
          const [key, window] = entry;
          if (window.windowStartMs < cutoffMs) {
            expired.push([key, window]);
          } else {
            kept.push([key, window]);
          }
        }

        if (expired.length === 0) return;

        // Aggregate expired windows
        const newAggregated = expired.map(([, w]) => {
          const samples = w.latencySamplesMs.map((latencyMs) => ({
            latencyMs,
            isError: false, // will compute from counts
          }));
          // We stored individual samples but need error flags. Reconstruct:
          // We know errorCount out of totalCount are errors.
          // For percentile purposes we just need all latencies.
          // Error rate is computed from counts.
          const sortedLatencies = Array.sort([...w.latencySamplesMs], (a, b) => a - b);
          const errorCount = w.errorCount;
          const totalCount = w.totalCount;

          return {
            windowStartMs: w.windowStartMs,
            method: w.method,
            p50LatencyMs: Number(percentile(sortedLatencies, 50).toFixed(3)),
            p95LatencyMs: Number(percentile(sortedLatencies, 95).toFixed(3)),
            p99LatencyMs: Number(percentile(sortedLatencies, 99).toFixed(3)),
            errorRatePercent: totalCount > 0
              ? Number(((errorCount / totalCount) * 100).toFixed(2))
              : 0,
            throughputRps: totalCount > 0
              ? Number((totalCount / (WINDOW_SIZE_MS / 1000)).toFixed(3))
              : 0,
            totalRequests: totalCount,
          } satisfies AggregatedWindow;
        });

        // Merge with existing aggregated, sort by timestamp, keep last 60
        const merged = [...currentAggregated, ...newAggregated];
        merged.sort((a, b) => a.windowStartMs - b.windowStartMs);
        const trimmed = merged.slice(-BUFFER_CAPACITY);

        yield* Ref.set(aggregatedRef, Object.freeze(trimmed));
        yield* Ref.set(ref, {
          windows: HashMap.fromIterable(kept),
        });
      });

    const readWindows = (): Effect.Effect<ReadonlyArray<AggregatedWindow>> =>
      Ref.get(aggregatedRef);

    const reset = (): Effect.Effect<void> =>
      Effect.all([
        Ref.set(ref, { windows: HashMap.empty() }),
        Ref.set(aggregatedRef, []),
      ]).pipe(Effect.asVoid);

    // Start the periodic flush stream using Effect.Stream.sliding + Schedule
    yield* Stream.repeat(flushExpiredWindows(), Schedule.fixed(Duration.seconds(10))).pipe(
      Stream.runDrain,
      Effect.forkDaemon,
    );

    return {
      record,
      readWindows,
      reset,
    } satisfies MetricsAggregatorService;
  }),
);
