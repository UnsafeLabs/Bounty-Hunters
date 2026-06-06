import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http";

import { isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";
import {
  BODY_LIMIT_HEADER,
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
  enforceRequestBodyLimit,
  parseContentLengthBytes,
  requestBodyLimitExceeded,
  resolveRequestBodyLimit,
} from "./httpBodyLimit.ts";

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

describe("request body limit", () => {
  it("uses a 10MB default and supports a 50MB route override", () => {
    expect(resolveRequestBodyLimit()).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES);
    expect(resolveRequestBodyLimit(FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES)).toBe(
      FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
    );
  });

  it("parses safe Content-Length values only", () => {
    expect(parseContentLengthBytes({ "content-length": "42" })).toBe(42);
    expect(parseContentLengthBytes({ "content-length": "" })).toBeUndefined();
    expect(parseContentLengthBytes({ "content-length": "-1" })).toBeUndefined();
    expect(parseContentLengthBytes({ "content-length": "10.5" })).toBeUndefined();
    expect(parseContentLengthBytes({ "content-length": "not-a-number" })).toBeUndefined();
  });

  it("reports oversized bodies before route body parsing", () => {
    const error = requestBodyLimitExceeded({
      "content-length": String(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1),
    });

    expect(error?._tag).toBe("RequestBodyTooLargeError");
    expect(error?.limitBytes).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES);
    expect(error?.receivedBytes).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1);
  });

  it("fails the request guard when Content-Length is over the limit", async () => {
    const result = await Effect.runPromise(
      Effect.flip(enforceRequestBodyLimit()).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, {
          headers: {
            "content-length": String(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1),
          },
        } as unknown as HttpServerRequest.HttpServerRequest),
      ),
    );

    expect(result._tag).toBe("RequestBodyTooLargeError");
    expect(result.limitBytes).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES);
    expect(result.receivedBytes).toBe(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1);
  });

  it("allows requests under custom per-route limits", () => {
    expect(
      requestBodyLimitExceeded(
        { "content-length": String(DEFAULT_REQUEST_BODY_LIMIT_BYTES + 1) },
        FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES,
      ),
    ).toBeUndefined();
  });

  it("exports the response header required by clients", () => {
    expect(BODY_LIMIT_HEADER).toBe("X-Max-Body-Size");
  });
});
