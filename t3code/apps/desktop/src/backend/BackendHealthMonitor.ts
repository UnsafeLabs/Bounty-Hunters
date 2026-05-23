import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Schedule from "effect/Schedule";
import { HttpClient } from "effect/unstable/http";

export interface HealthStatus {
  readonly healthy: boolean;
  readonly lastCheck: number;
  readonly consecutiveFailures: number;
  readonly restartCount: number;
}

export interface BackendHealthMonitorShape {
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => Effect.Effect<void, never>;
  readonly getStatus: () => Effect.Effect<HealthStatus, never>;
}

export class BackendHealthMonitor extends Context.Service<BackendHealthMonitor, BackendHealthMonitorShape>()(
  "t3/desktop/BackendHealthMonitor",
) {}

export const makeBackendHealthMonitor = (options: {
  readonly healthUrl: string;
  readonly checkIntervalMs?: number;
  readonly maxRestarts?: number;
  readonly onRestart?: () => void;
  readonly onUnhealthy?: (status: HealthStatus) => void;
}) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient;
    const checkInterval = options.checkIntervalMs ?? 30_000;
    const maxRestarts = options.maxRestarts ?? 5;

    let status: HealthStatus = {
      healthy: true,
      lastCheck: 0,
      consecutiveFailures: 0,
      restartCount: 0,
    };

    let running = false;

    const check = Effect.gen(function* () {
      try {
        const response = yield* httpClient.get(options.healthUrl);
        if (response.status === 200) {
          status = {
            ...status,
            healthy: true,
            lastCheck: Date.now(),
            consecutiveFailures: 0,
          };
        } else {
          throw new Error(`Health check failed: ${response.status}`);
        }
      } catch {
        status = {
          ...status,
          healthy: false,
          lastCheck: Date.now(),
          consecutiveFailures: status.consecutiveFailures + 1,
        };

        if (status.consecutiveFailures >= 3 && status.restartCount < maxRestarts) {
          status = { ...status, restartCount: status.restartCount + 1 };
          options.onRestart?.();
        } else if (status.restartCount >= maxRestarts) {
          options.onUnhealthy?.(status);
        }
      }
    });

    const start: BackendHealthMonitorShape["start"] = () => {
      running = true;
      return Effect.repeat(
        check,
        Schedule.spaced(Duration.millis(checkInterval)),
      ).pipe(Effect.forkDaemon, Effect.flatMap(() => Effect.void));
    };

    const stop: BackendHealthMonitorShape["stop"] = () => {
      running = false;
      return Effect.void;
    };

    const getStatus: BackendHealthMonitorShape["getStatus"] = () => Effect.succeed(status);

    return { start, stop, getStatus } satisfies BackendHealthMonitorShape;
  });
