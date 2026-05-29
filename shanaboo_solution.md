```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,4 +1,5 @@
 import Mime from "@effect/platform-node/Mime";
+import { Readable } from "node:stream";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
 import * as Effect from "effect/Effect";
@@ -6,6 +7,7 @@
 import * as Option from "effect/Option";
 import * as Path from "effect/Path";
 import { cast } from "effect/Function";
+import { pipe } from "effect/Function";
 import {
   HttpBody,
   HttpClient,
@@ -13,6 +15,7 @@
   HttpRouter,
   HttpServerResponse,
   HttpServerRequest,
+  HttpServerError,
 } from "effect/unstable/http";
 import { OtlpTracer } from "effect/unstable/observability";
 
@@ -39,6 +42,9 @@
 const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
 const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
 
+const DEFAULT_BODY_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB
+const FILE_UPLOAD_BODY_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
+
 export const browserApiCorsLayer = HttpRouter.cors({
   allowedMethods: [...browserApiCorsAllowedMethods],
   allowedHeaders: [...browserApiCorsAllowedHeaders],
@@ -63,6 +69,86 @@
   yield* serverAuth.authenticateHttpRequest(request);
 });
 
+export interface BodySizeLimitConfig {
+  readonly limit: number;
+}
+
+export const defaultBodySizeLimit: BodySizeLimitConfig = {
+  limit: DEFAULT_BODY_SIZE_LIMIT,
+};
+
+export const fileUploadBodySizeLimit: BodySizeLimitConfig = {
+  limit: FILE_UPLOAD_BODY_SIZE_LIMIT,
+};
+
+class PayloadTooLargeError extends Data.TaggedError("PayloadTooLargeError")<{
+  readonly limit: number;
+  readonly received: number;
+}> {}
+
+function parseContentLength(headers: Headers): number {
+  const contentLength = headers.get("content-length");
+  if (contentLength === null) return 0;
+  const parsed = parseInt(contentLength, 10);
+  return isNaN(parsed) ? 0 : parsed;
+}
+
+export function checkBodySize(
+  config: BodySizeLimitConfig
+): Effect.Effect<void, PayloadTooLargeError, HttpServerRequest.HttpServerRequest> {
+  return Effect.gen(function* () {
+    const request = yield* HttpServerRequest.HttpServerRequest;
+    const contentLength = parseContentLength(request.headers);
+    
+    if (contentLength > config.limit) {
+      return yield* new PayloadTooLargeError({
+        limit: config.limit,
+        received: contentLength,
+      });
+    }
+  });
+}
+
+export function withBodySizeLimit<R, E, A>(
+  config: BodySizeLimitConfig,
+  handler: Effect.Effect<A, E, R>
+): Effect.Effect<A, E | PayloadTooLargeError, R | HttpServerRequest.HttpServerRequest> {
+  return Effect.gen(function* () {
+    yield* checkBodySize(config);
+    return yield* handler;
+  });
+}
+
+export function handlePayloadTooLarge(
+  error: PayloadTooLargeError
+): HttpServerResponse.HttpServerResponse {
+  return HttpServerResponse.json(
+    {
+      error: "Payload Too Large",
+      limit: error.limit,
+      received: error.received,
+    },
+    {
+      status: 413,
+      headers: {
+        "X-Max-Body-Size": String(error.limit),
+      },
+    }
+  );
+}
+
+export function bodySizeLimitMiddleware(
+  config: BodySizeLimitConfig
+): <R, E, A>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | PayloadTooLargeError, R> {
+  return <R, E, A>(effect: Effect.Effect<A, E, R>) =>
+    Effect.gen(function* () {
+      yield* checkBodySize(config);
+      return yield* effect;
+    });
+}
+
 export const serverEnvironmentRouteLayer = HttpRouter.add(
   "GET",
   "/.well-known/t3/environment",
@@ -88,6 +174,7 @@
   OTLP_TRACES_PROXY_PATH,
   Effect.gen(function* () {
     yield* requireAuthenticatedRequest;
+    yield* checkBodySize(defaultBodySizeLimit);
     const request = yield* HttpServerRequest.HttpServerRequest;
     const config = yield* ServerConfig;
     const otlpTracesUrl = config.otlpTracesUrl;
@@ -123,6 +210,7 @@
   "/api/observability/v1/logs",
   Effect.gen(function* () {
     yield* requireAuthenticatedRequest;
+    yield* checkBodySize(defaultBodySizeLimit);
     const request = yield* HttpServerRequest.HttpServerRequest;
     const config = yield* ServerConfig;
     const otlpLogsUrl = config.otlpLogsUrl;
@@ -162,6 +250,7 @@
   "/api/observability/v1/metrics",
   Effect.gen(function* () {
     yield* requireAuthenticatedRequest;
+    yield* checkBodySize(defaultBodySizeLimit);
     const request = yield* HttpServerRequest.HttpServerRequest;
     const config = yield* ServerConfig;
     const otlpMetricsUrl = config.otlpMetricsUrl;
@@ -200,6 +289,7 @@
   "/api/observability/v1/profiles",
   Effect.gen(function* () {
     yield* requireAuthenticatedRequest;
+    yield* checkBodySize(defaultBodySizeLimit);
     const request = yield* HttpServerRequest.HttpServerRequest;
     const config = yield* ServerConfig;
     const otlpProfilesUrl = config.otlpProfilesUrl;
@@ -237,6 +327,7 @@
   "/api/observability/v1/dependencies",
   Effect.gen(function* () {
     yield* requireAuthenticatedRequest;
+    yield* checkBodySize(defaultBodySizeLimit);
     const request = yield* HttpServerRequest.HttpServerRequest;
     const config = yield* ServerConfig;
     const otlpDependenciesUrl = config.otlpDependenciesUrl;
@@ -274,6 +365,7 @@
   "/api/observability/v1/exceptions",
   Effect.gen(function* () {
     yield* requireAuthenticatedRequest;
+    yield* checkBodySize(defaultBodySizeLimit);
     const request = yield* HttpServerRequest.HttpServerRequest;
     const config = yield* ServerConfig;
     const otlpExceptionsUrl = config.otlpExceptionsUrl;
@@