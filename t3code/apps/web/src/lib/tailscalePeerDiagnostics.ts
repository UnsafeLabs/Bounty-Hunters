import type { PeerDiagnostics } from "@t3tools/contracts";

/** Number of recent pings rendered in the latency graph. */
export const MAX_LATENCY_GRAPH_SAMPLES = 10;

/** Floor height (in %) so a sample is always visible even at zero latency. */
export const MIN_LATENCY_BAR_PERCENT = 2;

export interface LatencyGraphBar {
  /** 1-based position of the ping within the rendered window. */
  readonly index: number;
  readonly latencyMs: number;
  /** Bar height as a percentage of the tallest bar, clamped to a visible floor. */
  readonly heightPercent: number;
}

export interface LatencyGraphModel {
  readonly bars: readonly LatencyGraphBar[];
  readonly minLatencyMs: number | null;
  readonly maxLatencyMs: number | null;
  readonly averageLatencyMs: number | null;
  readonly latestLatencyMs: number | null;
  readonly sampleCount: number;
}

const EMPTY_LATENCY_GRAPH_MODEL: LatencyGraphModel = {
  bars: [],
  minLatencyMs: null,
  maxLatencyMs: null,
  averageLatencyMs: null,
  latestLatencyMs: null,
  sampleCount: 0,
};

/**
 * Build a render-ready model for the peer latency graph from raw ping samples.
 *
 * Defensive against the malformed data a CLI can produce: non-finite and
 * negative samples are dropped, only the last `maxSamples` are kept, and bar
 * heights never collapse to an invisible zero. `maxSamples` must be a positive
 * integer.
 */
export function buildLatencyGraphModel(
  samples: readonly number[],
  maxSamples: number = MAX_LATENCY_GRAPH_SAMPLES,
): LatencyGraphModel {
  if (!Number.isInteger(maxSamples) || maxSamples < 1) {
    throw new TypeError(`maxSamples must be a positive integer, received ${String(maxSamples)}.`);
  }

  const valid = samples.filter(
    (sample) => typeof sample === "number" && Number.isFinite(sample) && sample >= 0,
  );
  if (valid.length === 0) {
    return EMPTY_LATENCY_GRAPH_MODEL;
  }

  const windowed = valid.slice(-maxSamples);
  const maxLatencyMs = Math.max(...windowed);
  const minLatencyMs = Math.min(...windowed);
  const averageLatencyMs =
    windowed.reduce((total, sample) => total + sample, 0) / windowed.length;

  const bars = windowed.map((latencyMs, position) => ({
    index: position + 1,
    latencyMs,
    heightPercent:
      maxLatencyMs > 0
        ? Math.max(MIN_LATENCY_BAR_PERCENT, (latencyMs / maxLatencyMs) * 100)
        : MIN_LATENCY_BAR_PERCENT,
  }));

  return {
    bars,
    minLatencyMs,
    maxLatencyMs,
    averageLatencyMs,
    latestLatencyMs: windowed[windowed.length - 1] ?? null,
    sampleCount: windowed.length,
  };
}

/** Format a millisecond latency for display; `null` renders as an em dash. */
export function formatLatencyMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

/** Human-readable label for a peer connection type. */
export function formatConnectionType(connectionType: PeerDiagnostics["connectionType"]): string {
  switch (connectionType) {
    case "direct":
      return "Direct";
    case "relayed":
      return "Relayed (DERP)";
    case "unknown":
      return "Unknown";
  }
}
