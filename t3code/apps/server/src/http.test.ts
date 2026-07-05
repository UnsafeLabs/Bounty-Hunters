import { describe, expect, it } from "vitest";

import {
  DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
  FILE_UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
  MAX_BODY_SIZE_RESPONSE_HEADER,
  isLoopbackHostname,
  parseRequestContentLength,
  resolveDevRedirectUrl,
  resolveRequestBodySizeLimit,
  resolveRequestBodySizeLimitDecision,
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

describe("request body size limiting", () => {
  it("uses a 10MB default limit for regular routes", () => {
    expect(resolveRequestBodySizeLimit("/api/observability/v1/traces")).toBe(
      DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
    );
  });

  it("uses a 50MB default limit for upload-style routes", () => {
    expect(resolveRequestBodySizeLimit("/api/files/upload")).toBe(
      FILE_UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
    );
    expect(resolveRequestBodySizeLimit("/api/attachments/abc123")).toBe(
      FILE_UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
    );
  });

  it("applies per-route overrides before default limits", () => {
    expect(
      resolveRequestBodySizeLimit("/api/observability/v1/traces", [
        { path: "/api/observability/v1/traces", limitBytes: 1024 },
      ]),
    ).toBe(1024);
    expect(
      resolveRequestBodySizeLimit("/api/uploads/avatar", [
        { path: /^\/api\/uploads\//, limitBytes: 2048 },
      ]),
    ).toBe(2048);
  });

  it("parses safe Content-Length headers", () => {
    expect(parseRequestContentLength({ "content-length": "42" })).toBe(42);
    expect(parseRequestContentLength({ "Content-Length": "43" })).toBe(43);
    expect(parseRequestContentLength({ "content-length": "-1" })).toBeNull();
    expect(parseRequestContentLength({ "content-length": "abc" })).toBeNull();
    expect(parseRequestContentLength({})).toBeNull();
  });

  it("rejects requests larger than the applicable limit", () => {
    expect(
      resolveRequestBodySizeLimitDecision({
        pathname: "/api/observability/v1/traces",
        headers: { "content-length": String(DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES + 1) },
      }),
    ).toEqual({
      limitBytes: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
      receivedBytes: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES + 1,
    });
  });

  it("allows requests within the applicable limit", () => {
    expect(
      resolveRequestBodySizeLimitDecision({
        pathname: "/api/observability/v1/traces",
        headers: { "content-length": String(DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES) },
      }),
    ).toBeNull();
  });

  it("exposes the response header name used for 413 responses", () => {
    expect(MAX_BODY_SIZE_RESPONSE_HEADER).toBe("X-Max-Body-Size");
  });
});
