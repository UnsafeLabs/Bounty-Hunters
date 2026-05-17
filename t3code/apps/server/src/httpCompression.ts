/**
 * HTTP Compression Middleware
 *
 * Adds gzip and brotli response compression and request body decompression
 * to the T3 Code HTTP layer. Prefer brotli over gzip when both are accepted.
 *
 * Environment variables:
 *   T3_COMPRESSION_LEVEL   - Compression quality (1-11 brotli, 1-9 gzip, default: 4)
 *   T3_COMPRESSION_ENABLED - Set "false" to disable compression
 *   T3_COMPRESSION_MIN_SIZE - Minimum response size in bytes to compress (default: 1024)
 *
 * @module httpCompression
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import {
  HttpServerResponse,
} from "effect/unstable/http";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CompressionConfig {
  readonly compressionLevel: number;
  readonly minSizeBytes: number;
  readonly enabled: boolean;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  compressionLevel: 4,
  minSizeBytes: 1024,
  enabled: true,
};

export class CompressionConfigService extends Context.Service<CompressionConfigService, CompressionConfig>()(
  "t3/http/CompressionConfig",
) {
  static readonly layerDefault = Layer.succeed(
    CompressionConfigService,
    DEFAULT_COMPRESSION_CONFIG,
  );

  static readonly layerFromEnv = Layer.sync(CompressionConfigService, () => ({
    compressionLevel: process.env.T3_COMPRESSION_LEVEL
      ? parseInt(process.env.T3_COMPRESSION_LEVEL, 10)
      : 4,
    minSizeBytes: process.env.T3_COMPRESSION_MIN_SIZE
      ? parseInt(process.env.T3_COMPRESSION_MIN_SIZE, 10)
      : 1024,
    enabled: process.env.T3_COMPRESSION_ENABLED !== "false",
  }));
}

// ---------------------------------------------------------------------------
// Content types that should never be compressed
// ---------------------------------------------------------------------------

const SKIP_COMPRESSION_PREFIXES: ReadonlyArray<string> = [
  "image/",
  "video/",
  "audio/",
  "application/zip",
  "application/x-zip",
  "application/gzip",
  "application/x-gzip",
  "application/brotli",
  "application/x-brotli",
  "application/pdf",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/octet-stream",
  "application/wasm",
];

function shouldSkipCompression(contentType: string): boolean {
  const lower = contentType.toLowerCase().split(";")[0].trim();
  return SKIP_COMPRESSION_PREFIXES.some((p) => lower.startsWith(p));
}

// ---------------------------------------------------------------------------
// Accept-Encoding parser
// ---------------------------------------------------------------------------

export interface AcceptedEncodings {
  readonly gzip: boolean;
  readonly br: boolean;
  readonly deflate: boolean;
  readonly priority: "br" | "gzip" | "deflate" | null;
}

function parseAcceptEncoding(header: string | undefined): AcceptedEncodings {
  if (!header) {
    return { gzip: false, br: false, deflate: false, priority: null };
  }

  const lower = header.toLowerCase();
  const hasGzip = lower.includes("gzip");
  const hasBr = /\bbr\b/.test(lower) || lower.includes("brotli");
  const hasDeflate = lower.includes("deflate");

  // Prefer brotli over gzip for better compression ratio
  let priority: "br" | "gzip" | "deflate" | null = null;
  if (hasBr) priority = "br";
  else if (hasGzip) priority = "gzip";
  else if (hasDeflate) priority = "deflate";

  return { gzip: hasGzip, br: hasBr, deflate: hasDeflate, priority };
}

// ---------------------------------------------------------------------------
// Compression / Decompression primitives
// ---------------------------------------------------------------------------

class CompressionError extends Data.TaggedError("CompressionError")<{
  readonly cause: unknown;
  readonly encoding: string;
}> {}

async function compressBrotli(data: Uint8Array, level: number): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.brotliCompress(
      data,
      { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level } },
      (err, result) => {
        if (err) reject(err);
        else resolve(result as Uint8Array);
      },
    );
  });
}

async function compressGzip(data: Uint8Array, level: number): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.gzip(data, { level: Math.min(level, 9) }, (err, result) => {
      if (err) reject(err);
      else resolve(result as Uint8Array);
    });
  });
}

async function decompressBrotli(data: Uint8Array): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.brotliDecompress(data, (err, result) => {
      if (err) reject(err);
      else resolve(result as Uint8Array);
    });
  });
}

async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.gunzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result as Uint8Array);
    });
  });
}

async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.inflate(data, (err, result) => {
      if (err) reject(err);
      else resolve(result as Uint8Array);
    });
  });
}

// ---------------------------------------------------------------------------
// Public API: compressResponse
// ---------------------------------------------------------------------------

/**
 * Compress an HttpServerResponse when the client supports it and the
 * response meets the size / content-type criteria.
 *
 * Returns the original response unchanged when compression is not applicable.
 *
 * Usage in route handlers:
 * ```ts
 * const response = HttpServerResponse.jsonUnsafe(data, { status: 200 });
 * yield* compressResponse(response, request.headers["accept-encoding"]);
 * ```
 */
