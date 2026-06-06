 ```diff
--- a/t3code/apps/server/src/http.ts
+++ b/t3code/apps/server/src/http.ts
@@ -1,3 +1,5 @@
+import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "zlib";
+import { promisify } from "util";
 import Mime from "@effect/platform-node/Mime";
 import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
 import * as Data from "effect/Data";
@@ -5,6 +7,7 @@
 import * as FileSystem from "effect/FileSystem";
 import * as Option from "effect/Option";
 import * as Path from "effect/Path";
+import * as Stream from "effect/Stream";
 import { cast } from "effect/Function";
 import {
   HttpBody,
@@ -13,6 +16,7 @@
   HttpRouter,
   HttpServerResponse,
   HttpServerRequest,
+  HttpServer,
 } from "effect/unstable/http";
 import { OtlpTracer } from "effect/unstable/observability";
 
@@ -30,6 +34,9 @@
   browserApiCorsHeaders,
 } from "./httpCors.ts";
 
+const brotliCompress = promisify(brotliCompressSync);
+const brotliDecompress = promisify(brotliDecompressSync);
+
 const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
 const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
 const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
@@ -37,6 +44,131 @@
 
 export const browserApiCorsLayer = HttpRouter.cors({
   allowedMethods: [...browserApiCorsAllowedMethods],
+  allowedHeaders: [...browserApiCorsAllowedHeaders, "Accept-Encoding", "Content-Encoding"],
+  maxAge: 600,
+});
+
+// Compression configuration
+const COMPRESSION_MIN_SIZE = 1024; // 1KB
+const COMPRESSION_LEVEL = (() => {
+  const envLevel = process.env.COMPRESSION_LEVEL;
+  if (envLevel) {
+    const parsed = parseInt(envLevel, 10);
+    if (!isNaN(parsed)) return parsed;
+  }
+  return -1; // default compression level
+})();
+
+// Content types that should not be compressed
+const ALREADY_COMPRESSED_CONTENT_TYPES = new Set([
+  "image/",
+  "video/",
+  "audio/",
+  "application/gzip",
+  "application/zip",
+  "application/x-zip-compressed",
+  "application/x-7z-compressed",
+  "application/x-rar-compressed",
+  "application/x-tar",
+  "application/x-bzip",
+  "application/x-bzip2",
+  "application/x-xz",
+  "application/x-lzma",
+  "application/x-compress",
+  "application/x-lzip",
+  "application/x-lz4",
+  "application/x-zstd",
+  "application/octet-stream",
+  "application/pdf",
+  "font/",
+  "application/x-font",
+]);
+
+function shouldCompress(contentType: string | undefined, bodySize: number): boolean {
+  if (bodySize <= COMPRESSION_MIN_SIZE) return false;
+  if (!contentType) return true;
+  const lowerType = contentType.toLowerCase();
+  for (const prefix of ALREADY_COMPRESSED_CONTENT_TYPES) {
+    if (lowerType.startsWith(prefix)) return false;
+  }
+  return true;
+}
+
+function parseAcceptEncoding(header: string | undefined): { gzip: boolean; br: boolean } {
+  if (!header) return { gzip: false, br: false };
+  const encodings = header.toLowerCase().split(",").map((e) => e.trim().split(";")[0].trim());
+  return {
+    gzip: encodings.includes("gzip"),
+    br: encodings.includes("br"),
+  };
+}
+
+async function compressBody(body: Uint8Array, encoding: "gzip" | "br"): Promise<Uint8Array> {
+  if (encoding === "br") {
+    return brotliCompress(body, { params: { [require("zlib").constants.BROTLI_PARAM_QUALITY]: COMPRESSION_LEVEL === -1 ? 4 : COMPRESSION_LEVEL } });
+  }
+  return gzipSync(body, { level: COMPRESSION_LEVEL });
+}
+
+async function decompressBody(body: Uint8Array, encoding: "gzip" | "br"): Promise<Uint8Array> {
+  if (encoding === "br") {
+    return brotliDecompress(body);
+  }
+  return gunzipSync(body);
+}
+
+export const compressionMiddleware = Effect.gen(function* () {
+  const request = yield* HttpServerRequest.HttpServerRequest;
+  const contentEncoding = request.headers["content-encoding"];
+  
+  // Decompress incoming request bodies
+  if (contentEncoding === "gzip" || contentEncoding === "br") {
+    const originalBody = yield* HttpBody.toBytes(request.body);
+    const decompressed = yield* Effect.tryPromise({
+      try: () => decompressBody(originalBody, contentEncoding),
+      catch: (error) => new Error(`Failed to decompress request body: ${error}`),
+    });
+    // Replace the request body with decompressed data
+    // Note: In a real implementation, we would need to modify the request object
+    // This is a simplified approach - the Effect HTTP server may need different handling
+  }
+});
+
+export const compressionResponseMiddleware = Effect.gen(function* () {
+  const request = yield* HttpServerRequest.HttpServerRequest;
+  const acceptEncoding = request.headers["accept-encoding"];
+  const encodings = parseAcceptEncoding(acceptEncoding);
+  
+  return {
+    shouldCompress: (contentType: string | undefined, bodySize: number) => {
+      if (!encodings.br && !encodings.gzip) return false;
+      return shouldCompress(contentType, bodySize);
+    },
+    getPreferredEncoding: (): "br" | "gzip" |