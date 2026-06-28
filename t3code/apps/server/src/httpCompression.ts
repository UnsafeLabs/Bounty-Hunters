/**
 * HTTP response compression helpers.
 *
 * Pure, side-effect-free utilities for negotiating a response content-encoding
 * from a request `Accept-Encoding` header and compressing a response body with
 * gzip or brotli. The HTTP routes own where these are applied; this module owns
 * the (testable) decision and the actual compression.
 *
 * @module httpCompression
 */
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  gunzipSync,
  gzipSync,
} from "node:zlib";

/** Content-codings this server can produce. */
export type SupportedContentEncoding = "br" | "gzip";

/** Result of content-encoding negotiation; `identity` means "do not compress". */
export type NegotiatedContentEncoding = SupportedContentEncoding | "identity";

// Tie-break order applied when the client weights codings equally: brotli first,
// since it generally yields a smaller payload than gzip for text assets.
const ENCODING_PREFERENCE: readonly SupportedContentEncoding[] = ["br", "gzip"];

/** Bodies smaller than this (in bytes) are not worth compressing. */
export const DEFAULT_MIN_COMPRESS_BYTES = 1024;
/** zlib default gzip level (speed/ratio balance). */
export const DEFAULT_GZIP_LEVEL = 6;
/** Brotli quality tuned for dynamic responses (11 is far too slow to do per-request). */
export const DEFAULT_BROTLI_QUALITY = 5;

// Content types that are already compressed (or not meaningfully compressible);
// running them through gzip/brotli wastes CPU and can grow the payload.
const INCOMPRESSIBLE_CONTENT_TYPE_PATTERNS: readonly RegExp[] = [
  /^image\/(?!svg\+xml)/, // raster images are already compressed; svg is text
  /^video\//,
  /^audio\//,
  /^font\/woff2?$/, // woff/woff2 carry their own compression
  /^application\/(?:zip|gzip|x-gzip|br|x-brotli|x-bzip|x-bzip2|x-7z-compressed|x-rar-compressed|x-xz|zstd)$/,
  /\+(?:zip|gzip)$/, // e.g. application/epub+zip
];

/**
 * Whether a response with the given `Content-Type` is worth compressing. Unknown
 * (`undefined`/empty) content types default to compressible.
 */
export function isCompressibleContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return true;
  }
  const essence = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (essence.length === 0) {
    return true;
  }
  return !INCOMPRESSIBLE_CONTENT_TYPE_PATTERNS.some((pattern) => pattern.test(essence));
}

function parseQualityValue(parameterParts: readonly string[]): number {
  for (const parameter of parameterParts) {
    const [key, value] = parameter.split("=");
    if (key !== undefined && key.trim().toLowerCase() === "q") {
      const parsed = Number.parseFloat((value ?? "").trim());
      if (!Number.isFinite(parsed)) {
        // Malformed weight (e.g. `q=foo`) is treated as not acceptable.
        return 0;
      }
      return Math.min(1, Math.max(0, parsed));
    }
  }
  return 1;
}

/**
 * Negotiate a content-coding from an `Accept-Encoding` header value.
 *
 * Follows RFC 7231 §5.3.4: respects `q` weights, honours `*`, treats `q=0` as
 * "not acceptable", and only ever returns a coding this server supports. Returns
 * `identity` when the client accepts nothing we can produce.
 */
export function negotiateContentEncoding(
  acceptEncoding: string | null | undefined,
): NegotiatedContentEncoding {
  if (acceptEncoding === null || acceptEncoding === undefined || acceptEncoding.trim().length === 0) {
    return "identity";
  }

  const weights = new Map<string, number>();
  for (const segment of acceptEncoding.split(",")) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const [codingPart, ...parameterParts] = trimmed.split(";");
    const coding = codingPart.trim().toLowerCase();
    if (coding.length === 0) {
      continue;
    }
    weights.set(coding, parseQualityValue(parameterParts));
  }

  const wildcardWeight = weights.get("*");
  const weightFor = (coding: SupportedContentEncoding): number => {
    const explicit = weights.get(coding);
    if (explicit !== undefined) {
      return explicit;
    }
    return wildcardWeight ?? 0;
  };

  let best: NegotiatedContentEncoding = "identity";
  let bestWeight = 0;
  for (const coding of ENCODING_PREFERENCE) {
    const weight = weightFor(coding);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = coding;
    }
  }
  return best;
}