export const compressResponse = Effect.fn(function* (
  response: HttpServerResponse.HttpServerResponse,
  acceptEncoding: string | undefined,
) {
  const config = yield* CompressionConfigService;

  // Skip if compression is disabled
  if (!config.enabled) return response;

  // Only compress Uint8Array bodies (JSON, text, etc.)
  if (!response.body || response.body._tag !== "Uint8Array") return response;

  const data = response.body.body as Uint8Array;

  // Skip small responses
  if (data.byteLength < config.minSizeBytes) return response;

  // Skip already-compressed content types
  const headers = (response.headers ?? {}) as Record<string, string | undefined>;
  const contentType = headers["content-type"] ?? "";
  if (shouldSkipCompression(contentType)) return response;

  // Skip if already has Content-Encoding
  if (headers["content-encoding"]) return response;

  // Determine client's accepted encodings
  const accepted = parseAcceptEncoding(acceptEncoding);
  if (!accepted.priority) return response;

  // Compress
  const startTime = Date.now();

  const result = yield* Effect.tryPromise({
    try: async () => {
      if (accepted.priority === "br") {
        const compressed = await compressBrotli(data, config.compressionLevel);
        return { data: compressed, encoding: "br" as const };
      }
      const compressed = await compressGzip(data, config.compressionLevel);
      return { data: compressed, encoding: "gzip" as const };
    },
    catch: (cause) => new CompressionError({ cause, encoding: accepted.priority ?? "unknown" }),
  }).pipe(
    Effect.catchTag("CompressionError", (e) =>
      Effect.logWarning("Compression failed, sending uncompressed response", {
        cause: String(e.cause),
        encoding: e.encoding,
      }).pipe(Effect.as(null)),
    ),
  );

  if (!result) return response;

  // Log if compression exceeded latency budget
  const elapsed = Date.now() - startTime;
  if (elapsed > 5) {
    yield* Effect.logWarning("Compression exceeded 5ms latency budget", {
      elapsedMs: elapsed,
      encoding: result.encoding,
      originalSize: data.byteLength,
      compressedSize: result.data.byteLength,
      ratio: ((result.data.byteLength / data.byteLength) * 100).toFixed(1) + "%",
    });
  }

  // Return compressed response with appropriate headers
  return HttpServerResponse.uint8Array(result.data, {
    status: response.status,
    contentType: headers["content-type"],
    headers: {
      ...headers,
      "content-encoding": result.encoding,
      vary: "Accept-Encoding",
    },
  });
});

// ---------------------------------------------------------------------------
// Public API: decompressRequestBody
// ---------------------------------------------------------------------------

class DecompressionError extends Data.TaggedError("DecompressionError")<{
  readonly cause: unknown;
  readonly encoding: string;
}> {}

/**
 * Decompress an incoming request body based on Content-Encoding header.
 * Returns the decompressed Uint8Array or the original body if no
 * compression was applied.
 */
export const decompressRequestBody = Effect.fn(function* (
  body: Uint8Array,
  contentEncoding: string | undefined,
) {
  if (!contentEncoding) return body;

  const encoding = contentEncoding.toLowerCase();

  const decompressed = yield* Effect.tryPromise({
    try: async () => {
      if (encoding === "br" || encoding === "brotli") {
        return decompressBrotli(body);
      }
      if (encoding === "gzip" || encoding === "x-gzip") {
        return decompressGzip(body);
      }
      if (encoding === "deflate") {
        return decompressDeflate(body);
      }
      return body; // Unknown encoding — pass through
    },
    catch: (cause) => new DecompressionError({ cause, encoding }),
  }).pipe(
    Effect.catchTag("DecompressionError", (e) =>
      Effect.logWarning("Failed to decompress request body", {
        cause: String(e.cause),
        encoding: e.encoding,
      }).pipe(Effect.as(body)),
    ),
  );

  return decompressed;
});

// ---------------------------------------------------------------------------
// Layer exports
// ---------------------------------------------------------------------------

/**
 * Layer providing CompressionConfigService from environment variables.
 */
export const httpCompressionLayer = CompressionConfigService.layerFromEnv;

/**
 * Layer providing default CompressionConfigService.
 */
export const httpCompressionLayerDefault = CompressionConfigService.layerDefault;

// ---------------------------------------------------------------------------
// Internal exports for testing
// ---------------------------------------------------------------------------

export const _internal = {
  parseAcceptEncoding,
  shouldSkipCompression,
  compressBrotli,
  compressGzip,
  decompressBrotli,
  decompressGzip,
  decompressDeflate,
  DEFAULT_COMPRESSION_CONFIG,
  SKIP_COMPRESSION_PREFIXES,
};
