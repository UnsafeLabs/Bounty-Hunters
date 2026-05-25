import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as MetricKey from "effect/MetricKey";
import * as MetricLabel from "effect/MetricLabel";
import * as MetricScope from "effect/MetricScope";

const metricsScope: MetricScope.MetricScope = MetricScope.global;

export const activeSessionsGauge = Metric.gauge("t3_active_sessions", {
  description: "Number of active provider sessions.",
  metricsScope,
});

export const rpcRequestsTotal = Metric.counter("t3_rpc_requests_total_custom", {
  description: "Total RPC requests handled by the server.",
  metricsScope,
});

export const rpcDurationHistogram = Metric.histogram(
  "t3_rpc_duration_seconds",
  Metric.exponentialBuckets(0.001, 2, 15),
  {
    description: "RPC request handling duration in seconds.",
    metricsScope,
  },
);

export const gitOperationsTotal = Metric.counter("t3_git_operations_total", {
  description: "Total git operations executed by the server.",
  metricsScope,
});

export const memoryUsageBytesGauge = Metric.gauge("t3_memory_usage_bytes", {
  description: "Current memory usage of the server process in bytes.",
  metricsScope,
});

export interface MetricsServiceShape {
  readonly incrementRpcRequests: (
    attributes: Record<string, string>,
  ) => Effect.Effect<void>;

  readonly recordRpcDuration: (
    durationSeconds: number,
    attributes: Record<string, string>,
  ) => Effect.Effect<void>;

  readonly incrementGitOperations: (
    attributes: Record<string, string>,
  ) => Effect.Effect<void>;

  readonly setActiveSessions: (count: number) => Effect.Effect<void>;

  readonly setMemoryUsageBytes: (bytes: number) => Effect.Effect<void>;

  readonly collectPrometheusMetrics: () => Effect.Effect<string>;
}

export class MetricsService extends Context.Service<
  MetricsService,
  MetricsServiceShape
>()("t3/metrics/MetricsService") {}

const collectSnapshots = Effect.gen(function* () {
  const keys: ReadonlyArray<MetricKey.MetricKey<number, unknown>> = [
    MetricKey.fromMetric(activeSessionsGauge),
    MetricKey.fromMetric(rpcRequestsTotal),
    MetricKey.fromMetric(rpcDurationHistogram),
    MetricKey.fromMetric(gitOperationsTotal),
    MetricKey.fromMetric(memoryUsageBytesGauge),
  ];

  const snapshotPromises = keys.map((key) => Metric.value(key));
  const snapshots = yield* Effect.all(snapshotPromises, {
    concurrency: "unbounded",
  });

  const lines: string[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const snapshot = snapshots[i]!;

    const baseName = extractBaseName(key.name);

    lines.push(`# HELP ${baseName} ${key.description ?? ""}`);
    lines.push(`# TYPE ${baseName} ${metricTypeString(snapshot)}`);

    for (const entry of snapshot.entries) {
      const attributes = entry.attributes;
      const labelStr = formatLabels(attributes);
      const value = formatValue(entry);

      if (labelStr) {
        lines.push(`${baseName}{${labelStr}} ${value}`);
      } else {
        lines.push(`${baseName} ${value}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
});

function extractBaseName(name: string): string {
  return name;
}

function formatLabels(
  attributes: ReadonlyArray<MetricLabel.MetricLabel>,
): string {
  if (!attributes || attributes.length === 0) {
    return "";
  }
  return attributes
    .map((label) => `${label.key}="${escapeLabelValue(label.value)}"`)
    .join(",");
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function formatValue(entry: Metric.MetricState.Entry<number>): number | string {
  const stateType = entry.metricState["_tag"];
  if (stateType === "Histogram") {
    // For histogram, we output sum and count
    const histState = entry.metricState as { sum: number; count: number };
    return histState.sum ?? 0;
  }
  if (stateType === "Counter") {
    const counterState = entry.metricState as { count: number };
    return counterState.count ?? 0;
  }
  if (stateType === "Gauge") {
    const gaugeState = entry.metricState as { value: number };
    return gaugeState.value ?? 0;
  }
  return 0;
}

function metricTypeString(
  snapshot: Metric.MetricSnapshot.Snapshot<number>,
): string {
  const stateType = snapshot.state["_tag"];
  switch (stateType) {
    case "Histogram":
      return "histogram";
    case "Counter":
      return "counter";
    case "Gauge":
      return "gauge";
    default:
      return "untyped";
  }
}

export const make = Effect.fn("makeMetricsService")(function* () {
  const incrementRpcRequests: MetricsServiceShape["incrementRpcRequests"] = (
    attributes,
  ) =>
    Effect.gen(function* () {
      const labels = Object.entries(attributes).map(([key, value]) =>
        MetricLabel.make(key, value),
      );
      const rpcRequestsTotalWithLabels = Metric.annotateLabels(
        rpcRequestsTotal,
        labels,
      );
      yield* Metric.update(rpcRequestsTotalWithLabels, 1);
    });

  const recordRpcDuration: MetricsServiceShape["recordRpcDuration"] = (
    durationSeconds,
    attributes,
  ) =>
    Effect.gen(function* () {
      const labels = Object.entries(attributes).map(([key, value]) =>
        MetricLabel.make(key, value),
      );
      const rpcDurationWithLabels = Metric.annotateLabels(
        rpcDurationHistogram,
        labels,
      );
      yield* Metric.update(rpcDurationWithLabels, durationSeconds);
    });

  const incrementGitOperations: MetricsServiceShape["incrementGitOperations"] = (
    attributes,
  ) =>
    Effect.gen(function* () {
      const labels = Object.entries(attributes).map(([key, value]) =>
        MetricLabel.make(key, value),
      );
      const gitOpsWithLabels = Metric.annotateLabels(
        gitOperationsTotal,
        labels,
      );
      yield* Metric.update(gitOpsWithLabels, 1);
    });

  const setActiveSessions: MetricsServiceShape["setActiveSessions"] = (count) =>
    Metric.set(activeSessionsGauge, count);

  const setMemoryUsageBytes: MetricsServiceShape["setMemoryUsageBytes"] = (
    bytes,
  ) => Metric.set(memoryUsageBytesGauge, bytes);

  const collectPrometheusMetrics: MetricsServiceShape["collectPrometheusMetrics"] =
    () => collectSnapshots;

  return MetricsService.of({
    incrementRpcRequests,
    recordRpcDuration,
    incrementGitOperations,
    setActiveSessions,
    setMemoryUsageBytes,
    collectPrometheusMetrics,
  });
});

export const layer = Layer.effect(MetricsService, make());
