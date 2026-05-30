import { describe, expect, it } from "vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
  MAX_BODY_SIZE_RESPONSE_HEADER,
  UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
  isLoopbackHostname,
  makeRequestBodySizeLimitLayer,
  parseContentLength,
  resolveDevRedirectUrl,
  resolveRequestBodySizeLimitBytes,
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

describe("http request body size limits", () => {
  it("parses valid Content-Length headers and ignores invalid values", () => {
    expect(parseContentLength("42")).toBe(42);
    expect(parseContentLength(" 42 ")).toBe(42);
    expect(parseContentLength(undefined)).toBeUndefined();
    expect(parseContentLength("12.5")).toBeUndefined();
    expect(parseContentLength("-1")).toBeUndefined();
  });

  it("uses the 10MB default, 50MB upload default, and per-route overrides", () => {
    expect(resolveRequestBodySizeLimitBytes("/api/session")).toBe(
      DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
    );
    expect(resolveRequestBodySizeLimitBytes("/api/files/upload")).toBe(
      UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
    );
    expect(
      resolveRequestBodySizeLimitBytes("/api/custom", [
        {
          path: "/api/custom",
          limitBytes: 2048,
        },
      ]),
    ).toBe(2048);
  });

  it("rejects oversized requests before the handler reads the body", async () => {
    const appLayer = Layer.mergeAll(
      HttpRouter.add(
        "POST",
        "/limited",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.text;
          return HttpServerResponse.text(body);
        }),
      ),
      makeRequestBodySizeLimitLayer([
        {
          path: "/limited",
          limitBytes: 4,
        },
      ]),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(appLayer, {
      disableLogger: true,
    });

    try {
      const response = await handler(
        new Request("http://127.0.0.1/limited", {
          method: "POST",
          body: "12345",
          headers: {
            "content-length": "5",
          },
        }),
      );

      expect(response.status).toBe(413);
      expect(response.headers.get(MAX_BODY_SIZE_RESPONSE_HEADER)).toBe("4");
      await expect(response.json()).resolves.toEqual({
        error: "Payload Too Large",
        limit: 4,
        received: 5,
      });
    } finally {
      await dispose();
    }
  });

  it("allows requests within the applicable route limit", async () => {
    const appLayer = Layer.mergeAll(
      HttpRouter.add(
        "POST",
        "/limited",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.text;
          return HttpServerResponse.text(body);
        }),
      ),
      makeRequestBodySizeLimitLayer([
        {
          path: "/limited",
          limitBytes: 5,
        },
      ]),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(appLayer, {
      disableLogger: true,
    });

    try {
      const response = await handler(
        new Request("http://127.0.0.1/limited", {
          method: "POST",
          body: "12345",
          headers: {
            "content-length": "5",
          },
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("12345");
    } finally {
      await dispose();
    }
  });
});
