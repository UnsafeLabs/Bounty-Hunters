import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import {
  parseAcceptEncoding,
  isCompressibleContentType,
  getCompressionConfig,
} from "./http.ts";

describe("HTTP Compression", () => {
  describe("parseAcceptEncoding", () => {
    it("should parse gzip encoding", () => {
      const result = parseAcceptEncoding("gzip");
      expect(result).toEqual({ gzip: true, br: false });
    });

    it("should parse brotli encoding", () => {
      const result = parseAcceptEncoding("br");
      expect(result).toEqual({ gzip: false, br: true });
    });

    it("should parse both gzip and brotli", () => {
      const result = parseAcceptEncoding("gzip, br");
      expect(result).toEqual({ gzip: true, br: true });
    });

    it("should handle quality values", () => {
      const result = parseAcceptEncoding("br;q=1.0, gzip;q=0.8");
      expect(result).toEqual({ gzip: true, br: true });
    });

    it("should handle empty header", () => {
      const result = parseAcceptEncoding(undefined);
      expect(result).toEqual({ gzip: false, br: false });
    });

    it("should handle whitespace", () => {
      const result = parseAcceptEncoding("  gzip ,  br  ");
      expect(result).toEqual({ gzip: true, br: true });
    });
  });

  describe("isCompressibleContentType", () => {
    it("should compress JSON", () => {
      expect(isCompressibleContentType("application/json")).toBe(true);
      expect(isCompressibleContentType("application/json; charset=utf-8")).toBe(true);
    });

    it("should compress HTML", () => {
      expect(isCompressibleContentType("text/html")).toBe(true);
      expect(isCompressibleContentType("text/html; charset=utf-8")).toBe(true);
    });

    it("should compress CSS", () => {
      expect(isCompressibleContentType("text/css")).toBe(true);
    });

    it("should compress JavaScript", () => {
      expect(isCompressibleContentType("application/javascript")).toBe(true);
    });

    it("should compress XML", () => {
      expect(isCompressibleContentType("application/xml")).toBe(true);
      expect(isCompressibleContentType("text/xml")).toBe(true);
    });

    it("should compress SVG", () => {
      expect(isCompressibleContentType("image/svg+xml")).toBe(true);
    });

    it("should not compress images", () => {
      expect(isCompressibleContentType("image/png")).toBe(false);
      expect(isCompressibleContentType("image/jpeg")).toBe(false);
      expect(isCompressibleContentType("image/gif")).toBe(false);
      expect(isCompressibleContentType("image/webp")).toBe(false);
    });

    it("should not compress archives", () => {
      expect(isCompressibleContentType("application/zip")).toBe(false);
      expect(isCompressibleContentType("application/gzip")).toBe(false);
      expect(isCompressibleContentType("application/x-brotli")).toBe(false);
    });

    it("should handle undefined", () => {
      expect(isCompressibleContentType(undefined)).toBe(false);
    });
  });

  describe("getCompressionConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("should return default values", () => {
      const config = getCompressionConfig();
      expect(config.gzipLevel).toBe(9);
      expect(config.brotliQuality).toBe(11);
      expect(config.threshold).toBe(1024);
    });

    it("should read from environment variables", () => {
      process.env.COMPRESSION_GZIP_LEVEL = "6";
      process.env.COMPRESSION_BROTLI_QUALITY = "8";
      process.env.COMPRESSION_THRESHOLD = "2048";

      const config = getCompressionConfig();
      expect(config.gzipLevel).toBe(6);
      expect(config.brotliQuality).toBe(8);
      expect(config.threshold).toBe(2048);
    });

    it("should clamp gzip level to valid range", () => {
      process.env.COMPRESSION_GZIP_LEVEL = "15";
      expect(getCompressionConfig().gzipLevel).toBe(9);

      process.env.COMPRESSION_GZIP_LEVEL = "0";
      expect(getCompressionConfig().gzipLevel).toBe(1);
    });

    it("should clamp brotli quality to valid range", () => {
      process.env.COMPRESSION_BROTLI_QUALITY = "20";
      expect(getCompressionConfig().brotliQuality).toBe(11);

      process.env.COMPRESSION_BROTLI_QUALITY = "-5";
      expect(getCompressionConfig().brotliQuality).toBe(0);
    });

    it("should ensure threshold is non-negative", () => {
      process.env.COMPRESSION_THRESHOLD = "-100";
      expect(getCompressionConfig().threshold).toBe(0);
    });
  });

  describe("Compression Integration", () => {
    it("should prefer brotli over gzip when both accepted", () => {
      const acceptEncoding = "gzip, br";
      const parsed = parseAcceptEncoding(acceptEncoding);
      const encoding = parsed.br ? "br" : "gzip";
      expect(encoding).toBe("br");
    });

    it("should use gzip when only gzip accepted", () => {
      const acceptEncoding = "gzip";
      const parsed = parseAcceptEncoding(acceptEncoding);
      const encoding = parsed.br ? "br" : "gzip";
      expect(encoding).toBe("gzip");
    });

    it("should use brotli when only brotli accepted", () => {
      const acceptEncoding = "br";
      const parsed = parseAcceptEncoding(acceptEncoding);
      const encoding = parsed.br ? "br" : "gzip";
      expect(encoding).toBe("br");
    });
  });
});
