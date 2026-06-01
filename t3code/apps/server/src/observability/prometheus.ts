/**
 * Prometheus metrics endpoint with Effect.Metric integration.
 */

import { Effect, Metric, MetricBoundaries } from "effect";
import type { IncomingMessage, ServerResponse } from "http";

interface MetricEntry {
  name: string;
  type: "counter" | "gauge" | "histogram";
  value: number;
  labels: Record<string, string>;
}

export class PrometheusExporter {
  private metrics: Map<string, MetricEntry> = new Map();

  counter(name: string, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    const existing = this.metrics.get(key);
    if (existing) {
      existing.value++;
    } else {
      this.metrics.set(key, { name, type: "counter", value: 1, labels });
    }
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    this.metrics.set(key, { name, type: "gauge", value, labels });
  }

  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    this.metrics.set(key, { name, type: "histogram", value, labels });
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const lines: string[] = [];
    for (const entry of this.metrics.values()) {
      const labelStr = Object.entries(entry.labels).map(([k,v]) => `${k}="${v}"`).join(",");
      const suffix = entry.type === "counter" ? "_total" : "";
      lines.push(`# TYPE ${entry.name} ${entry.type}`);
      lines.push(`${entry.name}${suffix}{${labelStr}} ${entry.value}`);
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(lines.join("\n"));
  }

  private makeKey(name: string, labels: Record<string, string>): string {
    return `${name}:${JSON.stringify(labels)}`;
  }
}

export const metrics = new PrometheusExporter();
