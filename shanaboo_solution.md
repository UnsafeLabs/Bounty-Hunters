```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,3 +1,4 @@
+import { createBrotliCompress, createGzip, createBrotliDecompress, createGunzip } from "node:zlib";
 import Mime from "@effect/platform-node/Mime";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
@@ -5,6 +6,7 @@ import * as Effect from "effect/Effect";
 import * as FileSystem from "effect/FileSystem";
 import * as Option from "effect/Option";
 import * as Path from "effect/Path";
+import { pipe } from "effect/Function";
 import { cast } from "effect/Function";
 import {
   HttpBody,
@@ -12,6 +14,8 @@ import {
   HttpClientResponse,
   HttpRouter,
   HttpServerResponse,
+  HttpServerRequest,
+  HttpMiddleware,
 } from "effect/unstable/http";
 import { OtlpTracer } from "effect/unstable/observability";
 
@@ -31,6 +35,7 @@ import {
   browserApiCorsAllowedMethods,
   browserApiCorsHeaders,
 } from "./httpCors.ts";
+import { ServerConfig } from "./config.ts";
 
 const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
 const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0 2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
@@ -39,6 +44,14 @@ const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
 
+const COMPRESSION_MIN_SIZE = 1024; // 1KB
+const COMPRESSIBLE_CONTENT_TYPES = new Set([
+  "text/",
+  "application/json",
+  "application/javascript",
+  "application/xml",
+  "application/xhtml+xml",
+  "image/svg+xml",
+]);
+
 export const browserApiCorsLayer = HttpRouter.cors({
   allowedMethods: [...browserApiCorsAllowedMethods],
   allowedHeaders: [...browserApiCorsAllowedHeaders],
@@ -59,6 +72,152 @@ export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
   return redirectUrl.toString();
 }
 
+function getCompressionLevel(): Effect.Effect<number, never, ServerConfig> {
+  return Effect.gen(function* () {
+    const config = yield* ServerConfig;
+    const envLevel = config.compressionLevel;
+    if (envLevel !== undefined) {
+      const parsed = Number(envLevel);
+      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 11) {
+        return parsed;
+      }
+    }
+    return 6; // default brotli quality
+  });
+}
+
+function shouldCompress(contentType: string | null, contentLength: number): boolean {
+  if (contentLength < COMPRESSION_MIN_SIZE) return false;
+  if (!contentType) return true;
+  const lower = contentType.toLowerCase();
+  // Skip already-compressed content types
+  if (
+    lower.startsWith("image/") && !lower.startsWith("image/svg+xml") ||
+    lower.startsWith("video/") ||
+    lower.startsWith("audio/") ||
+    lower.includes("zip") ||
+    lower.includes("compress") ||
+    lower.includes("gzip") ||
+    lower.includes("brotli") ||
+    lower.includes("rar") ||
+    lower.includes("7z") ||
+    lower.includes("tar") ||
+    lower.includes("archive")
+  ) {
+    return false;
+  }
+  for (const prefix of COMPRESSIBLE_CONTENT_TYPES) {
+    if (lower.startsWith(prefix)) return true;
+  }
+  return false;
+}
+
+function parseAcceptEncoding(header: string | null): { brotli: boolean; gzip: boolean } {
+  if (!header) return { brotli: false, gzip: false };
+  const encodings = header.toLowerCase().split(",").map(s => s.trim().split(";")[0]);
+  return {
+    brotli: encodings.includes("br"),
+    gzip: encodings.includes("gzip") || encodings.includes("x-gzip"),
+  };
+}
+
+function compressBody(
+  body: Uint8Array,
+  encoding: "br" | "gzip",
+  level: number,
+): Effect.Effect<Uint8Array, never, never> {
+  return Effect.async((resume) => {
+    const chunks: Uint8Array[] = [];
+    const stream = encoding === "br"
+      ? createBrotliCompress({
+          params: {
+            [require("node:zlib").constants.BROTLI_PARAM_QUALITY]: level,
+          },
+        })
+      : createGzip({ level });
+
+    stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
+    stream.on("end", () => {
+      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
+      const result = new Uint8Array(totalLength);
+      let offset = 0;
+      for (const chunk of chunks) {
+        result.set(chunk, offset);
+        offset += chunk.length;
+      }
+      resume(Effect.succeed(result));
+    });
+    stream.on("error", (err) => {
+      // Fallback to uncompressed on error
+      resume(Effect.succeed(body));
+    });
+    stream.end(body);
+  });
+}
+
+function decompressBody(
+  body: Uint8Array,
+  encoding: string,
+): Effect.Effect<Uint8Array, never, never> {
+  return Effect.async((resume) => {
+    const