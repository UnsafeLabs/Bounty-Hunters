import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
export interface WindowStats { readonly min: number; readonly max: number; readonly avg: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly count: number; }
export interface MetricsAggregatorShape {
  readonly record: (value: number) => Effect.Effect<void>;
  readonly getWindowStats: () => Effect.Effect<WindowStats>;
}
export class MetricsAggregator extends Context.Service<MetricsAggregator, MetricsAggregatorShape>()("t3/server/services/MetricsAggregator") {
  static readonly layer = Layer.effect(
    MetricsAggregator,
    Effect.gen(function* () {
      const points = yield* Ref.make<readonly number[]>([]);
      const record = (value: number): Effect.Effect<void> =>
        Ref.update(points, (p) => [...p, value].slice(-10000)).pipe(Effect.ignore);
      const computeStats = (data: readonly number[]): WindowStats => {
        if (data.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };
        const sorted = [...data].sort((a, b) => a - b);
        const p = (n: number) => sorted[Math.floor((n / 100) * (sorted.length - 1))]!;
        return { min: sorted[0]!, max: sorted[sorted.length - 1]!, avg: sorted.reduce((a, b) => a + b, 0) / sorted.length, p50: p(50), p95: p(95), p99: p(99), count: sorted.length };
      };
      const getWindowStats = (): Effect.Effect<WindowStats> => Ref.get(points).pipe(Effect.map((p) => computeStats(p)));
      return { record, getWindowStats };
    }),
  );
}
