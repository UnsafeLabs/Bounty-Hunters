import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import { formatPrometheusMetrics } from "./PrometheusExporter.ts";
import {
  gitCommandsTotal,
  metricAttributes,
  rpcDurationSeconds,
  rpcRequestDuration,
  rpcRequestsTotal,
} from "./Metrics.ts";

describe("PrometheusExporter", () => {
  it.effect("formats required Prometheus metrics with expected names and labels", () =>
    Effect.gen(function* () {
      yield* Metric.update(
        Metric.withAttributes(
          rpcRequestsTotal,
          metricAttributes({
            method: "test.prometheus.echo",
            outcome: "success",
          }),
        ),
        1,
      );
      yield* Metric.update(
        Metric.withAttributes(rpcRequestDuration, metricAttributes({ method: "test.prometheus" })),
        Duration.millis(125),
      );
      yield* Metric.update(
        Metric.withAttributes(
          rpcDurationSeconds,
          metricAttributes({ method: "test.prometheus.echo" }),
        ),
        0.125,
      );
      yield* Metric.update(
        Metric.withAttributes(
          gitCommandsTotal,
          metricAttributes({
            operation: "test-prometheus-status",
            outcome: "success",
          }),
        ),
        1,
      );

      const body = yield* formatPrometheusMetrics({
        activeSessions: 2,
        memoryUsageBytes: 123_456,
      });

      assert.include(body, "# TYPE active_sessions gauge");
      assert.include(body, "active_sessions 2");
      assert.include(body, "# TYPE memory_usage_bytes gauge");
      assert.include(body, "memory_usage_bytes 123456");
      assert.include(body, "# TYPE rpc_requests_total counter");
      assert.include(body, 'rpc_requests_total{method="test.prometheus.echo",outcome="success"} 1');
      assert.include(body, "# TYPE rpc_duration_seconds histogram");
      assert.include(
        body,
        'rpc_duration_seconds_bucket{method="test.prometheus.echo",le="+Inf"} 1',
      );
      assert.include(body, 'rpc_duration_seconds_sum{method="test.prometheus.echo"} 0.125');
      assert.include(body, "# TYPE git_operations_total counter");
      assert.include(
        body,
        'git_operations_total{operation="test-prometheus-status",outcome="success"} 1',
      );
    }),
  );
});
