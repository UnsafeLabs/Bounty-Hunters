import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as MetricState from "effect/MetricState";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { metricAttributes, rpcRequestDuration, rpcRequestsTotal } from "./Metrics.ts";

/**
 * A single metrics window containing aggregated statistics for one time interval.
 */
export interface MetricsWindow {
  /** Wall-clock timestamp (milliseconds) marking the start of this window. */
  readonly windowStartMs: number;
  /** Number of RPC calls recorded in this window. */
  readonly count: number;
  /** Sorted array of latency values in nanoseconds — used for percentile calculation. */
  readonly latenciesNs: readonly bigint[];
  /** Number of errored (non-success) calls in this window. */
  readonly errorCount: number;
}

/**
 * Aggregated percentile statistics for a metrics window.
 */
export interface Percentiles {
  /** 50th percentile latency in milliseconds. */
  readonly p50Ms: number;
  /** 95th percentile latency in milliseconds. */
  readonly p95Ms: number;
  /** 99th percentile latency in milliseconds. */
  readonly p99Ms: number;
}

/**
 * Full aggregated metrics snapshot for a single window.
 */
export interface AggregatedWindow {
  /** Timestamp marking the start of this window (milliseconds since epoch). */
  readonly windowStartMs: number;
  /** Total number of RPC calls in the window. */
  readonly count: number;
  /** Error rate as a fraction (0 = no errors, 1 = all errors). */
  readonly errorRate: number;
  /** Requests per second averaged over the window. */
  readonly throughput: number;
  /** Latency percentiles for this window. */
  readonly percentiles: Percentiles;
}

/** Duration of one metrics window in milliseconds (1 minute). */
const WINDOW_DURATION_MS = 60_000;

/** Number of windows to retain (60 minutes of data). */
const BUFFER_SIZE = 60;

const WINDOW_DURATION = Duration.millis(WINDOW_DURATION_MS);
const TICK_INTERVAL = Duration.millis(WINDOW_DURATION_MS / 2); // tick every 30s to catch edges

/**
 * Compute p50/p95/p99 from a sorted array of values (in ns) → returns ms.
 */
const computePercentiles = (sorted: bigint[], p50Idx: number, p95Idx: number, p99Idx: number): Percentiles => ({
  p50Ms: Number(sorted[Math.min(p50Idx, sorted.length - 1)]) / 1_000_000,
  p95Ms: Number(sorted[Math.min(p95Idx, sorted.length - 1)]) / 1_000_000,
  p99Ms: Number(sorted[Math.min(p99Idx, sorted.length - 1)]) / 1_000_000,
});

/**
 * Convert a MetricsWindow to an AggregatedWindow with percentile computation.
 */
