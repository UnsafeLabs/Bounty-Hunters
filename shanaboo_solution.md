Looking at the issue requirements, I need to add a Prometheus metrics endpoint to the server. Let me analyze what's needed:

1. Create a `/metrics` HTTP endpoint that returns Prometheus-compatible metrics
2. Track specific metrics: active_sessions, rpc_requests_total, rpc_duration_seconds, git_operations_total, memory_usage_bytes
3. Use Effect.Metric for metric registration and collection
4. Add optional auth check configurable via environment variable
5. Ensure the endpoint doesn't affect performance

Let me implement this solution:

```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,44 +1,45 @@
-import Mime from "@effect/platform-node/Mime";
-import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
+import Mime from "@effect/platform-node/Mime";
+import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
 import * as Effect from "effect/Effect";
 import * as FileSystem from "effect/FileSystem";
 import * as Option from "effect/Option";
 import * as Path from "effect/Path";
 import { cast } from "effect/Function";
-import {
-  HttpBody,
-  HttpClient,
-  HttpClientResponse,
-  HttpRouter,
-  HttpServerResponse,
-  HttpServerRequest,
-} from "effect/unstable/http";
+import { HttpBody, HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http";
 import { OtlpTracer } from "effect/unstable/observability";
-
-import {
-  ATTACHMENTS_ROUTE_PREFIX,
-  normalizeAttachmentRelativePath,
-  resolveAttachmentRelativePath,
-} from "./attachmentPaths.ts";
+import { HttpRouter as HttpRouterType } from "effect/unstable/http";
+
+import { ATTACHMENTS_ROUTE_PREFIX, normalizeAttachmentRelativePath, resolveAttachmentRelativePath } from "./attachmentPaths.ts";
 import { resolveAttachmentPathById } from "./attachmentStore.ts";
 import { resolveStaticDir, ServerConfig } from "./config.ts";
 import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
-import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
-import { ServerAuth } from "./auth/Services/ServerAuth.ts";
-import { respondToAuthError } from "./auth/http.ts";
-import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
+import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
+import { ServerAuth } from "./auth/Services/ServerAuth.ts";
+import { respondToAuthError } from "./auth/http.ts";
+import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
+
+// Add metrics imports
+import { Metric } from "effect/Metric";
+import { MetricListeners } from "effect/Metric/meter";
+import { Duration } from "effect/Duration";
+
+// Import for metrics
 import {
   browserApiCorsAllowedHeaders,
   browserApiCorsAllowedMethods,
   browserApiCorsHeaders,
 } from "./httpCors.ts";
+import { MetricKey, MetricState } from "effect";
+
+// Add metrics endpoint constants
+const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
+const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
+const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
+const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
 
-export const browserApiCorsLayer = HttpRouter.cors({
-  allowedMethods: [...browserApiCorsAllowedMethods],
-  allowedHeaders: [...browserApiCorsAllowedHeaders],
-  maxAge: 600,
-});
+export const browserApiCorsLayer = HttpRouter.cors({
+  allowedMethods: [...browserApiCorsAllowedMethods],
+  allowedHeaders: [...browserApiCorsAllowedHeaders],
+  maxAge: 600,
+});
 
-export class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
-  readonly cause: unknown;
-  readonly bodyJson: OtlpTracer.TraceData;
+export class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
+  readonly cause: unknown;
+  readonly bodyJson: OtlpTracer.TraceData;
 }>;
 
-export const otlpTracesProxyRouteLayer = HttpRouter.add(
-  "POST",
-  OTLP_TRACES_PROXY_PATH,
-  Effect.gen(function* () {
-    yield* requireAuthenticatedRequest;
-    const request = yield* HttpServerRequest.HttpServerRequest;
-    const config = yield* ServerConfig;
-    const otlpTracesUrl = config.otlpTracesUrl;
-    const browserTraceCollector = yield* BrowserTraceCollector;
-    const httpClient = yield* HttpClient.HttpClient;
-    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
-
-    yield* Effect.try({
-      try: () => decodeOtlpTraceRecords(bodyJson),
-      catch: (cause) => new DecodeOtlpTraceRecordsError({
+export const metricsEndpointRouteLayer = HttpRouter.add(
+  "GET",
+  "/metrics",
+  Effect.gen(function* () {
+    // Check if auth is disabled via environment variable
+    const authDisabled = process.env.METRICS_AUTH_DISABLED === "true";
+    
+    if (!authDisabled) {
+      const authEffect = yield* HttpServerRequest.HttpServerRequest;
+      yield* requireAuthenticatedRequest;
+    }
+    
+    // Collect and format metrics
+    const metrics = yield* Metric.snapshot;
+    const text = yield* metrics.text;
+    return HttpServerResponse.html(text);
+  }),
+);
+const otlpTracesProxyPath = "/api/observability/v1/traces";
+const loopbackHostnames = new Set(["127.0.0.1", "::1", "localhost"]);
+
+export const otlpTracesProxyRouteLayer