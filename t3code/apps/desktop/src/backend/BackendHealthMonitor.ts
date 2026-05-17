/**
 * Backend Health Monitor
 *
 * Periodic health check for the DesktopBackendManager that pings the server
 * process every 15 seconds. If 3 consecutive health checks fail, attempts
 * to restart the backend process automatically.
 *
 * Uses Effect.Schedule with jitter to avoid thundering herd on multi-window setups.
 *
 * @module BackendHealthMonitor
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import { HttpClient } from "effect/unstable/http";

import * as DesktopBackendManager from "./DesktopBackendManager.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HealthMonitorConfig {
  /** Health check interval. Default: 15 seconds */
  readonly checkInterval: Duration.Duration;
  /** Maximum consecutive failures before restart. Default: 3 */
  readonly maxConsecutiveFailures: number;
  /** Maximum restart attempts before showing error dialog. Default: 3 */
  readonly maxRestartAttempts: number;
  /** Jitter range (0-1) to add to interval for thundering herd prevention. Default: 0.2 */
  readonly jitterFactor: number;
  /** Request timeout for health check HTTP call. Default: 5 seconds */
  readonly requestTimeout: Duration.Duration;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  checkInterval: Duration.seconds(15),
  maxConsecutiveFailures: 3,
  maxRestartAttempts: 3,
  jitterFactor: 0.2,
  requestTimeout: Duration.seconds(5),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = "healthy" | "unhealthy" | "checking";

export interface HealthCheckResult {
  readonly status: "pass" | "fail";
  readonly timestamp: string;
  readonly responseTimeMs?: number;
  readonly error?: string;
}

export interface HealthMonitorSnapshot {
  readonly status: HealthStatus;
  readonly consecutiveFailures: number;
  readonly totalChecks: number;
  readonly lastCheckAt: Option.Option<string>;
  readonly lastFailureAt: Option.Option<string>;
  readonly restartCount: number;
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HealthCheckError extends Data.TaggedError("HealthCheckError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BackendRestartLimitError extends Data.TaggedError("BackendRestartLimitError")<{
  readonly restartCount: number;
  readonly maxRestarts: number;
}> {}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const { logInfo: logHealthInfo, logWarning: logHealthWarning, logError: logHealthError } =
  DesktopObservability.makeComponentLogger("backend-health-monitor");

// ---------------------------------------------------------------------------
// Schedule with jitter
// ---------------------------------------------------------------------------

/**
 * Creates a schedule that adds random jitter to each interval to prevent
 * thundering herd in multi-window scenarios.
 */
const spacedWithJitter = (
  interval: Duration.Duration,
  jitterFactor: number,
): Schedule.Schedule<unknown, unknown, never> =>
  Schedule.spaced(interval).pipe(
    Schedule.addDelay(() =>
      Random.next.pipe(
        Effect.map((r) => Duration.millis(Duration.toMillis(interval) * jitterFactor * (r - 0.5) * 2)),
      ),
    ),
  );

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

const performHealthCheck = (baseUrl: URL, requestTimeout: Duration.Duration) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const startTime = Date.now();

    const healthUrl = new URL("/.well-known/t3/environment", baseUrl);

    const result = yield* client.pipe(
      HttpClient.filterStatusOk,
      HttpClient.transformResponse(Effect.timeout(requestTimeout)),
    ).get(healthUrl).pipe(
      Effect.map(() => ({
        status: "pass" as const,
        timestamp: new Date().toISOString(),
        responseTimeMs: Date.now() - startTime,
      })),
      Effect.mapError((error) => ({
        status: "fail" as const,
        timestamp: new Date().toISOString(),
        responseTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      })),
    );

    return result satisfies HealthCheckResult;
  });

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface BackendHealthMonitorShape {
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly snapshot: Effect.Effect<HealthMonitorSnapshot>;
  readonly forceCheck: Effect.Effect<HealthCheckResult>;
}

