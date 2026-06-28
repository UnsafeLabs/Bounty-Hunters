import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  BROTLI_QUALITY_ENV_VAR,
  compressBuffer,
  compressResponseBody,
  contentEncodingResponseHeaders,
  decodeRequestBody,
  decompressBuffer,
  DEFAULT_BROTLI_QUALITY,
  DEFAULT_GZIP_LEVEL,
  DEFAULT_MIN_COMPRESS_BYTES,
  GZIP_LEVEL_ENV_VAR,
  isCompressibleContentType,
  MIN_COMPRESS_BYTES_ENV_VAR,
  negotiateContentEncoding,
  parseRequestContentEncodings,
  resolveCompressionOptionsFromEnv,
  UnsupportedContentEncodingError,
} from "./httpCompression.ts";

// ~8.8 KiB of repetitive text — comfortably above DEFAULT_MIN_COMPRESS_BYTES and
// highly compressible, so gzip/brotli output is reliably smaller than the input.
const textBody = (repeat = 200) =>
  new TextEncoder().encode("the quick brown fox jumps over the lazy dog ".repeat(repeat));

describe("negotiateContentEncoding", () => {
  it("returns identity when the header is missing or empty", () => {
    expect(negotiateContentEncoding(undefined)).toBe("identity");
    expect(negotiateContentEncoding(null)).toBe("identity");
    expect(negotiateContentEncoding("")).toBe("identity");
    expect(negotiateContentEncoding("   ")).toBe("identity");
  });

  it("selects the requested supported coding", () => {
    expect(negotiateContentEncoding("gzip")).toBe("gzip");
    expect(negotiateContentEncoding("br")).toBe("br");
  });

  it("prefers brotli over gzip when weights are equal", () => {
    expect(negotiateContentEncoding("gzip, br")).toBe("br");
    expect(negotiateContentEncoding("br, gzip")).toBe("br");
  });

  it("respects client q-weights over the server preference", () => {
    expect(negotiateContentEncoding("br;q=0.5, gzip;q=1.0")).toBe("gzip");
    expect(negotiateContentEncoding("gzip;q=0.2, br;q=0.9")).toBe("br");
  });

  it("treats q=0 as not acceptable", () => {
    expect(negotiateContentEncoding("br;q=0, gzip")).toBe("gzip");
    expect(negotiateContentEncoding("gzip;q=0")).toBe("identity");
    expect(negotiateContentEncoding("br;q=0, gzip;q=0")).toBe("identity");
  });

  it("honours the wildcard coding", () => {
    expect(negotiateContentEncoding("*")).toBe("br");
    expect(negotiateContentEncoding("identity, *;q=0")).toBe("identity");
  });

  it("ignores unsupported and malformed codings", () => {
    expect(negotiateContentEncoding("deflate")).toBe("identity");
    expect(negotiateContentEncoding("deflate, gzip")).toBe("gzip");
    expect(negotiateContentEncoding("gzip;q=foo")).toBe("identity");
    expect(negotiateContentEncoding("identity")).toBe("identity");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(negotiateContentEncoding("  GZIP ;Q=0.8 ")).toBe("gzip");
  });
});

describe("isCompressibleContentType", () => {
  it("compresses text-like and unknown content types", () => {
    expect(isCompressibleContentType("text/html; charset=utf-8")).toBe(true);
    expect(isCompressibleContentType("application/json")).toBe(true);
    expect(isCompressibleContentType("application/javascript")).toBe(true);
    expect(isCompressibleContentType("image/svg+xml")).toBe(true);
    expect(isCompressibleContentType(undefined)).toBe(true);
    expect(isCompressibleContentType("")).toBe(true);
  });

  it("skips already-compressed content types", () => {
    expect(isCompressibleContentType("image/png")).toBe(false);
    expect(isCompressibleContentType("image/jpeg")).toBe(false);
    expect(isCompressibleContentType("video/mp4")).toBe(false);
    expect(isCompressibleContentType("audio/mpeg")).toBe(false);
    expect(isCompressibleContentType("font/woff2")).toBe(false);
    expect(isCompressibleContentType("application/zip")).toBe(false);
    expect(isCompressibleContentType("application/epub+zip")).toBe(false);
  });
});

describe("compressBuffer", () => {
  it("gzip output round-trips back to the original", () => {
    const original = textBody();
    const compressed = compressBuffer(original, "gzip");
    expect(compressed.byteLength).toBeLessThan(original.byteLength);
    expect(gunzipSync(compressed)).toEqual(Buffer.from(original));
  });

  it("brotli output round-trips back to the original", () => {
    const original = textBody();
    const compressed = compressBuffer(original, "br");
    expect(compressed.byteLength).toBeLessThan(original.byteLength);
    expect(brotliDecompressSync(compressed)).toEqual(Buffer.from(original));
  });
});

