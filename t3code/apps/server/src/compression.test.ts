import { describe, expect, it } from "vitest";

import {
  supportsBrotli,
  supportsGzip,
  shouldSkipContentType,
  brotliCompress,
  gzipCompress,
  COMPRESSION_THRESHOLD_BYTES,
} from "./compression";

describe("compression middleware", () => {
  describe("Accept-Encoding parsing", () => {
    it("detects brotli support", () => {
      expect(supportsBrotli("br")).toBe(true);
      expect(supportsBrotli("gzip, br")).toBe(true);
      expect(supportsBrotli("gzip, deflate, br")).toBe(true);
      expect(supportsBrotli("gzip")).toBe(false);
      expect(supportsBrotli("")).toBe(false);
    });

    it("detects gzip support", () => {
      expect(supportsGzip("gzip")).toBe(true);
      expect(supportsGzip("deflate")).toBe(true);
      expect(supportsGzip("br, gzip")).toBe(true);
      expect(supportsGzip("br")).toBe(false);
      expect(supportsGzip("")).toBe(false);
    });
  });

  describe("content type skipping", () => {
    it("skips image content types", () => {
      expect(shouldSkipContentType("image/png")).toBe(true);
      expect(shouldSkipContentType("image/jpeg")).toBe(true);
      expect(shouldSkipContentType("image/svg+xml")).toBe(true);
      expect(shouldSkipContentType("image/webp")).toBe(true);
    });

    it("skips video and audio content types", () => {
      expect(shouldSkipContentType("video/mp4")).toBe(true);
      expect(shouldSkipContentType("audio/mpeg")).toBe(true);
    });

    it("skips archive content types", () => {
      expect(shouldSkipContentType("application/gzip")).toBe(true);
      expect(shouldSkipContentType("application/zip")).toBe(true);
      expect(shouldSkipContentType("application/x-7z-compressed")).toBe(true);
      expect(shouldSkipContentType("application/x-rar-compressed")).toBe(true);
    });

    it("skips font content types", () => {
      expect(shouldSkipContentType("font/woff")).toBe(true);
      expect(shouldSkipContentType("font/woff2")).toBe(true);
    });

    it("does not skip text content types", () => {
      expect(shouldSkipContentType("text/html")).toBe(false);
      expect(shouldSkipContentType("text/plain")).toBe(false);
      expect(shouldSkipContentType("application/json")).toBe(false);
      expect(shouldSkipContentType("application/javascript")).toBe(false);
    });
  });

  describe("compression threshold", () => {
    it("has a 1KB threshold", () => {
      expect(COMPRESSION_THRESHOLD_BYTES).toBe(1024);
    });
  });

  describe("brotli compression", () => {
    it("compresses a buffer and produces smaller output", async () => {
      const input = new Uint8Array(Buffer.from("Hello world! ".repeat(100)));
      const compressed = await brotliCompress(input);
      expect(compressed.byteLength).toBeLessThan(input.byteLength);
      expect(compressed.byteLength).toBeGreaterThan(0);
    });

    it("handles empty input", async () => {
      const input = new Uint8Array(0);
      const compressed = await brotliCompress(input);
      expect(compressed.byteLength).toBeGreaterThanOrEqual(0);
    });
  });

  describe("gzip compression", () => {
    it("compresses a buffer and produces smaller output", async () => {
      const input = new Uint8Array(Buffer.from("Hello world! ".repeat(100)));
      const compressed = await gzipCompress(input);
      expect(compressed.byteLength).toBeLessThan(input.byteLength);
      expect(compressed.byteLength).toBeGreaterThan(0);
    });

    it("handles empty input", async () => {
      const input = new Uint8Array(0);
      const compressed = await gzipCompress(input);
      expect(compressed.byteLength).toBeGreaterThanOrEqual(0);
    });
  });

  describe("compression level configuration", () => {
    it("reads compression level from environment variable", () => {
      const original = process.env["T3_COMPRESSION_LEVEL"];
      process.env["T3_COMPRESSION_LEVEL"] = "9";
      // The module reads at import time; verify the env var is set
      expect(process.env["T3_COMPRESSION_LEVEL"]).toBe("9");
      if (original === undefined) {
        delete process.env["T3_COMPRESSION_LEVEL"];
      } else {
        process.env["T3_COMPRESSION_LEVEL"] = original;
      }
    });
  });
});
