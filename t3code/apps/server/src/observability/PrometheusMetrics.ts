import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export const prometheusContentType = PROMETHEUS_CONTENT_TYPE;

export const activeSessionsGauge = Metric.gauge("active_sessions", {
  description: "Current number of active provider sessions.",
});

export const rpcRequestsTotalCounter = Metric.counter("rpc_requests_total", {
  description: "Total RPC requests handled by the server.",
});

export const rpcDurationSecondsHistogram = Metric.histogram("rpc_duration_seconds", {
  description: "RPC request duration in seconds.",
  boundaries: Metric.boundariesFromIterable([
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
  ]),
});

export const gitOperationsTotal = Metric.counter("git_operations_total", {
  description: "Total git operations executed by the server runtime.",
});

export const memoryUsageBytesGauge = Metric.gauge("memory_usage_bytes", {
  description: "Resident memory used by the server process in bytes.",
});

const REQUIRED_FAMILIES = [
  ["active_sessions", "gauge", "Current number of active provider sessions."],
  ["rpc_requests_total", "counter", "Total RPC requests handled by the server."],
  ["rpc_duration_seconds", "histogram", "RPC request duration in seconds."],
  ["git_operations_total", "counter", "Total git operations executed by the server runtime."],
  ["memory_usage_bytes", "gauge", "Resident memory used by the server process in bytes."],
] as const;

const METRIC_ALIASES: Readonly<Record<string, string>> = {
  t3_rpc_requests_total: "rpc_requests_total",
  t3_rpc_request_duration: "rpc_duration_seconds",
  t3_git_commands_total: "git_operations_total",
};

const escapeHelp = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");

const escapeLabelValue = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

const formatNumber = (value: number | bigint): string => {
  if (typeof value === "bigint") return value.toString();
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "+Inf";
  if (value === -Infinity) return "-Inf";
  return String(value);
};

const formatLabelEntries = (entries: ReadonlyArray<readonly [string, string]>): string => {
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",")}}`;
};

const sortedLabelEntries = (attributes: Readonly<Record<string, string>> | undefined) =>
  Object.entries(attributes ?? {}).sort(([left], [right]) => left.localeCompare(right));

const formatLabels = (attributes: Readonly<Record<string, string>> | undefined): string =>
  formatLabelEntries(sortedLabelEntries(attributes));

const formatLabelsWithExtra = (
  attributes: Readonly<Record<string, string>> | undefined,
  extra: Readonly<Record<string, string>>,
): string => formatLabelEntries([...sortedLabelEntries(attributes), ...sortedLabelEntries(extra)]);

const normalizeMetricName = (snapshot: Metric.Metric.Snapshot): string =>
  METRIC_ALIASES[snapshot.id] ?? snapshot.id;

const shouldExportSnapshot = (snapshot: Metric.Metric.Snapshot): boolean =>
  REQUIRED_FAMILIES.some(([name]) => name === normalizeMetricName(snapshot));

const emitCounter = (
  name: string,
  snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Counter" }>,
) => `${name}${formatLabels(snapshot.attributes)} ${formatNumber(snapshot.state.count)}`;

const emitGauge = (
  name: string,
  snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Gauge" }>,
) => `${name}${formatLabels(snapshot.attributes)} ${formatNumber(snapshot.state.value)}`;

const emitHistogram = (
  name: string,
  snapshot: Extract<Metric.Metric.Snapshot, { readonly type: "Histogram" }>,
): ReadonlyArray<string> => {
  const bucketLines = snapshot.state.buckets.map(
    ([upperBound, count]) =>
      `${name}_bucket${formatLabelsWithExtra(snapshot.attributes, {
        le: upperBound === Infinity ? "+Inf" : formatNumber(upperBound),
      })} ${formatNumber(count)}`,
  );
  return [
    ...bucketLines,
    `${name}_count${formatLabels(snapshot.attributes)} ${formatNumber(snapshot.state.count)}`,
    `${name}_sum${formatLabels(snapshot.attributes)} ${formatNumber(snapshot.state.sum)}`,
  ];
};

const emitSnapshot = (snapshot: Metric.Metric.Snapshot): ReadonlyArray<string> => {
  const name = normalizeMetricName(snapshot);
  switch (snapshot.type) {
    case "Counter":
      return [emitCounter(name, snapshot)];
    case "Gauge":
      return [emitGauge(name, snapshot)];
    case "Histogram":
      return emitHistogram(name, snapshot);
    default:
      return [];
  }
};

export const renderPrometheusMetrics = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
): string => {
  const lines: Array<string> = [];
  const snapshotsByFamily = new Map<string, Array<Metric.Metric.Snapshot>>();
  for (const snapshot of snapshots) {
    if (!shouldExportSnapshot(snapshot)) continue;
    const name = normalizeMetricName(snapshot);
    const existing = snapshotsByFamily.get(name) ?? [];
    existing.push(snapshot);
    snapshotsByFamily.set(name, existing);
  }

  for (const [name, type, description] of REQUIRED_FAMILIES) {
    lines.push(`# HELP ${name} ${escapeHelp(description)}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const snapshot of snapshotsByFamily.get(name) ?? []) {
      lines.push(...emitSnapshot(snapshot));
    }
  }

  return `${lines.join("\n")}\n`;
};

export const collectPrometheusMetrics = Effect.gen(function* () {
  yield* Metric.update(memoryUsageBytesGauge, process.memoryUsage().rss);
  const snapshots = yield* Metric.snapshot;
  return renderPrometheusMetrics(snapshots);
});

export const isMetricsAuthDisabled = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const value = env.METRICS_AUTH_DISABLED;
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !["0", "false", "no", "off"].includes(normalized);
};
