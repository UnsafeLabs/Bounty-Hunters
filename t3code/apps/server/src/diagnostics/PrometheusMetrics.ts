/**
 * Prometheus exposition format metrics (issue #833).
 */

export interface Histogram {
  sum: number;
  count: number;
  buckets: Map<number, number>; // le -> count
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class PrometheusRegistry {
  activeSessions = 0;
  rpcRequestsTotal = new Map<string, number>();
  rpcDuration: Histogram = {
    sum: 0,
    count: 0,
    buckets: new Map(DEFAULT_BUCKETS.map((b) => [b, 0])),
  };
  gitOperationsTotal = new Map<string, number>();
  memoryUsageBytes = 0;

  setActiveSessions(n: number): void {
    this.activeSessions = n;
  }

  incRpc(method: string, durationSeconds: number): void {
    this.rpcRequestsTotal.set(method, (this.rpcRequestsTotal.get(method) ?? 0) + 1);
    this.rpcDuration.sum += durationSeconds;
    this.rpcDuration.count += 1;
    for (const le of DEFAULT_BUCKETS) {
      if (durationSeconds <= le) {
        this.rpcDuration.buckets.set(le, (this.rpcDuration.buckets.get(le) ?? 0) + 1);
      }
    }
  }

  incGit(operation: string): void {
    this.gitOperationsTotal.set(operation, (this.gitOperationsTotal.get(operation) ?? 0) + 1);
  }

  setMemory(bytes: number): void {
    this.memoryUsageBytes = bytes;
  }

  /** Prometheus text exposition format. */
  toExposition(): string {
    const lines: string[] = [];
    lines.push("# HELP active_sessions Active user sessions");
    lines.push("# TYPE active_sessions gauge");
    lines.push(`active_sessions ${this.activeSessions}`);

    lines.push("# HELP rpc_requests_total Total RPC requests");
    lines.push("# TYPE rpc_requests_total counter");
    for (const [method, n] of [...this.rpcRequestsTotal.entries()].sort()) {
      lines.push(`rpc_requests_total{method="${escapeLabel(method)}"} ${n}`);
    }

    lines.push("# HELP rpc_duration_seconds RPC duration histogram");
    lines.push("# TYPE rpc_duration_seconds histogram");
    let cumulative = 0;
    for (const le of DEFAULT_BUCKETS) {
      cumulative = this.rpcDuration.buckets.get(le) ?? 0;
      lines.push(`rpc_duration_seconds_bucket{le="${le}"} ${cumulative}`);
    }
    lines.push(`rpc_duration_seconds_bucket{le="+Inf"} ${this.rpcDuration.count}`);
    lines.push(`rpc_duration_seconds_sum ${this.rpcDuration.sum}`);
    lines.push(`rpc_duration_seconds_count ${this.rpcDuration.count}`);

    lines.push("# HELP git_operations_total Git operations");
    lines.push("# TYPE git_operations_total counter");
    for (const [op, n] of [...this.gitOperationsTotal.entries()].sort()) {
      lines.push(`git_operations_total{operation="${escapeLabel(op)}"} ${n}`);
    }

    lines.push("# HELP memory_usage_bytes Process memory usage");
    lines.push("# TYPE memory_usage_bytes gauge");
    lines.push(`memory_usage_bytes ${this.memoryUsageBytes}`);

    return lines.join("\n") + "\n";
  }
}

function escapeLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function metricsAuthAllowed(
  authHeader: string | undefined,
  env: { METRICS_AUTH_DISABLED?: string; METRICS_TOKEN?: string },
): boolean {
  if (env.METRICS_AUTH_DISABLED === "true") return true;
  const token = env.METRICS_TOKEN;
  if (!token) return true; // no token configured
  return authHeader === `Bearer ${token}`;
}

export function handleMetricsRequest(input: {
  registry: PrometheusRegistry;
  authHeader?: string;
  env?: { METRICS_AUTH_DISABLED?: string; METRICS_TOKEN?: string };
}): { status: number; body: string; contentType: string } {
  const env = input.env ?? {};
  if (!metricsAuthAllowed(input.authHeader, env)) {
    return { status: 401, body: "Unauthorized\n", contentType: "text/plain" };
  }
  // refresh memory if available
  if (typeof process !== "undefined" && process.memoryUsage) {
    input.registry.setMemory(process.memoryUsage().heapUsed);
  }
  return {
    status: 200,
    body: input.registry.toExposition(),
    contentType: "text/plain; version=0.0.4; charset=utf-8",
  };
}
