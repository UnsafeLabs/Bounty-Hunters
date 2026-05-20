import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import { HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http";

const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(attributes: Readonly<Record<string, string>> | undefined): string {
  if (!attributes || Object.keys(attributes).length === 0) return "";
  const labels = Object.entries(attributes)
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(",");
  return `{${labels}}`;
}

function formatCounterLine(name: string, labels: string, value: number): string {
  return `${name}${labels} ${value}\n`;
}

function formatPrometheus(snapshots: ReadonlyArray<Metric.Metric.Snapshot>): string {
  const lines: Array<string> = [];

  for (const snapshot of snapshots) {
    const description = snapshot.description;
    if (description) {
      lines.push(`# HELP ${snapshot.id} ${description}\n`);
    }

    switch (snapshot.type) {
      case "Counter": {
        lines.push(`# TYPE ${snapshot.id} counter\n`);
        const state = snapshot.state as { count: number };
        const labels = formatLabels(snapshot.attributes);
        lines.push(formatCounterLine(snapshot.id, labels, state.count));
        break;
      }
      case "Gauge": {
        lines.push(`# TYPE ${snapshot.id} gauge\n`);
        const state = snapshot.state as { value: number };
        const labels = formatLabels(snapshot.attributes);
        lines.push(formatCounterLine(snapshot.id, labels, state.value));
        break;
      }
      case "Histogram": {
        lines.push(`# TYPE ${snapshot.id} histogram\n`);
        const state = snapshot.state as {
          buckets: ReadonlyArray<{ readonly upperBound: number; readonly count: number }>;
          count: number;
          sum: number;
          min: number;
          max: number;
        };
        const labels = formatLabels(snapshot.attributes);
        for (const bucket of state.buckets) {
          const bound = bucket.upperBound === Number.POSITIVE_INFINITY ? "+Inf" : String(bucket.upperBound);
          lines.push(`${snapshot.id}_bucket{${labels ? labels.slice(1, -1) : ""}le="${bound}"} ${bucket.count}\n`);
        }
        lines.push(`${snapshot.id}_sum${labels} ${state.sum}\n`);
        lines.push(`${snapshot.id}_count${labels} ${state.count}\n`);
        break;
      }
    }
  }

  return lines.join("");
}

export const metricsRouteLayer = HttpRouter.add(
  "GET",
  "/metrics",
  Effect.gen(function* () {
    const snapshots = yield* Metric.snapshot;
    const body = formatPrometheus(snapshots);
    return HttpServerResponse.text(body, {
      status: 200,
      headers: {
        "Content-Type": METRICS_CONTENT_TYPE,
      },
    });
  }),
);
