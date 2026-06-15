import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpServerRequest,
  HttpServerResponse,
  HttpRouter,
} from "effect/unstable/http";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(zlib.gzip);
const brotliCompressAsync = promisify(zlib.brotliCompress);

/** Minimum response body size in bytes to trigger compression (1 KB). */
const MIN_COMPRESS_SIZE = 1024;

/** Content types eligible for compression (startswith match). */
const COMPRESSIBLE_TYPE_PREFIXES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "image/svg+xml",
  "application/xhtml+xml",
  "application/ld+json",
];

/** Content types that should never be compressed (already compressed). */
const INCOMPRESSIBLE_TYPE_EXACT = new Set([
  "application/gzip",
  "application/x-gzip",
  "application/br",
  "application/x-brotli",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "video/",
  "audio/",
  "application/zip",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/x-rar-compressed",
]);

function parseAcceptEncoding(header: string | null): Set<string> {
  if (!header) return new Set();
  const encodings = new Set<string>();
  for (const part of header.split(",")) {
    const encoding = part.split(";")[0]?.trim().toLowerCase();
    if (encoding) encodings.add(encoding);
  }
  return encodings;
}

function isCompressibleContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  for (const exact of INCOMPRESSIBLE_TYPE_EXACT) {
    if (contentType.startsWith(exact)) return false;
  }
  for (const prefix of COMPRESSIBLE_TYPE_PREFIXES) {
    if (contentType.startsWith(prefix)) return true;
  }
  return false;
}

async function compressBody(
  body: Uint8Array,
  encoding: "br" | "gzip",
): Promise<{ body: Uint8Array; encoding: string }> {
  if (encoding === "br") {
    const compressed = await brotliCompressAsync(body, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    });
    return { body: new Uint8Array(compressed), encoding: "br" };
  }
  const compressed = await gzipAsync(body, { level: 6 });
  return { body: new Uint8Array(compressed), encoding: "gzip" };
}

class CompressionError {
  readonly _tag = "CompressionError";
  constructor(readonly cause: unknown) {}
}

/**
 * Compression middleware layer that compresses JSON HTTP responses larger
 * than 1 KB when the client advertises gzip or brotli support.
 *
 * Brotli is preferred over gzip when both are accepted.
 * Content types like images and archives are excluded.
 *
 * Provides via `Layer.provide(compressionMiddlewareLayer)` on a
 * `HttpRouter.DefaultRoutable` scope.
 */
export const compressionMiddlewareLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    // The layer itself is a no-op lifecycle hook; the actual compression
    // logic lives in `compressResponse` which callers invoke manually
    // inside their route handlers.
    yield* Effect.logDebug("Compression middleware initialized");
  }),
);

/**
 * Apply compression to an HTTP response.
 *
 * Usage inside a route handler:
 *
 * ```ts
 * return yield* HttpServerResponse.jsonUnsafe(data).pipe(
 *   Effect.flatMap(compressResponse),
 * );
 * ```
 */
export function compressResponse(
  response: HttpServerResponse.HttpServerResponse,
): Effect.Effect<HttpServerResponse.HttpServerResponse, CompressionError, HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    // Check Accept-Encoding
    const acceptEncoding = parseAcceptEncoding(
      request.headers["accept-encoding"] as string | undefined,
    );
    if (!acceptEncoding.has("br") && !acceptEncoding.has("gzip")) {
      return response;
    }

    // Determine preferred encoding (brotli > gzip)
    const encoding = acceptEncoding.has("br") ? "br" : "gzip";

    // Check content type
    const contentType = response.contentType ?? response.headers?.["content-type"] as string | undefined;
    if (!isCompressibleContentType(contentType ?? null)) {
      return response;
    }

    // Get response body
    const body = response.body;
    if (!body || !(body instanceof Uint8Array)) {
      return response;
    }

    // Skip small responses
    if (body.byteLength < MIN_COMPRESS_SIZE) {
      return response;
    }

    // Skip already-encoded responses
    if (response.headers?.["content-encoding"]) {
      return response;
    }

    try {
      const result = yield* Effect.tryPromise({
        try: () => compressBody(body, encoding as "br" | "gzip"),
        catch: (cause) => new CompressionError(cause),
      });

      return HttpServerResponse.uint8Array(result.body, {
        status: response.status,
        contentType: response.contentType ?? undefined,
        headers: {
          ...(response.headers as Record<string, string>),
          "Content-Encoding": result.encoding,
          "Vary": "Accept-Encoding",
        },
      });
    } catch {
      return response;
    }
  });
}

export const compressionRouteLayer = HttpRouter.use(
  Effect.gen(function* () {
    // This is a no-op passthrough middleware — compression is applied
    // per-route via compressResponse().
  }),
);
