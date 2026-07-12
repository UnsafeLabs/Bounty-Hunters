import { promisify } from "node:util";
import { brotliDecompress, gzip, gunzip } from "node:zlib";

import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import {
  chooseResponseCompressionEncoding,
  compressHttpResponseForRequest,
  decompressHttpRequest,
  isLoopbackHostname,
  normalizeHttpCompressionLevel,
  resolveDevRedirectUrl,
  shouldSkipCompressionContentType,
} from "./http.ts";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);

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
  it("prefers brotli over gzip when both encodings are accepted", () => {
    expect(chooseResponseCompressionEncoding("gzip, br")).toBe("br");
    expect(chooseResponseCompressionEncoding("gzip;q=1, br;q=0.4")).toBe("br");
    expect(chooseResponseCompressionEncoding("br;q=0, gzip")).toBe("gzip");
    expect(chooseResponseCompressionEncoding("identity")).toBeUndefined();
  });

  it("clamps compression levels to zlib's supported brotli range", () => {
    expect(normalizeHttpCompressionLevel(-2)).toBe(0);
    expect(normalizeHttpCompressionLevel(4.4)).toBe(4);
    expect(normalizeHttpCompressionLevel(99)).toBe(11);
    expect(normalizeHttpCompressionLevel(Number.NaN)).toBe(6);
  });

  it("skips already-compressed content types", () => {
    expect(shouldSkipCompressionContentType("image/png")).toBe(true);
    expect(shouldSkipCompressionContentType("application/zip")).toBe(true);
    expect(shouldSkipCompressionContentType("application/json")).toBe(false);
  });

  it("brotli-compresses eligible responses and sets response headers", async () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/data", {
        headers: { "Accept-Encoding": "gzip, br" },
      }),
    );
    const payload = { value: "x".repeat(2_000) };
    const response = HttpServerResponse.jsonUnsafe(payload);

    const compressed = await Effect.runPromise(
      compressHttpResponseForRequest(request, response, 5),
    );

    expect(compressed.headers["content-encoding"]).toBe("br");
    expect(compressed.headers.vary).toBe("Accept-Encoding");
    expect(compressed.body._tag).toBe("Uint8Array");
    if (compressed.body._tag !== "Uint8Array") return;

    expect(compressed.body.contentLength).toBeLessThan(JSON.stringify(payload).length);
    const decompressed = await brotliDecompressAsync(Buffer.from(compressed.body.body));
    expect(JSON.parse(decompressed.toString("utf8"))).toEqual(payload);
  });

  it("gzip-compresses eligible responses when brotli is not accepted", async () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/data", {
        headers: { "Accept-Encoding": "gzip" },
      }),
    );
    const payload = "hello ".repeat(300);
    const response = HttpServerResponse.text(payload, {
      contentType: "text/plain; charset=utf-8",
    });

    const compressed = await Effect.runPromise(
      compressHttpResponseForRequest(request, response, 5),
    );

    expect(compressed.headers["content-encoding"]).toBe("gzip");
    expect(compressed.body._tag).toBe("Uint8Array");
    if (compressed.body._tag !== "Uint8Array") return;

    const decompressed = await gunzipAsync(Buffer.from(compressed.body.body));
    expect(decompressed.toString("utf8")).toBe(payload);
  });

  it("does not compress small responses or image responses", async () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/data", {
        headers: { "Accept-Encoding": "br, gzip" },
      }),
    );
    const smallResponse = HttpServerResponse.text("small");
    const imageResponse = HttpServerResponse.uint8Array(new Uint8Array(2_048), {
      contentType: "image/png",
    });

    const smallResult = await Effect.runPromise(
      compressHttpResponseForRequest(request, smallResponse, 5),
    );
    const imageResult = await Effect.runPromise(
      compressHttpResponseForRequest(request, imageResponse, 5),
    );

    expect(smallResult.headers["content-encoding"]).toBeUndefined();
    expect(imageResult.headers["content-encoding"]).toBeUndefined();
  });

  it("decompresses gzip request bodies before handlers parse JSON", async () => {
    const payload = { traces: [{ id: "trace-1" }] };
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload)));
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/observability/v1/traces", {
        method: "POST",
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "application/json",
        },
        body: compressed,
      }),
    );

    const decompressed = await Effect.runPromise(decompressHttpRequest(request));

    expect(decompressed.headers["content-encoding"]).toBeUndefined();
    expect(decompressed.headers["content-length"]).toBe(
      Buffer.byteLength(JSON.stringify(payload)).toString(),
    );
    await expect(Effect.runPromise(decompressed.json)).resolves.toEqual(payload);
  });
});
