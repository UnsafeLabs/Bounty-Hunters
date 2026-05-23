import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { gzipSync, brotliCompressSync } from "node:zlib";

const MIN_COMPRESS_SIZE = 1024; // 1KB
const COMPRESSIBLE_TYPES = new Set([
  "application/json",
  "application/javascript",
  "text/html",
  "text/css",
  "text/plain",
  "text/markdown",
  "application/xml",
]);

export interface CompressionOptions {
  readonly minSize?: number;
  readonly gzipLevel?: number;
  readonly brotliQuality?: number;
}

export function compressResponse(
  body: string | Buffer,
  contentType: string | undefined,
  acceptEncoding: string | undefined,
  options: CompressionOptions = {},
): { body: Buffer; encoding: string | null } {
  const minSize = options.minSize ?? MIN_COMPRESS_SIZE;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);

  // Don't compress small responses
  if (buf.length < minSize) {
    return { body: buf, encoding: null };
  }

  // Don't compress non-compressible types
  const baseType = contentType?.split(";")[0].trim().toLowerCase();
  if (!baseType || !COMPRESSIBLE_TYPES.has(baseType)) {
    return { body: buf, encoding: null };
  }

  // Negotiate encoding
  const encodings = (acceptEncoding || "").split(",").map((e) => e.trim().split(";")[0].toLowerCase());

  // Prefer brotli, then gzip
  if (encodings.includes("br")) {
    const compressed = brotliCompressSync(buf, {
      params: { 3: (options.brotliQuality ?? 4) as number },
    });
    return { body: compressed, encoding: "br" };
  }

  if (encodings.includes("gzip")) {
    const compressed = gzipSync(buf, { level: options.gzipLevel ?? 6 });
    return { body: compressed, encoding: "gzip" };
  }

  return { body: buf, encoding: null };
}
