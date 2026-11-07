import { describe, it, assert } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  parseAcceptEncoding,
  shouldCompressContentType,
  compressBrotli,
  compressGzip,
  decompressGzip,
  decompressBrotli,
  compressResponseBody,
  DEFAULT_COMPRESSION_CONFIG,
} from "./httpCompression.ts";

describe("httpCompression", () => {
  describe("parseAcceptEncoding", () => {
    it("should return identity when no Accept-Encoding header", () => {
      assert.strictEqual(parseAcceptEncoding(undefined), "identity");
    });

    it("should prefer brotli over gzip", () => {
      assert.strictEqual(parseAcceptEncoding("gzip, br"), "br");
      assert.strictEqual(parseAcceptEncoding("br, gzip"), "br");
    });

    it("should return gzip when only gzip is accepted", () => {
      assert.strictEqual(parseAcceptEncoding("gzip"), "gzip");
    });

    it("should return identity when no supported encoding", () => {
      assert.strictEqual(parseAcceptEncoding("deflate"), "identity");
    });

    it("should handle quality values", () => {
      assert.strictEqual(parseAcceptEncoding("gzip;q=1.0, br;q=0.5"), "br");
    });
  });

  describe("shouldCompressContentType", () => {
    it("should compress JSON", () => {
      assert.isTrue(shouldCompressContentType("application/json"));
      assert.isTrue(shouldCompressContentType("application/json; charset=utf-8"));
    });

    it("should compress text types", () => {
      assert.isTrue(shouldCompressContentType("text/plain"));
      assert.isTrue(shouldCompressContentType("text/html"));
      assert.isTrue(shouldCompressContentType("text/css"));
    });

    it("should compress JavaScript", () => {
      assert.isTrue(shouldCompressContentType("application/javascript"));
      assert.isTrue(shouldCompressContentType("text/javascript"));
    });

    it("should not compress images", () => {
      assert.isFalse(shouldCompressContentType("image/jpeg"));
      assert.isFalse(shouldCompressContentType("image/png"));
      assert.isFalse(shouldCompressContentType("image/gif"));
    });

    it("should not compress archives", () => {
      assert.isFalse(shouldCompressContentType("application/zip"));
      assert.isFalse(shouldCompressContentType("application/gzip"));
    });

    it("should not compress video", () => {
      assert.isFalse(shouldCompressContentType("video/mp4"));
      assert.isFalse(shouldCompressContentType("video/webm"));
    });
  });

  describe("compressBrotli", () => {
    it("should compress data", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Hello, World!".repeat(100));
        const compressed = yield* compressBrotli(data, 6);

        assert.isTrue(compressed.length < data.length, "Compressed should be smaller");
      }).pipe(Effect.runPromise));

    it("should handle empty data", () =>
      Effect.gen(function* () {
        const data = new Uint8Array(0);
        const compressed = yield* compressBrotli(data, 6);

        assert.instanceOf(compressed, Uint8Array);
      }).pipe(Effect.runPromise));
  });

  describe("compressGzip", () => {
    it("should compress data", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Hello, World!".repeat(100));
        const compressed = yield* compressGzip(data, 6);

        assert.isTrue(compressed.length < data.length, "Compressed should be smaller");
      }).pipe(Effect.runPromise));
  });

  describe("decompressGzip", () => {
    it("should decompress gzip data", () =>
      Effect.gen(function* () {
        const original = new TextEncoder().encode("Hello, World!".repeat(100));
        const compressed = yield* compressGzip(original, 6);
        const decompressed = yield* decompressGzip(compressed);

        assert.deepEqual(decompressed, original);
      }).pipe(Effect.runPromise));
  });

  describe("decompressBrotli", () => {
    it("should decompress brotli data", () =>
      Effect.gen(function* () {
        const original = new TextEncoder().encode("Hello, World!".repeat(100));
        const compressed = yield* compressBrotli(original, 6);
        const decompressed = yield* decompressBrotli(compressed);

        assert.deepEqual(decompressed, original);
      }).pipe(Effect.runPromise));
  });

  describe("compressResponseBody", () => {
    it("should skip compression for small responses", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Small");
        const result = yield* compressResponseBody(data, "application/json", "gzip", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "identity");
        assert.deepEqual(result.data, data);
      }).pipe(Effect.runPromise));

    it("should skip compression when disabled", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Large data".repeat(200));
        const config = { ...DEFAULT_COMPRESSION_CONFIG, enabled: false };
        const result = yield* compressResponseBody(data, "application/json", "gzip", config);

        assert.strictEqual(result.encoding, "identity");
      }).pipe(Effect.runPromise));

    it("should skip compression for identity encoding", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Large data".repeat(200));
        const result = yield* compressResponseBody(data, "application/json", "identity", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "identity");
      }).pipe(Effect.runPromise));

    it("should skip compression for non-compressible content", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Large data".repeat(200));
        const result = yield* compressResponseBody(data, "image/jpeg", "gzip", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "identity");
      }).pipe(Effect.runPromise));

    it("should compress large JSON responses with gzip", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Large JSON data".repeat(200));
        const result = yield* compressResponseBody(data, "application/json", "gzip", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "gzip");
        assert.isTrue(result.data.length < data.length);
      }).pipe(Effect.runPromise));

    it("should compress large JSON responses with brotli", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Large JSON data".repeat(200));
        const result = yield* compressResponseBody(data, "application/json", "br", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "br");
        assert.isTrue(result.data.length < data.length);
      }).pipe(Effect.runPromise));

    it("should prefer brotli when both are supported", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("Large data".repeat(200));
        const result = yield* compressResponseBody(data, "application/json", "br", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "br");
      }).pipe(Effect.runPromise));
  });

  describe("compression threshold", () => {
    it("should not compress responses under 1KB", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("x".repeat(1023)); // Just under 1KB
        const result = yield* compressResponseBody(data, "application/json", "gzip", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "identity");
      }).pipe(Effect.runPromise));

    it("should compress responses over 1KB", () =>
      Effect.gen(function* () {
        const data = new TextEncoder().encode("x".repeat(1025)); // Just over 1KB
        const result = yield* compressResponseBody(data, "application/json", "gzip", DEFAULT_COMPRESSION_CONFIG);

        assert.strictEqual(result.encoding, "gzip");
      }).pipe(Effect.runPromise));
  });
});
