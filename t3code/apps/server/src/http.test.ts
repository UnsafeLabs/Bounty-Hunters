import { brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import {
  compressHttpResponse,
  decodeCompressedHttpRequest,
  httpCompressionMiddleware,
  isHttpCompressionSkippableContentType,
  isLoopbackHostname,
  resolveDevRedirectUrl,
  resolveHttpCompressionLevel,
  selectHttpResponseCompressionEncoding,
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
  const makeRequest = (acceptEncoding: string) =>
    HttpServerRequest.fromWeb(
      new Request("http://localhost/api/test", {
        headers: { "accept-encoding": acceptEncoding },
      }),
    );

  it("prefers brotli over gzip when both are accepted", () => {
    expect(selectHttpResponseCompressionEncoding("gzip, br")).toBe("br");
    expect(selectHttpResponseCompressionEncoding("gzip")).toBe("gzip");
    expect(selectHttpResponseCompressionEncoding("br;q=0, gzip;q=1")).toBe("gzip");
  });

  it("resolves compression level from the first supported environment variable", () => {
    expect(resolveHttpCompressionLevel({ T3CODE_HTTP_COMPRESSION_LEVEL: "9" })).toBe(9);
    expect(resolveHttpCompressionLevel({ T3_HTTP_COMPRESSION_LEVEL: "50" })).toBe(11);
    expect(resolveHttpCompressionLevel({ HTTP_COMPRESSION_LEVEL: "bad" })).toBe(4);
  });

  it("skips image and archive content types", () => {
    expect(isHttpCompressionSkippableContentType("image/png")).toBe(true);
    expect(isHttpCompressionSkippableContentType("application/zip")).toBe(true);
    expect(isHttpCompressionSkippableContentType("application/json")).toBe(false);
  });

  it("compresses responses over 1KB with brotli and sets headers", async () => {
    const response = HttpServerResponse.jsonUnsafe({
      payload: "x".repeat(2048),
    });

    const compressedResponse = await Effect.runPromise(
      compressHttpResponse(makeRequest("gzip, br"), response, 4),
    );

    expect(compressedResponse.headers["content-encoding"]).toBe("br");
    expect(compressedResponse.headers.vary).toBe("Accept-Encoding");
    expect(compressedResponse.body._tag).toBe("Uint8Array");
    if (compressedResponse.body._tag === "Uint8Array") {
      const decompressed = brotliDecompressSync(compressedResponse.body.body).toString("utf8");
      expect(JSON.parse(decompressed)).toEqual({ payload: "x".repeat(2048) });
    }
  });

  it("compresses responses over 1KB with gzip when brotli is unavailable", async () => {
    const response = HttpServerResponse.text("x".repeat(2048), {
      contentType: "text/plain",
    });

    const compressedResponse = await Effect.runPromise(
      compressHttpResponse(makeRequest("gzip"), response, 4),
    );

    expect(compressedResponse.headers["content-encoding"]).toBe("gzip");
    expect(compressedResponse.body._tag).toBe("Uint8Array");
    if (compressedResponse.body._tag === "Uint8Array") {
      expect(gunzipSync(compressedResponse.body.body).toString("utf8")).toBe("x".repeat(2048));
    }
  });

  it("compresses stream responses with a known length", async () => {
    const response = HttpServerResponse.stream(
      Stream.succeed(new TextEncoder().encode("x".repeat(2048))),
      {
        contentType: "text/plain",
        contentLength: 2048,
      },
    );

    const compressedResponse = await Effect.runPromise(
      compressHttpResponse(makeRequest("gzip"), response, 4),
    );

    expect(compressedResponse.headers["content-encoding"]).toBe("gzip");
    expect(compressedResponse.body._tag).toBe("Uint8Array");
    if (compressedResponse.body._tag === "Uint8Array") {
      expect(gunzipSync(compressedResponse.body.body).toString("utf8")).toBe("x".repeat(2048));
    }
  });

  it("skips responses under 1KB and already-compressed content types", async () => {
    const smallResponse = HttpServerResponse.jsonUnsafe({ payload: "small" });
    const imageResponse = HttpServerResponse.uint8Array(new Uint8Array(2048), {
      contentType: "image/png",
    });

    expect(await Effect.runPromise(compressHttpResponse(makeRequest("br"), smallResponse))).toBe(
      smallResponse,
    );
    expect(await Effect.runPromise(compressHttpResponse(makeRequest("br"), imageResponse))).toBe(
      imageResponse,
    );
  });

  it("decompresses incoming gzip request bodies before handler processing", async () => {
    const body = JSON.stringify({ message: "hello" });
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-encoding": "gzip",
          "content-type": "application/json",
        },
        body: gzipSync(body),
      }),
    );

    const result = await Effect.runPromise(decodeCompressedHttpRequest(request));

    expect(result._tag).toBe("Request");
    if (result._tag === "Request") {
      expect(result.request.headers["content-encoding"]).toBeUndefined();
      expect(await Effect.runPromise(result.request.json)).toEqual({ message: "hello" });
    }
  });

  it("applies request decompression before running middleware handler", async () => {
    const body = JSON.stringify({ message: "from middleware" });
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-encoding": "gzip",
          "content-type": "application/json",
        },
        body: gzipSync(body),
      }),
    );

    const handler = Effect.gen(function* () {
      const currentRequest = yield* HttpServerRequest.HttpServerRequest;
      return HttpServerResponse.jsonUnsafe(yield* currentRequest.json.pipe(Effect.orDie));
    });
    const response = await Effect.runPromise(
      httpCompressionMiddleware(handler).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      ),
    );

    expect(response.body._tag).toBe("Uint8Array");
    if (response.body._tag === "Uint8Array") {
      expect(JSON.parse(new TextDecoder().decode(response.body.body))).toEqual({
        message: "from middleware",
      });
    }
  });
});
