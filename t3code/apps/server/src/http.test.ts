import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { assert, it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import {
  HttpBody,
  HttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import {
  DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
  FILE_UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
  REQUEST_BODY_SIZE_LIMIT_HEADER,
  makeRequestBodySizeLimitLayer,
  parseContentLengthHeader,
  resolveDevRedirectUrl,
  resolveRequestBodySizeLimit,
  isLoopbackHostname,
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

describe("request body size limit policy", () => {
  it("uses the regular default, file upload default, and per-route overrides", () => {
    expect(
      resolveRequestBodySizeLimit({
        method: "POST",
        url: "/api/observability/v1/traces",
        headers: { "content-type": "application/json" },
      }),
    ).toEqual({
      limitBytes: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
      routeKind: "default",
    });

    expect(
      resolveRequestBodySizeLimit({
        method: "POST",
        url: "/api/files/upload",
        headers: { "content-type": "application/octet-stream" },
      }),
    ).toEqual({
      limitBytes: FILE_UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
      routeKind: "file-upload",
    });

    expect(
      resolveRequestBodySizeLimit(
        {
          method: "POST",
          url: "/api/custom",
          headers: { "content-type": "application/json" },
        },
        {
          routeOverrides: [{ method: "POST", path: "/api/custom", limitBytes: 4 }],
        },
      ),
    ).toEqual({
      limitBytes: 4,
      routeKind: "override",
    });
  });

  it("parses valid Content-Length headers and ignores invalid values", () => {
    expect(parseContentLengthHeader("42")).toBe(42);
    expect(parseContentLengthHeader(" 42 ")).toBe(42);
    expect(parseContentLengthHeader("4.2")).toBeUndefined();
    expect(parseContentLengthHeader("invalid")).toBeUndefined();
  });
});

effectIt.layer(NodeServices.layer)("request body size limit middleware", (it) => {
  const routeLayer = HttpRouter.add(
    "POST",
    "/echo",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = yield* request.text;
      return HttpServerResponse.jsonUnsafe({ length: body.length });
    }),
  );

  const serveEchoLayer = (limitBytes: number) =>
    HttpRouter.serve(
      routeLayer.pipe(
        Layer.provide(
          makeRequestBodySizeLimitLayer({
            routeOverrides: [{ method: "POST", path: "/echo", limitBytes }],
          }),
        ),
      ),
      { disableListenLog: true, disableLogger: true },
    );

  it.effect("rejects a custom route body before the handler buffers it", () =>
    Effect.gen(function* () {
      yield* Layer.build(serveEchoLayer(4));

      const response = yield* HttpClient.post("/echo", {
        body: HttpBody.text("12345", "text/plain"),
      });
      const body = (yield* response.json) as {
        readonly error: string;
        readonly limit: number;
        readonly received: number;
      };

      assert.equal(response.status, 413);
      assert.equal(response.headers[REQUEST_BODY_SIZE_LIMIT_HEADER.toLowerCase()], "4");
      assert.deepEqual(body, {
        error: "Payload Too Large",
        limit: 4,
        received: 5,
      });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("allows custom route bodies within the override", () =>
    Effect.gen(function* () {
      yield* Layer.build(serveEchoLayer(5));

      const response = yield* HttpClient.post("/echo", {
        body: HttpBody.text("12345", "text/plain"),
      });
      const body = (yield* response.json) as { readonly length: number };

      assert.equal(response.status, 200);
      assert.deepEqual(body, { length: 5 });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
