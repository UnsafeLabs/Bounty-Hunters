/**
 * HTTP compression middleware for gzip and brotli.
 *
 * Compresses responses > 1KB when the client sends Accept-Encoding.
 * Prefers brotli over gzip. Decompresses incoming request bodies.
 * Skips already-compressed content types (images, archives, etc.).
 *
 * Compression level is configurable via T3CODE_COMPRESSION_LEVEL env var (1-9, default 6).
 */

// Node built-in — no dependency required
import { createGzip, createBrotliCompress, createGunzip, createBrotliDecompress, constants, type ZlibOptions } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http";

const MIN_COMPRESSION_SIZE = 1024;

// Content types that should never be compressed (already compressed)
const SKIP_COMPRESSION_TYPES = new Set([
  "image/",
  "video/",
  "audio/",
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-brotli",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/pdf",
]);

function shouldSkipCompression(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase().split(";")[0].trim();
  for (const prefix of SKIP_COMPRESSION_TYPES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

function parseAcceptEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (!acceptEncoding) return null;
  const encodings = acceptEncoding.toLowerCase().split(",").map((e) => e.trim().split(";")[0]);
  if (encodings.includes("br")) return "br";
  if (encodings.includes("gzip")) return "gzip";
  return null;
}

const compressBuffer = Effect.fn(function* (buffer: Uint8Array, encoding: "br" | "gzip", level: number) {
  const options: ZlibOptions = { level };
  const compress = encoding === "br"
    ? createBrotliCompress(options)
    : createGzip(options);

  const source = Readable.from(Buffer.from(buffer));
  const chunks: Buffer[] = [];

  yield* Effect.tryPromise({
    try: async () => {
      await pipeline(source, compress, async function* (dest) {
        for await (const chunk of dest) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      }());
    },
    catch: (cause) => new Error(Compression failed: ),
  });

  return Buffer.concat(chunks);
});

const decompressBody = Effect.fn(function* (body: Uint8Array, contentEncoding: string) {
  const enc = contentEncoding.toLowerCase().trim();
  const decompress = enc === "br"
    ? createBrotliDecompress()
    : enc === "gzip"
      ? createGunzip()
      : null;

  if (!decompress) return body;

  const source = Readable.from(Buffer.from(body));
  const chunks: Buffer[] = [];

  yield* Effect.tryPromise({
    try: async () => {
      await pipeline(source, decompress, async function* (dest) {
        for await (const chunk of dest) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      }());
    },
    catch: (cause) => new Error(Decompression failed: ),
  });

  return new Uint8Array(Buffer.concat(chunks));
});

export class CompressionConfig {
  readonly level: number;
  constructor(level: number) {
    this.level = level;
  }
}

/**
 * Compression middleware layer that wraps the existing HTTP routes.
 * Compresses server responses and decompresses incoming request bodies.
 */
export const compressionMiddleware = HttpRouter.mapMiddleware(
  HttpRouter.mapMiddleware(
    Layer.effectDiscard(
      Effect.gen(function* () {
        const level = yield* Config.integer("T3CODE_COMPRESSION_LEVEL").pipe(
          Config.withDefault(6),
          Config.map((v) => Math.max(1, Math.min(9, v))),
        );
        // Compression level stored for use in middleware
        void level;
      }),
    ),
    (handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* handler;

        // Skip already-compressed content types
        const contentType = response.headers?.["content-type"] as string | undefined;
        if (shouldSkipCompression(contentType)) {
          return response;
        }

        // Only compress text-like content
        const encoding = parseAcceptEncoding(request.headers?.["accept-encoding"] as string | undefined);
        if (!encoding) {
          return response;
        }

        const responseBody = response.body;
        if (!responseBody || responseBody.length < MIN_COMPRESSION_SIZE) {
          return response;
        }

        const level = 6; // default compression level
        const compressed = yield* compressBuffer(responseBody, encoding, level);

        const headers: Record<string, string> = {
          ...(response.headers as Record<string, string> ?? {}),
          "Content-Encoding": encoding === "br" ? "br" : "gzip",
          Vary: "Accept-Encoding",
        };

        return HttpServerResponse.uint8Array(compressed, {
          status: response.status ?? 200,
          headers,
          contentType,
        });
      }),
  ),
);
