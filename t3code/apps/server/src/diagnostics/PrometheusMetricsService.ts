import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface PrometheusMetricsServiceShape {
  readonly getMetricsText: () => Effect.Effect<string, never>;
  readonly incrementCounter: (name: string, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly observeHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
}

export class PrometheusMetricsService extends Context.Service<
  PrometheusMetricsService,
  PrometheusMetricsServiceShape
>()("t3/diagnostics/PrometheusMetricsService") {}
