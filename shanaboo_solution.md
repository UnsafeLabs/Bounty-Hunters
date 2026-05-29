Looking at the issue, I need to add request body size limiting to the HTTP server in `t3code/apps/server/src/http.ts`. The solution should:

1. Add a configurable request body size limit (10MB default, 50MB for file uploads)
2. Return 413 Payload Too Large when limits are exceeded
3. Support per-route overrides
4. Include limit and received size in error responses
5. Add X-Max-Body-Size header on 413 errors

Let me examine the file and implement the solution:

```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,3 +1,4 @@
+import { IncomingMessage } from "node:http";
 import Mime from "@effect/platform-node/Mime";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
@@ -12,6 +13,7 @@ import {
   HttpClient,
   HttpClientResponse,
   HttpRouter,
+  HttpServerRequest,
   HttpServerResponse,
   HttpServerRequest,
 } from "effect/unstable/http";
@@ -33,6 +35,90 @@ const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
 const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
 const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
 const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
+const DEFAULT_BODY_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB
+const FILE_UPLOAD_BODY_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
+
+// Route-specific body size limits
+const ROUTE_BODY_SIZE_LIMITS: Record<string, number> = {
+  // File upload routes get higher limits
+  [ATTACHMENTS_ROUTE_PREFIX]: FILE_UPLOAD_BODY_SIZE_LIMIT,
+  "/api/observability/v1/traces": FILE_UPLOAD_BODY_SIZE_LIMIT,
+};
+
+class RequestBodyTooLargeError extends Data.TaggedError("RequestBodyTooLargeError")<{
+  readonly limit: number;
+  readonly contentLength: number;
+}> {}
+
+function getBodySizeLimit(path: string): number {
+  // Check for route-specific overrides
+  for (const [routePrefix, limit] of Object.entries(ROUTE_BODY_SIZE_LIMITS)) {
+    if (path.startsWith(routePrefix)) {
+      return limit;
+    }
+  }
+  // Default limit
+  return DEFAULT_BODY_SIZE_LIMIT;
+}
+
+function createBodySizeLimitMiddleware() {
+  return HttpServerRequest.middleware((request, next) => {
+    return Effect.gen(function* () {
+      const limit = getBodySizeLimit(request.url);
+      
+      // Check Content-Length header if present
+      const contentLengthHeader = request.headers["content-length"];
+      if (contentLengthHeader) {
+        const contentLength = parseInt(contentLengthHeader, 10);
+        if (!isNaN(contentLength) && contentLength > limit) {
+          return yield* Effect.fail(
+            new RequestBodyTooLargeError({
+              limit,
+              contentLength,
+            })
+          );
+        }
+      }
+      
+      // For streaming validation, we need to check the actual stream
+      // This requires access to the underlying Node.js request object
+      const nodeRequest = (request as any).source as IncomingMessage | undefined;
+      if (nodeRequest) {
+        let receivedBytes = 0;
+        const originalEmit = nodeRequest.emit;
+        
+        nodeRequest.emit = function(event: string, ...args: any[]) {
+          if (event === 'data') {
+            const chunk = args[0];
+            if (chunk) {
+              receivedBytes += chunk.length || chunk.byteLength || 0;
+              if (receivedBytes > limit) {
+                // Stop processing and return error
+                return nodeRequest.emit('error', new Error('Request body too large'));
+              }
+            }
+          }
+          return originalEmit.call(this, event, ...args);
+        };
+      }
+      
+      return yield* next(request);
+    }).pipe(
+      Effect.catchTag("RequestBodyTooLargeError", (error) =>
+        HttpServerResponse.empty({
+          status: 413,
+          headers: {
+            ...browserApiCorsHeaders,
+            "X-Max-Body-Size": error.limit.toString(),
+          },
+        }).pipe(
+          Effect.map(response => {
+            // Add error details to response body
+            const errorBody = {
+              error: "Payload Too Large",
+              message: `Request body exceeds ${error.limit} bytes limit`,
+              limit: error.limit,
+              contentLength: error.contentLength,
+            };
+            return HttpServerResponse.jsonUnsafe(errorBody, {
+              status: 413,
+              headers: {
+                ...browserApiCorsHeaders,
+                "X-Max-Body-Size": error.limit.toString(),
+              },
+            });
+          })
+        )
+      )
+    );
+  });
+}
 
 export const browserApiCorsLayer = HttpRouter.cors({
   allowedMethods: [...browserApiCorsAllowedMethods],
@@ -40,6 +126,10 @@ export const browserApiCorsLayer = HttpRouter.cors({
 });
 
 export function isLoopbackHostname(hostname: string): boolean {
+  // Apply body size limiting middleware
+  HttpServerRequest.HttpServerRequest = HttpServerRequest.HttpServerRequest.pipe(
+    Effect.tap(() => createBodySizeLimitMiddleware())
+  );
   const normalizedHostname = hostname
     .trim()
     .toLowerCase()
@@ -144,6 +234,15 @@ export const otlpTracesProxyRouteLayer = HttpRouter.add(
     const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);
 
     yield* Effect.try({
+      try: ()