/** Options controlling the gzip level / brotli quality used by {@link compressBuffer}. */
export interface CompressBufferOptions {
  readonly gzipLevel?: number;
  readonly brotliQuality?: number;
}

function assertUint8Array(data: Uint8Array): void {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("compression requires a Uint8Array body");
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

/** Compress a buffer with the given supported coding. */
export function compressBuffer(
  data: Uint8Array,
  encoding: SupportedContentEncoding,
  options: CompressBufferOptions = {},
): Uint8Array {
  assertUint8Array(data);
  switch (encoding) {
    case "gzip":
      return gzipSync(data, { level: options.gzipLevel ?? DEFAULT_GZIP_LEVEL });
    case "br":
      return brotliCompressSync(data, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: options.brotliQuality ?? DEFAULT_BROTLI_QUALITY,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.byteLength,
        },
      });
  }
}

/** Tunable knobs for {@link compressResponseBody}. */
export interface CompressResponseOptions extends CompressBufferOptions {
  /** Bodies below this many bytes are left uncompressed. Defaults to {@link DEFAULT_MIN_COMPRESS_BYTES}. */
  readonly minBytes?: number;
  /** Override the content-type compressibility check (defaults to {@link isCompressibleContentType}). */
  readonly isCompressibleContentType?: (contentType: string | undefined) => boolean;
}

/** Outcome of {@link compressResponseBody}: the chosen coding and the body to send. */
export interface CompressedResponseBody {
  readonly encoding: NegotiatedContentEncoding;
  readonly body: Uint8Array;
}

/**
 * Decide whether and how to compress a response body, returning the coding plus
 * the (possibly compressed) bytes. When the result is `identity` the original
 * `data` is returned unchanged. Throws {@link TypeError} on invalid input.
 */
export function compressResponseBody(params: {
  readonly data: Uint8Array;
  readonly acceptEncoding: string | null | undefined;
  readonly contentType?: string;
  readonly options?: CompressResponseOptions;
}): CompressedResponseBody {
  const { data, acceptEncoding, contentType, options = {} } = params;
  assertUint8Array(data);

  const minBytes = options.minBytes ?? DEFAULT_MIN_COMPRESS_BYTES;
  assertNonNegativeInteger(minBytes, "minBytes");
  const compressible = options.isCompressibleContentType ?? isCompressibleContentType;

  if (data.byteLength < minBytes || !compressible(contentType)) {
    return { encoding: "identity", body: data };
  }

  const encoding = negotiateContentEncoding(acceptEncoding);
  if (encoding === "identity") {
    return { encoding, body: data };
  }
  return { encoding, body: compressBuffer(data, encoding, options) };
}

/**
 * Response headers that describe a negotiated coding. Always advertises
 * `Vary: Accept-Encoding` so shared caches key on the request encoding, and adds
 * `Content-Encoding` only when the body was actually compressed.
 */
export function contentEncodingResponseHeaders(
  encoding: NegotiatedContentEncoding,
): Record<string, string> {
  return encoding === "identity"
    ? { Vary: "Accept-Encoding" }
    : { "Content-Encoding": encoding, Vary: "Accept-Encoding" };
}

/**
 * Thrown by {@link decodeRequestBody} when a request advertises a
 * `Content-Encoding` this server cannot decode. Callers should map this to a
 * `415 Unsupported Media Type` response.
 */
export class UnsupportedContentEncodingError extends Error {
  override readonly name = "UnsupportedContentEncodingError";
  /** The unrecognised coding token, lower-cased. */
  readonly coding: string;
  constructor(coding: string) {
    super(`unsupported request Content-Encoding: ${coding}`);
    this.coding = coding;
  }
}

/** Decompress a buffer encoded with the given supported coding. */
export function decompressBuffer(data: Uint8Array, encoding: SupportedContentEncoding): Uint8Array {
  assertUint8Array(data);
  switch (encoding) {
    case "gzip":
      return gunzipSync(data);
    case "br":
      return brotliDecompressSync(data);
  }
}

/**
 * Parse a request `Content-Encoding` header into the ordered list of supported
 * codings that were applied to the body. `identity` and empty tokens are
 * dropped; `x-gzip` is treated as `gzip` (RFC 7230 legacy alias). Throws
 * {@link UnsupportedContentEncodingError} on any coding this server cannot
 * decode, so a malformed/unknown encoding never silently passes through.
 */
