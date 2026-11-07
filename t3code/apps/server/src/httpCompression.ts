/**
 * HTTP Compression - Gzip and Brotli compression middleware for HTTP responses.
 *
 * Provides automatic compression for responses larger than 1KB when the client
 * supports it. Prefers Brotli over Gzip when both are accepted. Skips compression
 * for already-compressed content types (images, archives).
 *
 * @module httpCompression
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as NodeStream from "effect/NodeStream";
import {
  HttpBody,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import * as Zlib from "node:zlib";
import * as NodeStreamWeb from "node:stream/web";

const COMPRESSION_THRESHOLD_BYTES = 1024; // 1KB

const COMPRESSIBLE_CONTENT_TYPES = new Set([
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/javascript",
  "application/xml",
  "application/xhtml+xml",
  "image/svg+xml",
]);

const SKIP_COMPRESSION_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "application/zip",
  "application/gzip",
  "application/x-bzip2",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
]);

export type CompressionEncoding = "br" | "gzip" | "identity";

export interface CompressionConfig {
  readonly compressionLevel: number;
  readonly enabled: boolean;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  compressionLevel: 6, // Balanced compression level
  enabled: true,
};

/**
 * Parse Accept-Encoding header and return preferred encoding.
 * Prefers brotli over gzip when both are accepted.
 */
export function parseAcceptEncoding(acceptEncoding: string | undefined): CompressionEncoding {
  if (!acceptEncoding) {
    return "identity";
  }

  const encodings = acceptEncoding
    .toLowerCase()
    .split(",")
    .map((e) => e.trim().split(";")[0]);

  if (encodings.includes("br")) {
    return "br";
  }
  if (encodings.includes("gzip")) {
    return "gzip";
  }

  return "identity";
}

/**
 * Check if content type should be compressed.
 */
export function shouldCompressContentType(contentType: string): boolean {
  const mimeType = contentType.split(";")[0].trim().toLowerCase();

  if (SKIP_COMPRESSION_CONTENT_TYPES.has(mimeType)) {
    return false;
  }

  // Compress if it's a known compressible type or text-based
  if (COMPRESSIBLE_CONTENT_TYPES.has(mimeType)) {
    return true;
  }

  // Default: compress text-based content
  return mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("javascript");
}

/**
 * Compress data using Brotli.
 */
export function compressBrotli(
  data: Uint8Array,
  level: number,
): Effect.Effect<Uint8Array, never> {
  return Effect.try({
    try: () => {
      const compressed = Zlib.brotliCompressSync(data, {
        params: {
          [Zlib.constants.BROTLI_PARAM_QUALITY]: level,
        },
      });
      return new Uint8Array(compressed);
    },
    catch: () => data, // Return uncompressed on error
  });
}

/**
 * Compress data using Gzip.
 */
export function compressGzip(
  data: Uint8Array,
  level: number,
): Effect.Effect<Uint8Array, never> {
  return Effect.try({
    try: () => {
      const compressed = Zlib.gzipSync(data, { level });
      return new Uint8Array(compressed);
    },
    catch: () => data, // Return uncompressed on error
  });
}

/**
 * Decompress gzip-encoded request body.
 */
export function decompressGzip(data: Uint8Array): Effect.Effect<Uint8Array, Error> {
  return Effect.try({
    try: () => {
      const decompressed = Zlib.gunzipSync(data);
      return new Uint8Array(decompressed);
    },
    catch: (error) => new Error(`Failed to decompress gzip: ${error}`),
  });
}

/**
 * Decompress brotli-encoded request body.
 */
export function decompressBrotli(data: Uint8Array): Effect.Effect<Uint8Array, Error> {
  return Effect.try({
    try: () => {
      const decompressed = Zlib.brotliDecompressSync(data);
      return new Uint8Array(decompressed);
    },
    catch: (error) => new Error(`Failed to decompress brotli: ${error}`),
  });
}

/**
 * Decompress request body based on Content-Encoding header.
 */
export function decompressRequestBody(
  request: HttpServerRequest.HttpServerRequest,
  body: Uint8Array,
): Effect.Effect<Uint8Array, Error> {
  const contentEncoding = request.headers["content-encoding"];

  if (!contentEncoding) {
    return Effect.succeed(body);
  }

  const encoding = contentEncoding.toLowerCase();

  if (encoding === "gzip") {
    return decompressGzip(body);
  }

  if (encoding === "br") {
    return decompressBrotli(body);
  }

  return Effect.succeed(body);
}

/**
 * Compress response body if conditions are met.
 */
export function compressResponseBody(
  body: Uint8Array,
  contentType: string,
  encoding: CompressionEncoding,
  config: CompressionConfig,
): Effect.Effect<{ data: Uint8Array; encoding: CompressionEncoding }, never> {
  if (!config.enabled || encoding === "identity") {
    return Effect.succeed({ data: body, encoding: "identity" });
  }

  // Skip compression for small responses
  if (body.length < COMPRESSION_THRESHOLD_BYTES) {
    return Effect.succeed({ data: body, encoding: "identity" });
  }

  // Skip compression for non-compressible content types
  if (!shouldCompressContentType(contentType)) {
    return Effect.succeed({ data: body, encoding: "identity" });
  }

  // Compress based on preferred encoding
  if (encoding === "br") {
    return compressBrotli(body, config.compressionLevel).pipe(
      Effect.map((data) => ({ data, encoding: "br" })),
    );
  }

  if (encoding === "gzip") {
    return compressGzip(body, config.compressionLevel).pipe(
      Effect.map((data) => ({ data, encoding: "gzip" })),
    );
  }

  return Effect.succeed({ data: body, encoding: "identity" });
}

/**
 * HTTP middleware that adds compression support to responses.
 */
export const compressionMiddleware = (
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG,
) => {
  return (
    effect: Effect.Effect<HttpServerResponse.HttpServerResponse, any, any>,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, any, any> =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const response = yield* effect;

      if (!config.enabled) {
        return response;
      }

      const acceptEncoding = request.headers["accept-encoding"];
      const preferredEncoding = parseAcceptEncoding(acceptEncoding);

      if (preferredEncoding === "identity") {
        return response;
      }

      const contentType = response.headers["content-type"] ?? "application/octet-stream";
      const body = yield* response.arrayBody;

      const compressed = yield* compressResponseBody(
        body,
        contentType,
        preferredEncoding,
        config,
      );

      if (compressed.encoding === "identity") {
        return response;
      }

      // Return compressed response with appropriate headers
      return HttpServerResponse.raw(compressed.data, {
        status: response.status,
        headers: {
          ...response.headers,
          "content-encoding": compressed.encoding,
          "vary": "Accept-Encoding",
        },
      });
    });
};

/**
 * Get compression config from environment variables.
 */
export function getCompressionConfigFromEnv(): CompressionConfig {
  const level = parseInt(process.env.HTTP_COMPRESSION_LEVEL ?? "6", 10);
  const enabled = process.env.HTTP_COMPRESSION_ENABLED !== "false";

  return {
    compressionLevel: Math.max(1, Math.min(11, level)), // Clamp between 1-11
    enabled,
  };
}
