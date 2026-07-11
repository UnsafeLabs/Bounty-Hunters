/**
 * HTTP request/response compression (gzip + brotli) for the T3 Code server.
 *
 * - Prefer brotli when Accept-Encoding lists both `br` and `gzip`
 * - Skip bodies under 1KB and already-compressed content types
 * - Compression level configurable via COMPRESSION_LEVEL (default 4)
 * - Incoming Content-Encoding: gzip|br|deflate is decompressed for handlers
 */
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants, gunzipSync, gzipSync, inflateSync } from "node:zlib";
import * as Effect from "effect/Effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

export const MIN_COMPRESS_BYTES = 1024;

const SKIP_CONTENT_TYPE_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "font/",
] as const;

const SKIP_CONTENT_TYPE_EXACT = new Set([
  "application/gzip",
  "application/zip",
  "application/x-gzip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/x-bzip2",
  "application/x-xz",
  "application/wasm",
  "application/octet-stream",
  "application/pdf",
  "application/zstd",
  "application/brotli",
]);

export type CompressionEncoding = "br" | "gzip";

export function parseCompressionLevel(raw: string | undefined, fallback = 4): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(11, Math.max(0, n));
}

export function getConfiguredCompressionLevel(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseCompressionLevel(env.COMPRESSION_LEVEL);
}

/** Negotiate encoding: prefer brotli over gzip when both are accepted. */
export function negotiateEncoding(acceptEncodingHeader: string | undefined): CompressionEncoding | null {
  if (!acceptEncodingHeader) return null;
  const tokens = acceptEncodingHeader
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().split(";")[0]?.trim())
    .filter((t): t is string => Boolean(t));
  if (tokens.includes("*") || tokens.includes("br")) return "br";
  if (tokens.includes("gzip") || tokens.includes("x-gzip")) return "gzip";
  return null;
}

export function shouldSkipContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!base) return false;
  if (SKIP_CONTENT_TYPE_EXACT.has(base)) return true;
  return SKIP_CONTENT_TYPE_PREFIXES.some((prefix) => base.startsWith(prefix));
}

export function compressBytes(
  input: Uint8Array,
  encoding: CompressionEncoding,
  level: number,
): Uint8Array {
  if (encoding === "br") {
    return brotliCompressSync(input, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: Math.min(11, Math.max(0, level)),
      },
    });
  }
  return gzipSync(input, { level: Math.min(9, Math.max(0, level)) });
}

export function decompressBytes(
  input: Uint8Array,
  contentEncoding: string | undefined,
): Uint8Array {
  if (!contentEncoding) return input;
  const encoding = contentEncoding.toLowerCase().split(",")[0]?.trim() ?? "";
  if (encoding === "gzip" || encoding === "x-gzip") {
    return gunzipSync(input);
  }
  if (encoding === "br") {
    return brotliDecompressSync(input);
  }
  if (encoding === "deflate") {
    return inflateSync(input);
  }
  return input;
}

export function maybeCompressBody(options: {
  body: Uint8Array;
  contentType: string | undefined;
  acceptEncoding: string | undefined;
  alreadyEncoded: boolean;
  level: number;
}): { body: Uint8Array; contentEncoding: CompressionEncoding | null } {
  const { body, contentType, acceptEncoding, alreadyEncoded, level } = options;
  if (alreadyEncoded) {
    return { body, contentEncoding: null };
  }
  if (body.byteLength < MIN_COMPRESS_BYTES) {
    return { body, contentEncoding: null };
  }
  if (shouldSkipContentType(contentType)) {
    return { body, contentEncoding: null };
  }
  const encoding = negotiateEncoding(acceptEncoding);
  if (!encoding) {
    return { body, contentEncoding: null };
  }
  const compressed = compressBytes(body, encoding, level);
  // Only keep compressed form if it actually shrinks the payload.
  if (compressed.byteLength >= body.byteLength) {
    return { body, contentEncoding: null };
  }
  return { body: compressed, contentEncoding: encoding };
}

function extractUint8Body(
  response: HttpServerResponse.HttpServerResponse,
): { bytes: Uint8Array; contentType: string | undefined } | null {
  const body = response.body;
  if (body._tag === "Uint8Array") {
    return { bytes: body.body, contentType: body.contentType ?? response.headers["content-type"] };
  }
  if (body._tag === "Raw") {
    const raw = body.body;
    if (typeof raw === "string") {
      return {
        bytes: new TextEncoder().encode(raw),
        contentType: body.contentType ?? response.headers["content-type"] ?? "text/plain; charset=utf-8",
      };
    }
    if (raw instanceof Uint8Array) {
      return {
        bytes: raw,
        contentType: body.contentType ?? response.headers["content-type"],
      };
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
      return {
        bytes: new Uint8Array(raw),
        contentType: body.contentType ?? response.headers["content-type"],
      };
    }
  }
  return null;
}

/**
 * Effect HTTP middleware: compress large compressible responses.
 */
export const responseCompressionMiddleware: HttpMiddleware.HttpMiddleware = HttpMiddleware.make(
  (httpApp) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const response = yield* httpApp;
      const extracted = extractUint8Body(response);
      if (!extracted) {
        return response;
      }
      const alreadyEncoded = Boolean(response.headers["content-encoding"]);
      const result = maybeCompressBody({
        body: extracted.bytes,
        contentType: extracted.contentType,
        acceptEncoding: request.headers["accept-encoding"],
        alreadyEncoded,
        level: getConfiguredCompressionLevel(),
      });
      if (!result.contentEncoding) {
        return response;
      }
      return HttpServerResponse.uint8Array(result.body, {
        status: response.status,
        statusText: response.statusText,
        contentType: extracted.contentType,
        headers: {
          ...response.headers,
          "content-encoding": result.contentEncoding,
          vary: mergeVary(response.headers["vary"], "Accept-Encoding"),
        },
        cookies: response.cookies,
      });
    }),
);

function mergeVary(existing: string | undefined, value: string): string {
  if (!existing) return value;
  const parts = existing.split(",").map((p) => p.trim().toLowerCase());
  if (parts.includes(value.toLowerCase())) return existing;
  return `${existing}, ${value}`;
}

/**
 * Decompress an incoming request body buffer when Content-Encoding is set.
 * Handlers that read raw bytes can call this before JSON parsing.
 */
export function decompressRequestBody(
  body: Uint8Array,
  contentEncoding: string | undefined,
): Uint8Array {
  try {
    return decompressBytes(body, contentEncoding);
  } catch {
    return body;
  }
}

/** Global middleware layer — provide to route layers to compress all responses. */
export const httpCompressionMiddlewareLayer = HttpRouter.middleware(
  responseCompressionMiddleware,
  { global: true },
);
