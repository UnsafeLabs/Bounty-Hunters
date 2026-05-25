import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import {
  MetricsService,
  activeSessionsGauge,
  gitOperationsTotal,
  make,
  memoryUsageBytesGauge,
  rpcDurationHistogram,
  rpcRequestsTotal,
} from "./MetricsService.ts";

describe("MetricsService", () => {
  it.effect("increments rpc_requests_total counter with method label", () =>
    Effect.gen(function* () {
      const service = yield* make();

      yield* service.incrementRpcRequests({ method: "git.status" });
      yield* service.incrementRpcRequests({ method: "git.status" });
      yield* service.incrementRpcRequests({ method: "session.create" });

      const prometheusOutput = yield* service.collectPrometheusMetrics();

      assert.include(prometheusOutput, "# HELP t3_rpc_requests_total_custom");
      assert.include(prometheusOutput, "# TYPE t3_rpc_requests_total_custom counter");
      assert.include(
        prometheusOutput,
        't3_rpc_requests_total_custom{method="git.status"} 2',
      );
      assert.include(
        prometheusOutput,
        't3_rpc_requests_total_custom{method="session.create"} 1',
      );
    }));

  it.effect("increments git_operations_total counter with operation label", () =>
    Effect.gen(function* () {
      const service = yield* make();

      yield* service.incrementGitOperations({ operation: "status" });
      yield* service.incrementGitOperations({ operation: "diff" });
      yield* service.incrementGitOperations({ operation: "status" });

      const prometheusOutput = yield* service.collectPrometheusMetrics();

      assert.include(prometheusOutput, "# HELP t3_git_operations_total");
      assert.include(prometheusOutput, "# TYPE t3_git_operations_total counter");
      assert.include(
        prometheusOutput,
        't3_git_operations_total{operation="status"} 2',
      );
      assert.include(
        prometheusOutput,
        't3_git_operations_total{operation="diff"} 1',
      );
    }));

  it.effect("sets active_sessions gauge", () =>
    Effect.gen(function* () {
      const service = yield* make();

      yield* service.setActiveSessions(5);

      const prometheusOutput = yield* service.collectPrometheusMetrics();

      assert.include(prometheusOutput, "# HELP t3_active_sessions");
      assert.include(prometheusOutput, "# TYPE t3_active_sessions gauge");
      assert.include(prometheusOutput, "t3_active_sessions 5");
    }));

  it.effect("sets memory_usage_bytes gauge", () =>
    Effect.gen(function* () {
      const service = yield* make();

      yield* service.setMemoryUsageBytes(1048576);

      const prometheusOutput = yield* service.collectPrometheusMetrics();

      assert.include(prometheusOutput, "# HELP t3_memory_usage_bytes");
      assert.include(prometheusOutput, "# TYPE t3_memory_usage_bytes gauge");
      assert.include(prometheusOutput, "t3_memory_usage_bytes 1048576");
    }));

  it.effect("records rpc_duration_seconds histogram with method label", () =>
    Effect.gen(function* () {
      const service = yield* make();

      yield* service.recordRpcDuration(0.025, { method: "session.list" });
      yield* service.recordRpcDuration(0.15, { method: "session.create" });

      const prometheusOutput = yield* service.collectPrometheusMetrics();

      assert.include(prometheusOutput, "# HELP t3_rpc_duration_seconds");
      assert.include(
        prometheusOutput,
        "# TYPE t3_rpc_duration_seconds histogram",
      );
      assert.include(
        prometheusOutput,
        't3_rpc_duration_seconds{method="session.list"}',
      );
      assert.include(
        prometheusOutput,
        't3_rpc_duration_seconds{method="session.create"}',
      );
    }));

  it.effect("returns valid Prometheus exposition format", () =>
    Effect.gen(function* () {
      const service = yield* make();

      yield* service.incrementRpcRequests({ method: "health" });
      yield* service.setActiveSessions(1);
      yield* service.setMemoryUsageBytes(2048);

      const prometheusOutput = yield* service.collectPrometheusMetrics();

      const outputLines = prometheusOutput.split("\n").filter((line) => line.trim().length > 0);

      // Verify HELP and TYPE directives exist
      const helpLines = outputLines.filter((line) => line.startsWith("# HELP"));
      const typeLines = outputLines.filter((line) => line.startsWith("# TYPE"));

      assert.isAtLeast(helpLines.length, 5);
      assert.isAtLeast(typeLines.length, 5);

      // Verify each TYPE line has a valid metric type
      for (const typeLine of typeLines) {
        const parts = typeLine.split(" ");
        assert.strictEqual(parts.length, 4);
        assert.include(["counter", "gauge", "histogram"], parts[3]);
      }

      // Verify metric data lines exist
      const dataLines = outputLines.filter(
        (line) => !line.startsWith("#"),
      );
      assert.isAtLeast(dataLines.length, 3);
    }));
});
