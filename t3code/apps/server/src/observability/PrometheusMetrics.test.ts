import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import {
  activeSessionsGauge,
  collectPrometheusMetrics,
  gitOperationsTotal,
  memoryUsageBytesGauge,
  rpcDurationSecondsHistogram,
  rpcRequestsTotalCounter,
} from "./PrometheusMetrics.ts";

describe("PrometheusMetrics", () => {
  it.effect("exports the required metric families in Prometheus text format", () =>
    Effect.gen(function* () {
      yield* Metric.update(activeSessionsGauge, 2);
      yield* Metric.update(memoryUsageBytesGauge, 12_345);
      yield* Metric.update(
        Metric.withAttributes(rpcRequestsTotalCounter, [["method", "server.getDiagnostics"]]),
        3,
      );
      yield* Metric.update(Metric.withAttributes(gitOperationsTotal, [["operation", "status"]]), 1);
      yield* Metric.update(
        Metric.withAttributes(rpcDurationSecondsHistogram, [["method", "server.getDiagnostics"]]),
        0.25,
      );

      const text = yield* collectPrometheusMetrics;

      assert.match(text, /^# HELP active_sessions /m);
      assert.match(text, /^# TYPE active_sessions gauge$/m);
      assert.match(text, /^active_sessions 2$/m);
      assert.match(text, /^# TYPE rpc_requests_total counter$/m);
      assert.match(text, /^rpc_requests_total\{method="server.getDiagnostics"\} 3$/m);
      assert.match(text, /^# TYPE rpc_duration_seconds histogram$/m);
      assert.match(
        text,
        /^rpc_duration_seconds_bucket\{method="server.getDiagnostics",le="0\.5"\} 1$/m,
      );
      assert.match(text, /^rpc_duration_seconds_count\{method="server.getDiagnostics"\} 1$/m);
      assert.match(text, /^rpc_duration_seconds_sum\{method="server.getDiagnostics"\} 0\.25$/m);
      assert.match(text, /^git_operations_total\{operation="status"\} 1$/m);
      assert.match(text, /^memory_usage_bytes \d+$/m);
    }),
  );

  it.effect("increments counter metrics from Effect.Metric events", () =>
    Effect.gen(function* () {
      yield* Metric.update(
        Metric.withAttributes(rpcRequestsTotalCounter, [["method", "server.ping"]]),
        1,
      );
      yield* Metric.update(
        Metric.withAttributes(rpcRequestsTotalCounter, [["method", "server.ping"]]),
        1,
      );

      const text = yield* collectPrometheusMetrics;

      assert.match(text, /^rpc_requests_total\{method="server.ping"\} 2$/m);
    }),
  );
});
