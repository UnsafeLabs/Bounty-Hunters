import { describe, expect, it } from "vitest";

import { _internal } from "./httpCompression.ts";

const {
  parseAcceptEncoding,
  shouldSkipCompression,
  DEFAULT_COMPRESSION_CONFIG,
  SKIP_COMPRESSION_PREFIXES,
} = _internal;

// ---------------------------------------------------------------------------
// parseAcceptEncoding
// ---------------------------------------------------------------------------

describe("parseAcceptEncoding", () => {
  it("returns no accepted encodings for undefined header", () => {
    const result = parseAcceptEncoding(undefined);
    expect(result.gzip).toBe(false);
    expect(result.br).toBe(false);
    expect(result.deflate).toBe(false);
    expect(result.priority).toBeNull();
  });

  it("returns no accepted encodings for empty string", () => {
    const result = parseAcceptEncoding("");
    expect(result.priority).toBeNull();
  });

  it("parses gzip-only Accept-Encoding", () => {
    const result = parseAcceptEncoding("gzip");
    expect(result.gzip).toBe(true);
    expect(result.br).toBe(false);
    expect(result.priority).toBe("gzip");
  });

  it("parses brotli-only Accept-Encoding", () => {
    const result = parseAcceptEncoding("br");
    expect(result.br).toBe(true);
    expect(result.gzip).toBe(false);
    expect(result.priority).toBe("br");
  });

  it("prefers brotli over gzip when both accepted", () => {
    const result = parseAcceptEncoding("gzip, deflate, br");
    expect(result.gzip).toBe(true);
    expect(result.br).toBe(true);
    expect(result.deflate).toBe(true);
    expect(result.priority).toBe("br");
  });

  it("prefers brotli over gzip in any order", () => {
    const result = parseAcceptEncoding("br, gzip");
    expect(result.priority).toBe("br");
  });

  it("prefers gzip over deflate when brotli not present", () => {
    const result = parseAcceptEncoding("gzip, deflate");
    expect(result.priority).toBe("gzip");
  });

  it("handles deflate-only Accept-Encoding", () => {
    const result = parseAcceptEncoding("deflate");
    expect(result.deflate).toBe(true);
    expect(result.priority).toBe("deflate");
  });

  it("handles Accept-Encoding with q-values", () => {
    const result = parseAcceptEncoding("gzip;q=1.0, br;q=0.8");
    expect(result.gzip).toBe(true);
    expect(result.br).toBe(true);
    expect(result.priority).toBe("br"); // brotli still preferred per our policy
  });

  it("handles identity only (no compression)", () => {
    const result = parseAcceptEncoding("identity");
    expect(result.priority).toBeNull();
  });

  it("handles * (any encoding)", () => {
    const result = parseAcceptEncoding("*");
    expect(result.priority).toBeNull(); // We don't interpret * as supporting specific encodings
  });
});

// ---------------------------------------------------------------------------
// shouldSkipCompression
// ---------------------------------------------------------------------------

