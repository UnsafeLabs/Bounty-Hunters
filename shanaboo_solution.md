Looking at the issue description, I need to add health monitoring and auto-restart functionality to the DesktopBackendManager. Based on the repository structure, I can see there's a `t3code/apps/desktop/src/backend/` directory, but I don't see the actual `DesktopBackendManager.ts` file in the provided file listing.

Let me infer the structure and create the necessary changes. Since the file isn't provided, I'll create a complete implementation that would fit into the T3 Code desktop application architecture.

```diff
--- /dev/null
+++ b/t3code/apps/desktop/src/backend/DesktopBackendManager.ts
@@ -0,0 +1,260 @@
+import * as NodeChildProcess from "@effect/platform-node/NodeChildProcess";
+import * as NodeHttp from "@effect/platform-node/NodeHttp";
+import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
+import * as NodeUrl from "@effect/platform-node/NodeUrl";
+import * as Effect from "effect/Effect";
+import * as Layer from "effect/Layer";
+import * as Schedule from "effect/Schedule";
+import * as Scope from "effect/Scope";
+import * as Stream from "effect/Stream";
+import * as Duration from "effect/Duration";
+import * as Logger from "effect/Logger";
+import * as Fiber from "effect/Fiber";
+import * as Exit from "effect/Exit";
+import * as Option from "effect/Option";
+import * as Context from "effect/Context";
+import * as Queue from "effect/Queue";
+import * as Deferred from "effect/Deferred";
+
+import * as DesktopDiagnostics from "../app/DesktopDiagnostics.ts";
+import * as DesktopNotifications from "../app/DesktopNotifications.ts";
+import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
+
+export interface DesktopBackendManager {
+  readonly start: Effect.Effect<void, Error, Scope.Scope>;
+  readonly stop: Effect.Effect<void, Error>;
+  readonly restart: Effect.Effect<void, Error>;
+  readonly isHealthy: Effect.Effect<boolean, Error>;
+}
+
+export const DesktopBackendManager = Context.GenericTag<DesktopBackendManager>("DesktopBackendManager");
+
+export interface BackendProcessState {
+  readonly process: NodeChildProcess.Process;
+  readonly baseUrl: URL;
+}
+
+interface HealthCheckState {
+  consecutiveFailures: number;
+  maxConsecutiveFailures: number;
+  restartAttempts: number;
+  maxRestartAttempts: number;
+}
+
+const make = Effect.gen(function* () {
+  const diagnostics = yield* DesktopDiagnostics.DesktopDiagnostics;
+  const notifications = yield* DesktopNotifications.DesktopNotifications;
+  const config = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
+  
+  let currentState: Option.Option<BackendProcessState> = Option.none();
+  let healthCheckFiber: Option.Option<Fiber.Fiber<never, Error>> = Option.none();
+  let healthState: HealthCheckState = {
+    consecutiveFailures: 0,
+    maxConsecutiveFailures: 3,
+    restartAttempts: 0,
+    maxRestartAttempts: 3
+  };
+
+  const log = (message: string, ...args: any[]) => 
+    diagnostics.logDebug(`[DesktopBackendManager] ${message}`, ...args);
+
+  const startBackend = Effect.gen(function* () {
+    log("Starting backend process");
+    
+    const resolvedConfig = yield* config.resolve;
+    const process = yield* NodeChildProcess.spawn(resolvedConfig);
+    
+    // Wait for process to be ready
+    yield* waitForReadiness(process, resolvedConfig.httpBaseUrl);
+    
+    currentState = Option.some({ process, baseUrl: resolvedConfig.httpBaseUrl });
+    log("Backend process started successfully");
+    
+    return { process, baseUrl: resolvedConfig.httpBaseUrl };
+  });
+
+  const waitForReadiness = (process: NodeChildProcess.Process, baseUrl: URL) => 
+    Effect.gen(function* () {
+      log("Waiting for backend readiness", { url: baseUrl.toString() });
+      
+      const client = yield* NodeHttpClient.client;
+      const healthUrl = new URL("/health", baseUrl);
+      
+      return yield* Effect.retry(
+        NodeHttpClient.get(healthUrl, client, {
+          accept: "application/json"
+        }).pipe(
+          Effect.tap(() => log("Backend is ready")),
+          Effect.catchAll(() => Effect.fail(new Error("Backend not ready")))
+        ),
+        Schedule.exponential("100 millis").pipe(
+          Schedule.andThen(Schedule.spaced("1 second")),
+          Schedule.compose(Schedule.recurs(30)) // ~30 seconds timeout
+        )
+      );
+    });
+
+  const healthCheck = Effect.gen(function* () {
+    const state = Option.getOrElse(currentState, () => {
+      return Effect.die("Backend not started");
+    });
+    
+    const client = yield* NodeHttpClient.client;
+    const healthUrl = new URL("/health", state.baseUrl);
+    
+    return yield* NodeHttpClient.get(healthUrl, client, {
+      accept: "application/json"
+    }).pipe(
+      Effect.as(true),
+      Effect.catchAll(() => Effect.succeed(false))
+    );
+  });
+
+  const startHealthMonitoring = Effect.gen(function* (yield*_) {
+    log("Starting health monitoring");
+    
+    const healthSchedule = Schedule.spaced("15 seconds").pipe(
+      Schedule.jittered() // Add jitter to avoid thundering herd
+    );
+    
+    const healthCheckEffect = Effect.schedule(Effect.gen(function* () {
+      log("Performing health check");
+      
+      const isHealthy = yield* healthCheck;
+      
+      if (isHealthy) {
+        healthState.consecutiveFailures = 0;
+        log("Health check passed");
+      } else {
+        healthState.consecutiveFailures++;
+        log(`Health check failed (${healthState.consecutiveFailures}/${healthState.maxConsecutiveFailures})`);
+        
+        if (healthState.consecutiveFailures >= healthState.maxConsecutiveFailures) {
+          log("Too many consecutive failures, attempting restart");
+          yield* restartBackend();
+        }
+      }
+    }), healthSchedule);
+    
+    // Run health checks indefinitely
+    const fiber = yield* Effect.forkDaemon(healthCheckEffect);
+    healthCheckFiber = Option.some(fiber);
+    
+    return fiber;
+  });
+
+  const stopHealthMonitoring = Effect.gen(function* () {
+    log("Stopping health monitoring");
+    
+    const fiber = healthCheckFiber;
+    if (Option.isSome(fiber)) {
+      yield* Fiber.interrupt(fiber.value);
+      healthCheckFiber = Option.none();
+    }
+  });
+
+  const restartBackend =