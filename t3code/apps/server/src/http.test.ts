import { describe, expect, it } from "vitest";

import {
  DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
  FILE_UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
  evaluateRequestBodySizeLimit,
  isLoopbackHostname,
  parseContentLengthHeader,
  resolveDevRedirectUrl,
  resolveRequestBodySizeLimit,
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
  it("parses safe content-length values", () => {
    expect(parseContentLengthHeader("1048576")).toBe(1_048_576);
    expect(parseContentLengthHeader(undefined)).toBeNull();
    expect(parseContentLengthHeader("-1")).toBeNull();
    expect(parseContentLengthHeader("not-a-number")).toBeNull();
  });

  it("uses a 10 MB default limit for regular routes", () => {
    expect(resolveRequestBodySizeLimit({ method: "POST", pathname: "/api/auth/bootstrap" })).toBe(
      DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
    );
  });

  it("uses a 50 MB limit for upload-style routes", () => {
    expect(resolveRequestBodySizeLimit({ method: "POST", pathname: "/api/upload/file" })).toBe(
      FILE_UPLOAD_REQUEST_BODY_SIZE_LIMIT_BYTES,
    );
  });

  it("prefers the most specific per-route override", () => {
    expect(
      resolveRequestBodySizeLimit({
        method: "POST",
        pathname: "/api/upload/small",
        overrides: [
          { pathPrefix: "/api/upload", maxBytes: 10_000 },
          { pathPrefix: "/api/upload/small", maxBytes: 512 },
        ],
      }),
    ).toBe(512);
  });

  it("rejects oversized request bodies for body-carrying methods", () => {
    expect(
      evaluateRequestBodySizeLimit({
        method: "POST",
        pathname: "/api/auth/bootstrap",
        contentLengthHeader: String(DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES + 1),
      }),
    ).toEqual({
      ok: false,
      limit: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
      received: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES + 1,
    });
  });

  it("allows requests at the configured limit and ignores body limits for GET", () => {
    expect(
      evaluateRequestBodySizeLimit({
        method: "POST",
        pathname: "/api/auth/bootstrap",
        contentLengthHeader: String(DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES),
      }),
    ).toEqual({
      ok: true,
      limit: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
      received: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
    });

    expect(
      evaluateRequestBodySizeLimit({
        method: "GET",
        pathname: "/api/auth/bootstrap",
        contentLengthHeader: String(DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES + 1),
      }),
    ).toEqual({
      ok: true,
      limit: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES,
      received: DEFAULT_REQUEST_BODY_SIZE_LIMIT_BYTES + 1,
    });
  });
});
