/**
 * Response compression helpers for the HTTP layer (issue #863).
 *
 * Pure negotiation + content-type skip rules so handlers can compress
 * payloads >1KB when clients advertise gzip/br. Prefer brotli over gzip.
 */

export type CompressionEncoding = "br" | "gzip";

const SKIP_TYPES = [
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-brotli",
  "application/octet-stream",
  "application/pdf",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
];

/** Minimum body size (bytes) before compression is considered. */
export const COMPRESSION_MIN_BYTES = 1024;

/**
 * Read compression level from env (1–11 for brotli-ish scale, mapped for gzip 1–9).
 * Default 4 for speed (<5ms target on typical JSON).
 */
export function compressionLevelFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.T3_HTTP_COMPRESSION_LEVEL ?? env.HTTP_COMPRESSION_LEVEL;
  if (!raw) return 4;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.min(11, Math.floor(n));
}

/**
 * Prefer brotli over gzip when both appear in Accept-Encoding.
 */
export function negotiateEncoding(
  acceptEncoding: string | null | undefined,
): CompressionEncoding | null {
  if (!acceptEncoding) return null;
  const parts = acceptEncoding
    .toLowerCase()
    .split(",")
    .map((p) => p.trim().split(";")[0]?.trim())
    .filter(Boolean) as string[];
  if (parts.includes("br") || parts.some((p) => p === "br")) return "br";
  // also accept "br;q=1.0" already stripped
  if (parts.includes("*") && !parts.includes("identity")) {
    // wildcard: prefer br
    return "br";
  }
  if (parts.includes("gzip") || parts.includes("x-gzip")) return "gzip";
  // ordered scan for q-values omitted for simplicity: first match of br then gzip
  for (const p of parts) {
    if (p === "br") return "br";
  }
  for (const p of parts) {
    if (p === "gzip" || p === "x-gzip") return "gzip";
  }
  return null;
}

export function shouldSkipContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return SKIP_TYPES.some((prefix) =>
    prefix.endsWith("/") ? ct.startsWith(prefix) : ct === prefix,
  );
}

export function shouldCompressBody(
  byteLength: number,
  contentType: string | null | undefined,
  acceptEncoding: string | null | undefined,
): CompressionEncoding | null {
  if (byteLength < COMPRESSION_MIN_BYTES) return null;
  if (shouldSkipContentType(contentType)) return null;
  return negotiateEncoding(acceptEncoding);
}

/**
 * Compress a Uint8Array with the chosen encoding using Node zlib.
 */
export async function compressBody(
  body: Uint8Array,
  encoding: CompressionEncoding,
  level: number = compressionLevelFromEnv(),
): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  const { promisify } = await import("node:util");
  if (encoding === "br") {
    const brotli = promisify(zlib.brotliCompress);
    return new Uint8Array(
      await brotli(body, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: Math.min(11, Math.max(0, level)),
        },
      }),
    );
  }
  const gzip = promisify(zlib.gzip);
  return new Uint8Array(await gzip(body, { level: Math.min(9, Math.max(1, level)) }));
}

/**
 * Decompress request bodies when Content-Encoding is gzip/br.
 */
export async function decompressBody(
  body: Uint8Array,
  contentEncoding: string | null | undefined,
): Promise<Uint8Array> {
  if (!contentEncoding) return body;
  const enc = contentEncoding.toLowerCase().trim();
  const zlib = await import("node:zlib");
  const { promisify } = await import("node:util");
  if (enc === "br") {
    const brotli = promisify(zlib.brotliDecompress);
    return new Uint8Array(await brotli(body));
  }
  if (enc === "gzip" || enc === "x-gzip") {
    const gunzip = promisify(zlib.gunzip);
    return new Uint8Array(await gunzip(body));
  }
  return body;
}
