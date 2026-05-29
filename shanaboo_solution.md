```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,3 +1,5 @@
+import { createMiddleware } from "effect/HttpApp";
+import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse, HttpMiddleware, HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http";
 import Mime from "@effect/platform-node/Mime";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
@@ -9,6 +11,8 @@ import * as Option from "effect/Option";
 import * as Path from "effect/Path";
 import { cast } from "effect/Function";
 import {
+  HttpBody,
+  HttpClient,
   HttpClientResponse,
   HttpRouter,
   HttpServerResponse,
@@ -16,6 +20,7 @@ import {
 } from "effect/unstable/http";
 import { OtlpTracer } from "effect/unstable/observability";
 
+// ... existing code ...
 
 import {
   ATTACHMENTS_ROUTE_PREFIX,
@@ -33,6 +39,137 @@ import {
 } from "./attachmentPaths.ts";
 import { resolveAttachmentPathById } from "./attachmentStore.ts";
 import { resolveStaticDir, ServerConfig } from "./config.ts";
+import { createHttpBodySizeLimiter } from "./httpMiddleware.ts";
+
+export const browserApiCorsLayer = HttpRouter.cors({
+  allowedMethods: [...browserApiCorsAllowedMethods],
+  allowedHeaders: [...browserApiCorsAllowedHeaders],
+  maxAge: 600,
+});
+
+class RequireAuthenticatedRequestError extends Data.TaggedError("RequireAuthenticatedRequestError")<{
+  readonly cause: unknown;
+  readonly bodyJson: OtlpTracer.TraceData;
+}> {}
+
+export const serverEnvironmentRouteLayer = HttpRouter.add(
+  "GET",
+  "/.well-known/t3/environment",
+  Effect.gen(function* () {
+    const descriptor = yield* Effect.service(ServerEnvironment).pipe(
+      Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
+    );
+    return HttpServerResponse.jsonUnsafe(descriptor, {
+      status: 200,
+      headers: browserApiCorsHeaders,
+    });
+  }),
+);
+
+export const otlpTracesProxyRouteLayer = HttpRouter.add(
+  "POST",
+  OTLP_TRACES_PROXY_PATH,
+  Effect.gen(function* () {
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
+    });
+
+    return HttpServerResponse.jsonUnsafe(bodyJson, {
+      status: 200,
+      headers: browserApiCorsHeaders,
+    });
+  }),
+);
+
+export const browserApiCorsLayer = HttpRouter.cors({
+  allowedMethods: [...browserApiCorsAllowedMethods],
+  allowedHeaders: [...browserApiCorsAllowedHeaders],
+  maxAge: 600,
+});
+
+export function isLoopbackHostname(hostname: string): boolean {
+  const normalizedHostname = hostname
+    .trim()
+    .toLowerCase()
+    .replace(/^\[(.*)\]$/, "$1");
+  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
+}
+
+export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
+  const redirectUrl = new URL(devUrl.toString());
+  redirectUrl.pathname = requestUrl.pathname;
+  redirectUrl.search = requestUrl.search;
+  redirectUrl.hash = requestUrl.hash;
+  return redirectUrl.toString();
+}
+
+const requireAuthenticatedRequest = Effect.gen(function* () {
+  const request = yield* HttpServerRequest.HttpServerRequest;
+  const serverAuth = yield* ServerAuth;
+  yield* serverAuth.authenticateHttpRequest(request);
+});
+
+export function serverEnvironmentRouteLayer = HttpRouter.add(
+  "GET",
+  "/.well-known/t3/environment",
+  Effect.gen(function* () {
+    const descriptor = yield* Effect.service(ServerEnvironment).pipe(
+      Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
+    );
+    return HttpServerResponse.jsonUnsafe(descriptor, {
+      status: 200,
+      headers: browserApiCorsHeaders,
+    });
+  }),
+);
+
+class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
+  readonly cause: unknown;
+  readonly bodyJson: OtlpTracer.TraceData;
+}> {}
+
+export const otlpTracesProxyRouteLayer = HttpRouter.add(
+  "POST",
+  OTLP_TRACES_PROXY_PATH,
+  Effect.gen(function* () {
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
+    });
+
+    return HttpServerResponse.jsonUnsafe(bodyJson, {
+      status: 200,
+      headers: browserApiCorsHeaders,
+    });
+  }),
+);
+
+export const browserApiCorsLayer = HttpRouter.cors({
+  allowedMethods: [...browserApiCorsAllowedMethods],
+  allowedHeaders: [...browserApiCorsAllowedHeaders],
+  maxAge: 600,
+});
+
+function isLoopbackHostname(hostname: string): boolean {
+  const normalizedHostname = hostname
+    .trim()
+    .toLowerCase()
+    .replace(/^\[(.*)\]$/, "$1");
+  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
+}
+
+function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
+  const redirectUrl = new URL(devUrl.toString());
+  redirectUrl.pathname = requestUrl.pathname;
+  redirectUrl.search = requestUrl.search;
+  redirectUrl.hash = request