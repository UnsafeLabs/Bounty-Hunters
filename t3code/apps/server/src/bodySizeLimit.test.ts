import { describe, expect, it } from "vitest";

import {
  DEFAULT_BODY_SIZE_LIMITS,
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  OTLP_TRACES_MAX_REQUEST_BODY_BYTES,
  OTLP_TRACES_PROXY_ROUTE_KEY,
  enforceRequestBodyLimit,
  evaluateRequestBodyLimit,
  makeBodySizeLimits,
  parseContentLength,
  resolveMaxBodyBytes,
} from "./bodySizeLimit.ts";

describe("parseContentLength", () => {
  it("parses a well-formed header into a byte count", () => {
    expect(parseContentLength("0")).toBe(0);
    expect(parseContentLength("1024")).toBe(1024);
    expect(parseContentLength("  2048  ")).toBe(2048);
  });

  it("returns undefined for absent or malformed headers", () => {
    expect(parseContentLength(undefined)).toBeUndefined();
    expect(parseContentLength("")).toBeUndefined();
    expect(parseContentLength("abc")).toBeUndefined();
    expect(parseContentLength("12abc")).toBeUndefined();
    expect(parseContentLength("-5")).toBeUndefined();
    expect(parseContentLength("+5")).toBeUndefined();
    expect(parseContentLength("1.5")).toBeUndefined();
  });

  it("clamps absurdly large declared sizes to a safe integer", () => {
    expect(parseContentLength("99999999999999999999")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("makeBodySizeLimits", () => {
  it("builds a table from a valid default and overrides", () => {
    const limits = makeBodySizeLimits({
      defaultMaxBytes: 100,
      routeOverrides: { "/api/big": 1000 },
    });
    expect(limits.defaultMaxBytes).toBe(100);
    expect(limits.routeOverrides["/api/big"]).toBe(1000);
  });

  it("defaults missing overrides to an empty table", () => {
    expect(makeBodySizeLimits({ defaultMaxBytes: 10 }).routeOverrides).toEqual({});
  });

  it("throws a TypeError on a non-integer, negative, infinite, or unsafe default", () => {
    expect(() => makeBodySizeLimits({ defaultMaxBytes: -1 })).toThrow(TypeError);
    expect(() => makeBodySizeLimits({ defaultMaxBytes: 1.5 })).toThrow(TypeError);
    expect(() => makeBodySizeLimits({ defaultMaxBytes: Number.POSITIVE_INFINITY })).toThrow(
      TypeError,
    );
    expect(() => makeBodySizeLimits({ defaultMaxBytes: Number.NaN })).toThrow(TypeError);
    expect(() => makeBodySizeLimits({ defaultMaxBytes: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      TypeError,
    );
  });

  it("throws a TypeError on an invalid per-route override", () => {
    expect(() =>
      makeBodySizeLimits({ defaultMaxBytes: 100, routeOverrides: { "/api/bad": -10 } }),
    ).toThrow(TypeError);
  });

  it("accepts a zero budget (an empty-body-only route)", () => {
    expect(() => makeBodySizeLimits({ defaultMaxBytes: 0 })).not.toThrow();
  });
});

describe("resolveMaxBodyBytes", () => {
  const limits = makeBodySizeLimits({
    defaultMaxBytes: 100,
    routeOverrides: { "/api/big": 1000 },
  });

  it("returns the per-route override when present", () => {
    expect(resolveMaxBodyBytes(limits, "/api/big")).toBe(1000);
  });

  it("falls back to the default for routes without an override", () => {
    expect(resolveMaxBodyBytes(limits, "/api/other")).toBe(100);
  });
});

describe("evaluateRequestBodyLimit", () => {
  const limits = makeBodySizeLimits({
    defaultMaxBytes: 100,
    routeOverrides: { "/api/big": 1000, "/api/empty": 0 },
  });

  it("allows a body at or under the budget", () => {
    expect(evaluateRequestBodyLimit(limits, "/api/x", "99").allowed).toBe(true);
    expect(evaluateRequestBodyLimit(limits, "/api/x", "100").allowed).toBe(true);
  });

  it("rejects a body over the budget", () => {
    const decision = evaluateRequestBodyLimit(limits, "/api/x", "101");
    expect(decision.allowed).toBe(false);
    expect(decision.maxBytes).toBe(100);
    expect(decision.contentLength).toBe(101);
  });

  it("applies the per-route override instead of the default", () => {
    expect(evaluateRequestBodyLimit(limits, "/api/big", "500").allowed).toBe(true);
    expect(evaluateRequestBodyLimit(limits, "/api/big", "1001").allowed).toBe(false);
  });

  it("allows requests that do not declare a parseable Content-Length", () => {
    expect(evaluateRequestBodyLimit(limits, "/api/x", undefined).allowed).toBe(true);
    expect(evaluateRequestBodyLimit(limits, "/api/x", "not-a-number").allowed).toBe(true);
  });

  it("rejects any non-empty body on a zero-budget route", () => {
    expect(evaluateRequestBodyLimit(limits, "/api/empty", "0").allowed).toBe(true);
    expect(evaluateRequestBodyLimit(limits, "/api/empty", "1").allowed).toBe(false);
  });
});

describe("enforceRequestBodyLimit", () => {
  const limits = makeBodySizeLimits({ defaultMaxBytes: 100 });

  it("returns undefined when the request is within budget", () => {
    expect(enforceRequestBodyLimit(limits, "/api/x", "50")).toBeUndefined();
    expect(enforceRequestBodyLimit(limits, "/api/x", undefined)).toBeUndefined();
  });

  it("returns a 413 response advertising the limit and the received size when over budget", () => {
    const response = enforceRequestBodyLimit(limits, "/api/x", "101");
    expect(response).toBeDefined();
    expect(response?.status).toBe(413);
    expect(response?.headers["x-max-body-size"]).toBe("100");
    expect(response?.headers["x-received-content-length"]).toBe("101");
  });
});

describe("DEFAULT_BODY_SIZE_LIMITS", () => {
  it("is a valid table with a larger override for the OTLP traces proxy", () => {
    expect(() => makeBodySizeLimits(DEFAULT_BODY_SIZE_LIMITS)).not.toThrow();
    expect(DEFAULT_BODY_SIZE_LIMITS.defaultMaxBytes).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
    expect(resolveMaxBodyBytes(DEFAULT_BODY_SIZE_LIMITS, OTLP_TRACES_PROXY_ROUTE_KEY)).toBe(
      OTLP_TRACES_MAX_REQUEST_BODY_BYTES,
    );
    expect(OTLP_TRACES_MAX_REQUEST_BODY_BYTES).toBeGreaterThan(DEFAULT_MAX_REQUEST_BODY_BYTES);
  });
});