describe("compressResponseBody", () => {
  it("compresses a large compressible body with the negotiated coding", () => {
    const original = textBody();
    const result = compressResponseBody({
      data: original,
      acceptEncoding: "gzip, br",
      contentType: "text/html; charset=utf-8",
    });
    expect(result.encoding).toBe("br");
    expect(result.body.byteLength).toBeLessThan(original.byteLength);
    expect(brotliDecompressSync(result.body)).toEqual(Buffer.from(original));
  });

  it("falls back to gzip when brotli is not accepted", () => {
    const original = textBody();
    const result = compressResponseBody({
      data: original,
      acceptEncoding: "gzip",
      contentType: "application/javascript",
    });
    expect(result.encoding).toBe("gzip");
    expect(gunzipSync(result.body)).toEqual(Buffer.from(original));
  });

  it("leaves the body untouched when the client accepts no supported coding", () => {
    const original = textBody();
    const result = compressResponseBody({
      data: original,
      acceptEncoding: "identity",
      contentType: "text/html",
    });
    expect(result.encoding).toBe("identity");
    expect(result.body).toBe(original);
  });

  it("does not compress bodies below the size threshold", () => {
    const original = new TextEncoder().encode("small");
    const result = compressResponseBody({
      data: original,
      acceptEncoding: "br",
      contentType: "text/plain",
    });
    expect(result.encoding).toBe("identity");
    expect(result.body).toBe(original);
  });

  it("does not compress already-compressed content types", () => {
    const original = textBody();
    const result = compressResponseBody({
      data: original,
      acceptEncoding: "br",
      contentType: "image/png",
    });
    expect(result.encoding).toBe("identity");
    expect(result.body).toBe(original);
  });

  it("honours a custom minBytes threshold", () => {
    const original = textBody();
    const result = compressResponseBody({
      data: original,
      acceptEncoding: "gzip",
      contentType: "text/plain",
      options: { minBytes: original.byteLength + 1 },
    });
    expect(result.encoding).toBe("identity");
    expect(result.body).toBe(original);
  });

  it("throws on a non-Uint8Array body", () => {
    expect(() =>
      compressResponseBody({
        data: "not bytes" as unknown as Uint8Array,
        acceptEncoding: "gzip",
      }),
    ).toThrow(TypeError);
  });

  it("throws on an invalid minBytes option", () => {
    expect(() =>
      compressResponseBody({
        data: textBody(),
        acceptEncoding: "gzip",
        options: { minBytes: -1 },
      }),
    ).toThrow(TypeError);
  });
});

describe("parseRequestContentEncodings", () => {
  it("returns an empty list for a missing, empty, or identity encoding", () => {
    expect(parseRequestContentEncodings(undefined)).toEqual([]);
    expect(parseRequestContentEncodings(null)).toEqual([]);
    expect(parseRequestContentEncodings("")).toEqual([]);
    expect(parseRequestContentEncodings("identity")).toEqual([]);
  });

  it("parses supported codings case-insensitively and treats x-gzip as gzip", () => {
    expect(parseRequestContentEncodings("gzip")).toEqual(["gzip"]);
    expect(parseRequestContentEncodings("  BR ")).toEqual(["br"]);
    expect(parseRequestContentEncodings("x-gzip")).toEqual(["gzip"]);
    expect(parseRequestContentEncodings("gzip, br")).toEqual(["gzip", "br"]);
    expect(parseRequestContentEncodings("identity, gzip")).toEqual(["gzip"]);
  });

  it("throws UnsupportedContentEncodingError on an unknown coding", () => {
    expect(() => parseRequestContentEncodings("deflate")).toThrow(UnsupportedContentEncodingError);
    expect(() => parseRequestContentEncodings("gzip, zstd")).toThrow(
      UnsupportedContentEncodingError,
    );
  });
});

describe("decompressBuffer", () => {
  it("reverses gzip and brotli compression", () => {
    const original = textBody();
    expect(decompressBuffer(compressBuffer(original, "gzip"), "gzip")).toEqual(
      Buffer.from(original),
    );
    expect(decompressBuffer(compressBuffer(original, "br"), "br")).toEqual(Buffer.from(original));
  });

  it("throws on a non-Uint8Array body", () => {
    expect(() => decompressBuffer("nope" as unknown as Uint8Array, "gzip")).toThrow(TypeError);
  });
});

