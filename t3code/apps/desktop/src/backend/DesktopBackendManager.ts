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

const startProcess = (config: DesktopBackendStartConfig) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const process = yield* spawner.spawn({
      command: config.executablePath,
      args: [config.entryPath],
      cwd: config.cwd,
      env: config.env,
      stdout: config.captureOutput ? "pipe" : "inherit",
      stderr: config.captureOutput ? "pipe" : "inherit",
    });
    return process;
  });

const waitForReadiness = (
  config: DesktopBackendStartConfig,
  timeout: Duration.DurationInput = DEFAULT_BACKEND_READINESS_TIMEOUT,
  interval: Duration.DurationInput = DEFAULT_BACKEND_READINESS_INTERVAL,
  requestTimeout: Duration.DurationInput = DEFAULT_BACKEND_READINESS_REQUEST_TIMEOUT,
) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const readinessUrl = new URL(BACKEND_READINESS_PATH, config.httpBaseUrl).toString();
    yield* Effect.retry(
      http.get(readinessUrl).pipe(
        Effect.timeout(requestTimeout),
        Effect.filterOrFail(
          (response) => response.status === 200,
          () => new Error("Backend not ready"),
        ),
      ),
      Schedule.spaced(interval),
    ).pipe(Effect.timeout(timeout));
  });

const performHealthCheck = (config: DesktopBackendStartConfig) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const readinessUrl = new URL(BACKEND_READINESS_PATH, config.httpBaseUrl).toString();
    yield* http.get(readinessUrl).pipe(
      Effect.timeout(DEFAULT_BACKEND_READINESS_REQUEST_TIMEOUT),
      Effect.filterOrFail(
        (response) => response.status === 200,
        () => new Error("Health check failed"),
      ),
    );
  });

const startHealthMonitoring = (
  config: DesktopBackendStartConfig,
  processRef: Ref.Ref<Option.Option<ChildProcess.ChildProcess>>,
) =>
  Effect.gen(function* () {
    const failureCountRef = yield* Ref.make(0);
    yield* Effect.repeat(
      Effect.gen(function* () {
        const result = yield* Effect.either(performHealthCheck(config));
        yield* Effect.match(result, {
          onLeft: () =>
            Effect.gen(function* () {
              const count = yield* Ref.updateAndGet(failureCountRef, (c) => c + 1);
              if (count >= HEALTH_CHECK_FAILURE_THRESHOLD) {
                yield* restartBackendProcess(config, processRef);
                yield* Ref.set(failureCountRef, 0);
              }
            }),
          onRight: () => Ref.set(failureCountRef, 0),
        });
      }),
      Schedule.spaced(HEALTH_CHECK_INTERVAL),
    );
  }).pipe(Effect.forkScoped);

const restartBackendProcess = (
  config: DesktopBackendStartConfig,
  processRef: Ref.Ref<Option.Option<ChildProcess.ChildProcess>>,
) =>
  Effect.gen(function* () {
    const process = yield* Ref.get(processRef);
    yield* Option.match(process, {
      onNone: () => Effect.void,
      onSome: (proc) =>
        Effect.gen(function* () {
          yield* proc.kill();
          yield* Effect.sleep(Duration.millis(500));
        }),
    });
    const newProcess = yield* startProcess(config);
    yield* Ref.set(processRef, Option.some(newProcess));
    yield* waitForReadiness(config);
    const observability = yield* DesktopObservability.DesktopObservability;
    yield* observability.info("Backend process restarted after health check failures");
  });

export const DesktopBackendManager = Context.GenericTag<{
  readonly start: (
    config: DesktopBackendStartConfig,
  ) => Effect.Effect<void, PlatformError.PlatformError, BackendProcessRunRequirements>;
}>("@t3tools/DesktopBackendManager");

export const DesktopBackendManagerLive = Layer.effect(
  DesktopBackendManager,
  Effect.gen(function* () {
    return {
      start: (config: DesktopBackendStartConfig) =>
        Effect.gen(function* () {
          const process = yield* startProcess(config);
          const processRef = yield* Ref.make(Option.some(process));
          yield* waitForReadiness(config);
          yield* startHealthMonitoring(config, processRef);
        }),
    };
  }),
);
