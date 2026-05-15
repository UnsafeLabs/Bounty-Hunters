import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  PrometheusMetricsService,
  type PrometheusMetricsServiceShape,
} from "./PrometheusMetricsService.ts";

interface MetricEntry {
  readonly type: "counter" | "gauge" | "histogram";
  readonly name: string;
  readonly help: string;
  readonly labelNames: ReadonlyArray<string>;
  readonly values: Map<string, number>;
  readonly buckets?: ReadonlyArray<number>;
}

const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

function formatMetric(entry: MetricEntry): string {
  const lines: string[] = [];
  lines.push(`# HELP ${entry.name} ${entry.help}`);
  lines.push(`# TYPE ${entry.name} ${entry.type}`);

  if (entry.type === "histogram" && entry.buckets) {
    const sorted = [...entry.values.entries()].sort();
    let cumulative = 0;
    const labelPart = sorted.length > 0 && sorted[0][0] ? `{${sorted[0][0].split(",").filter(l => !l.startsWith("le=")).join(",")}}` : "";

    for (const bucket of entry.buckets) {
      cumulative += (entry.values.get(`le="${bucket}"`) ?? 0);
      lines.push(`${entry.name}_bucket{le="${bucket}"${labelPart ? "," + labelPart.slice(1, -1) : ""}} ${cumulative}`);
    }
    cumulative += (entry.values.get(`le="+Inf"`) ?? 0);
    lines.push(`${entry.name}_bucket{le="+Inf"${labelPart ? "," + labelPart.slice(1, -1) : ""}} ${cumulative}`);
    const sum = entry.values.get("_sum") ?? 0;
    const count = cumulative;
    lines.push(`${entry.name}_sum ${sum}`);
    lines.push(`${entry.name}_count ${count}`);
  } else {
    for (const [labels, value] of entry.values.entries()) {
      if (labels) {
        lines.push(`${entry.name}{${labels}} ${value}`);
      } else {
        lines.push(`${entry.name} ${value}`);
      }
    }
  }

  return lines.join("\n");
}

export const makePrometheusMetricsService = Effect.gen(function* () {
  const metricsRef = yield* Ref.make<Map<string, MetricEntry>>(new Map());

  const getOrCreate = (name: string, type: MetricEntry["type"], help: string, labelNames: ReadonlyArray<string>, buckets?: ReadonlyArray<number>) =>
    Ref.update(metricsRef, (map) => {
      const next = new Map(map);
      if (!next.has(name)) {
        next.set(name, { type, name, help, labelNames, values: new Map(), buckets });
      }
      return next;
    });

  const getMetricsText: PrometheusMetricsServiceShape["getMetricsText"] = () =>
    Effect.gen(function* () {
      const map = yield* Ref.get(metricsRef);
      return Array.from(map.values()).map(formatMetric).join("\n\n") + "\n";
    });

  const incrementCounter: PrometheusMetricsServiceShape["incrementCounter"] = (name, labels = {}) =>
    Effect.gen(function* () {
      yield* getOrCreate(name, "counter", name, Object.keys(labels));
      yield* Ref.update(metricsRef, (map) => {
        const next = new Map(map);
        const entry = next.get(name)!;
        const key = labelKey(labels);
        entry.values.set(key, (entry.values.get(key) ?? 0) + 1);
        return next;
      });
    });

  const observeHistogram: PrometheusMetricsServiceShape["observeHistogram"] = (name, value, labels = {}) =>
    Effect.gen(function* () {
      yield* getOrCreate(name, "histogram", name, Object.keys(labels), DEFAULT_HISTOGRAM_BUCKETS);
      yield* Ref.update(metricsRef, (map) => {
        const next = new Map(map);
        const entry = next.get(name)!;
        const baseKey = labelKey(labels);
        for (const bucket of entry.buckets ?? DEFAULT_HISTOGRAM_BUCKETS) {
          if (value <= bucket) {
            const bucketKey = baseKey ? `${baseKey},le="${bucket}"` : `le="${bucket}"`;
            entry.values.set(bucketKey, (entry.values.get(bucketKey) ?? 0) + 1);
          }
        }
        const infKey = baseKey ? `${baseKey},le="+Inf"` : `le="+Inf"`;
        entry.values.set(infKey, (entry.values.get(infKey) ?? 0) + 1);
        const sumKey = baseKey ? `${baseKey},_sum` : "_sum";
        entry.values.set(sumKey, (entry.values.get(sumKey) ?? 0) + value);
        return next;
      });
    });

  const setGauge: PrometheusMetricsServiceShape["setGauge"] = (name, value, labels = {}) =>
    Effect.gen(function* () {
      yield* getOrCreate(name, "gauge", name, Object.keys(labels));
      yield* Ref.update(metricsRef, (map) => {
        const next = new Map(map);
        const entry = next.get(name)!;
        const key = labelKey(labels);
        entry.values.set(key, value);
        return next;
      });
    });

  return { getMetricsText, incrementCounter, observeHistogram, setGauge } satisfies PrometheusMetricsServiceShape;
});

export const PrometheusMetricsServiceLive = Layer.effect(
  PrometheusMetricsService,
  makePrometheusMetricsService,
);
