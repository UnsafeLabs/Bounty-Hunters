/**
 * Sliding-window RPC metrics aggregator (issue #856).
 *
 * Collects per-method samples into 1-minute windows with p50/p95/p99,
 * error rate, and throughput. Circular buffer of last 60 windows (1 hour).
 */

export type RpcSample = {
  method: string;
  latencyMs: number;
  ok: boolean;
  at: number; // epoch ms
};

export type MethodStats = {
  method: string;
  count: number;
  errorCount: number;
  errorRatePct: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type MetricsWindow = {
  windowStart: number;
  windowEnd: number;
  methods: MethodStats[];
};

const WINDOW_MS = 60_000;
const MAX_WINDOWS = 60;

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export function aggregateSamples(
  samples: RpcSample[],
  windowStart: number,
  windowEnd: number,
): MetricsWindow {
  const byMethod = new Map<string, RpcSample[]>();
  for (const s of samples) {
    if (s.at < windowStart || s.at >= windowEnd) continue;
    const list = byMethod.get(s.method) ?? [];
    list.push(s);
    byMethod.set(s.method, list);
  }
  const durationSec = Math.max(0.001, (windowEnd - windowStart) / 1000);
  const methods: MethodStats[] = [];
  for (const [method, list] of byMethod) {
    const latencies = list.map((x) => x.latencyMs).sort((a, b) => a - b);
    const errorCount = list.filter((x) => !x.ok).length;
    methods.push({
      method,
      count: list.length,
      errorCount,
      errorRatePct: (errorCount / list.length) * 100,
      throughputRps: list.length / durationSec,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
    });
  }
  methods.sort((a, b) => a.method.localeCompare(b.method));
  return { windowStart, windowEnd, methods };
}

export class MetricsAggregator {
  private readonly samples: RpcSample[] = [];
  private readonly windows: MetricsWindow[] = [];
  private currentWindowStart: number;
  private readonly windowMs: number;
  private readonly maxWindows: number;

  constructor(opts?: { windowMs?: number; maxWindows?: number; now?: number }) {
    this.windowMs = opts?.windowMs ?? WINDOW_MS;
    this.maxWindows = opts?.maxWindows ?? MAX_WINDOWS;
    const now = opts?.now ?? Date.now();
    this.currentWindowStart = now - (now % this.windowMs);
  }

  record(sample: Omit<RpcSample, "at"> & { at?: number }): void {
    const at = sample.at ?? Date.now();
    this.samples.push({ ...sample, at });
    this.rotate(at);
    // Bound raw samples to last 2 windows of time
    const cutoff = at - this.windowMs * 2;
    while (this.samples.length && this.samples[0].at < cutoff) {
      this.samples.shift();
    }
  }

  /** Force window rotation using `now`. */
  rotate(now: number = Date.now()): void {
    while (now >= this.currentWindowStart + this.windowMs) {
      const start = this.currentWindowStart;
      const end = start + this.windowMs;
      const win = aggregateSamples(this.samples, start, end);
      this.windows.push(win);
      while (this.windows.length > this.maxWindows) {
        this.windows.shift();
      }
      this.currentWindowStart = end;
    }
  }

  /** Last 60 completed windows (oldest first). */
  getWindows(): MetricsWindow[] {
    this.rotate();
    return [...this.windows];
  }

  /** JSON payload for GET /metrics/aggregated */
  toJSON(): { windows: MetricsWindow[]; windowMs: number; maxWindows: number } {
    return {
      windows: this.getWindows(),
      windowMs: this.windowMs,
      maxWindows: this.maxWindows,
    };
  }
}

export const metricsAggregator = new MetricsAggregator();