describe("decodeRequestBody", () => {
  it("returns the body unchanged when no encoding is applied", () => {
    const original = textBody();
    expect(decodeRequestBody({ data: original, contentEncoding: undefined })).toBe(original);
    expect(decodeRequestBody({ data: original, contentEncoding: "identity" })).toBe(original);
  });

  it("decompresses a gzip-encoded request body", () => {
    const original = new TextEncoder().encode(JSON.stringify({ hello: "world", n: 42 }));
    const encoded = new Uint8Array(gzipSync(original));
    const decoded = decodeRequestBody({ data: encoded, contentEncoding: "gzip" });
    expect(decoded).toEqual(Buffer.from(original));
    expect(JSON.parse(new TextDecoder().decode(decoded))).toEqual({ hello: "world", n: 42 });
  });

  it("decompresses a brotli-encoded request body case-insensitively", () => {
    const original = textBody();
    const encoded = new Uint8Array(brotliCompressSync(original));
    expect(decodeRequestBody({ data: encoded, contentEncoding: "BR" })).toEqual(
      Buffer.from(original),
    );
  });

  it("reverses chained encodings in application order", () => {
    const original = textBody();
    // Applied gzip first, then brotli: Content-Encoding: gzip, br
    const encoded = new Uint8Array(brotliCompressSync(gzipSync(original)));
    expect(decodeRequestBody({ data: encoded, contentEncoding: "gzip, br" })).toEqual(
      Buffer.from(original),
    );
  });

  it("throws UnsupportedContentEncodingError on an unknown coding", () => {
    expect(() => decodeRequestBody({ data: textBody(), contentEncoding: "deflate" })).toThrow(
      UnsupportedContentEncodingError,
    );
  });

  it("throws on a non-Uint8Array body", () => {
    expect(() =>
      decodeRequestBody({ data: "nope" as unknown as Uint8Array, contentEncoding: "gzip" }),
    ).toThrow(TypeError);
  });
});

describe("resolveCompressionOptionsFromEnv", () => {
  it("falls back to the documented defaults when the env is empty", () => {
    expect(resolveCompressionOptionsFromEnv({})).toEqual({
      gzipLevel: DEFAULT_GZIP_LEVEL,
      brotliQuality: DEFAULT_BROTLI_QUALITY,
      minBytes: DEFAULT_MIN_COMPRESS_BYTES,
    });
  });

  it("ignores blank values and uses defaults", () => {
    expect(
      resolveCompressionOptionsFromEnv({ [GZIP_LEVEL_ENV_VAR]: "   " }).gzipLevel,
    ).toBe(DEFAULT_GZIP_LEVEL);
  });

  it("reads configured levels from the environment", () => {
    const options = resolveCompressionOptionsFromEnv({
      [GZIP_LEVEL_ENV_VAR]: "9",
      [BROTLI_QUALITY_ENV_VAR]: "11",
      [MIN_COMPRESS_BYTES_ENV_VAR]: "2048",
    });
    expect(options).toEqual({ gzipLevel: 9, brotliQuality: 11, minBytes: 2048 });
  });

  it("throws RangeError on out-of-range or non-integer values", () => {
    expect(() => resolveCompressionOptionsFromEnv({ [GZIP_LEVEL_ENV_VAR]: "10" })).toThrow(
      RangeError,
    );
    expect(() => resolveCompressionOptionsFromEnv({ [BROTLI_QUALITY_ENV_VAR]: "12" })).toThrow(
      RangeError,
    );
    expect(() => resolveCompressionOptionsFromEnv({ [GZIP_LEVEL_ENV_VAR]: "6.5" })).toThrow(
      RangeError,
    );
    expect(() => resolveCompressionOptionsFromEnv({ [MIN_COMPRESS_BYTES_ENV_VAR]: "-1" })).toThrow(
      RangeError,
    );
  });

  it("feeds the configured gzip level into compressResponseBody", () => {
    const original = textBody();
    const options = resolveCompressionOptionsFromEnv({ [GZIP_LEVEL_ENV_VAR]: "9" });
    const result = compressResponseBody({
      data: original,
      acceptEncoding: "gzip",
      contentType: "application/json",
      options,
    });
    expect(result.encoding).toBe("gzip");
    expect(gunzipSync(result.body)).toEqual(Buffer.from(original));
    // The configured level must reach zlib: byte-identical to an explicit level-9 gzip.
    expect(Buffer.from(result.body)).toEqual(Buffer.from(gzipSync(original, { level: 9 })));
  });
});

describe("contentEncodingResponseHeaders", () => {
  it("advertises Vary without Content-Encoding for identity", () => {
    expect(contentEncodingResponseHeaders("identity")).toEqual({ Vary: "Accept-Encoding" });
  });

  it("sets Content-Encoding for compressed responses", () => {
    expect(contentEncodingResponseHeaders("gzip")).toEqual({
      "Content-Encoding": "gzip",
      Vary: "Accept-Encoding",
    });
    expect(contentEncodingResponseHeaders("br")).toEqual({
      "Content-Encoding": "br",
      Vary: "Accept-Encoding",
    });
  });
});
