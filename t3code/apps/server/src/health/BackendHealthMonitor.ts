import { Effect, Schema, Schedule, Ref, Layer } from "effect";

export const HealthStatus = Schema.Union(
  Schema.Literal("healthy"),
  Schema.Literal("degraded"),
  Schema.Literal("unhealthy"),
  Schema.Literal("unknown")
);

export type HealthStatusType = Schema.Schema.Type<typeof HealthStatus>;

export interface HealthCheck {
  name: string;
  check: Effect.Effect<boolean, never>;
  timeoutMs: number;
  critical: boolean;
}

export interface HealthReport {
  status: HealthStatusType;
  checks: Record<string, { healthy: boolean; latencyMs: number; lastChecked: string }>;
  uptime: number;
  lastRestart: string;
  consecutiveFailures: number;
}

export const BackendHealthMonitor = Effect.gen(function* (_) {
  const checks = yield* _(Ref.make<Map<string, HealthCheck>>(new Map()));
  const results = yield* _(Ref.make<Map<string, { healthy: boolean; latencyMs: number; lastChecked: string }>>(new Map()));
  const consecutiveFailures = yield* _(Ref.make(0));
  const startTime = Date.now();

  const registerCheck = (check: HealthCheck) =>
    Ref.update(checks, (m) => {
      const next = new Map(m);
      next.set(check.name, check);
      return next;
    });

  const runCheck = (name: string) =>
    Effect.gen(function* (_) {
      const c = yield* _(Ref.get(checks));
      const check = c.get(name);
      if (!check) return null;

      const start = Date.now();
      const result = yield* _(
        check.check,
        Effect.timeout(check.timeoutMs),
        Effect.map((r) => r === true),
        Effect.catchAll(() => Effect.succeed(false))
      );
      const latency = Date.now() - start;

      const entry = { healthy: result, latencyMs: latency, lastChecked: new Date().toISOString() };
      yield* _(Ref.update(results, (m) => {
        const next = new Map(m);
        next.set(name, entry);
        return next;
      }));

      return entry;
    });

  const runAllChecks = Effect.gen(function* (_) {
    const c = yield* _(Ref.get(checks));
    let anyCriticalFailed = false;
    let anyNonCriticalFailed = false;

    for (const [name] of c) {
      const result = yield* _(runCheck(name));
      if (result && !result.healthy) {
        const check = c.get(name);
        if (check?.critical) anyCriticalFailed = true;
        else anyNonCriticalFailed = true;
      }
    }

    let status: HealthStatusType = "healthy";
    if (anyCriticalFailed) {
      status = "unhealthy";
      yield* _(Ref.update(consecutiveFailures, (n) => n + 1));
    } else if (anyNonCriticalFailed) {
      status = "degraded";
      yield* _(Ref.update(consecutiveFailures, (n) => n + 1));
    } else {
      yield* _(Ref.set(consecutiveFailures, 0));
    }

    return status;
  });

  const getReport = Effect.gen(function* (_) {
    const c = yield* _(Ref.get(checks));
    const r = yield* _(Ref.get(results));
    const failures = yield* _(Ref.get(consecutiveFailures));

    const checksReport: Record<string, { healthy: boolean; latencyMs: number; lastChecked: string }> = {};
    for (const [name, result] of r) {
      checksReport[name] = result;
    }

    const anyUnhealthy = Object.values(checksReport).some((r) => !r.healthy);
    const status: HealthStatusType = Object.keys(checksReport).length === 0
      ? "unknown"
      : failures >= 3 ? "unhealthy"
      : anyUnhealthy ? "degraded"
      : "healthy";

    return {
      status,
      checks: checksReport,
      uptime: Date.now() - startTime,
      lastRestart: new Date(startTime).toISOString(),
      consecutiveFailures: failures,
    };
  });

  // Auto-restart logic
  const shouldRestart = Effect.gen(function* (_) {
    const failures = yield* _(Ref.get(consecutiveFailures));
    return failures >= 5; // Restart after 5 consecutive failures
  });

  const startMonitoring = Effect.gen(function* (_) {
    yield* _(
      Effect.repeat(runAllChecks, Schedule.spaced(30000)), // Check every 30s
      Effect.fork
    );
  });

  return { registerCheck, runCheck, runAllChecks, getReport, shouldRestart, startMonitoring };
});

export const BackendHealthMonitorLayer = Layer.effect(BackendHealthMonitor, BackendHealthMonitor);
