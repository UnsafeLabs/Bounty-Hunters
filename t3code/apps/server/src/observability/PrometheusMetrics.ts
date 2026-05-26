import type * as Metric from "effect/Metric";

export const PROMETHEUS_METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function sanitizeMetricName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_:]/g, "_");
  return /^[a-zA-Z_:]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function escapeHelpText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatNumber(value: number | bigint | undefined): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "number") {
    return "0";
  }
  if (Number.isNaN(value)) {
    return "NaN";
  }
  if (value === Number.POSITIVE_INFINITY) {
    return "+Inf";
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return "-Inf";
  }
  return String(value);
}

function formatLabels(
  attributes: Metric.Metric.Snapshot["attributes"],
  extra?: Readonly<Record<string, string>>,
): string {
  const labels = {
    ...(attributes ?? {}),
    ...(extra ?? {}),
  };
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(String(value))}"`).join(",")}}`;
}

function appendMetricHeader(
  lines: string[],
  metricName: string,
  type: "counter" | "gauge" | "histogram" | "summary",
  description: string | undefined,
) {
  if (description) {
    lines.push(`# HELP ${metricName} ${escapeHelpText(description)}`);
  }
  lines.push(`# TYPE ${metricName} ${type}`);
}

export function formatPrometheusMetricSnapshots(
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
): string {
  const lines: string[] = [];

  for (const snapshot of [...snapshots].sort((left, right) => left.id.localeCompare(right.id))) {
    const metricName = sanitizeMetricName(snapshot.id);
    const labels = formatLabels(snapshot.attributes);

    switch (snapshot.type) {
      case "Counter": {
        appendMetricHeader(lines, metricName, "counter", snapshot.description);
        lines.push(`${metricName}${labels} ${formatNumber(snapshot.state.count)}`);
        break;
      }
      case "Gauge": {
        appendMetricHeader(lines, metricName, "gauge", snapshot.description);
        lines.push(`${metricName}${labels} ${formatNumber(snapshot.state.value)}`);
        break;
      }
      case "Frequency": {
        appendMetricHeader(lines, metricName, "counter", snapshot.description);
        for (const [value, count] of [...snapshot.state.occurrences.entries()].sort(
          ([left], [right]) => left.localeCompare(right),
        )) {
          lines.push(
            `${metricName}${formatLabels(snapshot.attributes, { value })} ${formatNumber(count)}`,
          );
        }
        break;
      }
      case "Histogram": {
        appendMetricHeader(lines, metricName, "histogram", snapshot.description);
        for (const [upperBound, count] of snapshot.state.buckets) {
          lines.push(
            `${metricName}_bucket${formatLabels(snapshot.attributes, {
              le: formatNumber(upperBound),
            })} ${formatNumber(count)}`,
          );
        }
        lines.push(
          `${metricName}_bucket${formatLabels(snapshot.attributes, { le: "+Inf" })} ${formatNumber(
            snapshot.state.count,
          )}`,
        );
        lines.push(`${metricName}_sum${labels} ${formatNumber(snapshot.state.sum)}`);
        lines.push(`${metricName}_count${labels} ${formatNumber(snapshot.state.count)}`);
        break;
      }
      case "Summary": {
        appendMetricHeader(lines, metricName, "summary", snapshot.description);
        for (const [quantile, value] of snapshot.state.quantiles) {
          if (value === undefined) {
            continue;
          }
          lines.push(
            `${metricName}${formatLabels(snapshot.attributes, {
              quantile: formatNumber(quantile),
            })} ${formatNumber(value)}`,
          );
        }
        lines.push(`${metricName}_sum${labels} ${formatNumber(snapshot.state.sum)}`);
        lines.push(`${metricName}_count${labels} ${formatNumber(snapshot.state.count)}`);
        break;
      }
    }
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
