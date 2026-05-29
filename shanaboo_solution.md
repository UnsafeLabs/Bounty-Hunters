```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,4 +1,4 @@
-import Mime from "@effect/platform-node/Mime";
+import Mime from "@effect/platform-node/Mime";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
 import * as Effect from "effect/Effect";
@@ -13,4 +13,4 @@ import {
 import { resolveStaticDir, ServerConfig } from "./config.ts";
 import { BrowserTraceCollector end
 import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
-import { respondToAuthError } from "./auth/http.ts";
+import { respondToAuthError } from "./auth/http.ts";
 
@@ -21,4 +21,22 @@ import { respondToAuthError } from "./auth/http.ts";
 
 const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
+
+// Request size limits
+const DEFAULT_BODY_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB
+const FILE_UPLOAD_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
+
+// Middleware to limit request body size
+const withBodySizeLimit = (limit: number) => HttpServerRequest.withMiddleware(
+  HttpServerRequest.HttpServerRequest,
+  (req) => {
+    const contentLength = req.headers.get("content-length");
+    if (contentLength && parseInt(contentLength) > limit) {
+      return HttpServerResponse.empty({
+        status: 413,
+        headers: {
+          "X-Max-Body-Size": limit.toString(),
+        }
+      });
+    }
+    return req;
+  }
+);
+
 const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
@@ -28,4 +46,4 @@ const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
 
 export const browserApiCorsLayer = HttpRouter.cors({
-  allowedMethods: [...browserApiCorsAllowedMethods],
-  allowedHeaders: [...browserApiCorsAllowedHeaders],
-  maxAge: 600,
-});
+  allowedMethods: [...browserApiCorsAllowedMethods],
+  allowedHeaders: [...browserApiCorsAllowedHeaders],
+  maxAge: 600,
+});
 
@@ -33,4 +51,12 @@ export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
   return redirectUrl.toString();
 }
 
+// Add body size limiting middleware
+const withBodySizeLimit = (limit: number) => {
+  return (req: HttpServerRequest.HttpServerRequest) => {
+    const contentLength = req.headers.get("content-length");
+    if (contentLength && parseInt(contentLength) > limit) {
+      return HttpServerResponse.empty({ status: 413, headers: { "X-Max-Body-Size": limit.toString() } });
+    }
+    return req;
+  };
+};
+
 const requireAuthenticatedRequest = Effect.gen(function* () {
   const request = yield* HttpServerRequest.HttpServerRequest;
@@ -40,4 +68,4 @@ const requireAuthenticatedRequest = Effect.gen(function* () {
     yield* serverAuth.authenticateHttpRequest(request);
   });
-}
+}
 
 class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
   readonly cause: unknown;
@@ -48,2 +76,2 @@ class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecor
 export const otlpTracesProxyRouteLayer = HttpRouter.add(
-  "POST",
-  OTLP_TRACES_PROXY_PATH,
+  "POST",
+  OTLP_TRACES_PROXY_PATH,
   Effect.gen(function* () {
@@ -51,3 +79,3 @@ class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecor
 export const otlpTracesProxyRouteLayer = HttpRouter.add(
-  "POST",
-  OTLP_TRACES_PROXY_PATH,
+  "POST",
+  OTLP_TRACES_PROXY_PATH,
   Effect.gen(function* () {
@@ -55,2 +83,2 @@ export const otlpTracesProxyRouteLayer = HttpRouter.add(
   const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
-    yield* Effect.try({
-      try: () => decodeOtlpTraceRecords(bodyJson),
+    const maxSizeLimit = withBodySizeLimit(DEFAULT_BODY_SIZE_LIMIT);
+    yield* Effect.try({
+      try: () => decodeOtlpTraceRecords(bodyJson),
       catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson })
@@ -58,2 +86,2 @@ export const otlpTracesProxyRouteLayer = HttpRouter.add(
   const browserTraceCollector = yield* BrowserTraceCollector;
-  const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
+  const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
 
@@ -60,3 +88,3 @@ export const otlpTracesProxyRouteLayer = HttpRouter.add(
   const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
-    yield* Effect.try({
-      try: () => decodeOtlpTraceRecords(bodyJson),
-      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson })
+    const maxSizeLimit = withBodySizeLimit(DEFAULT_BODY_SIZE_LIMIT);
+    yield* Effect.try({
+      try: () => decodeOtlpTraceRecords(bodyJson),
+      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson })
     })
@@ -64,3 +9