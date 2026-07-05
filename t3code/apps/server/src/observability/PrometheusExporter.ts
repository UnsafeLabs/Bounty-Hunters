import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as PrometheusMetrics from "effect/unstable/observability/PrometheusMetrics";

import { activeSessionsGauge, memoryUsageBytesGauge } from "./Metrics.ts";

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

const prometheusMetricAliases: Readonly<Record<string, string>> = {
  t3_git_commands_total: "git_operations_total",
  t3_rpc_requests_total: "rpc_requests_total",
};

export const mapPrometheusMetricName = (name: string): string =>
  prometheusMetricAliases[name] ?? name;

export interface PrometheusRuntimeMetrics {
  readonly activeSessions: number;
  readonly memoryUsageBytes?: number;
}

export const recordPrometheusRuntimeMetrics = (input: PrometheusRuntimeMetrics) =>
  Effect.all(
    [
      Metric.update(activeSessionsGauge, input.activeSessions),
      Metric.update(memoryUsageBytesGauge, input.memoryUsageBytes ?? process.memoryUsage().rss),
    ],
    { discard: true },
  );

export const formatPrometheusMetrics = (input: PrometheusRuntimeMetrics) =>
  Effect.gen(function* () {
    yield* recordPrometheusRuntimeMetrics(input);
    return yield* PrometheusMetrics.format({
      metricNameMapper: mapPrometheusMetricName,
    });
  });
