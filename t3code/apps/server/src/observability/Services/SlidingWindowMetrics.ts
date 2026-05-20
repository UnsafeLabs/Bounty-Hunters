/**
 * SlidingWindowMetrics - Stream-based sliding window metrics aggregation.
 *
 * Uses Effect.Stream to aggregate raw event timestamps into sliding window
 * request/error rate gauges. Latency percentiles are tracked via histogram
 * with p50/p95/p99 boundaries.
 *
 * @module SlidingWindowMetrics
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Clock from "effect/Clock";

export const requestLatency = Metric.histogram(
  "t3_sliding_request_latency",
  Metric.HistogramBoundaries.exponential(0.001, 2, 16),
  {
    description: "Request latency distribution with p50/p95/p99 boundaries.",
  },
);

export const slidingRequestRate1m = Metric.gauge(
  "t3_sliding_request_rate_1m",
  { description: "Request rate over 1 minute sliding window." },
);

export const slidingRequestRate5m = Metric.gauge(
  "t3_sliding_request_rate_5m",
  { description: "Request rate over 5 minute sliding window." },
);

export const slidingRequestRate15m = Metric.gauge(
  "t3_sliding_request_rate_15m",
  { description: "Request rate over 15 minute sliding window." },
);

export const slidingErrorRate1m = Metric.gauge(
  "t3_sliding_error_rate_1m",
  { description: "Error rate over 1 minute sliding window." },
);

export const slidingErrorRate5m = Metric.gauge(
  "t3_sliding_error_rate_5m",
  { description: "Error rate over 5 minute sliding window." },
);

export const slidingErrorRate15m = Metric.gauge(
  "t3_sliding_error_rate_15m",
  { description: "Error rate over 15 minute sliding window." },
);

export interface SlidingEvent {
  readonly timestamp: number;
  readonly isError: boolean;
}

export interface SlidingWindowMetricsShape {
  readonly recordEvent: (event: SlidingEvent) => Effect.Effect<void>;
  readonly startAggregator: Effect.Effect<
    void,
    never,
    Scope.Scope | Clock.Clock
  >;
}

export class SlidingWindowMetrics extends Context.Service<
  SlidingWindowMetrics,
  SlidingWindowMetricsShape
>()("t3/observability/Services/SlidingWindowMetrics") {}

const WINDOWS = [
  { duration: Duration.minutes(1), rateMetric: slidingRequestRate1m, errorMetric: slidingErrorRate1m },
  { duration: Duration.minutes(5), rateMetric: slidingRequestRate5m, errorMetric: slidingErrorRate5m },
  { duration: Duration.minutes(15), rateMetric: slidingRequestRate15m, errorMetric: slidingErrorRate15m },
] as const;

export const makeSlidingWindowMetrics = Effect.fn(
  "SlidingWindowMetrics.make",
)(function* (): Effect.fn.Return<
  SlidingWindowMetricsShape,
  never,
  Scope.Scope | Clock.Clock
> {
  const queue = yield* Queue.unbounded<SlidingEvent>();
  const scope = yield* Scope.Scope;

  const aggregator = Stream.fromQueue(queue).pipe(
    Stream.aggregateWithin(
      Stream.Sink.foldLeft(
        { events: [] as SlidingEvent[] },
        (acc, event: SlidingEvent) => {
          acc.events.push(event);
          return acc;
        },
      ),
      Stream.Schedule.fixed(Duration.seconds(30)),
    ),
    Stream.map(({ events }) => {
      const now = Date.now();
      for (const { duration, rateMetric, errorMetric } of WINDOWS) {
        const windowStart = now - Duration.toMillis(duration);
        const windowEvents = events.filter((e) => e.timestamp >= windowStart);
        const windowErrors = windowEvents.filter((e) => e.isError);
        const windowSeconds = Duration.toMillis(duration) / 1000;
        const rate = windowEvents.length / windowSeconds;
        const errorRate = windowErrors.length / Math.max(windowSeconds, 1);
        Metric.update(rateMetric, rate);
        Metric.update(errorMetric, errorRate);
      }
    }),
    Stream.runDrain,
  );

  yield* Scope.addFinalizer(
    Effect.fn("SlidingWindowMetrics.finalizer")(function* () {
      yield* Queue.shutdown(queue);
    }),
  );

  const fiber = yield* Effect.forkIn(scope)(aggregator);

  const recordEvent = Effect.fn("SlidingWindowMetrics.recordEvent")(function* (
    event: SlidingEvent,
  ) {
    yield* Queue.offer(queue, event);
  });

  const startAggregator = Effect.suspend(() => Effect.void);

  return {
    recordEvent,
    startAggregator,
  };
});
