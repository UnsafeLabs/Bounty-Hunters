import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as MetricState from "effect/MetricState";

import { compactMetricAttributes } from "../../Attributes.ts";

/**
 * Prometheus metrics service that exposes Effect.Metric primitives
 * in Prometheus exposition format.
 */

/** Gauge: number of active WebSocket/RPC sessions. */
export const activeSessionsGauge = Metric.gauge("t3_active_sessions", {
  description: "Number of active WebSocket/RPC sessions.",
});

/** Counter: total RPC requests, tagged by method and status. */
export const rpcRequestsTotal = Metric.counter("t3_rpc_requests_total", {
  description: "Total RPC requests handled by the WebSocket RPC server.",
});

/** Histogram: RPC request duration in seconds, tagged by method and status. */
export const rpcRequestDurationSeconds = Metric.histogram("t3_rpc_request_duration_seconds", {
  description: "RPC request handling duration in seconds.",
  boundaries: [
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
  ],
});

export interface PrometheusMetrics {
  readonly recordActiveSessions: (count: number) => Effect.Effect<void>;
  readonly recordRpcRequest: (
    method: string,
    status: string,
    durationSeconds: number,
  ) => Effect.Effect<void>;
  readonly getMetricsText: () => Effect.Effect<string>;
}

const formatSnapshot = (
  id: string,
  description: string,
  state: MetricState.MetricState.Types,
): string => {
  const lines: string[] = [];
  lines.push(`# HELP ${id} ${description}`);
  lines.push(`# TYPE ${id} ${state.type}`);

  switch (state.type) {
    case "Counter":
    case "Gauge": {
      for (const [attrs, stateVal] of Object.entries(state.values ?? {})) {
        const parsed = attrs ? JSON.parse(attrs) : {};
        const labelStr =
          Object.keys(parsed).length > 0
            ? "{" +
              Object.entries(parsed)
                .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
                .join(",") +
              "}"
            : "";
        lines.push(`${id}${labelStr} ${stateVal}`);
      }
      break;
    }
    case "Histogram": {
      for (const [attrs, stateVal] of Object.entries(state.values ?? {})) {
        const parsed = attrs ? JSON.parse(attrs) : {};
        const labelStr =
          Object.keys(parsed).length > 0
            ? "{" +
              Object.entries(parsed)
                .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
                .join(",") +
              "}"
            : "";
        lines.push(`${id}${labelStr}_count ${stateVal.count}`);
        lines.push(`${id}${labelStr}_sum ${stateVal.sum}`);
        for (const [boundary, bucketCount] of Object.entries(stateVal.buckets ?? {})) {
          const le = boundary === "+Inf" ? "+Inf" : boundary;
          lines.push(`${id}${labelStr}_bucket{le="${le}"} ${bucketCount}`);
        }
      }
      break;
    }
    case "Frequency": {
      for (const [attrs, stateVal] of Object.entries(state.values ?? {})) {
        const parsed = attrs ? JSON.parse(attrs) : {};
        const labelStr =
          Object.keys(parsed).length > 0
            ? "{" +
              Object.entries(parsed)
                .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
                .join(",") +
              "}"
            : "";
        for (const [bucket, bucketCount] of Object.entries(stateVal.counts ?? {})) {
          lines.push(`${id}${labelStr} ${bucketCount} ${JSON.stringify(bucket)}`);
        }
      }
      break;
    }
    case "Summary": {
      break;
    }
  }

  return lines.join("\n");
};

const makePrometheusMetrics = (): Effect.Effect<PrometheusMetrics> =>
  Effect.gen(function* () {
    const recordActiveSessions = (count: number): Effect.Effect<void> =>
      Metric.set(activeSessionsGauge, count);

    const recordRpcRequest = (
      method: string,
      status: string,
      durationSeconds: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Metric.update(
          Metric.withAttributes(
            rpcRequestsTotal,
            compactMetricAttributes({ method, status }),
          ),
          1,
        );
        yield* Metric.update(
          Metric.withAttributes(
            rpcRequestDurationSeconds,
            compactMetricAttributes({ method, status }),
          ),
          durationSeconds,
        );
      });

    const getMetricsText = (): Effect.Effect<string> =>
      Effect.gen(function* () {
        const snapshots = yield* Metric.snapshot;
        const lines: string[] = [];

        for (const snapshot of snapshots) {
          const formatted = formatSnapshot(
            snapshot.id,
            snapshot.description ?? "",
            snapshot.state,
          );
          if (formatted) {
            lines.push(formatted);
          }
        }

        return lines.join("\n");
      });

    return {
      recordActiveSessions,
      recordRpcRequest,
      getMetricsText,
    } as PrometheusMetrics;
  });

export const PrometheusMetrics = Object.assign(makePrometheusMetrics, {
  /**
   * Effect that runs the background metric collection.
   * Currently metrics are pulled on-demand from Metric.snapshot.
   */
  run: (_: PrometheusMetrics): Effect.Effect<never> => Effect.never,
});
