import { describe, expect, it } from "vitest";
import {
  COMPRESSION_MIN_BYTES,
  compressBody,
  decompressBody,
  negotiateEncoding,
  shouldCompressBody,
  shouldSkipContentType,
} from "./httpCompression.ts";

describe("httpCompression (#863)", () => {
  it("prefers brotli over gzip", () => {
    expect(negotiateEncoding("gzip, deflate, br")).toBe("br");
    expect(negotiateEncoding("gzip")).toBe("gzip");
    expect(negotiateEncoding(null)).toBeNull();
  });

  it("skips images and archives", () => {
    expect(shouldSkipContentType("image/png")).toBe(true);
    expect(shouldSkipContentType("application/zip")).toBe(true);
    expect(shouldSkipContentType("application/json")).toBe(false);
  });

  it("skips bodies under 1KB", () => {
    expect(shouldCompressBody(100, "application/json", "br")).toBeNull();
    expect(shouldCompressBody(COMPRESSION_MIN_BYTES, "application/json", "br")).toBe(
      "br",
    );
  });

  it("round-trips gzip", async () => {
    const raw = new TextEncoder().encode("x".repeat(2000));
    const gz = await compressBody(raw, "gzip", 4);
    expect(gz.byteLength).toBeLessThan(raw.byteLength);
    const back = await decompressBody(gz, "gzip");
    expect(new TextDecoder().decode(back)).toBe("x".repeat(2000));
  });

  it("round-trips brotli", async () => {
    const raw = new TextEncoder().encode(JSON.stringify({ a: "y".repeat(1500) }));
    const br = await compressBody(raw, "br", 4);
    expect(br.byteLength).toBeLessThan(raw.byteLength);
    const back = await decompressBody(br, "br");
    expect(JSON.parse(new TextDecoder().decode(back)).a.length).toBe(1500);
  });
});
