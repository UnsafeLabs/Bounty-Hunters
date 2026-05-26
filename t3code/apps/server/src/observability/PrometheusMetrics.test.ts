import { describe, expect, it } from "vitest";
import type * as Metric from "effect/Metric";

import { formatPrometheusMetricSnapshots } from "./PrometheusMetrics.ts";

describe("formatPrometheusMetricSnapshots", () => {
  it("formats counters and gauges with escaped labels", () => {
    const text = formatPrometheusMetricSnapshots([
      {
        id: "t3_rpc_requests_total",
        type: "Counter",
        description: "Total RPC requests\nhandled by the server.",
        attributes: {
          method: "server.list",
          outcome: 'success"quoted',
        },
        state: {
          count: 3,
          incremental: true,
        },
      },
      {
        id: "t3_active_sessions",
        type: "Gauge",
        description: "Active sessions.",
        attributes: undefined,
        state: {
          value: 2,
        },
      },
    ] satisfies Metric.Metric.Snapshot[]);

    expect(text).toContain(
      "# HELP t3_rpc_requests_total Total RPC requests handled by the server.",
    );
    expect(text).toContain("# TYPE t3_rpc_requests_total counter");
    expect(text).toContain(
      't3_rpc_requests_total{method="server.list",outcome="success\\"quoted"} 3',
    );
    expect(text).toContain("# TYPE t3_active_sessions gauge");
    expect(text).toContain("t3_active_sessions 2");
  });

  it("formats histogram buckets, sum, and count", () => {
    const text = formatPrometheusMetricSnapshots([
      {
        id: "t3_rpc_request_duration_seconds",
        type: "Histogram",
        description: "RPC request duration.",
        attributes: { route: "rpc" },
        state: {
          buckets: [
            [0.1, 1],
            [0.5, 3],
          ],
          count: 3,
          min: 0.02,
          max: 0.4,
          sum: 0.7,
        },
      },
    ] satisfies Metric.Metric.Snapshot[]);

    expect(text).toContain("# TYPE t3_rpc_request_duration_seconds histogram");
    expect(text).toContain('t3_rpc_request_duration_seconds_bucket{le="0.1",route="rpc"} 1');
    expect(text).toContain('t3_rpc_request_duration_seconds_bucket{le="+Inf",route="rpc"} 3');
    expect(text).toContain('t3_rpc_request_duration_seconds_sum{route="rpc"} 0.7');
    expect(text).toContain('t3_rpc_request_duration_seconds_count{route="rpc"} 3');
  });
});
