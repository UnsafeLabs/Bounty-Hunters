import * as zlib from "node:zlib";

import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  compressResponse,
  decompressBytes,
  isAlreadyCompressedContentType,
  selectResponseEncoding,
} from "./httpCompression.ts";
import { HttpServerResponse } from "effect/unstable/http";
import { isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";

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

describe("http compression helpers", () => {
  it("prefers brotli over gzip when both are accepted", () => {
    expect(selectResponseEncoding("gzip, br")).toBe("br");
    expect(selectResponseEncoding("gzip")).toBe("gzip");
    expect(selectResponseEncoding("deflate")).toBeUndefined();
  });

  it("skips already compressed response content types", () => {
    expect(isAlreadyCompressedContentType("image/png")).toBe(true);
    expect(isAlreadyCompressedContentType("application/zip")).toBe(true);
    expect(isAlreadyCompressedContentType("font/woff2")).toBe(true);
    expect(isAlreadyCompressedContentType("image/svg+xml")).toBe(false);
    expect(isAlreadyCompressedContentType("application/json; charset=utf-8")).toBe(false);
  });

  it("compresses large responses with brotli when supported", async () => {
    const response = HttpServerResponse.text("A".repeat(2000));
    const compressed = await Effect.runPromise(compressResponse(response, "gzip, br"));
    const webResponse = HttpServerResponse.toWeb(compressed);
    const body = new Uint8Array(await webResponse.arrayBuffer());

    expect(compressed.headers["content-encoding"]).toBe("br");
    expect(zlib.brotliDecompressSync(body).toString()).toBe("A".repeat(2000));
  });

  it("compresses large responses with gzip when brotli is not accepted", async () => {
    const response = HttpServerResponse.text("A".repeat(2000));
    const compressed = await Effect.runPromise(compressResponse(response, "gzip"));
    const webResponse = HttpServerResponse.toWeb(compressed);
    const body = new Uint8Array(await webResponse.arrayBuffer());

    expect(compressed.headers["content-encoding"]).toBe("gzip");
    expect(zlib.gunzipSync(body).toString()).toBe("A".repeat(2000));
  });

  it("does not compress small or already-compressed responses", async () => {
    const small = await Effect.runPromise(
      compressResponse(HttpServerResponse.text("A".repeat(500)), "br, gzip"),
    );
    const image = await Effect.runPromise(
      compressResponse(
        HttpServerResponse.uint8Array(new Uint8Array(2000), {
          contentType: "image/png",
        }),
        "br, gzip",
      ),
    );

    expect(small.headers["content-encoding"]).toBeUndefined();
    expect(image.headers["content-encoding"]).toBeUndefined();
  });

  it("decompresses gzip request bodies", async () => {
    const payload = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    const compressed = zlib.gzipSync(payload);
    const decompressed = await Effect.runPromise(decompressBytes(compressed, "gzip"));

    expect(JSON.parse(new TextDecoder().decode(decompressed))).toEqual({ hello: "world" });
  });

  it("decompresses brotli request bodies", async () => {
    const payload = new TextEncoder().encode(JSON.stringify({ hello: "brotli" }));
    const compressed = zlib.brotliCompressSync(payload);
    const decompressed = await Effect.runPromise(decompressBytes(compressed, "br"));

    expect(JSON.parse(new TextDecoder().decode(decompressed))).toEqual({ hello: "brotli" });
  });
});