describe("shouldSkipCompression", () => {
  it("skips image content types", () => {
    expect(shouldSkipCompression("image/png")).toBe(true);
    expect(shouldSkipCompression("image/jpeg")).toBe(true);
    expect(shouldSkipCompression("image/svg+xml")).toBe(true);
    expect(shouldSkipCompression("image/webp")).toBe(true);
  });

  it("skips video content types", () => {
    expect(shouldSkipCompression("video/mp4")).toBe(true);
    expect(shouldSkipCompression("video/webm")).toBe(true);
  });

  it("skips audio content types", () => {
    expect(shouldSkipCompression("audio/mpeg")).toBe(true);
    expect(shouldSkipCompression("audio/ogg")).toBe(true);
  });

  it("skips archive content types", () => {
    expect(shouldSkipCompression("application/zip")).toBe(true);
    expect(shouldSkipCompression("application/gzip")).toBe(true);
    expect(shouldSkipCompression("application/x-gzip")).toBe(true);
    expect(shouldSkipCompression("application/pdf")).toBe(true);
    expect(shouldSkipCompression("application/x-rar-compressed")).toBe(true);
    expect(shouldSkipCompression("application/x-tar")).toBe(true);
    expect(shouldSkipCompression("application/x-7z-compressed")).toBe(true);
    expect(shouldSkipCompression("application/octet-stream")).toBe(true);
  });

  it("skips wasm", () => {
    expect(shouldSkipCompression("application/wasm")).toBe(true);
  });

  it("does NOT skip compressible content types", () => {
    expect(shouldSkipCompression("application/json")).toBe(false);
    expect(shouldSkipCompression("text/html")).toBe(false);
    expect(shouldSkipCompression("text/plain")).toBe(false);
    expect(shouldSkipCompression("text/css")).toBe(false);
    expect(shouldSkipCompression("application/javascript")).toBe(false);
    expect(shouldSkipCompression("text/xml")).toBe(false);
  });

  it("handles content types with charset parameter", () => {
    expect(shouldSkipCompression("image/png; charset=utf-8")).toBe(true);
    expect(shouldSkipCompression("application/json; charset=utf-8")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(shouldSkipCompression("Image/PNG")).toBe(true);
    expect(shouldSkipCompression("APPLICATION/JSON")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Compression / decompression round-trip
// ---------------------------------------------------------------------------

describe("brotli compression round-trip", () => {
  it("compresses and decompresses data correctly", async () => {
    const original = new TextEncoder().encode('{"hello":"world","count":42}');
    const compressed = await _internal.compressBrotli(original, 4);
    expect(compressed.byteLength).toBeGreaterThan(0);
    expect(compressed.byteLength).toBeLessThan(original.byteLength * 3); // Sanity check

    const decompressed = await _internal.decompressBrotli(compressed);
    expect(decompressed).toEqual(original);
  });

  it("handles larger payloads", async () => {
    const data = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item-${i}`, value: `data-${i}` })),
    );
    const original = new TextEncoder().encode(data);
    const compressed = await _internal.compressBrotli(original, 4);
    expect(compressed.byteLength).toBeLessThan(original.byteLength);

    const decompressed = await _internal.decompressBrotli(compressed);
    expect(decompressed).toEqual(original);
  });
});

describe("gzip compression round-trip", () => {
  it("compresses and decompresses data correctly", async () => {
    const original = new TextEncoder().encode('{"hello":"world","count":42}');
    const compressed = await _internal.compressGzip(original, 6);
    expect(compressed.byteLength).toBeGreaterThan(0);

    const decompressed = await _internal.decompressGzip(compressed);
    expect(decompressed).toEqual(original);
  });

  it("handles larger payloads", async () => {
    const data = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item-${i}`, value: `data-${i}` })),
    );
    const original = new TextEncoder().encode(data);
    const compressed = await _internal.compressGzip(original, 6);
    expect(compressed.byteLength).toBeLessThan(original.byteLength);

    const decompressed = await _internal.decompressGzip(compressed);
    expect(decompressed).toEqual(original);
  });
});

describe("deflate decompression", () => {
  it("decompresses deflate data", async () => {
    const zlib = await import("node:zlib");
    const original = new TextEncoder().encode('{"test":"deflate"}');
    
    const deflated = await new Promise<Uint8Array>((resolve, reject) => {
      zlib.deflate(original, (err, result) => {
        if (err) reject(err);
        else resolve(result as Uint8Array);
      });
    });

    const decompressed = await _internal.decompressDeflate(deflated);
    expect(decompressed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

describe("DEFAULT_COMPRESSION_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_COMPRESSION_CONFIG.compressionLevel).toBe(4);
    expect(DEFAULT_COMPRESSION_CONFIG.minSizeBytes).toBe(1024);
    expect(DEFAULT_COMPRESSION_CONFIG.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SKIP_COMPRESSION_PREFIXES coverage
// ---------------------------------------------------------------------------

describe("SKIP_COMPRESSION_PREFIXES", () => {
  it("includes all expected prefixes", () => {
    expect(SKIP_COMPRESSION_PREFIXES).toContain("image/");
    expect(SKIP_COMPRESSION_PREFIXES).toContain("video/");
    expect(SKIP_COMPRESSION_PREFIXES).toContain("audio/");
    expect(SKIP_COMPRESSION_PREFIXES).toContain("application/zip");
    expect(SKIP_COMPRESSION_PREFIXES).toContain("application/gzip");
    expect(SKIP_COMPRESSION_PREFIXES).toContain("application/pdf");
  });
});
