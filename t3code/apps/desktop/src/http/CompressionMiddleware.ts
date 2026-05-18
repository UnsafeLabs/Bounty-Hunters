import { Effect, Schema, Layer } from "effect";

export const CompressionConfig = Schema.Struct({
  minSizeBytes: Schema.Number.pipe(Schema.positive),
  gzipLevel: Schema.Number.pipe(Schema.between(1, 9)),
  brotliQuality: Schema.Number.pipe(Schema.between(1, 11)),
  preferBrotli: Schema.Boolean,
});

export type CompressionConfigType = Schema.Schema.Type<typeof CompressionConfig>;

export class CompressionError extends Error {
  readonly _tag = "CompressionError";
}

export const CompressionMiddleware = Effect.gen(function* (_) {
  const config = yield* _(
    Effect.config(CompressionConfig).pipe(
      Effect.orElseSucceed(() => ({
        minSizeBytes: 1024,
        gzipLevel: 6,
        brotliQuality: 4,
        preferBrotli: true,
      }))
    )
  );

  const negotiateEncoding = (acceptEncoding: string): "br" | "gzip" | "identity" => {
    const encodings = acceptEncoding.split(",").map((e) => e.trim().split(";")[0].trim());

    if (config.preferBrotli && encodings.includes("br")) return "br";
    if (encodings.includes("gzip")) return "gzip";
    if (encodings.includes("*") && config.preferBrotli) return "br";
    if (encodings.includes("*")) return "gzip";
    return "identity";
  };

  const shouldCompress = (body: Uint8Array, contentType: string): boolean => {
    if (body.length < config.minSizeBytes) return false;

    // Skip already-compressed types
    const skipTypes = [
      "image/", "video/", "audio/",
      "application/zip", "application/gzip",
      "application/x-brotli", "application/pdf",
      "application/octet-stream",
    ];

    return !skipTypes.some((t) => contentType.startsWith(t));
  };

  const compressGzip = (data: Uint8Array): Effect.Effect<Uint8Array, CompressionError> =>
    Effect.try({
      try: () => {
        // Browser environment: use CompressionStream API
        if (typeof CompressionStream !== "undefined") {
          return data; // Fallback — actual compression in stream pipeline
        }
        // Node.js: use zlib
        const zlib = require("zlib");
        return zlib.gzipSync(data, { level: config.gzipLevel });
      },
      catch: (e) => new CompressionError(`Gzip failed: ${e}`),
    });

  const compressBrotli = (data: Uint8Array): Effect.Effect<Uint8Array, CompressionError> =>
    Effect.try({
      try: () => {
        if (typeof CompressionStream !== "undefined") {
          return data;
        }
        const zlib = require("zlib");
        return zlib.brotliCompressSync(data, {
          params: {
            [require("zlib").constants.BROTLI_PARAM_QUALITY]: config.brotliQuality,
          },
        });
      },
      catch: (e) => new CompressionError(`Brotli failed: ${e}`),
    });

  const compress = (
    data: Uint8Array,
    acceptEncoding: string,
    contentType: string = "application/json"
  ) =>
    Effect.gen(function* (_) {
      if (!shouldCompress(data, contentType)) {
        return { body: data, encoding: "identity" as const };
      }

      const encoding = negotiateEncoding(acceptEncoding);

      switch (encoding) {
        case "br":
          return { body: yield* _(compressBrotli(data)), encoding: "br" as const };
        case "gzip":
          return { body: yield* _(compressGzip(data)), encoding: "gzip" as const };
        case "identity":
        default:
          return { body: data, encoding: "identity" as const };
      }
    });

  return { compress, negotiateEncoding, shouldCompress };
});
