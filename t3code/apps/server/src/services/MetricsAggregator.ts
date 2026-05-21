import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

export interface MetricPoint {
  timestamp: number;
  value: number;
  label?: string;
}

export interface WindowStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

export class MetricsAggregatorService extends Effect.Service<MetricsAggregatorService>()(
  "t3/server/services/MetricsAggregator",
  {
    effect: Effect.gen(function* () {
      const points = yield* Ref.make<MetricPoint[]>([]);
      const WINDOW_MS = 300_000;
      const BUCKET_MS = 60_000;

      const queue = yield* Queue.unbounded<MetricPoint>();

      yield* Stream.fromQueue(queue).pipe(
        Stream.run(Sink.forEach((point: MetricPoint) =>
          Ref.update(points, (pts) => {
            const now = Date.now();
            const windowed = [...pts, point].filter((p) => now - p.timestamp < WINDOW_MS);
            return windowed.slice(-10000);
          }),
        )),
        Effect.forkDaemon,
      );

      function record(value: number, label?: string): Effect.Effect<void> {
        return Queue.offer(queue, { timestamp: Date.now(), value, label }).pipe(
          Effect.ignore,
        );
      }

      function computeStats(data: number[]): WindowStats {
        if (data.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };
        const sorted = [...data].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const p = (n: number) => sorted[Math.floor((n / 100) * (sorted.length - 1))];
        return {
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: sum / sorted.length,
          p50: p(50),
          p95: p(95),
          p99: p(99),
          count: sorted.length,
        };
      }

      function getWindowStats(label?: string): Effect.Effect<WindowStats> {
        return Ref.get(points).pipe(
          Effect.map((pts) => {
            const now = Date.now();
            const filtered = label
              ? pts.filter((p) => p.label === label && now - p.timestamp < WINDOW_MS)
              : pts.filter((p) => now - p.timestamp < WINDOW_MS);
            return computeStats(filtered.map((p) => p.value));
          }),
        );
      }

      function streamStats(intervalMs: number = 5000): Stream.Stream<WindowStats> {
        return Stream.fromSchedule(Schedule.fixed(Duration.millis(intervalMs))).pipe(
          Stream.mapEffect(() => getWindowStats()),
        );
      }

      return { record, getWindowStats, streamStats, computeStats } as const;
    }),
  },
) {}
