import { Effect, Stream, Ref, Schedule, Schema } from "effect";

export const MetricEvent = Schema.Struct({
  name: Schema.String,
  value: Schema.Number,
  timestamp: Schema.Number,
  tags: Schema.Record({ key: Schema.String, value: Schema.String }),
});

export type MetricEventType = Schema.Schema.Type<typeof MetricEvent>;

export const AggregationResult = Schema.Struct({
  metricName: Schema.String,
  windowStart: Schema.Number,
  windowEnd: Schema.Number,
  count: Schema.Number,
  sum: Schema.Number,
  min: Schema.Number,
  max: Schema.Number,
  avg: Schema.Number,
  p50: Schema.Number,
  p95: Schema.Number,
  p99: Schema.Number,
});

export type AggregationResultType = Schema.Schema.Type<typeof AggregationResult>;

export interface WindowConfig {
  windowSizeMs: number;     // Total window duration
  slideIntervalMs: number;  // How often to emit aggregations
  maxEventsPerWindow: number;
}

export const SlidingWindowAggregator = Effect.gen(function* (_) {
  const events = yield* _(Ref.make<MetricEventType[]>([]));
  const config: WindowConfig = {
    windowSizeMs: 60_000,     // 1 minute window
    slideIntervalMs: 10_000,  // Every 10 seconds
    maxEventsPerWindow: 100_000,
  };

  const addEvent = (event: MetricEventType) =>
    Effect.gen(function* (_) {
      yield* _(Ref.update(events, (evts) => {
        const now = Date.now();
        const cutoff = now - config.windowSizeMs;
        const filtered = evts.filter((e) => e.timestamp >= cutoff);
        const newEvents = [...filtered, event];

        // Enforce max events
        if (newEvents.length > config.maxEventsPerWindow) {
          return newEvents.slice(-config.maxEventsPerWindow);
        }
        return newEvents;
      }));
    });

  const aggregate = (metricName: string) =>
    Effect.gen(function* (_) {
      const now = Date.now();
      const windowStart = now - config.windowSizeMs;
      const allEvents = yield* _(Ref.get(events));

      const windowEvents = allEvents
        .filter((e) => e.name === metricName && e.timestamp >= windowStart)
        .sort((a, b) => a.value - b.value);

      if (windowEvents.length === 0) {
        return AggregationResult.make({
          metricName,
          windowStart,
          windowEnd: now,
          count: 0,
          sum: 0,
          min: 0,
          max: 0,
          avg: 0,
          p50: 0,
          p95: 0,
          p99: 0,
        });
      }

      const values = windowEvents.map((e) => e.value);
      const sum = values.reduce((a, b) => a + b, 0);

      const percentile = (p: number) => {
        const idx = Math.ceil((p / 100) * values.length) - 1;
        return values[Math.max(0, idx)];
      };

      return AggregationResult.make({
        metricName,
        windowStart,
        windowEnd: now,
        count: values.length,
        sum,
        min: values[0],
        max: values[values.length - 1],
        avg: sum / values.length,
        p50: percentile(50),
        p95: percentile(95),
        p99: percentile(99),
      });
    });

  // Stream that emits aggregations on a sliding schedule
  const aggregationStream = (metricName: string) =>
    Stream.repeatEffect(aggregate(metricName)).pipe(
      Stream.schedule(Schedule.fixed(Schedule.Duration.millis(config.slideIntervalMs)))
    );

  // Stream from incoming events
  const eventStream = Stream.fromRef(events).pipe(
    Stream.map((evts) => evts[evts.length - 1]),
    Stream.filter((evt): evt is MetricEventType => evt !== undefined)
  );

  return { addEvent, aggregate, aggregationStream, eventStream };
});