const aggregateWindow = (window: MetricsWindow, windowDurationMs: number): AggregatedWindow => {
  const sorted = [...window.latenciesNs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const count = window.count;
  const errorRate = count > 0 ? window.errorCount / count : 0;
  const durationSec = windowDurationMs / 1000;
  const throughput = count / durationSec;

  if (sorted.length === 0) {
    return {
      windowStartMs: window.windowStartMs,
      count,
      errorRate,
      throughput,
      percentiles: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    };
  }

  const p50Idx = Math.floor(sorted.length * 0.5);
  const p95Idx = Math.floor(sorted.length * 0.95);
  const p99Idx = Math.floor(sorted.length * 0.99);

  return {
    windowStartMs: window.windowStartMs,
    count,
    errorRate,
    throughput,
    percentiles: computePercentiles(sorted, p50Idx, p95Idx, p99Idx),
  };
};

/**
 * Circular buffer of MetricsWindow that retains the last BUFFER_SIZE entries.
 */
class CircularWindowBuffer {
  private buffer: MetricsWindow[] = [];
  private head = 0;

  push(window: MetricsWindow): void {
    if (this.buffer.length < BUFFER_SIZE) {
      this.buffer.push(window);
    } else {
      this.buffer[this.head % BUFFER_SIZE] = window;
    }
    this.head++;
  }

  getAll(): MetricsWindow[] {
    if (this.buffer.length === 0) return [];
    if (this.buffer.length < BUFFER_SIZE) return [...this.buffer];
    const result: MetricsWindow[] = [];
    for (let i = 0; i < BUFFER_SIZE; i++) {
      const idx = (this.head + i) % BUFFER_SIZE;
      const item = this.buffer[idx];
      if (item) result.push(item);
    }
    // Sort by windowStartMs ascending
    return result.sort((a, b) => a.windowStartMs - b.windowStartMs);
  }

  get size(): number {
    return Math.min(this.buffer.length, BUFFER_SIZE);
  }
}

/**
 * MetricsAggregator service that collects RPC metrics into 1-minute sliding windows
 * and exposes aggregated statistics.
 */
export interface MetricsAggregator {
  /** Record a single RPC call's latency and outcome into the current window. */
  recordLatency(method: string, latencyNs: bigint, isError: boolean): Effect.Effect<void>;
  /** Get all aggregated windows as a JSON-serializable array. */
  getAggregatedWindows(): Effect.Effect<AggregatedWindow[]>;
  /** Start the background aggregation tick loop. */
  start(): Effect.Effect<void>;
}

/**
 * Create a MetricsAggregator service.
 *
 * Uses Effect.Ref for mutable state, Clock for time, and a circular buffer
 * to retain exactly 60 windows (1 hour of data).
 */
const makeMetricsAggregator = (): Effect.Effect<MetricsAggregator> =>
  Effect.gen(function* () {
    // Current active window
    const currentWindow = yield* Ref.make<MetricsWindow>({
      windowStartMs: Date.now(),
      count: 0,
      latenciesNs: [],
      errorCount: 0,
    });

    // Circular buffer for completed windows
    const completedWindows = yield* Ref.make<CircularWindowBuffer>(new CircularWindowBuffer());

    /**
     * Finalize the current window, push it to the completed buffer,
     * and start a fresh window.
     */
    const rotateWindow = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const now = Date.now();
        const existing = yield* Ref.get(currentWindow);
        const buffered = yield* Ref.get(completedWindows);
        buffered.push(existing);
        yield* Ref.set(currentWindow, {
          windowStartMs: now,
          count: 0,
          latenciesNs: [],
          errorCount: 0,
        });
      });

    const recordLatency = (
      method: string,
      latencyNs: bigint,
      isError: boolean,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const now = Date.now();
        const existing = yield* Ref.get(currentWindow);

        // If current window has expired, rotate first
        if (now >= existing.windowStartMs + WINDOW_DURATION_MS) {
          yield* rotateWindow();
        }

        const updated = yield* Ref.get(currentWindow);
        yield* Ref.set(currentWindow, {
          ...updated,
          count: updated.count + 1,
          latenciesNs: [...updated.latenciesNs, latencyNs],
          errorCount: updated.errorCount + (isError ? 1 : 0),
        });
      });

    const getAggregatedWindows = (): Effect.Effect<AggregatedWindow[]> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(currentWindow);
        const buffered = yield* Ref.get(completedWindows);
        const all = buffered.getAll();
        // Include current window if it has data
        const withCurrent =
          current.count > 0 ? [...all, aggregateWindow(current, WINDOW_DURATION_MS)] : all;
        return withCurrent;
      });

    /**
     * Background loop that rotates windows every minute.
     * Runs on a 30-second tick to catch window boundaries accurately.
     */
    const start = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Clock.sleep(Duration.millis(500)); // small initial delay
        while (true) {
          const now = Date.now();
          const current = yield* Ref.get(currentWindow);
          if (now >= current.windowStartMs + WINDOW_DURATION_MS) {
            yield* rotateWindow();
          }
          yield* Clock.sleep(TICK_INTERVAL);
        }
      });

    return {
      recordLatency,
      getAggregatedWindows,
      start,
    } as MetricsAggregator;
  });

export const MetricsAggregator = Object.assign(makeMetricsAggregator, {
  /**
   * Effect that runs the aggregator tick loop in the background.
   * Attach to your server runtime as a side-effect service.
   */
  run: (aggregator: MetricsAggregator): Effect.Effect<never> =>
    Effect.annotateCurrentSpan("MetricsAggregator.run", {}).pipe(
      Effect.flatMap(() => aggregator.start()),
    ),
});

/**
 * Record an RPC metric into the aggregator from the raw Effect metrics system.
 * This bridges between the existing Metric.observe API and our window aggregator.
 */
export const recordRpcMetric = (
  aggregator: MetricsAggregator,
  method: string,
  latencyNs: bigint,
  isError: boolean,
): Effect.Effect<void> =>
  aggregator.recordLatency(method, latencyNs, isError);