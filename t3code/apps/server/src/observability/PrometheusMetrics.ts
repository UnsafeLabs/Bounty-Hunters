import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import { metricAttributes } from "./Metrics.ts";

export const activeSessionsGauge = Metric.gauge("active_sessions", {
  description: "Current connected server sessions.",
});

export const memoryUsageBytesGauge = Metric.gauge("memory_usage_bytes", {
  description: "Current process RSS memory usage in bytes.",
});

const METRIC_NAME_ALIASES: Readonly<Record<string, string>> = {
  t3_rpc_requests_total: "rpc_requests_total",
  t3_rpc_request_duration: "rpc_duration_seconds",
  t3_git_commands_total: "git_operations_total",
};

const METRIC_TYPE_BY_SNAPSHOT_TYPE: Readonly<Record<Metric.Metric.Type, string>> = {
  Counter: "counter",
  Frequency: "counter",
  Gauge: "gauge",
  Histogram: "histogram",
  Summary: "summary",
};

function normalizeMetricName(name: string): string {
  return METRIC_NAME_ALIASES[name] ?? name;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatNumber(value: number | bigint): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(value);
}

function metricUsesSeconds(name: string): boolean {
  return name.endsWith("_seconds");
}

function normalizeMetricValue(name: string, value: number): number {
  return metricUsesSeconds(name) ? value / 1_000 : value;
}

function normalizeAttributes(
  name: string,
  attributes: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!attributes || !metricUsesSeconds(name)) {
    return attributes;
  }
  const { time_unit: _timeUnit, ...rest } = attributes;
  return rest;
}

function formatLabels(
  attributes: Readonly<Record<string, string>> | undefined,
  extra: Readonly<Record<string, string>> = {},
): string {
  const entries = [...Object.entries(attributes ?? {}), ...Object.entries(extra)].filter(
    ([, value]) => value.length > 0,
  );
  if (entries.length === 0) {
    return "";
  }
  return `{${entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",")}}`;
}

function formatHelpAndType(snapshot: Metric.Metric.Snapshot, name: string): ReadonlyArray<string> {
  const description = snapshot.description ? [`# HELP ${name} ${snapshot.description}`] : [];
  return [...description, `# TYPE ${name} ${METRIC_TYPE_BY_SNAPSHOT_TYPE[snapshot.type]}`];
}

function formatCounter(snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Counter" }>) {
  const name = normalizeMetricName(snapshot.id);
  const attributes = normalizeAttributes(name, snapshot.attributes);
  return [`${name}${formatLabels(attributes)} ${formatNumber(snapshot.state.count)}`];
}

function formatFrequency(
  snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Frequency" }>,
) {
  const name = normalizeMetricName(snapshot.id);
  const attributes = normalizeAttributes(name, snapshot.attributes);
  return [
    ...Array.from(snapshot.state.occurrences).map(
      ([value, count]) => `${name}${formatLabels(attributes, { value })} ${count}`,
    ),
  ];
}

function formatGauge(snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Gauge" }>) {
  const name = normalizeMetricName(snapshot.id);
  const attributes = normalizeAttributes(name, snapshot.attributes);
  return [`${name}${formatLabels(attributes)} ${formatNumber(snapshot.state.value)}`];
}

function formatHistogram(
  snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Histogram" }>,
) {
  const name = normalizeMetricName(snapshot.id);
  const attributes = normalizeAttributes(name, snapshot.attributes);
  const buckets = snapshot.state.buckets.map(([boundary, count]) => {
    const le = metricUsesSeconds(name) ? normalizeMetricValue(name, boundary) : boundary;
    return `${name}_bucket${formatLabels(attributes, { le: formatNumber(le) })} ${count}`;
  });
  return [
    ...buckets,
    `${name}_bucket${formatLabels(attributes, { le: "+Inf" })} ${snapshot.state.count}`,
    `${name}_sum${formatLabels(attributes)} ${formatNumber(
      normalizeMetricValue(name, snapshot.state.sum),
    )}`,
    `${name}_count${formatLabels(attributes)} ${snapshot.state.count}`,
  ];
}

function formatSummary(snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Summary" }>) {
  const name = normalizeMetricName(snapshot.id);
  const attributes = normalizeAttributes(name, snapshot.attributes);
  return [
    `${name}_count${formatLabels(attributes)} ${snapshot.state.count}`,
    `${name}_sum${formatLabels(attributes)} ${formatNumber(snapshot.state.sum)}`,
  ];
}

export function formatPrometheusMetrics(snapshots: ReadonlyArray<Metric.Metric.Snapshot>): string {
  const emittedHeaders = new Set<string>();
  const lines = snapshots.flatMap((snapshot) => {
    const name = normalizeMetricName(snapshot.id);
    const headers = emittedHeaders.has(name) ? [] : formatHelpAndType(snapshot, name);
    emittedHeaders.add(name);

    switch (snapshot.type) {
      case "Counter":
        return [...headers, ...formatCounter(snapshot)];
      case "Frequency":
        return [...headers, ...formatFrequency(snapshot)];
      case "Gauge":
        return [...headers, ...formatGauge(snapshot)];
      case "Histogram":
        return [...headers, ...formatHistogram(snapshot)];
      case "Summary":
        return [...headers, ...formatSummary(snapshot)];
    }
  });

  return `${lines.join("\n")}\n`;
}

export const collectPrometheusMetrics = (input: { readonly activeSessions: number }) =>
  Effect.gen(function* () {
    yield* Metric.update(activeSessionsGauge, input.activeSessions);
    yield* Metric.update(
      Metric.withAttributes(memoryUsageBytesGauge, metricAttributes({ source: "process_rss" })),
      process.memoryUsage().rss,
    );
    const snapshots = yield* Metric.snapshot;
    return formatPrometheusMetrics(snapshots);
  });

export const collectPrometheusMetricsWithDefaults = collectPrometheusMetrics({
  activeSessions: 0,
});
