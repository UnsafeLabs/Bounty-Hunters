import { describe, expect, it } from "vitest";
import {
  MetricsAggregator,
  aggregateSamples,
  percentile,
} from "./MetricsAggregator.ts";

describe("MetricsAggregator (#856)", () => {
  it("computes percentiles on sorted arrays", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 50)).toBe(5.5);
    expect(percentile(s, 90)).toBeCloseTo(9.1, 5);
    expect(percentile([7], 99)).toBe(7);
  });

  it("aggregates error rate and throughput", () => {
    const start = 1_000_000;
    const samples = [
      { method: "rpc.a", latencyMs: 10, ok: true, at: start + 100 },
      { method: "rpc.a", latencyMs: 30, ok: false, at: start + 200 },
      { method: "rpc.a", latencyMs: 20, ok: true, at: start + 300 },
    ];
    const win = aggregateSamples(samples, start, start + 60_000);
    const m = win.methods.find((x) => x.method === "rpc.a")!;
    expect(m.count).toBe(3);
    expect(m.errorCount).toBe(1);
    expect(m.errorRatePct).toBeCloseTo(33.333, 2);
    expect(m.p50Ms).toBe(20);
  });

  it("retains at most 60 windows", () => {
    const now = 1_000_000;
    const agg = new MetricsAggregator({ windowMs: 1000, maxWindows: 60, now });
    for (let i = 0; i < 80; i++) {
      agg.record({
        method: "x",
        latencyMs: i,
        ok: true,
        at: now + i * 1000 + 10,
      });
      agg.rotate(now + (i + 1) * 1000);
    }
    expect(agg.getWindows().length).toBeLessThanOrEqual(60);
  });

  it("exports JSON shape for /metrics/aggregated", () => {
    const agg = new MetricsAggregator({ windowMs: 1000, maxWindows: 5, now: 0 });
    agg.record({ method: "ping", latencyMs: 5, ok: true, at: 100 });
    agg.rotate(1000);
    const json = agg.toJSON();
    expect(json.windowMs).toBe(1000);
    expect(json.maxWindows).toBe(5);
    expect(Array.isArray(json.windows)).toBe(true);
  });
});
