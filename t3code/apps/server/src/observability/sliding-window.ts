/**
 * Sliding window metrics aggregation with Effect.Stream.
 * Tracks metrics in time-bucketed windows for trend analysis.
 */

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface MetricWindow {
  start: number;
  end: number;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

interface SlidingWindowConfig {
  /** Window duration in ms (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Number of windows to keep (default: 60 = 1 hour) */
  maxWindows?: number;
  /** Aggregation interval in ms (default: 1000 = 1 second) */
  aggregateIntervalMs?: number;
}

export class SlidingWindowMetrics {
  private windows: Map<string, MetricPoint[]> = new Map();
  private config: Required<SlidingWindowConfig>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SlidingWindowConfig = {}) {
    this.config = {
      windowMs: config.windowMs || 60000,
      maxWindows: config.maxWindows || 60,
      aggregateIntervalMs: config.aggregateIntervalMs || 1000,
    };
  }

  /**
   * Record a metric point.
   */
  record(name: string, value: number, labels?: Record<string, string>): void {
    const now = Date.now();
    const key = this.getWindowKey(name, now);

    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }

    this.windows.get(key)!.push({ timestamp: now, value, labels });
  }

  /**
   * Get aggregated metrics for a named metric.
   */
  getMetrics(name: string, windowCount: number = 1): MetricWindow[] {
    const now = Date.now();
    const results: MetricWindow[] = [];

    for (let i = 0; i < windowCount; i++) {
      const windowEnd = now - i * this.config.windowMs;
      const windowStart = windowEnd - this.config.windowMs;
      const key = this.getWindowKey(name, windowEnd);

      const points = this.windows.get(key) || [];
      if (points.length === 0) {
        results.push({
          start: windowStart,
          end: windowEnd,
          count: 0,
          sum: 0,
          min: 0,
          max: 0,
          avg: 0,
          p50: 0,
          p95: 0,
          p99: 0,
        });
        continue;
      }

      const values = points.map((p) => p.value).sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);

      results.push({
        start: windowStart,
        end: windowEnd,
        count: values.length,
        sum,
        min: values[0],
        max: values[values.length - 1],
        avg: sum / values.length,
        p50: this.percentile(values, 0.5),
        p95: this.percentile(values, 0.95),
        p99: this.percentile(values, 0.99),
      });
    }

    return results;
  }

  /**
   * Get all metric names.
   */
  getMetricNames(): string[] {
    const names = new Set<string>();
    for (const key of this.windows.keys()) {
      names.add(key.split(":")[0]);
    }
    return Array.from(names);
  }

  /**
   * Clear old windows.
   */
  cleanup(): void {
    const cutoff = Date.now() - this.config.windowMs * this.config.maxWindows;
    for (const [key, points] of this.windows.entries()) {
      if (points.length > 0 && points[points.length - 1].timestamp < cutoff) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Start automatic cleanup.
   */
  startCleanup(): void {
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      this.config.windowMs
    );
  }

  /**
   * Stop automatic cleanup.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private getWindowKey(name: string, timestamp: number): string {
    const windowStart = Math.floor(timestamp / this.config.windowMs) * this.config.windowMs;
    return `${name}:${windowStart}`;
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }
}
