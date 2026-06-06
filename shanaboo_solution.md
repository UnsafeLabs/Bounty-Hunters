 ```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,4 +1,5 @@
 import Mime from "@effect/platform-node/Mime";
+import zlib from "node:zlib";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
 import * as Effect from "effect/Effect";
@@ -12,6 +13,7 @@
   HttpClient,
   HttpClientResponse,
   HttpRouter,
+  HttpServer,
   HttpServerResponse,
   HttpServerRequest,
 } from "effect/unstable/http";
@@ -33,6 +35,7 @@
   browserApiCorsAllowedMethods,
   browserApiCorsHeaders,
 } from "./httpCors.ts";
+import { Readable } from "node:stream";
 
 const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
 const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
@@ -40,6 +43,148 @@
 const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
 
+// Compression configuration
+const COMPRESSION_MIN_SIZE = 1024; // 1KB
+const COMPRESSION_LEVEL_ENV = process.env.COMPRESSION_LEVEL;
+const DEFAULT_BROTLI_QUALITY = 4;
+const DEFAULT_GZIP_LEVEL = 6;
+
+const brotliQuality = COMPRESSION_LEVEL_ENV
+  ? parseInt(COMPRESSION_LEVEL_ENV, 10)
+  : DEFAULT_BROTLI_QUALITY;
+const gzipLevel = COMPRESSION_LEVEL_ENV
+  ? parseInt(COMPRESSION_LEVEL_ENV, 10)
+  : DEFAULT_GZIP_LEVEL;
+
+// Content types that should not be compressed
+const NON_COMPRESSIBLE_CONTENT_TYPES = [
+  "image/",
+  "video/",
+  "audio/",
+  "application/gzip",
+  "application/zip",
+  "application/x-zip",
+  "application/x-7z-compressed",
+  "application/x-rar-compressed",
+  "application/x-tar",
+  "application/x-bzip",
+  "application/x-bzip2",
+  "application/octet-stream",
+  "application/pdf",
+];
+
+function shouldCompress(contentType: string | undefined, bodySize: number): boolean {
+  if (bodySize < COMPRESSION_MIN_SIZE) return false;
+  if (!contentType) return true;
+  const lowerContentType = contentType.toLowerCase();
+  return !NON_COMPRESSIBLE_CONTENT_TYPES.some((type) =>
+    lowerContentType.startsWith(type.toLowerCase())
+  );
+}
+
+function getPreferredEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
+  if (!acceptEncoding) return null;
+  const encodings = acceptEncoding.toLowerCase().split(",").map((e) => e.trim());
+  const hasBrotli = encodings.some((e) => e.startsWith("br"));
+  const hasGzip = encodings.some((e) => e.startsWith("gzip"));
+  if (hasBrotli) return "br";
+  if (hasGzip) return "gzip";
+  return null;
+}
+
+function compressBuffer(
+  buffer: Buffer,
+  encoding: "br" | "gzip"
+): Effect.Effect<Buffer, Error> {
+  return Effect.async((resume) => {
+    if (encoding === "br") {
+      zlib.brotliCompress(
+        buffer,
+        { quality: brotliQuality },
+        (err, compressed) => {
+          if (err) {
+            resume(Effect.fail(err));
+          } else {
+            resume(Effect.succeed(compressed));
+          }
+        }
+      );
+    } else {
+      zlib.gzip(buffer, { level: gzipLevel }, (err, compressed) => {
+        if (err) {
+          resume(Effect.fail(err));
+        } else {
+          resume(Effect.succeed(compressed));
+        }
+      });
+    }
+  });
+}
+
+function decompressRequestBody(
+  buffer: Buffer,
+  contentEncoding: string
+): Effect.Effect<Buffer, Error> {
+  return Effect.async((resume) => {
+    const encoding = contentEncoding.toLowerCase().trim();
+    if (encoding === "br") {
+      zlib.brotliDecompress(buffer, (err, decompressed) => {
+        if (err) {
+          resume(Effect.fail(err));
+        } else {
+          resume(Effect.succeed(decompressed));
+        }
+      });
+    } else if (encoding === "gzip") {
+      zlib.gunzip(buffer, (err, decompressed) => {
+        if (err) {
+          resume(Effect.fail(err));
+        } else {
+          resume(Effect.succeed(decompressed));
+        }
+      });
+    } else if (encoding === "deflate") {
+      zlib.inflate(buffer, (err, decompressed) => {
+        if (err) {
+          resume(Effect.fail(err));
+        } else {
+          resume(Effect.succeed(decompressed));
+        }
+      });
+    } else {
+      resume(Effect.fail(new Error(`Unsupported Content-Encoding: ${contentEncoding}`)));
+    }
+  });
+}
+
+export const compressionMiddleware = Effect.gen(function* () {
+  const request = yield* HttpServerRequest.HttpServerRequest;
+  const contentEncoding = request.headers["content-encoding"];
+
+  if (contentEncoding) {
+    // Decompress request body if needed
+    // Note: The actual body decompression would need to be handled
+    // at the server level before request parsing. This is a placeholder
+    // for the middleware pattern.
+  }
+
+  return yield* Effect.succeed(request);
+});
+
 export const browserApiCorsLayer = HttpRouter.cors({
   allowedMethods: [...browserApiCorsAllowedMethods],
   allowedHeaders: [...browserApiCorsAllowedHeaders],
@@ -60,6 +205,111 @@
   return redirectUrl.to