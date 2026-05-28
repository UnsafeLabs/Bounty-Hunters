/**
 * HTTP response compression middleware using gzip and brotli.
 *
 * Compresses eligible responses based on Accept-Encoding header.
 * Prefers brotli over gzip when both are accepted.
 * Skips compression for already-compressed content types (images, archives).
 * Only compresses responses larger than 1KB.
 * Compression level configurable via HTTP_COMPRESSION_LEVEL env var.
 *
 * Usage:
 * ```typescript
 * import { HttpRouter } from "effect/unstable/http";
 * import { compressionMiddleware } from "./httpCompression.ts";
 *
 * HttpRouter.serve(appLayer, { middleware: compressionMiddleware })
 * ```
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/unstable/http/HttpBody";
import { HttpEffect } from "effect/unstable/http";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Content types that are already compressed and should not be re-compressed. */
const ALREADY_COMPRESSED_CONTENT_TYPES: ReadonlyArray<string> = [
  // Images
  "image/",
  // Audio/Video
  "audio/",
  "video/",
  // Archives / compressed
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-bzip2",
  "application/x-xz",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  // Fonts (often woff/woff2 are already compressed)
  "font/woff",
  "font/woff2",
  "application/vnd.ms-fontobject",
];

/** Minimum response body size in bytes to trigger compression. */
const MIN_COMPRESS_SIZE = 1024;

/** Default compression level. */
const DEFAULT_COMPRESSION_LEVEL = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a content type is already compressed and should be skipped.
 */
function isAlreadyCompressedContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  for (const prefix of ALREADY_COMPRESSED_CONTENT_TYPES) {
    if (prefix.endsWith("/") && lower.startsWith(prefix)) return true;
    if (lower === prefix) return true;
  }
  return false;
}

/**
 * Determine the preferred compression encoding from Accept-Encoding header.
 * Returns "br" for brotli, "gzip" for gzip, or undefined if no supported
 * encoding is requested.
 */
function pickEncoding(acceptEncoding: string | undefined): "br" | "gzip" | undefined {
  if (!acceptEncoding) return undefined;

  const lower = acceptEncoding.toLowerCase();
  const hasBr = lower.includes("br");
  const hasGzip = lower.includes("gzip");

  if (!hasBr && !hasGzip) return undefined;

  // Parse quality values (q=)
  const brMatch = lower.match(/\bbr\s*(?:;q=([01](?:\.\d+)?))?/);
  const gzipMatch = lower.match(/\bgzip\s*(?:;q=([01](?:\.\d+)?))?/);

  const brQ = brMatch ? (brMatch[1] !== undefined ? parseFloat(brMatch[1]) : 1) : 0;
  const gzipQ = gzipMatch ? (gzipMatch[1] !== undefined ? parseFloat(gzipMatch[1]) : 1) : 0;

  if (brQ === 0 && gzipQ === 0) return undefined;
  if (brQ === gzipQ) return hasBr ? "br" : hasGzip ? "gzip" : undefined;

  return brQ > gzipQ ? "br" : "gzip";
}

/**
 * Get the compression level from the environment variable.
 */
function getCompressionLevel(): number {
  const env = process.env["HTTP_COMPRESSION_LEVEL"];
  if (env === undefined) return DEFAULT_COMPRESSION_LEVEL;
  const level = Number(env);
  if (Number.isFinite(level) && level >= 1 && level <= 11) {
    return Math.round(level);
  }
  return DEFAULT_COMPRESSION_LEVEL;
}

/**
 * Compress a Uint8Array synchronously using the specified encoding.
 */
function compressSync(data: Uint8Array, encoding: "br" | "gzip"): Uint8Array {
  const level = getCompressionLevel();
  if (encoding === "br") {
    return zlib.brotliCompressSync(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: Math.min(level, 11),
      },
    });
  }
  return zlib.gzipSync(data, { level: Math.min(level, 9) });
}

/**
 * Extract the raw Uint8Array from a response body if it's a concrete
 * (non-streaming) body type. Returns undefined for stream or form-data
 * bodies that cannot be easily compressed at the middleware layer.
 */
function extractBodyBytes(body: HttpBody.HttpBody): Uint8Array | undefined {
  if (body._tag === "Uint8Array") {
    return (body as HttpBody.Uint8Array).body;
  }
  if (body._tag === "Raw") {
    const raw = body as HttpBody.Raw;
    if (raw.body instanceof Uint8Array) return raw.body;
    if (typeof raw.body === "string") return new TextEncoder().encode(raw.body);
    return undefined;
  }
  if (body._tag === "Empty") {
    return new Uint8Array(0);
  }
  // Stream / FormData bodies cannot be compressed at this layer
  return undefined;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * HttpMiddleware that compresses response bodies when the client advertises
 * support for gzip or brotli via Accept-Encoding.
 *
 * - Prefers brotli over gzip when both are accepted
 * - Skips compression for already-compressed content types (images, archives)
 * - Only compresses responses with body size > 1KB
 * - Compression level configurable via `HTTP_COMPRESSION_LEVEL` env var
 *   (1-11 for brotli, 1-9 for gzip; default 6)
 */
export const compressionMiddleware: HttpMiddleware.HttpMiddleware = HttpMiddleware.make(
  <E, R>(
    httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest>,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest> =>
    Effect.withFiber((fiber) => {
      const request = Context.getUnsafe(fiber.context, HttpServerRequest);
      const acceptEncoding = request.headers["accept-encoding"];

      const encoding = pickEncoding(acceptEncoding);
      if (!encoding) {
        return httpApp;
      }

      // Register a pre-response handler to compress the response body
      // just before it is sent to the client
      HttpEffect.appendPreResponseHandlerUnsafe(request, (_request, response) => {
        // Skip redirects and empty/no-body responses
        if (response.status < 200 || response.status === 204 || response.status === 304) {
          return Effect.succeed(response);
        }

        // Skip already-compressed content types
        const contentType = response.headers["content-type"];
        if (isAlreadyCompressedContentType(contentType)) {
          return Effect.succeed(response);
        }

        // Extract body bytes (skip streaming/form-data bodies)
        const bodyBytes = extractBodyBytes(response.body);
        if (!bodyBytes) {
          return Effect.succeed(response);
        }

        // Skip small responses (below 1KB)
        if (bodyBytes.length < MIN_COMPRESS_SIZE) {
          return Effect.succeed(response);
        }

        // Compress
        try {
          const compressed = compressSync(bodyBytes, encoding);
          const encodingHeader = encoding === "br" ? "br" : "gzip";

          // Build new response with compressed body and Content-Encoding header.
          // Remove Content-Length since it will change.
          const newHeaders: Record<string, string> = {};
          for (const key of Object.keys(response.headers)) {
            if (key.toLowerCase() !== "content-length") {
              newHeaders[key] = response.headers[key];
            }
          }
          newHeaders["content-encoding"] = encodingHeader;

          // Add Vary: Accept-Encoding if not already present
          const vary = response.headers["vary"];
          if (vary) {
            if (
              !vary
                .toLowerCase()
                .split(",")
                .map((s) => s.trim())
                .includes("accept-encoding")
            ) {
              newHeaders["vary"] = vary + ", Accept-Encoding";
            }
          } else {
            newHeaders["vary"] = "Accept-Encoding";
          }

          return Effect.succeed(
            HttpServerResponse.uint8Array(compressed, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders as any,
              contentType: contentType ?? "application/octet-stream",
            }),
          );
        } catch {
          // If compression fails, fall back to the original uncompressed response
          return Effect.succeed(response);
        }
      });

      return httpApp;
    }),
);
