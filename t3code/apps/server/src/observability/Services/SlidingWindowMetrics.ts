import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Metric from "effect/Metric";

export interface WindowedMetric {
  readonly windowSizeMs: number;
  readonly requestsPerSecond: number;
  readonly errorRate: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly totalRequests: number;
  readonly timestamp: number;
}

export interface SlidingWindowMetricsShape {
  readonly recordCall: (method: string, durationMs: number, error: boolean) => Effect.Effect<void>;
  readonly getMetrics: (method: string, windowSizeMs: number) => Effect.Effect<WindowedMetric>;
  readonly streamMetrics: (windowSizeMs: number) => Stream.Stream<WindowedMetric>;
}

export class SlidingWindowMetrics extends Context.Service<SlidingWindowMetrics, SlidingWindowMetricsShape>()(
  "t3/observability/SlidingWindowMetrics",
) {}

export type CallRecord = {
  readonly method: string;
  readonly durationMs: number;
  readonly error: boolean;
  readonly timestamp: number;
};

const CALLS_BUFFER: CallRecord[] = [];
const MAX_BUFFER_SIZE = 100_000;

export const makeSlidingWindowMetrics = Effect.gen(function* () {
  const recordCall: SlidingWindowMetricsShape["recordCall"] = (method, durationMs, error) => {
    CALLS_BUFFER.push({ method, durationMs, error, timestamp: Date.now() });
    // Prevent unbounded growth
    if (CALLS_BUFFER.length > MAX_BUFFER_SIZE) {
      CALLS_BUFFER.splice(0, CALLS_BUFFER.length - MAX_BUFFER_SIZE);
    }
    return Effect.void;
  };

  const computeWindow = (records: CallRecord[], windowSizeMs: number): WindowedMetric => {
    const now = Date.now();
    const cutoff = now - windowSizeMs;
    const windowRecords = records.filter((r) => r.timestamp >= cutoff);

    if (windowRecords.length === 0) {
      return {
        windowSizeMs,
        requestsPerSecond: 0,
        errorRate: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        totalRequests: 0,
        timestamp: now,
      };
    }

    const durations = windowRecords.map((r) => r.durationMs).sort((a, b) => a - b);
    const errors = windowRecords.filter((r) => r.error).length;
    const windowSeconds = windowSizeMs / 1000;

    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil(arr.length * p) - 1;
      return arr[Math.max(0, Math.min(idx, arr.length - 1))];
    };

    return {
      windowSizeMs,
      requestsPerSecond: windowRecords.length / windowSeconds,
      errorRate: errors / windowRecords.length,
      p50LatencyMs: percentile(durations, 0.5),
      p95LatencyMs: percentile(durations, 0.95),
      p99LatencyMs: percentile(durations, 0.99),
      totalRequests: windowRecords.length,
      timestamp: now,
    };
  };

  const getMetrics: SlidingWindowMetricsShape["getMetrics"] = (method, windowSizeMs) => {
    const methodRecords = CALLS_BUFFER.filter((r) => r.method === method);
    return Effect.succeed(computeWindow(methodRecords, windowSizeMs));
  };

  const streamMetrics: SlidingWindowMetricsShape["streamMetrics"] = (windowSizeMs) =>
    Stream.repeatEffect(
      Effect.gen(function* () {
        const allMetrics = computeWindow(CALLS_BUFFER, windowSizeMs);
        yield* Effect.sleep(Duration.seconds(1));
        return allMetrics;
      }),
    );

  return { recordCall, getMetrics, streamMetrics } satisfies SlidingWindowMetricsShape;
});
