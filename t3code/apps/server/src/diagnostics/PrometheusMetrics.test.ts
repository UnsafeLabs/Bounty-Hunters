import { describe, expect, it } from "vitest";

import {
  createPrometheusMetricsRegistry,
  isMetricsAuthDisabled,
  renderPrometheusMetrics,
} from "./PrometheusMetrics.ts";

describe("Prometheus metrics", () => {
  it("renders the expected Prometheus exposition format", () => {
    const registry = createPrometheusMetricsRegistry();
    registry.recordRpcRequest({ method: "server.getConfig", durationSeconds: 0.12 });
    registry.recordGitOperation("status");

    const output = renderPrometheusMetrics({
      activeSessions: 2,
      memoryUsageBytes: 4096,
      snapshot: registry.snapshot(),
    });

    expect(output).toContain("# HELP active_sessions Current connected client sessions.");
    expect(output).toContain("# TYPE active_sessions gauge");
    expect(output).toContain("active_sessions 2");
    expect(output).toContain("# TYPE rpc_requests_total counter");
    expect(output).toContain('rpc_requests_total{method="server.getConfig"} 1');
    expect(output).toContain("# TYPE rpc_duration_seconds histogram");
    expect(output).toContain('rpc_duration_seconds_bucket{le="+Inf",method="server.getConfig"} 1');
    expect(output).toContain('rpc_duration_seconds_count{method="server.getConfig"} 1');
    expect(output).toContain('git_operations_total{operation="status"} 1');
    expect(output).toContain("memory_usage_bytes 4096");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("increments RPC and Git counters across repeated observations", () => {
    const registry = createPrometheusMetricsRegistry();
    registry.recordRpcRequest({ method: "thread.dispatch", durationSeconds: 0.1 });
    registry.recordRpcRequest({ method: "thread.dispatch", durationSeconds: 0.2 });
    registry.recordGitOperation("commit");
    registry.recordGitOperation("commit");

    const output = renderPrometheusMetrics({
      activeSessions: 0,
      memoryUsageBytes: 1,
      snapshot: registry.snapshot(),
    });

    expect(output).toContain('rpc_requests_total{method="thread.dispatch"} 2');
    expect(output).toContain('rpc_duration_seconds_count{method="thread.dispatch"} 2');
    expect(output).toContain('rpc_duration_seconds_sum{method="thread.dispatch"} 0.3');
    expect(output).toContain('git_operations_total{operation="commit"} 2');
  });

  it("escapes label values and reads the metrics auth toggle", () => {
    const registry = createPrometheusMetricsRegistry();
    registry.recordRpcRequest({ method: 'server."quoted"\\method\nline', durationSeconds: 0 });

    const output = renderPrometheusMetrics({
      activeSessions: 0,
      memoryUsageBytes: 1,
      snapshot: registry.snapshot(),
    });

    expect(output).toContain('method="server.\\"quoted\\"\\\\method\\nline"');
    expect(isMetricsAuthDisabled({ METRICS_AUTH_DISABLED: "true" })).toBe(true);
    expect(isMetricsAuthDisabled({ METRICS_AUTH_DISABLED: "false" })).toBe(false);
    expect(isMetricsAuthDisabled({})).toBe(false);
  });
});
