Looking at the issue, I need to add a Prometheus metrics endpoint to the HTTP server. Let me analyze what's needed:

1. Add a `/metrics` endpoint that returns Prometheus format metrics
2. Track specific metrics using Effect.Metric
3. Add optional auth check configurable via environment variable
4. Include the required metrics: active_sessions, rpc_requests_total, rpc_duration_seconds, git_operations_total, memory_usage_bytes

Let me check the file structure and implement the solution:

```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,13 +1,18 @@
 import Mime from "@effect/platform-node/Mime";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
+import * as Metric from "effect/Metric";
+import * as MetricState from "effect/MetricState";
 import * as Data from "effect/Data";
 import * as Effect from "effect/Effect";
 import * as FileSystem from "effect/FileSystem";
 import * as Option from "effect/Option";
 import * as Path from "effect/Path";
 import { cast } from "effect/Function";
+import * as Schedule from "effect/Schedule";
 import {
   HttpBody,
   HttpClient,
@@ -16,11 +21,15 @@ import {
   HttpServerResponse,
   HttpServerRequest,
 } from "effect/unstable/http";
+import { HttpMiddleware } from "effect/unstable/http";
 import { OtlpTracer } from "effect/unstable/observability";
 
 import {
   ATTACHMENTS_ROUTE_PREFIX,
   normalizeAttachmentRelativePath,
   resolveAttachmentRelativePath,
 } from "./attachmentPaths.ts";
@@ -32,6 +41,13 @@ import {
 import { resolveStaticDir, ServerConfig } from "./config.ts";
 import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
 import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
+import { ServerAuth } from "./auth/Services/ServerAuth.ts";
+import { respondToAuthError } from "./auth/http.ts";
 import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
 import {
   browserApiCorsAllowedHeaders,
@@ -44,6 +56,55 @@ import {
   browserApiCorsHeaders,
 } from "./httpCors.ts";
 
+// Metrics definitions
+export const activeSessionsGauge = Metric.gauge("active_sessions");
+export const rpcRequestsTotalCounter = Metric.counter("rpc_requests_total", {
+  description: "Total number of RPC requests",
+});
+export const rpcDurationHistogram = Metric.histogram("rpc_duration_seconds", {
+  description: "RPC request duration in seconds",
+  boundaries: Metric.Histogram.boundaries.exponential({
+    start: 0.005,
+    factor: 2,
+    count: 10,
+  }),
+});
+export const gitOperationsTotalCounter = Metric.counter("git_operations_total", {
+  description: "Total number of git operations",
+});
+export const memoryUsageBytesGauge = Metric.gauge("memory_usage_bytes");
+
+// Update memory usage periodically
+const updateMemoryUsage = Effect.gen(function* () {
+  const memoryUsage = process.memoryUsage();
+  const totalMemory = memoryUsage.rss;
+  yield* memoryUsageBytesGauge.set(totalMemory);
+});
+
+// Memory usage updater
+const memoryUsageUpdater = updateMemoryUsage.pipe(
+  Effect.repeat(Schedule.spaced(5000)), // Update every 5 seconds
+  Effect.forkDaemon,
+);
+
+// Metrics authorization middleware
+const metricsAuthMiddleware = HttpMiddleware.make((app) => {
+  if (process.env.METRICS_AUTH_DISABLED === "true") {
+    return app;
+  }
+  
+  return Effect.gen(function* () {
+    const request = yield* HttpServerRequest.HttpServerRequest;
+    const serverAuth = yield* ServerAuth;
+    yield* serverAuth.authenticateHttpRequest(request);
+    return yield* app;
+  }).pipe(Effect.catchTags({
+    ServerAuthError: (error) => respondToAuthError(error),
+  }));
+});
+
 const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
 const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www600" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
 const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
@@ -51,6 +112,7 @@ const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
 const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
 
 export const browserApiCorsLayer = HttpRouter.cors({
+  
   allowedMethods: [...browserApiCorsAllowedMethods],
   allowedHeaders: [...browserApiCorsAllowedHeaders],
   maxAge: 600,
@@ -104,6 +166,59 @@ export const otlpTracesProxyRouteLayer = HttpRouter.add(
   "POST",
   OTLP_TRACES_PROXY_PATH,
   Effect.gen(function* () {
+    yield* requireAuthenticatedRequest;
+    const request = yield* HttpServerRequest.HttpServerRequest;
+    const config = yield* ServerConfig;
+    const otlpTracesUrl = config.otlpTracesUrl;
+    const browserTraceCollector = yield* BrowserTraceCollector;
+    const httpClient = yield* HttpClient.HttpClient;
+    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
+
+    yield* Effect.try({
+      try: () => decodeOtlpTraceRecords(bodyJson),
+      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
+    }).pipe(
+      Effect.flatMap((spans) =>
+        Effect.forEach(spans, (span) => browserTraceCollector.collect(span)),
+      ),
+    );
+
+    if (Option.isSome(otlpTracesUrl)) {
+      const proxyResponse = yield* httpClient
+        .post(otlpTracesUrl.value, {
+        body: HttpBody.unsafeJson(bodyJson),
+      })
+        .pipe(HttpClientResponse.schemaBodyJsonUnknown);
+      return HttpServerResponse.jsonUnsafe(proxyResponse,