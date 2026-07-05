import { describe, expect, it } from "vitest";
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";

import {
  HTTP_COMPRESSION_LEVEL_ENV,
  HTTP_COMPRESSION_MIN_BYTES,
  compressResponseBody,
  isLoopbackHostname,
  parseRequestJsonBody,
  resolveAcceptedCompressionEncoding,
  resolveCompressedResponse,
  resolveDevRedirectUrl,
  resolveHttpCompressionLevel,
  resolveRequestContentEncoding,
  shouldSkipCompressionForContentType,
} from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("http compression", () => {
  const largeJson = new TextEncoder().encode(
    JSON.stringify({
      messages: Array.from({ length: 120 }, (_, index) => ({
        id: `message-${index}`,
        body: "Repeated chat history payload ".repeat(8),
      })),
    }),
  );

  it("prefers brotli over gzip when both are accepted", () => {
    expect(resolveAcceptedCompressionEncoding({ "accept-encoding": "gzip, br" })).toBe("br");
  });

  it("falls back to gzip when brotli is explicitly disabled", () => {
    expect(resolveAcceptedCompressionEncoding({ "accept-encoding": "br;q=0, gzip;q=1" })).toBe(
      "gzip",
    );
  });

  it("skips compression for small responses", () => {
    const body = new TextEncoder().encode("small");
    const response = resolveCompressedResponse({
      body,
      contentType: "application/json",
      requestHeaders: { "accept-encoding": "br, gzip" },
    });

    expect(response.encoding).toBeNull();
    expect(response.body).toBe(body);
    expect(response.headers["Content-Encoding"]).toBeUndefined();
  });

  it("skips image and archive content types", () => {
    expect(shouldSkipCompressionForContentType("image/png")).toBe(true);
    expect(shouldSkipCompressionForContentType("application/zip")).toBe(true);
    expect(shouldSkipCompressionForContentType("application/json; charset=utf-8")).toBe(false);
  });

  it("sets compression headers and produces a brotli body for large JSON responses", () => {
    const response = resolveCompressedResponse({
      body: largeJson,
      contentType: "application/json",
      requestHeaders: { "accept-encoding": "gzip, br" },
      responseHeaders: { Vary: "Origin" },
    });

    expect(largeJson.byteLength).toBeGreaterThan(HTTP_COMPRESSION_MIN_BYTES);
    expect(response.encoding).toBe("br");
    expect(response.headers["Content-Encoding"]).toBe("br");
    expect(response.headers.Vary).toBe("Origin, Accept-Encoding");
    expect(brotliDecompressSync(response.body).toString()).toBe(Buffer.from(largeJson).toString());
  });

  it("uses gzip when gzip is the selected encoding", () => {
    const compressed = compressResponseBody(largeJson, "gzip", 6);

    expect(gunzipSync(compressed).toString()).toBe(Buffer.from(largeJson).toString());
  });

  it("parses and clamps the configurable compression level", () => {
    expect(resolveHttpCompressionLevel(undefined)).toBe(6);
    expect(resolveHttpCompressionLevel("2")).toBe(2);
    expect(resolveHttpCompressionLevel("99")).toBe(11);
    expect(resolveHttpCompressionLevel("not-a-number")).toBe(6);
    expect(HTTP_COMPRESSION_LEVEL_ENV).toBe("T3_HTTP_COMPRESSION_LEVEL");
  });
});

describe("compressed request bodies", () => {
  const payload = { traceId: "abc123", spans: [{ name: "chat-history-load" }] };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

  it("detects supported request content encodings", () => {
    expect(resolveRequestContentEncoding({ "content-encoding": "gzip" })).toBe("gzip");
    expect(resolveRequestContentEncoding({ "content-encoding": "br" })).toBe("br");
    expect(resolveRequestContentEncoding({ "content-encoding": "deflate" })).toBeNull();
  });

  it("decompresses gzip JSON request bodies before parsing", () => {
    expect(parseRequestJsonBody(gzipSync(payloadBytes), "gzip")).toEqual(payload);
  });

  it("decompresses brotli JSON request bodies before parsing", () => {
    expect(parseRequestJsonBody(brotliCompressSync(payloadBytes), "br")).toEqual(payload);
  });
});
