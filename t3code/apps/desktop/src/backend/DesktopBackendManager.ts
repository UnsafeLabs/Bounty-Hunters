import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  DesktopBackendBootstrap,
  type DesktopBackendBootstrap as DesktopBackendBootstrapValue,
} from "@t3tools/contracts";

import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

const INITIAL_RESTART_DELAY = Duration.millis(500);
const MAX_RESTART_DELAY = Duration.seconds(10);
const DEFAULT_BACKEND_READINESS_TIMEOUT = Duration.minutes(1);
const DEFAULT_BACKEND_READINESS_INTERVAL = Duration.millis(100);
const DEFAULT_BACKEND_READINESS_REQUEST_TIMEOUT = Duration.seconds(1);
const DEFAULT_BACKEND_TERMINATE_GRACE = Duration.seconds(2);
const BACKEND_READINESS_PATH = "/.well-known/t3/environment";
const HEALTH_CHECK_INTERVAL = Duration.seconds(15);
const HEALTH_CHECK_FAILURE_THRESHOLD = 3;

type BackendProcessLayerServices = ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient;

type BackendProcessRunRequirements = BackendProcessLayerServices | Scope.Scope;

export type BackendProcessOutputStream = "stdout" | "stderr";

export interface DesktopBackendStartConfig {
  readonly executablePath: string;
  readonly entryPath: string;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly bootstrap: DesktopBackendBootstrapValue;
  readonly httpBaseUrl: URL;
  readonly captureOutput: boolean;
}

interface BackendProcessExit {
  readonly code: Option.Option<number>;
  readonly reason: string;
  readonly result: Result.Result<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>;
}

interface BackendHealth {
  readonly failureCount: number;
  readonly isHealthy: boolean;
}

export const make = Effect.gen(function* () {
  const config = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
  const observability = yield* DesktopObservability.DesktopObservability;
  const state = yield* DesktopState.DesktopState;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const httpClient = yield* HttpClient.HttpClient;
  const scope = yield* Scope.Scope;

  const backendHealthRef = yield* Ref.make<BackendHealth>({
    failureCount: 0,
    isHealthy: true,
  });

  const performHealthCheck = (baseUrl: URL): Effect.Effect<boolean, Error> =>
    Effect.gen(function* () {
      try {
        const healthUrl = new URL(BACKEND_READINESS_PATH, baseUrl);
        const response = yield* httpClient.get(healthUrl.toString()).pipe(
          Effect.timeout(DEFAULT_BACKEND_READINESS_REQUEST_TIMEOUT),
          Effect.map((res) => res.status === 200),
          Effect.catchAll(() => Effect.succeed(false))
        );
        return response;
      } catch {
        return false;
      }
    });

  const updateHealthStatus = (
    isHealthy: boolean
  ): Effect.Effect<void> =>
    Ref.modify(backendHealthRef, (health) => {
      const newFailureCount = isHealthy ? 0 : health.failureCount + 1;
      const shouldRestart =
        newFailureCount >= HEALTH_CHECK_FAILURE_THRESHOLD;

      if (shouldRestart) {
        yield* observability.logWarning(
          `Backend health check failed ${newFailureCount} times, attempting restart...`
        );
      }

      return [
        void 0,
        {
          failureCount: newFailureCount,
          isHealthy: !shouldRestart && isHealthy,
        },
      ];
    });

  const startHealthMonitoring = (
    baseUrl: URL
  ): Effect.Effect<Fiber.Fiber<void, Error>> =>
    Effect.gen(function* () {
      const healthCheckFiber = yield* Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(HEALTH_CHECK_INTERVAL);
          const isHealthy = yield* performHealthCheck(baseUrl);
          yield* updateHealthStatus(isHealthy);
        }
      }).pipe(
        Effect.fork,
        Scope.extend(scope)
      );

      return healthCheckFiber;
    });

  return {
    startHealthMonitoring,
    getHealthStatus: (): Effect.Effect<BackendHealth> =>
      Ref.get(backendHealthRef),
  };
});

export const DesktopBackendManager = Context.GenericTag<
  ReturnType<typeof make>
>("DesktopBackendManager");