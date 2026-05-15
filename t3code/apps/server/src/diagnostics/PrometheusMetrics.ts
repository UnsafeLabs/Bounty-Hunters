import * as Effect from "effect/Effect";

export const PROMETHEUS_METRICS_PATH = "/metrics";
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

const DEFAULT_RPC_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

interface CounterSnapshot {
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

interface HistogramSnapshot {
  readonly labels: Readonly<Record<string, string>>;
  readonly buckets: ReadonlyArray<{
    readonly le: number;
    readonly count: number;
  }>;
  readonly count: number;
  readonly sum: number;
}

export interface PrometheusMetricsSnapshot {
  readonly rpcRequests: ReadonlyArray<CounterSnapshot>;
  readonly rpcDurations: ReadonlyArray<HistogramSnapshot>;
  readonly gitOperations: ReadonlyArray<CounterSnapshot>;
}

interface RpcMetricState {
  count: number;
  sum: number;
  readonly bucketCounts: Map<number, number>;
}

export class PrometheusMetricsRegistry {
  private readonly rpcMetrics = new Map<string, RpcMetricState>();
  private readonly gitOperations = new Map<string, number>();

  recordRpcRequest(input: { readonly method: string; readonly durationSeconds: number }): void {
    const method = input.method.trim() || "unknown";
    const durationSeconds = normalizeMetricValue(input.durationSeconds);
    const state = this.rpcMetrics.get(method) ?? {
      count: 0,
      sum: 0,
      bucketCounts: new Map(DEFAULT_RPC_DURATION_BUCKETS.map((bucket) => [bucket, 0])),
    };

    state.count += 1;
    state.sum += durationSeconds;
    for (const bucket of DEFAULT_RPC_DURATION_BUCKETS) {
      if (durationSeconds <= bucket) {
        state.bucketCounts.set(bucket, (state.bucketCounts.get(bucket) ?? 0) + 1);
      }
    }
    this.rpcMetrics.set(method, state);
  }

  recordGitOperation(operation: string): void {
    const normalizedOperation = operation.trim() || "unknown";
    this.gitOperations.set(
      normalizedOperation,
      (this.gitOperations.get(normalizedOperation) ?? 0) + 1,
    );
  }

  snapshot(): PrometheusMetricsSnapshot {
    return {
      rpcRequests: [...this.rpcMetrics.entries()]
        .map(([method, state]) => ({
          labels: { method },
          value: state.count,
        }))
        .toSorted(sortCounterSnapshots),
      rpcDurations: [...this.rpcMetrics.entries()]
        .map(([method, state]) => ({
          labels: { method },
          buckets: DEFAULT_RPC_DURATION_BUCKETS.map((bucket) => ({
            le: bucket,
            count: state.bucketCounts.get(bucket) ?? 0,
          })),
          count: state.count,
          sum: state.sum,
        }))
        .toSorted(sortHistogramSnapshots),
      gitOperations: [...this.gitOperations.entries()]
        .map(([operation, value]) => ({
          labels: { operation },
          value,
        }))
        .toSorted(sortCounterSnapshots),
    };
  }

  reset(): void {
    this.rpcMetrics.clear();
    this.gitOperations.clear();
  }
}

export const prometheusMetricsRegistry = new PrometheusMetricsRegistry();

export function createPrometheusMetricsRegistry(): PrometheusMetricsRegistry {
  return new PrometheusMetricsRegistry();
}

export function isMetricsAuthDisabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.METRICS_AUTH_DISABLED?.trim().toLowerCase() === "true";
}

export function recordPrometheusRpcRequest(input: {
  readonly method: string;
  readonly elapsedNanos: bigint;
}): Effect.Effect<void> {
  return Effect.sync(() => {
    prometheusMetricsRegistry.recordRpcRequest({
      method: input.method,
      durationSeconds: Number(input.elapsedNanos) / 1_000_000_000,
    });
  });
}

export function recordPrometheusGitOperation(operation: string): Effect.Effect<void> {
  return Effect.sync(() => {
    prometheusMetricsRegistry.recordGitOperation(operation);
  });
}

export function renderPrometheusMetrics(input: {
  readonly activeSessions: number;
  readonly memoryUsageBytes: number;
  readonly snapshot?: PrometheusMetricsSnapshot;
}): string {
  const snapshot = input.snapshot ?? prometheusMetricsRegistry.snapshot();
  const lines: string[] = [];

  appendHelpAndType(lines, "active_sessions", "Current connected client sessions.", "gauge");
  lines.push(`active_sessions ${formatMetricNumber(input.activeSessions)}`);
  lines.push("");

  appendHelpAndType(
    lines,
    "rpc_requests_total",
    "Total WebSocket RPC requests handled by method.",
    "counter",
  );
  for (const counter of snapshot.rpcRequests) {
    lines.push(
      `rpc_requests_total${formatLabels(counter.labels)} ${formatMetricNumber(counter.value)}`,
    );
  }
  lines.push("");

  appendHelpAndType(
    lines,
    "rpc_duration_seconds",
    "WebSocket RPC request duration in seconds.",
    "histogram",
  );
  for (const histogram of snapshot.rpcDurations) {
    for (const bucket of histogram.buckets) {
      lines.push(
        `rpc_duration_seconds_bucket${formatLabels({
          ...histogram.labels,
          le: formatBucketBoundary(bucket.le),
        })} ${formatMetricNumber(bucket.count)}`,
      );
    }
    lines.push(
      `rpc_duration_seconds_bucket${formatLabels({
        ...histogram.labels,
        le: "+Inf",
      })} ${formatMetricNumber(histogram.count)}`,
    );
    lines.push(
      `rpc_duration_seconds_sum${formatLabels(histogram.labels)} ${formatMetricNumber(histogram.sum)}`,
    );
    lines.push(
      `rpc_duration_seconds_count${formatLabels(histogram.labels)} ${formatMetricNumber(histogram.count)}`,
    );
  }
  lines.push("");

  appendHelpAndType(lines, "git_operations_total", "Total Git operations executed.", "counter");
  for (const counter of snapshot.gitOperations) {
    lines.push(
      `git_operations_total${formatLabels(counter.labels)} ${formatMetricNumber(counter.value)}`,
    );
  }
  lines.push("");

  appendHelpAndType(lines, "memory_usage_bytes", "Current process RSS memory usage.", "gauge");
  lines.push(`memory_usage_bytes ${formatMetricNumber(input.memoryUsageBytes)}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function appendHelpAndType(
  lines: string[],
  name: string,
  help: string,
  type: "counter" | "gauge" | "histogram",
): void {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
}

function formatLabels(labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels).toSorted(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",")}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatBucketBoundary(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toString();
}

function normalizeMetricValue(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatMetricNumber(value: number): string {
  const normalized = normalizeMetricValue(value);
  return Number.isInteger(normalized)
    ? normalized.toString()
    : Number.parseFloat(normalized.toPrecision(15)).toString();
}

function sortCounterSnapshots(left: CounterSnapshot, right: CounterSnapshot): number {
  return JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels));
}

function sortHistogramSnapshots(left: HistogramSnapshot, right: HistogramSnapshot): number {
  return JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels));
}
