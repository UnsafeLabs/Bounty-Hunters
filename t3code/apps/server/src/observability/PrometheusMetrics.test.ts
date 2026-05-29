import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import {
  gitCommandsTotal,
  metricAttributes,
  rpcRequestDuration,
  rpcRequestsTotal,
} from "./Metrics.ts";
import { collectPrometheusMetrics } from "./PrometheusMetrics.ts";

describe("Prometheus metrics exposition", () => {
  it.effect("formats required gauges, counters, and histograms", () =>
    Effect.gen(function* () {
      const method = "prometheus.test";
      const operation = "prometheus-status";

      yield* Metric.update(
        Metric.withAttributes(rpcRequestsTotal, metricAttributes({ method })),
        1,
      );
      yield* Metric.update(
        Metric.withAttributes(rpcRequestDuration, metricAttributes({ method })),
        Duration.millis(250),
      );
      yield* Metric.update(
        Metric.withAttributes(gitCommandsTotal, metricAttributes({ operation })),
        2,
      );

      const text = yield* collectPrometheusMetrics({ activeSessions: 2 });

      assert.include(text, "# TYPE active_sessions gauge");
      assert.include(text, "active_sessions 2");
      assert.match(text, /memory_usage_bytes\{source="process_rss"\} \d+/);
      assert.include(text, `rpc_requests_total{method="${method}"} 1`);
      assert.include(text, `rpc_duration_seconds_bucket{le="+Inf",method="${method}"} 1`);
      assert.include(text, `rpc_duration_seconds_sum{method="${method}"} 0.25`);
      assert.include(text, `rpc_duration_seconds_count{method="${method}"} 1`);
      assert.include(text, `git_operations_total{operation="${operation}"} 2`);
    }),
  );
});
