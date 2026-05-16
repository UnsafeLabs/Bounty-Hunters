/**
 * HTTP compression middleware for gzip and brotli support.
 *
 * Compresses responses larger than 1KB when the client supports it.
 * Prefers brotli over gzip when both are accepted.
 *
 * @module CompressionMiddleware
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

// Compression threshold (1KB)
const COMPRESSION_THRESHOLD = 1024;

// Content types that should not be compressed
const SKIP_COMPRESSION_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/pdf",
  "video/mp4",
  "audio/mpeg",
]);

export interface CompressionConfig {
  readonly enabled: boolean;
  readonly level: number; // 1-9 for gzip, 0-11 for brotli
  readonly threshold: number;
}

const defaultConfig: CompressionConfig = {
  enabled: true,
  level: 6, // Default compression level
  threshold: COMPRESSION_THRESHOLD,
};

/**
 * Parse Accept-Encoding header to determine preferred encoding.
 */
function getPreferredEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (!acceptEncoding) return null;

  const encodings = acceptEncoding.split(",").map((e) => e.trim().toLowerCase());

  // Prefer brotli over gzip
  if (encodings.some((e) => e.startsWith("br"))) return "br";
  if (encodings.some((e) => e.startsWith("gzip"))) return "gzip";

  return null;
}

/**
 * Check if content type should be skipped for compression.
 */
function shouldSkipCompression(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return SKIP_COMPRESSION_TYPES.has(contentType.split(";")[0].trim());
}

/**
 * Compress data using gzip.
 */
function gzipCompress(data: Buffer, level: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zlib = require("zlib");
    zlib.gzip(data, { level }, (err: Error | null, result: Buffer) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Compress data using brotli.
 */
function brotliCompress(data: Buffer, level: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zlib = require("zlib");
    zlib.brotliCompress(
      data,
      {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: level,
        },
      },
      (err: Error | null, result: Buffer) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
}

/**
 * Decompress gzip data.
 */
function gzipDecompress(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zlib = require("zlib");
    zlib.gunzip(data, (err: Error | null, result: Buffer) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Decompress brotli data.
 */
function brotliDecompress(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zlib = require("zlib");
    zlib.brotliDecompress(data, (err: Error | null, result: Buffer) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Create compression middleware.
 */
export const compressionMiddleware = (config: Partial<CompressionConfig> = {}) => {
  const mergedConfig = { ...defaultConfig, ...config };

  return HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      if (!mergedConfig.enabled) {
        return yield* app;
      }

      const request = yield* HttpServerRequest.HttpServerRequest;

      // Get client's preferred encoding
      const acceptEncoding = request.headers["accept-encoding"];
      const preferredEncoding = getPreferredEncoding(acceptEncoding);

      // Process request body decompression
      const contentEncoding = request.headers["content-encoding"];
      if (contentEncoding && request.body) {
        const bodyBuffer = Buffer.from(request.body);
        let decompressedBody: Buffer;

        if (contentEncoding === "gzip") {
          decompressedBody = yield* Effect.promise(() => gzipDecompress(bodyBuffer));
        } else if (contentEncoding === "br") {
          decompressedBody = yield* Effect.promise(() => brotliDecompress(bodyBuffer));
        } else {
          decompressedBody = bodyBuffer;
        }

        // Replace request body with decompressed version
        request.body = decompressedBody.toString();
      }

      // Process response
      const response = yield* app;

      // Check if response should be compressed
      const contentType = response.headers?.["content-type"];
      if (shouldSkipCompression(contentType)) {
        return response;
      }

      // Get response body
      const body = response.body;
      if (!body || typeof body !== "string") {
        return response;
      }

      const bodyBuffer = Buffer.from(body);

      // Check if response is large enough to compress
      if (bodyBuffer.length < mergedConfig.threshold) {
        return response;
      }

      // Compress response
      let compressedBody: Buffer;
      let encoding: string;

      if (preferredEncoding === "br") {
        compressedBody = yield* Effect.promise(() =>
          brotliCompress(bodyBuffer, mergedConfig.level),
        );
        encoding = "br";
      } else if (preferredEncoding === "gzip") {
        compressedBody = yield* Effect.promise(() =>
          gzipCompress(bodyBuffer, mergedConfig.level),
        );
        encoding = "gzip";
      } else {
        return response;
      }

      // Return compressed response
      return HttpServerResponse.raw(compressedBody, {
        headers: {
          ...response.headers,
          "content-encoding": encoding,
          "content-length": compressedBody.length.toString(),
          vary: "Accept-Encoding",
        },
      });
    }),
  );
};

/**
 * Layer for compression middleware.
 */
export const layer = Layer.succeed(HttpMiddleware.middleware, compressionMiddleware());
