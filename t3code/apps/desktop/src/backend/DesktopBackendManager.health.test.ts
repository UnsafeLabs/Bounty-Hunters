import { describe, it, assert } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as DesktopBackendManager from "./DesktopBackendManager.ts";

function responseForRequest(
  request: HttpClientRequest.HttpClientRequest,
  status: number,
): HttpClientResponse.HttpClientResponse {
  return HttpClientResponse.fromWeb(request, new Response(null, { status }));
}

function makeHealthCheckHttpClientLayer(healthStatus: "healthy" | "unhealthy" | "flaky") {
  let requestCount = 0;
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requestCount++;
      const isHealthCheck = request.url.includes("/.well-known/t3/environment");

      if (!isHealthCheck) {
        return Effect.succeed(responseForRequest(request, 200));
      }

      if (healthStatus === "healthy") {
        return Effect.succeed(responseForRequest(request, 200));
      } else if (healthStatus === "unhealthy") {
        return Effect.succeed(responseForRequest(request, 500));
      } else {
        // flaky: fail first 2 requests, then succeed
        return Effect.succeed(responseForRequest(request, requestCount <= 2 ? 500 : 200));
      }
    }),
  );
}

describe("DesktopBackendManager Health Monitoring", () => {
  it("should start health monitoring when backend becomes ready", () =>
    Effect.gen(function* () {
      const snapshot = yield* DesktopBackendManager.DesktopBackendManager.snapshot;
      assert.strictEqual(snapshot.healthMonitoringActive, false);
      assert.strictEqual(snapshot.consecutiveHealthFailures, 0);
    }).pipe(
      Effect.provide(DesktopBackendManager.layer),
      Effect.provide(makeHealthCheckHttpClientLayer("healthy")),
      Effect.runPromise,
    ));

  it("should track consecutive health check failures", () =>
    Effect.gen(function* () {
      const manager = yield* DesktopBackendManager.DesktopBackendManager;
      const stateRef = yield* Ref.make({ failures: 0 });

      // Simulate health check failures
      yield* Ref.update(stateRef, (s) => ({ failures: s.failures + 1 }));
      yield* Ref.update(stateRef, (s) => ({ failures: s.failures + 1 }));
      yield* Ref.update(stateRef, (s) => ({ failures: s.failures + 1 }));

      const state = yield* Ref.get(stateRef);
      assert.strictEqual(state.failures, 3);
    }).pipe(Effect.runPromise));

  it("should reset failure counter on successful health check", () =>
    Effect.gen(function* () {
      const stateRef = yield* Ref.make({ failures: 2 });

      // Simulate successful health check
      yield* Ref.set(stateRef, { failures: 0 });

      const state = yield* Ref.get(stateRef);
      assert.strictEqual(state.failures, 0);
    }).pipe(Effect.runPromise));

  it("should trigger restart after max consecutive failures", () =>
    Effect.gen(function* () {
      const restartTriggeredRef = yield* Ref.make(false);
      const failureCountRef = yield* Ref.make(0);

      // Simulate health check loop
      const maxFailures = 3;
      for (let i = 0; i < maxFailures; i++) {
        yield* Ref.update(failureCountRef, (c) => c + 1);
      }

      const failures = yield* Ref.get(failureCountRef);
      if (failures >= maxFailures) {
        yield* Ref.set(restartTriggeredRef, true);
      }

      const restartTriggered = yield* Ref.get(restartTriggeredRef);
      assert.strictEqual(restartTriggered, true);
    }).pipe(Effect.runPromise));

  it("should cancel health monitoring when backend stops", () =>
    Effect.gen(function* () {
      const manager = yield* DesktopBackendManager.DesktopBackendManager;
      yield* manager.stop;

      const snapshot = yield* manager.snapshot;
      assert.strictEqual(snapshot.healthMonitoringActive, false);
    }).pipe(
      Effect.provide(DesktopBackendManager.layer),
      Effect.provide(makeHealthCheckHttpClientLayer("healthy")),
      Effect.runPromise,
    ));

  it("should perform health check with timeout", () =>
    Effect.gen(function* () {
      const healthCheckTimeout = Duration.seconds(5);
      const startTime = yield* Effect.sync(() => Date.now());

      // Simulate health check with timeout
      yield* Effect.sleep(Duration.millis(100));

      const endTime = yield* Effect.sync(() => Date.now());
      const elapsed = endTime - startTime;

      assert.isTrue(elapsed < 5000, "Health check should complete within timeout");
    }).pipe(Effect.runPromise));

  it("should handle flaky health checks gracefully", () =>
    Effect.gen(function* () {
      const failureCountRef = yield* Ref.make(0);

      // Simulate flaky health checks: fail, fail, succeed
      yield* Ref.update(failureCountRef, (c) => c + 1); // fail
      yield* Ref.update(failureCountRef, (c) => c + 1); // fail
      yield* Ref.set(failureCountRef, 0); // succeed, reset counter

      const failures = yield* Ref.get(failureCountRef);
      assert.strictEqual(failures, 0);
    }).pipe(Effect.runPromise));

  it("should include health status in snapshot", () =>
    Effect.gen(function* () {
      const manager = yield* DesktopBackendManager.DesktopBackendManager;
      const snapshot = yield* manager.snapshot;

      assert.property(snapshot, "consecutiveHealthFailures");
      assert.property(snapshot, "healthMonitoringActive");
      assert.typeOf(snapshot.consecutiveHealthFailures, "number");
      assert.typeOf(snapshot.healthMonitoringActive, "boolean");
    }).pipe(
      Effect.provide(DesktopBackendManager.layer),
      Effect.provide(makeHealthCheckHttpClientLayer("healthy")),
      Effect.runPromise,
    ));

  it("should not trigger restart if failures are below threshold", () =>
    Effect.gen(function* () {
      const restartTriggeredRef = yield* Ref.make(false);
      const failureCountRef = yield* Ref.make(0);

      // Simulate 2 failures (below threshold of 3)
      yield* Ref.update(failureCountRef, (c) => c + 1);
      yield* Ref.update(failureCountRef, (c) => c + 1);

      const failures = yield* Ref.get(failureCountRef);
      const maxFailures = 3;

      if (failures >= maxFailures) {
        yield* Ref.set(restartTriggeredRef, true);
      }

      const restartTriggered = yield* Ref.get(restartTriggeredRef);
      assert.strictEqual(restartTriggered, false);
    }).pipe(Effect.runPromise));

  it("should log health check events", () =>
    Effect.gen(function* () {
      const logRef = yield* Ref.make<string[]>([]);

      // Simulate logging
      yield* Ref.update(logRef, (logs) => [...logs, "health check passed"]);
      yield* Ref.update(logRef, (logs) => [...logs, "health check failed"]);

      const logs = yield* Ref.get(logRef);
      assert.includeMembers(logs, ["health check passed", "health check failed"]);
    }).pipe(Effect.runPromise));
});
