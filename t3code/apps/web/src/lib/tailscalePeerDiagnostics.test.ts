import { describe, expect, it } from "vitest";

import {
  buildLatencyGraphModel,
  formatConnectionType,
  formatLatencyMs,
  MAX_LATENCY_GRAPH_SAMPLES,
  MIN_LATENCY_BAR_PERCENT,
} from "./tailscalePeerDiagnostics";

describe("buildLatencyGraphModel", () => {
  it("returns an empty model when there are no samples", () => {
    expect(buildLatencyGraphModel([])).toEqual({
      bars: [],
      minLatencyMs: null,
      maxLatencyMs: null,
      averageLatencyMs: null,
      latestLatencyMs: null,
      sampleCount: 0,
    });
  });

  it("renders a single sample at full height", () => {
    const model = buildLatencyGraphModel([42]);
    expect(model.bars).toEqual([{ index: 1, latencyMs: 42, heightPercent: 100 }]);
    expect(model.latestLatencyMs).toBe(42);
    expect(model.averageLatencyMs).toBe(42);
    expect(model.minLatencyMs).toBe(42);
    expect(model.maxLatencyMs).toBe(42);
  });

  it("scales bar heights relative to the tallest sample", () => {
    const model = buildLatencyGraphModel([10, 20]);
    expect(model.bars.map((bar) => bar.heightPercent)).toEqual([50, 100]);
    expect(model.averageLatencyMs).toBe(15);
  });

  it("keeps zero-latency samples visible at the floor height", () => {
    const model = buildLatencyGraphModel([0, 100]);
    expect(model.bars[0]?.heightPercent).toBe(MIN_LATENCY_BAR_PERCENT);
    expect(model.bars[1]?.heightPercent).toBe(100);
  });

  it("uses the floor height when every sample is zero", () => {
    const model = buildLatencyGraphModel([0, 0, 0]);
    expect(model.bars.every((bar) => bar.heightPercent === MIN_LATENCY_BAR_PERCENT)).toBe(true);
    expect(model.maxLatencyMs).toBe(0);
  });

  it("keeps only the last 10 pings for the graph", () => {
    const samples = Array.from({ length: 14 }, (_, index) => index + 1);
    const model = buildLatencyGraphModel(samples);
    expect(model.sampleCount).toBe(MAX_LATENCY_GRAPH_SAMPLES);
    expect(model.bars.map((bar) => bar.latencyMs)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(model.latestLatencyMs).toBe(14);
  });

  it("drops non-finite and negative samples", () => {
    const model = buildLatencyGraphModel([Number.NaN, -5, Number.POSITIVE_INFINITY, 8, 4]);
    expect(model.bars.map((bar) => bar.latencyMs)).toEqual([8, 4]);
    expect(model.maxLatencyMs).toBe(8);
  });

  it("honors a custom sample window", () => {
    const model = buildLatencyGraphModel([1, 2, 3, 4], 2);
    expect(model.bars.map((bar) => bar.latencyMs)).toEqual([3, 4]);
  });

  it("throws on a non-positive or non-integer sample window", () => {
    expect(() => buildLatencyGraphModel([1, 2], 0)).toThrow(TypeError);
    expect(() => buildLatencyGraphModel([1, 2], -3)).toThrow(TypeError);
    expect(() => buildLatencyGraphModel([1, 2], 2.5)).toThrow(TypeError);
  });
});

describe("formatLatencyMs", () => {
  it("renders an em dash for missing latency", () => {
    expect(formatLatencyMs(null)).toBe("—");
    expect(formatLatencyMs(Number.NaN)).toBe("—");
  });

  it("formats small latencies with one decimal and large ones as integers", () => {
    expect(formatLatencyMs(12.34)).toBe("12.3 ms");
    expect(formatLatencyMs(150.7)).toBe("151 ms");
  });
});

describe("formatConnectionType", () => {
  it("labels each connection type", () => {
    expect(formatConnectionType("direct")).toBe("Direct");
    expect(formatConnectionType("relayed")).toBe("Relayed (DERP)");
    expect(formatConnectionType("unknown")).toBe("Unknown");
  });
});
