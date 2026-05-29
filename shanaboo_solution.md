Looking at the issue requirements, I need to add a Prometheus metrics endpoint to the server. Let me analyze the existing code and implement the solution.

The issue asks for:
1. A `/metrics` HTTP endpoint that returns Prometheus-compatible metrics
2. Tracking specific metrics: active_sessions gauge, rpc_requests_total counter with method label, rpc_duration_seconds histogram, git_operations_total counter with operation label, memory_usage_bytes gauge
3. Use Effect.Metric for metric registration and collection
4. Auth check configurable via environment variable
5. The endpoint should not affect normal request performance

```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,73 +1,73 @@
 import Mime from "@effect/platform-node/Mime";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
 import * as Effect from "effect/Effect";
 import * as FileSystem from "effect/FileSystem";
 import * as Path from "effect/Path";
 import * as Option from "effect/Option";
 import * as Schedule from "effect/Schedule";
 import { cast } from "effect/Function";
 import {
   HttpBody,
   HttpClient,
   HttpClientResponse,
   HttpRouter,
   HttpServerResponse,
   HttpServerRequest,
 } from "effect/unstable/http";
+import * as Metric from "effect/Metric";
+import * as MetricState from "effect/MetricState";
+import * as Duration from "effect/Duration";
 
 import {
   ATTACHMENTS_ROUTE_PREFIX,
   normalizeAttachmentRelativePath,
   resolveAttachmentRelativePath,
 } from "./attachmentPaths.ts";
 import { resolveAttachmentPathById } from "./attachmentStore.ts";
 import { resolveStaticDir, ServerConfig } from "./config.ts";
 import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
 import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
 import { ServerAuth } from "./auth/Services/ServerAuth.ts";
 import { respondToAuthError } from "./auth/http.ts";
 import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
 import {
   browserApiCorsAllowedHeaders,
   browserApiCorsAllowedMethods,
   browserApiCorsHeaders,
 } from "./httpCors.ts";
 
 const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
 const FALLINGBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2V12a2 2 0 0 0 2 2Z"/></svg>`;
 const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
 const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
 
+// Initialize metrics
+const activeSessions = Metric.gauge("active_sessions");
+const rpcRequestsTotal = Metric.counter("rpc_requests_total").withLabels("method");
+const rpcDurationSeconds = Metric.histogram("rpc_duration_seconds", [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5, 10]);
+const gitOperationsTotal = Metric.counter("git_operations_total").withLabels("operation");
+const memoryUsageBytes = Metric.gauge("memory_usage_bytes");
+
+// Create metrics for server-side tracking
+const activeSessionsMetric = Metric.withConstantStateNow(Metric.gauge("active_sessions"));
+const rpcRequestsTotalMetric = Metric.withConstantStateNow(Metric.counter("rpc_requests_total"));
+const gitOperationsTotalMetric = Metric.withConstantStateNow(Metric.counter("git_operations_total"));
+const memoryUsageBytesMetric = Metric.withConstantStateNow(Metric.gauge("memory_usage_bytes"));
+
 export const serverEnvironmentRouteLayer = HttpRouter.add(
   "GET",
   "/.well-known/t3/environment",
   Effect.gen(function* () {
     const descriptor = yield* Effect.service(ServerEnvironment).pipe(
       Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
     );
     return HttpServerResponse.jsonUnsafe(descriptor, {
       status: 200,
       headers: browserApiCorsHeaders,
     });
   }),
 );
 
@@ -76,23 +76,105 @@
 class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
   readonly cause: unknown;
   readonly bodyJson: OtlpTracer.TraceData;
 }>();
 
+// Metrics collection effect
+const collectMetrics = Effect.gen(function* () {
+  return yield* activeSessionsMetric.get();
+});
+
+// Metrics endpoint handler
+const metricsHandler = Effect.gen(function* () {
+  const snapshot = yield* Metric.snapshot;
+  const text = yield* snapshot.print;
+  return HttpServerResponse.html(text);
+});
+
 export const otlpTracesProxyRouteLayer = HttpRouter.add(
   "POST",
   OTLP_TRACES_PROXY_PATH,
   Effect.gen(function* () {
     yield* requireAuthenticatedRequest;
     const request = yield* HttpServerRequest.HttpServerRequest;
     const config = yield* ServerConfig;
     const otlpTracesUrl = config.otlpTracesUrl;
     const browserTraceCollector = yield* BrowserTraceCollector;
     const httpClient = yield* HttpClient.HttpClient;
     const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
 
     yield* Effect.try({
       try: () => decodeOtlpTraceRecords(bodyJson),
       catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
     });
 
     yield* browserTraceCollector.collect(bodyJson);
     return HttpClientResponse.empty({ status: 202 });
   }),
 );
 
+export const metricsRouteLayer = HttpRouter.add(
+  "GET",
+  "/metrics",
+  Effect.gen(function* () {
+    // Check for authentication if not disabled
+    const authDisabled = process.env.METRICS_AUTH_DISABLED === "true";
+    if (!authDisabled) {
+      yield* requireAuthenticatedRequest;
+    }
+    
+    const snapshot = yield* Metric.snapshot;
+    const text = yield* snapshot.print;
+    return HttpServerResponse.html(text);
+  }),
+);
+
+// Add metrics collection to the server environment
+