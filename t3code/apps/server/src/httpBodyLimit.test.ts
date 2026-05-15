import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { describe } from "vitest";

import {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  DEFAULT_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
  MAX_BODY_SIZE_HEADER,
  makeRequestBodyLimitLayer,
  resolveRequestBodyLimitForRoute,
} from "./http.ts";

const testBodyLimitConfig = {
  defaultMaxBytes: 10,
  uploadMaxBytes: 50,
  routeOverrides: [
    {
      pathPrefix: "/api/custom",
      maxBytes: 5,
    },
  ],
} as const;

const startBodyLimitTestServer = () =>
  Effect.gen(function* () {
    const echoRoute = (path: string) =>
      HttpRouter.add(
        "POST",
        path as `/${string}`,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const text = yield* request.text;
          return HttpServerResponse.jsonUnsafe({
            ok: true,
            receivedBytes: text.length,
          });
        }),
      );

    const appLayer = HttpRouter.serve(
      Layer.mergeAll(
        echoRoute("/api/default"),
        echoRoute("/api/upload"),
        echoRoute("/api/custom"),
        makeRequestBodyLimitLayer(testBodyLimitConfig),
      ),
      {
        disableListenLog: true,
        disableLogger: true,
      },
    );

    yield* Layer.build(appLayer);
    const server = yield* HttpServer.HttpServer;
    const address = server.address as HttpServer.TcpAddress;
    return `http://127.0.0.1:${address.port}`;
  });

describe("http request body limits", () => {
  it("uses default, upload, and override limits", () => {
    assert.equal(
      resolveRequestBodyLimitForRoute({
        method: "POST",
        pathname: "/api/default",
        contentType: "application/json",
      }),
      DEFAULT_REQUEST_BODY_LIMIT_BYTES,
    );
    assert.equal(
      resolveRequestBodyLimitForRoute({
        method: "POST",
        pathname: "/api/upload",
        contentType: "multipart/form-data; boundary=test",
      }),
      DEFAULT_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
    );
    assert.equal(
      resolveRequestBodyLimitForRoute(
        {
          method: "POST",
          pathname: "/api/custom",
          contentType: "application/json",
        },
        testBodyLimitConfig,
      ),
      5,
    );
  });

  it.effect(
    "returns 413 with limit and received size when content-length exceeds the default limit",
    () =>
      Effect.gen(function* () {
        const baseUrl = yield* startBodyLimitTestServer();
        const response = yield* Effect.promise(() =>
          fetch(`${baseUrl}/api/default`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: "01234567890",
          }),
        );
        const body = (yield* Effect.promise(() => response.json())) as {
          readonly error: string;
          readonly limitBytes: number;
          readonly receivedBytes: number | null;
        };

        assert.equal(response.status, 413);
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        assert.equal(response.headers.get(MAX_BODY_SIZE_HEADER.toLowerCase()), "10");
        assert.deepEqual(body, {
          error: "Payload Too Large",
          limitBytes: 10,
          receivedBytes: 11,
        });
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("applies the upload limit to multipart requests", () =>
    Effect.gen(function* () {
      const baseUrl = yield* startBodyLimitTestServer();
      const response = yield* Effect.promise(() =>
        fetch(`${baseUrl}/api/upload`, {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=test",
          },
          body: "0123456789012345678901234567890123456789",
        }),
      );
      const body = (yield* Effect.promise(() => response.json())) as {
        readonly ok: boolean;
        readonly receivedBytes: number;
      };

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        ok: true,
        receivedBytes: 40,
      });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("supports tighter per-route overrides", () =>
    Effect.gen(function* () {
      const baseUrl = yield* startBodyLimitTestServer();
      const response = yield* Effect.promise(() =>
        fetch(`${baseUrl}/api/custom`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: "012345",
        }),
      );
      const body = (yield* Effect.promise(() => response.json())) as {
        readonly error: string;
        readonly limitBytes: number;
        readonly receivedBytes: number | null;
      };

      assert.equal(response.status, 413);
      assert.deepEqual(body, {
        error: "Payload Too Large",
        limitBytes: 5,
        receivedBytes: 6,
      });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("returns 413 for streamed bodies that exceed the configured limit", () =>
    Effect.gen(function* () {
      const baseUrl = yield* startBodyLimitTestServer();
      const encoder = new TextEncoder();
      const streamedBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("01234567890"));
          controller.close();
        },
      });
      const response = yield* Effect.promise(() =>
        fetch(`${baseUrl}/api/default`, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
          },
          body: streamedBody,
          duplex: "half",
        }),
      );
      const body = (yield* Effect.promise(() => response.json())) as {
        readonly error: string;
        readonly limitBytes: number;
        readonly receivedBytes: number | null;
      };

      assert.equal(response.status, 413);
      assert.deepEqual(body, {
        error: "Payload Too Large",
        limitBytes: 10,
        receivedBytes: null,
      });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
