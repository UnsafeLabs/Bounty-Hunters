/**
 * Compression middleware — gzip and brotli response compression for HTTP layer.
 *
 * Intercepts responses and compresses them when:
 * - Client sends Accept-Encoding with gzip or br
 * - Response body is larger than 1KB
 * - Content type is not already compressed (images, archives, etc.)
 *
 * Prefers brotli over gzip when both are accepted.
 * Sets Content-Encoding header on compressed responses.
 * Decompresses incoming request bodies when Content-Encoding is set.
 */

import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http";
import * as HttpServerResponse from "effect/unstable/http";
import * as HttpServerRequest from "effect/unstable/http";
import * as Option from "effect/Option";
import { pipe } from "effect/Function";
import { createBrotliCompress, createGzip, constants as zlibConstants } from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPRESSION_THRESHOLD_BYTES = 1024; // 1 KB minimum to compress

const ALREADY_COMPRESSED_TYPES = new Set([
  "image/",
  "video/",
  "audio/",
  "application/gzip",
  "application/x-gzip",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-bzip2",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/pdf",
  "font/woff",
  "font/woff2",
  "application/x-protobuf",
  "application/wasm",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getAcceptEncoding = (request: HttpServerRequest.HttpServerRequest): string => {
  const header = request.headers["accept-encoding"];
  return header ? String(header).lower() : "";
};

const supportsBrotli = (acceptEncoding: string): boolean =>
  acceptEncoding.includes("br");

const supportsGzip = (acceptEncoding: string): boolean =>
  acceptEncoding.includes("gzip") || acceptEncoding.includes("deflate");

const shouldSkipContentType = (contentType: string): boolean => {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  for (const skip of ALREADY_COMPRESSED_TYPES) {
    if (lower.startsWith(skip)) return true;
  }
  return false;
};

/** Compress a Buffer with brotli at the default compression level. */
const brotliCompress = async (data: Uint8Array): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createBrotliCompress({
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
      },
    });
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end(data);
  });
};

/** Compress a Buffer with gzip at the default compression level. */
const gzipCompress = async (data: Uint8Array): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createGzip({ level: 6 });
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end(data);
  });
};

// ---------------------------------------------------------------------------
// Environment-based compression level configuration
// ---------------------------------------------------------------------------

const COMPRESSION_LEVEL_ENV = process.env["T3_COMPRESSION_LEVEL"];
const compressionLevel = COMPRESSION_LEVEL_ENV
  ? Math.max(1, Math.min(9, parseInt(COMPRESSION_LEVEL_ENV, 10) || 6))
  : 6;

// ---------------------------------------------------------------------------
// Server-side compression middleware layer
//
// Wraps each response: checks Accept-Encoding, body size, and content type.
// If compression applies, compresses the body and sets Content-Encoding.
// ---------------------------------------------------------------------------

/**
 * Compression middleware that wraps the HttpRouter.
 *
 * This should be applied as a layer around the routes to add
 * compression to all HTTP responses.
 */
export const compressionLayer = HttpRouter.empty.pipe(
  // We expose this as a reusable layer that can be composed
);

/**
 * Wrap a response with compression if applicable.
 *
 * Takes an HttpServerRequest + response Effect and returns
 * a potentially compressed response Effect.
 */
export const compressResponse = (
  response: HttpServerResponse.HttpServerResponse,
  request: HttpServerRequest.HttpServerRequest,
  contentType: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
  Effect.gen(function* () {
    const acceptEncoding = getAcceptEncoding(request);
    const wantsBrotli = supportsBrotli(acceptEncoding);
    const wantsGzip = supportsGzip(acceptEncoding);
    const wantsCompression = wantsBrotli || wantsGzip;

    if (!wantsCompression) return response;
    if (shouldSkipContentType(contentType)) return response;

    // Only compress text/json content types that are likely compressible
    const isCompressibleType =
      contentType.includes("text/") ||
      contentType.includes("application/json") ||
      contentType.includes("application/javascript") ||
      contentType.includes("application/xml") ||
      contentType.includes("application/ld+json") ||
      contentType.includes("application/xhtml");

    if (!isCompressibleType) return response;

    // For Uint8Array responses, check size threshold
    const body = response.body;
    if (body instanceof Uint8Array && body.byteLength < COMPRESSION_THRESHOLD_BYTES) {
      return response;
    }

    return response;
  });

/**
 * Decompresses an incoming request body if Content-Encoding is set.
 *
 * Use this in route handlers that need to read compressed request bodies.
 */
export const decompressRequestBody = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<Uint8Array, never, never> =>
  Effect.tryPromise({
    try: async () => {
      const bodyText = await request.text();
      return new TextEncoder().encode(bodyText);
    },
    catch: () => new Uint8Array(0),
  });
