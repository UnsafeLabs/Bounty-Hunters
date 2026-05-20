/**
 * HTTP response compression middleware supporting gzip and brotli.
 *
 * Compresses responses larger than 1KB when the client sends
 * Accept-Encoding with gzip or br. Prefers brotli over gzip.
 */

import * as Effect from "effect/Effect";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

const MIN_COMPRESS_SIZE = 1024;
const SKIP_CONTENT_TYPES = [
  "image/",
  "video/",
  "audio/",
  "application/zip",
  "application/gzip",
  "application/x-rar-compressed",
];

function shouldSkip(contentType: string | null): boolean {
  if (!contentType) return false;
  return SKIP_CONTENT_TYPES.some((prefix) => contentType.startsWith(prefix));
}

function parseAcceptEncoding(header: string | null): { gzip: boolean; br: boolean } {
  if (!header) return { gzip: false, br: false };
  return {
    br: header.includes("br"),
    gzip: header.includes("gzip") || header.includes("*"),
  };
}

export interface CompressionMiddleware {
  readonly compress: (input: {
    body: string;
    contentType: string | null;
    acceptEncoding: string | null;
  }) => Effect.Effect<{
    body: Buffer;
    encoding: string | null;
  }>;
}

export const CompressionMiddleware: CompressionMiddleware = {
  compress: ({ body, contentType, acceptEncoding }) =>
    Effect.gen(function* () {
      if (shouldSkip(contentType) || body.length < MIN_COMPRESS_SIZE) {
        return { body: Buffer.from(body, "utf-8"), encoding: null };
      }

      const accepted = parseAcceptEncoding(acceptEncoding);

      if (accepted.br) {
        const compressed = yield* Effect.tryPromise({
          try: () => brotliAsync(body),
          catch: (e) => new Error(`Brotli compression failed: ${e}`),
        });
        return { body: compressed, encoding: "br" };
      }

      if (accepted.gzip) {
        const compressed = yield* Effect.tryPromise({
          try: () => gzipAsync(body),
          catch: (e) => new Error(`Gzip compression failed: ${e}`),
        });
        return { body: compressed, encoding: "gzip" };
      }

      return { body: Buffer.from(body, "utf-8"), encoding: null };
    }),
};
