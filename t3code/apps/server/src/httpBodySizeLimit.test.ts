import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  checkBodySizeLimit,
  createBodySizeLimitConfig,
  RequestBodyTooLargeError,
  getLimitForRoute,
} from "./httpBodySizeLimit.ts";

describe("httpBodySizeLimit", () => {
  describe("checkBodySizeLimit", () => {
    it("should allow requests without content-length header", async () => {
      const request = {
        url: "/api/test",
        headers: {},
      } as HttpServerRequest.HttpServerRequest;

      const result = await Effect.runPromise(
        Effect.either(checkBodySizeLimit(request)),
      );

      expect(result._tag).toBe("Right");
    });

    it("should allow requests within default limit", async () => {
      const request = {
        url: "/api/test",
        headers: { "content-length": "1000" },
      } as HttpServerRequest.HttpServerRequest;

      const result = await Effect.runPromise(
        Effect.either(checkBodySizeLimit(request)),
      );

      expect(result._tag).toBe("Right");
    });

    it("should reject requests exceeding default limit", async () => {
      const request = {
        url: "/api/test",
        headers: { "content-length": (11 * 1024 * 1024).toString() }, // 11MB
      } as HttpServerRequest.HttpServerRequest;

      const result = await Effect.runPromise(
        Effect.either(checkBodySizeLimit(request)),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(RequestBodyTooLargeError);
        expect(result.left.limit).toBe(10 * 1024 * 1024);
        expect(result.left.received).toBe(11 * 1024 * 1024);
      }
    });

    it("should allow larger requests for upload routes", async () => {
      const request = {
        url: "/api/upload/file",
        headers: { "content-length": (40 * 1024 * 1024).toString() }, // 40MB
      } as HttpServerRequest.HttpServerRequest;

      const result = await Effect.runPromise(
        Effect.either(checkBodySizeLimit(request)),
      );

      expect(result._tag).toBe("Right");
    });

    it("should reject upload requests exceeding upload limit", async () => {
      const request = {
        url: "/api/upload/file",
        headers: { "content-length": (60 * 1024 * 1024).toString() }, // 60MB
      } as HttpServerRequest.HttpServerRequest;

      const result = await Effect.runPromise(
        Effect.either(checkBodySizeLimit(request)),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(RequestBodyTooLargeError);
        expect(result.left.limit).toBe(50 * 1024 * 1024);
      }
    });

    it("should respect route-specific overrides", async () => {
      const config = createBodySizeLimitConfig({
        routeOverrides: new Map([["/api/large-data", 100 * 1024 * 1024]]), // 100MB
      });

      const request = {
        url: "/api/large-data endpoint",
        headers: { "content-length": (80 * 1024 * 1024).toString() }, // 80MB
      } as HttpServerRequest.HttpServerRequest;

      const result = await Effect.runPromise(
        Effect.either(checkBodySizeLimit(request, config)),
      );

      expect(result._tag).toBe("Right");
    });

    it("should handle invalid content-length gracefully", async () => {
      const request = {
        url: "/api/test",
        headers: { "content-length": "invalid" },
      } as HttpServerRequest.HttpServerRequest;

      const result = await Effect.runPromise(
        Effect.either(checkBodySizeLimit(request)),
      );

      expect(result._tag).toBe("Right");
    });
  });

  describe("getLimitForRoute", () => {
    it("should return default limit for regular routes", () => {
      const limit = getLimitForRoute("/api/test", createBodySizeLimitConfig());
      expect(limit).toBe(10 * 1024 * 1024);
    });

    it("should return upload limit for upload routes", () => {
      const limit = getLimitForRoute("/api/upload/file", createBodySizeLimitConfig());
      expect(limit).toBe(50 * 1024 * 1024);
    });

    it("should return upload limit for attachment routes", () => {
      const limit = getLimitForRoute("/api/attachment/123", createBodySizeLimitConfig());
      expect(limit).toBe(50 * 1024 * 1024);
    });

    it("should return route-specific override when configured", () => {
      const config = createBodySizeLimitConfig({
        routeOverrides: new Map([["/api/special", 200 * 1024 * 1024]]),
      });
      const limit = getLimitForRoute("/api/special/endpoint", config);
      expect(limit).toBe(200 * 1024 * 1024);
    });
  });

  describe("createBodySizeLimitConfig", () => {
    it("should create config with defaults", () => {
      const config = createBodySizeLimitConfig();
      expect(config.defaultLimit).toBe(10 * 1024 * 1024);
      expect(config.uploadLimit).toBe(50 * 1024 * 1024);
    });

    it("should allow overriding defaults", () => {
      const config = createBodySizeLimitConfig({
        defaultLimit: 5 * 1024 * 1024,
        uploadLimit: 25 * 1024 * 1024,
      });
      expect(config.defaultLimit).toBe(5 * 1024 * 1024);
      expect(config.uploadLimit).toBe(25 * 1024 * 1024);
    });
  });
});
