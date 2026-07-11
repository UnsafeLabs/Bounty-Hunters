import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";

import {
  MIN_COMPRESS_BYTES,
  compressBytes,
  decompressBytes,
  decompressRequestBody,
  getConfiguredCompressionLevel,
  maybeCompressBody,
  negotiateEncoding,
  parseCompressionLevel,
  shouldSkipContentType,
} from "./httpCompression.ts";

describe("httpCompression pure helpers", () => {
  it("prefers brotli over gzip when both accepted", () => {
    expect(negotiateEncoding("gzip, deflate, br")).toBe("br");
    expect(negotiateEncoding("gzip")).toBe("gzip");
    expect(negotiateEncoding("identity")).toBeNull();
    expect(negotiateEncoding(undefined)).toBeNull();
  });

  it("skips images and archives", () => {
    expect(shouldSkipContentType("image/png")).toBe(true);
    expect(shouldSkipContentType("application/zip")).toBe(true);
    expect(shouldSkipContentType("application/json")).toBe(false);
    expect(shouldSkipContentType("text/html; charset=utf-8")).toBe(false);
  });

  it("parses COMPRESSION_LEVEL with clamp", () => {
    expect(parseCompressionLevel(undefined)).toBe(4);
    expect(parseCompressionLevel("6")).toBe(6);
    expect(parseCompressionLevel("99")).toBe(11);
    expect(parseCompressionLevel("-3")).toBe(0);
    expect(getConfiguredCompressionLevel({ COMPRESSION_LEVEL: "5" })).toBe(5);
  });

  it("skips bodies under 1KB", () => {
    const small = new TextEncoder().encode("x".repeat(100));
    const result = maybeCompressBody({
      body: small,
      contentType: "application/json",
      acceptEncoding: "br, gzip",
      alreadyEncoded: false,
      level: 4,
    });
    expect(result.contentEncoding).toBeNull();
    expect(result.body.byteLength).toBe(small.byteLength);
  });

  it("compresses large JSON with brotli preferred", () => {
    const large = new TextEncoder().encode(JSON.stringify({ data: "y".repeat(MIN_COMPRESS_BYTES) }));
    const result = maybeCompressBody({
      body: large,
      contentType: "application/json",
      acceptEncoding: "gzip, br",
      alreadyEncoded: false,
      level: 4,
    });
    expect(result.contentEncoding).toBe("br");
    expect(result.body.byteLength).toBeLessThan(large.byteLength);
  });

  it("uses gzip when brotli not accepted", () => {
    const large = new TextEncoder().encode("z".repeat(MIN_COMPRESS_BYTES * 2));
    const result = maybeCompressBody({
      body: large,
      contentType: "text/plain",
      acceptEncoding: "gzip",
      alreadyEncoded: false,
      level: 4,
    });
    expect(result.contentEncoding).toBe("gzip");
  });

  it("never recompresses already-encoded responses", () => {
    const large = new TextEncoder().encode("a".repeat(MIN_COMPRESS_BYTES * 2));
    const result = maybeCompressBody({
      body: large,
      contentType: "application/json",
      acceptEncoding: "br",
      alreadyEncoded: true,
      level: 4,
    });
    expect(result.contentEncoding).toBeNull();
  });

  it("round-trips gzip request body decompression", () => {
    const original = new TextEncoder().encode(JSON.stringify({ hello: "world", pad: "p".repeat(200) }));
    const compressed = gzipSync(original);
    const roundTrip = decompressRequestBody(compressed, "gzip");
    expect(new TextDecoder().decode(roundTrip)).toBe(new TextDecoder().decode(original));
  });

  it("compressBytes/decompressBytes br round-trip", () => {
    const original = new TextEncoder().encode("brotli-payload-".repeat(200));
    const compressed = compressBytes(original, "br", 4);
    const restored = decompressBytes(compressed, "br");
    expect(new TextDecoder().decode(restored)).toBe(new TextDecoder().decode(original));
  });
});
