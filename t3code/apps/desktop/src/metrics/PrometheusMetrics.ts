import { Effect, Metric, Schema, Layer } from "effect";

/**
 * Fix: Add Prometheus metrics endpoint with Effect.Metric integration (#833)
 */

export const requestCounter = Metric.counter("http_requests_total", {
  description: "Total HTTP requests",
  incrementBy: 1,
});

export const requestDuration = Metric.timer("http_request_duration_seconds", {
  description: "HTTP request duration",
});

export const activeConnections = Metric.gauge("active_connections", {
  description: "Currently active connections",
});

export const errorCounter = Metric.counter("http_errors_total", {
  description: "Total HTTP errors",
  incrementBy: 1,
});

export const PrometheusEndpoint = Effect.gen(function* (_) {
  const collectMetrics = Effect.gen(function* (_) {
    const snapshot = yield* _(
      Effect.all([
        Metric.snapshot(requestCounter),
        Metric.snapshot(requestDuration),
      ])
    );
    
    const formatPrometheus = (metrics: any[]): string => {
      return metrics.map((m: any) => {
        const key = m.key || "unknown";
        const value = m.value || 0;
        return `${key} ${value}`;
      }).join("\n");
    };

    return formatPrometheus(snapshot);
  });

  return { collectMetrics };
});