export class BackendHealthMonitor extends Context.Service<BackendHealthMonitor, BackendHealthMonitorShape>()(
  "t3/desktop/BackendHealthMonitor",
) {}

export const make = Effect.fn("BackendHealthMonitor.make")(function* (
  config: Partial<HealthMonitorConfig> = {},
): Effect.fn.Return<BackendHealthMonitorShape, never, Scope.Scope | HttpClient.HttpClient | DesktopBackendManager.DesktopBackendManager | DesktopState.DesktopState | DesktopWindow.DesktopWindow> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const monitorState = yield* Ref.make({
    status: "checking" as HealthStatus,
    consecutiveFailures: 0,
    totalChecks: 0,
    lastCheckAt: Option.none<string>(),
    lastFailureAt: Option.none<string>(),
    restartCount: 0,
    active: false,
    monitorFiber: Option.none<Fiber.Fiber<void, never>>(),
  });

  const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
  const desktopState = yield* DesktopState.DesktopState;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;

  const snapshot = Ref.get(monitorState).pipe(
    Effect.map(
      (state): HealthMonitorSnapshot => ({
        status: state.status,
        consecutiveFailures: state.consecutiveFailures,
        totalChecks: state.totalChecks,
        lastCheckAt: state.lastCheckAt,
        lastFailureAt: state.lastFailureAt,
        restartCount: state.restartCount,
        active: state.active,
      }),
    ),
  );

  const handleHealthFailure = Effect.fn("BackendHealthMonitor.handleHealthFailure")(
    function* (result: HealthCheckResult) {
      const state = yield* Ref.get(monitorState);

      const newConsecutiveFailures = state.consecutiveFailures + 1;

      yield* logHealthWarning("backend health check failed", {
        consecutiveFailures: newConsecutiveFailures,
        maxConsecutiveFailures: fullConfig.maxConsecutiveFailures,
        error: result.error,
      });

      if (newConsecutiveFailures >= fullConfig.maxConsecutiveFailures) {
        // Reset failure counter before restart
        yield* Ref.update(monitorState, (s) => ({
          ...s,
          consecutiveFailures: 0,
          status: "unhealthy",
        }));

        // Attempt restart
        if (state.restartCount < fullConfig.maxRestartAttempts) {
          yield* logHealthInfo("attempting automatic backend restart", {
            attempt: state.restartCount + 1,
            maxAttempts: fullConfig.maxRestartAttempts,
          });

          // Show notification to user
          yield* desktopWindow.showNotification({
            title: "Backend Restarting",
            body: "The server appears unresponsive and is being restarted automatically.",
          }).pipe(Effect.catch(() => Effect.void));

          // Restart the backend
          yield* backendManager.stop().pipe(Effect.catch(() => Effect.void));
          yield* backendManager.start.pipe(Effect.catch(() => Effect.void));

          yield* Ref.update(monitorState, (s) => ({
            ...s,
            restartCount: s.restartCount + 1,
            status: "checking",
          }));
        } else {
          // Max restarts reached — show error dialog
          yield* logHealthError("maximum restart attempts reached", {
            restartCount: state.restartCount,
            maxRestarts: fullConfig.maxRestartAttempts,
          });

          yield* desktopWindow.showErrorDialog({
            title: "Backend Unavailable",
            message: `The server could not be restarted after ${state.restartCount} attempts. Would you like to retry or quit?`,
            actions: ["Retry", "Quit"],
          }).pipe(Effect.catch(() => Effect.void));
        }
      } else {
        yield* Ref.update(monitorState, (s) => ({
          ...s,
          consecutiveFailures: newConsecutiveFailures,
          status: "unhealthy",
        }));
      }
    },
  );

  const handleHealthSuccess = Effect.fn("BackendHealthMonitor.handleHealthSuccess")(
    function* () {
      yield* Ref.update(monitorState, (s) => ({
        ...s,
        consecutiveFailures: 0,
        status: "healthy",
        // Reset restart count on successful health check
        ...(s.consecutiveFailures > 0 ? { restartCount: 0 } : {}),
      }));
    },
  );

  const runHealthCheck = Effect.fn("BackendHealthMonitor.runHealthCheck")(function* () {
    const backendConfig = yield* backendManager.currentConfig;

    if (Option.isNone(backendConfig)) {
      // No backend configured, skip check
      return;
    }

    const httpBaseUrl = backendConfig.value.httpBaseUrl;
    const result = yield* performHealthCheck(httpBaseUrl, fullConfig.requestTimeout);

    yield* Ref.update(monitorState, (s) => ({
      ...s,
      totalChecks: s.totalChecks + 1,
      lastCheckAt: Option.some(result.timestamp),
      ...(result.status === "fail"
        ? { lastFailureAt: Option.some(result.timestamp) }
        : {}),
    }));

    if (result.status === "pass") {
      yield* handleHealthSuccess();
    } else {
      yield* handleHealthFailure(result);
    }
  });

  const start = Effect.fn("BackendHealthMonitor.start")(function* () {
    const currentState = yield* Ref.get(monitorState);
    if (currentState.active) return;

    yield* Ref.update(monitorState, (s) => ({ ...s, active: true }));

    // Wait for backend to be ready before starting health checks
    yield* Effect.gen(function* () {
      const ready = yield* desktopState.backendReady;
      if (!ready) {
        // Wait up to 2 minutes for initial readiness
        yield* Effect.gen(function* () {
          yield* Effect.sleep(Duration.seconds(5));
        }).pipe(
          Effect.repeat(Schedule.spaced(Duration.seconds(5)).pipe(Schedule.whileEffect(
            Effect.gen(function* () {
              const r = yield* desktopState.backendReady;
              return !r;
            }),
          ))),
          Effect.timeout(Duration.minutes(2)),
          Effect.asVoid,
        );
      }
    });

    // Start periodic health check with jitter
    const monitorFiber = yield* runHealthCheck.pipe(
      Effect.catchCause((cause) =>
        logHealthError("health check loop error", { cause: Cause.pretty(cause) })
      ),
      Effect.repeat(spacedWithJitter(fullConfig.checkInterval, fullConfig.jitterFactor)),
      Effect.forkScoped,
    );

    yield* Ref.update(monitorState, (s) => ({
      ...s,
      monitorFiber: Option.some(monitorFiber),
    }));
  });

  const stop = Effect.fn("BackendHealthMonitor.stop")(function* () {
    yield* Ref.update(monitorState, (s) => ({
      ...s,
      active: false,
    }));

    const fiber = yield* Ref.get(monitorState).pipe(
      Effect.map((s) => s.monitorFiber),
    );

    yield* Option.match(fiber, {
      onNone: () => Effect.void,
      onSome: (f) => Fiber.interrupt(f).pipe(Effect.asVoid),
    });

    yield* Ref.update(monitorState, (s) => ({
      ...s,
      monitorFiber: Option.none(),
      status: "checking",
      consecutiveFailures: 0,
    }));
  });

  const forceCheck = Effect.gen(function* () {
    const backendConfig = yield* backendManager.currentConfig;
    if (Option.isNone(backendConfig)) {
      return {
        status: "fail" as const,
        timestamp: new Date().toISOString(),
        error: "No backend configured",
      };
    }
    return yield* performHealthCheck(backendConfig.value.httpBaseUrl, fullConfig.requestTimeout);
  });

  // Auto-cleanup on scope close
  yield* Effect.addFinalizer(() => stop());

  return BackendHealthMonitor.of({
    start,
    stop,
    snapshot,
    forceCheck,
  });
});

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer = (config?: Partial<HealthMonitorConfig>) =>
  Layer.effect(BackendHealthMonitor, make(config));