export function parseRequestContentEncodings(
  contentEncoding: string | null | undefined,
): SupportedContentEncoding[] {
  if (contentEncoding === null || contentEncoding === undefined) {
    return [];
  }
  const codings: SupportedContentEncoding[] = [];
  for (const segment of contentEncoding.split(",")) {
    const coding = segment.trim().toLowerCase();
    if (coding.length === 0 || coding === "identity") {
      continue;
    }
    if (coding === "gzip" || coding === "x-gzip") {
      codings.push("gzip");
    } else if (coding === "br") {
      codings.push("br");
    } else {
      throw new UnsupportedContentEncodingError(coding);
    }
  }
  return codings;
}

/**
 * Decode an incoming request body according to its `Content-Encoding` header.
 *
 * Reverses the codings in the order they were applied (last-applied is decoded
 * first), so chained encodings such as `gzip, br` round-trip correctly. When no
 * (or only `identity`) encoding is present the original bytes are returned
 * unchanged. Throws {@link TypeError} on a non-`Uint8Array` body and
 * {@link UnsupportedContentEncodingError} on an unknown coding.
 */
export function decodeRequestBody(params: {
  readonly data: Uint8Array;
  readonly contentEncoding: string | null | undefined;
}): Uint8Array {
  const { data, contentEncoding } = params;
  assertUint8Array(data);
  const codings = parseRequestContentEncodings(contentEncoding);
  let decoded = data;
  // Decode in reverse of the order the codings were applied (RFC 7231 §3.1.2.2).
  for (const coding of [...codings].reverse()) {
    decoded = decompressBuffer(decoded, coding);
  }
  return decoded;
}

/** Environment variable that overrides the gzip compression level (0–9). */
export const GZIP_LEVEL_ENV_VAR = "T3CODE_HTTP_COMPRESSION_GZIP_LEVEL";
/** Environment variable that overrides the brotli quality (0–11). */
export const BROTLI_QUALITY_ENV_VAR = "T3CODE_HTTP_COMPRESSION_BROTLI_QUALITY";
/** Environment variable that overrides the minimum compressible body size in bytes. */
export const MIN_COMPRESS_BYTES_ENV_VAR = "T3CODE_HTTP_COMPRESSION_MIN_BYTES";

function parseBoundedIntEnv(
  rawValue: string | undefined,
  spec: {
    readonly min: number;
    readonly max: number;
    readonly label: string;
    readonly fallback: number;
  },
): number {
  if (rawValue === undefined) {
    return spec.fallback;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return spec.fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < spec.min || parsed > spec.max) {
    throw new RangeError(
      `${spec.label} must be an integer in [${spec.min}, ${spec.max}], received ${JSON.stringify(rawValue)}`,
    );
  }
  return parsed;
}

/**
 * Build {@link CompressResponseOptions} from environment variables, falling back
 * to the documented defaults when a variable is unset or empty. Pure: the source
 * environment is an explicit argument (defaults to `process.env`). Throws
 * {@link RangeError} when a variable holds an out-of-range or non-integer value
 * rather than silently degrading to a default.
 */
export function resolveCompressionOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): CompressResponseOptions {
  return {
    gzipLevel: parseBoundedIntEnv(env[GZIP_LEVEL_ENV_VAR], {
      min: zlibConstants.Z_NO_COMPRESSION,
      max: zlibConstants.Z_BEST_COMPRESSION,
      label: GZIP_LEVEL_ENV_VAR,
      fallback: DEFAULT_GZIP_LEVEL,
    }),
    brotliQuality: parseBoundedIntEnv(env[BROTLI_QUALITY_ENV_VAR], {
      min: zlibConstants.BROTLI_MIN_QUALITY,
      max: zlibConstants.BROTLI_MAX_QUALITY,
      label: BROTLI_QUALITY_ENV_VAR,
      fallback: DEFAULT_BROTLI_QUALITY,
    }),
    minBytes: parseBoundedIntEnv(env[MIN_COMPRESS_BYTES_ENV_VAR], {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      label: MIN_COMPRESS_BYTES_ENV_VAR,
      fallback: DEFAULT_MIN_COMPRESS_BYTES,
    }),
  };
}
