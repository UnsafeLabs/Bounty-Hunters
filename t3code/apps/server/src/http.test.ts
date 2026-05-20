import { describe, expect, it } from "vitest";
import * as zlib from "node:zlib";
import { HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";
import { httpCompressionLayer, HttpCompressionError } from "./httpCompression.ts";

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

describe("http compression layer", () => {
  // Create a mock router to test the middleware layer
  const makeTestRouter = Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;

    // A large compressible route (> 1 KB)
    yield* router.add(
      "GET",
      "/large",
      Effect.gen(function* () {
        return HttpServerResponse.text("A".repeat(2000));
      }),
    );

    // A small compressible route (<= 1 KB)
    yield* router.add(
      "GET",
      "/small",
      Effect.gen(function* () {
        return HttpServerResponse.text("A".repeat(500));
      }),
    );

    // An image route (should skip compression)
    yield* router.add(
      "GET",
      "/image",
      Effect.gen(function* () {
        const data = new Uint8Array(2000);
        return HttpServerResponse.uint8Array(data, {
          contentType: "image/png",
        });
      }),
    );

    // Stream route
    yield* router.add(
      "GET",
      "/stream",
      Effect.gen(function* () {
        const stream = Stream.fromIterable(
          ["hello ", "world ", "stream"].map((s) => new TextEncoder().encode(s)),
        );
        return HttpServerResponse.stream(stream, {
          contentType: "text/plain",
        });
      }),
    );

    // Echo JSON request body
    yield* router.add(
      "POST",
      "/echo-json",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = yield* request.json;
        return HttpServerResponse.jsonUnsafe(body);
      }),
    );
  });

  const testLayer = Layer.effectDiscard(makeTestRouter).pipe(Layer.provide(httpCompressionLayer));

  const executeRequest = (webRequest: globalThis.Request): Promise<HttpServerResponse.HttpServerResponse> => {
    const program = Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const scope = yield* Scope.make();
      const asHttpEffect = router.asHttpEffect as unknown as () => Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        never,
        HttpServerRequest.HttpServerRequest | Scope.Scope
      >;
      return yield* asHttpEffect().pipe(
        Scope.provide(scope),
      );
    });

    const serverRequest = HttpServerRequest.fromWeb(webRequest);
    const unifiedLayer = testLayer.pipe(
      Layer.provideMerge(HttpRouter.layer),
    );

    const finalEffect = program.pipe(
      Effect.provide(unifiedLayer),
      Effect.provideService(HttpServerRequest.HttpServerRequest, serverRequest),
    );

    return Effect.runPromise(
      finalEffect as Effect.Effect<HttpServerResponse.HttpServerResponse, never, never>,
    );
  };

  const getResponseText = async (response: HttpServerResponse.HttpServerResponse) => {
    const webResponse = HttpServerResponse.toWeb(response);
    const buffer = new Uint8Array(await webResponse.arrayBuffer());
    const encoding = response.headers["content-encoding"];
    if (encoding === "br") {
      return zlib.brotliDecompressSync(buffer).toString();
    } else if (encoding === "gzip") {
      return zlib.gunzipSync(buffer).toString();
    }
    return new TextDecoder().decode(buffer);
  };

  it("compresses large responses using brotli when supported", async () => {
    const webRequest = new Request("http://localhost/large", {
      headers: { "accept-encoding": "br, gzip" },
    });
    const response = await executeRequest(webRequest);

    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["content-length"]).toBeDefined();

    const text = await getResponseText(response);
    expect(text).toBe("A".repeat(2000));
  });

  it("compresses large responses using gzip when brotli is not supported", async () => {
    const webRequest = new Request("http://localhost/large", {
      headers: { "accept-encoding": "gzip" },
    });
    const response = await executeRequest(webRequest);

    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["content-length"]).toBeDefined();

    const text = await getResponseText(response);
    expect(text).toBe("A".repeat(2000));
  });

  it("does not compress small responses (<= 1 KB)", async () => {
    const webRequest = new Request("http://localhost/small", {
      headers: { "accept-encoding": "br, gzip" },
    });
    const response = await executeRequest(webRequest);

    expect(response.headers["content-encoding"]).toBeUndefined();
    const text = await getResponseText(response);
    expect(text).toBe("A".repeat(500));
  });

  it("does not compress already compressed content-types like png images", async () => {
    const webRequest = new Request("http://localhost/image", {
      headers: { "accept-encoding": "br, gzip" },
    });
    const response = await executeRequest(webRequest);

    expect(response.headers["content-encoding"]).toBeUndefined();
  });

  it("compresses streams using brotli when supported", async () => {
    const webRequest = new Request("http://localhost/stream", {
      headers: { "accept-encoding": "br" },
    });
    const response = await executeRequest(webRequest);

    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["content-length"]).toBeUndefined(); // Deleted for streams!

    const text = await getResponseText(response);
    expect(text).toBe("hello world stream");
  });

  it("decompresses compressed requests using gzip", async () => {
    const payload = JSON.stringify({ hello: "world", data: [1, 2, 3] });
    const compressed = zlib.gzipSync(Buffer.from(payload));

    const webRequest = new Request("http://localhost/echo-json", {
      method: "POST",
      headers: {
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
      body: compressed,
    });

    const response = await executeRequest(webRequest);
    const webResponse = HttpServerResponse.toWeb(response);
    const json = await webResponse.json();

    expect(json).toEqual({ hello: "world", data: [1, 2, 3] });
  });

  it("decompresses compressed requests using brotli", async () => {
    const payload = JSON.stringify({ name: "t3code", type: "server" });
    const compressed = zlib.brotliCompressSync(Buffer.from(payload));

    const webRequest = new Request("http://localhost/echo-json", {
      method: "POST",
      headers: {
        "content-encoding": "br",
        "content-type": "application/json",
      },
      body: compressed,
    });

    const response = await executeRequest(webRequest);
    const webResponse = HttpServerResponse.toWeb(response);
    const json = await webResponse.json();

    expect(json).toEqual({ name: "t3code", type: "server" });
  });
});
