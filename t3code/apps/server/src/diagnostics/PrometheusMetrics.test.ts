import { describe, it, expect } from "vitest";
import { Effect, Ref, Layer } from "effect";
import { makePrometheusMetricsService } from "./PrometheusMetrics.ts";

describe("PrometheusMetricsService", () => {
  describe("counter metrics", () => {
    it("increments counter and formats correctly", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makePrometheusMetricsService;
        yield* service.incrementCounter("rpc_requests_total", { method: "prompt" });
        yield* service.incrementCounter("rpc_requests_total", { method: "prompt" });
        yield* service.incrementCounter("rpc_requests_total", { method: "createSession" });

        const text = yield* service.getMetricsText();
        expect(text).toContain("rpc_requests_total");
        expect(text).toContain("# TYPE rpc_requests_total counter");
        expect(text).toContain(`method="prompt"`);
        expect(text).toContain(`method="createSession"`);
      });
      await Effect.runPromise(program);
    });
  });

  describe("gauge metrics", () => {
    it("sets gauge value and formats correctly", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makePrometheusMetricsService;
        yield* service.setGauge("active_sessions", 5);
        yield* service.setGauge("memory_usage_bytes", 1048576);

        const text = yield* service.getMetricsText();
        expect(text).toContain("active_sessions 5");
        expect(text).toContain("memory_usage_bytes 1048576");
        expect(text).toContain("# TYPE active_sessions gauge");
      });
      await Effect.runPromise(program);
    });
  });

  describe("histogram metrics", () => {
    it("observes values and formats histogram", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makePrometheusMetricsService;
        yield* service.observeHistogram("rpc_duration_seconds", 0.1);
        yield* service.observeHistogram("rpc_duration_seconds", 0.5);

        const text = yield* service.getMetricsText();
        expect(text).toContain("rpc_duration_seconds");
        expect(text).toContain("# TYPE rpc_duration_seconds histogram");
        expect(text).toContain("le=");
        expect(text).toContain("_sum");
        expect(text).toContain("_count");
      });
      await Effect.runPromise(program);
    });
  });

  describe("Prometheus format validation", () => {
    it("includes HELP and TYPE for each metric", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makePrometheusMetricsService;
        yield* service.incrementCounter("test_counter");
        yield* service.setGauge("test_gauge", 42);

        const text = yield* service.getMetricsText();
        expect(text).toContain("# HELP test_counter");
        expect(text).toContain("# TYPE test_counter counter");
        expect(text).toContain("# HELP test_gauge");
        expect(text).toContain("# TYPE test_gauge gauge");
      });
      await Effect.runPromise(program);
    });

    it("returns empty output when no metrics registered", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makePrometheusMetricsService;
        const text = yield* service.getMetricsText();
        expect(text).toBe("\n");
      });
      await Effect.runPromise(program);
    });

    it("handles metrics with no labels", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makePrometheusMetricsService;
        yield* service.incrementCounter("simple_total");

        const text = yield* service.getMetricsText();
        expect(text).toContain("simple_total 1");
      });
      await Effect.runPromise(program);
    });
  });

  describe("all five required metrics", () => {
    it("tracks all specified metric types", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makePrometheusMetricsService;

        yield* service.setGauge("active_sessions", 3);
        yield* service.incrementCounter("rpc_requests_total", { method: "prompt" });
        yield* service.observeHistogram("rpc_duration_seconds", 0.15);
        yield* service.incrementCounter("git_operations_total", { operation: "clone" });
        yield* service.setGauge("memory_usage_bytes", 5242880);

        const text = yield* service.getMetricsText();
        expect(text).toContain("active_sessions");
        expect(text).toContain("rpc_requests_total");
        expect(text).toContain("rpc_duration_seconds");
        expect(text).toContain("git_operations_total");
        expect(text).toContain("memory_usage_bytes");
      });
      await Effect.runPromise(program);
    });
  });
});
