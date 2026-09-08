import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import {
  AuthenticationError,
  TokenRefreshManager,
  TokenRefreshManagerOptions,
  TokenSession,
  DefaultTokenRefreshOptions,
  createRetryableRequest,
  createAuthenticatedRequest,
  RequestWithAuthOptions,
} from "./client";

// Mock token session
const createMockTokenSession = (
  expiresInMs: number = 3600000,
  token: string = "test-token",
  refreshToken: string = "refresh-token"
): TokenSession => ({
  token,
  refreshToken,
  expiresAt: Date.now() + expiresInMs,
  isExpired: false,
});

// Mock expired token session
const createExpiredTokenSession = (): TokenSession => ({
  token: "expired-token",
  refreshToken: "expired-refresh-token",
  expiresAt: Date.now() - 1000, // Already expired
  isExpired: true,
});

describe("Token Refresh with Effect Retry", () => {
  describe("AuthenticationError", () => {
    it("should create error with code", () => {
      const error = new AuthenticationError({
        code: "TOKEN_EXPIRED",
        message: "Token has expired",
      });
      expect(error.name).toBe("AuthenticationError");
      expect(error.error.code).toBe("TOKEN_EXPIRED");
      expect(error.message).toBe("Token has expired");
    });

    it("should create error with default message", () => {
      const error = new AuthenticationError({
        code: "UNAUTHORIZED",
      });
      expect(error.message).toBe("Authentication error: UNAUTHORIZED");
    });

    it("should have _tag property", () => {
      const error = new AuthenticationError({
        code: "INVALID_TOKEN",
      });
      expect(error._tag).toBe("AuthenticationError");
    });
  });

  describe("DefaultTokenRefreshOptions", () => {
    it("should have default values", () => {
      expect(DefaultTokenRefreshOptions.maxRetries).toBe(3);
      expect(DefaultTokenRefreshOptions.baseDelayMs).toBe(1000);
      expect(DefaultTokenRefreshOptions.maxDelayMs).toBe(30000);
      expect(DefaultTokenRefreshOptions.backoffMultiplier).toBe(2);
      expect(DefaultTokenRefreshOptions.jitter).toBe(true);
    });

    it("should have default isRetryable", () => {
      expect(DefaultTokenRefreshOptions.isRetryable(new AuthenticationError({
        code: "TOKEN_EXPIRED",
      }))).toBe(true);
      expect(DefaultTokenRefreshOptions.isRetryable(new AuthenticationError({
        code: "UNAUTHORIZED",
      }))).toBe(true);
      expect(DefaultTokenRefreshOptions.isRetryable(new AuthenticationError({
        code: "INVALID_TOKEN",
      }))).toBe(false);
    });
  });

  describe("TokenRefreshManager", () => {
    let manager: TokenRefreshManager;
    let refreshCount: number;
    let currentToken: string;

    beforeEach(async () => {
      refreshCount = 0;
      currentToken = "initial-token";

      manager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () =>
            Effect.gen(function* () {
              refreshCount++;
              currentToken = `refreshed-token-${refreshCount}`;
              return createMockTokenSession(3600000, currentToken, `refresh-${refreshCount}`);
            }),
          getTokenFn: () =>
            Effect.succeed(
              createMockTokenSession(3600000, currentToken, "current-refresh")
            ),
        })
      );
    });

    it("should get current token when valid", async () => {
      const session = await Effect.runPromise(manager.getToken());
      expect(session.token).toBe("initial-token");
    });

    it("should get access token string", async () => {
      const token = await Effect.runPromise(manager.getAccessToken());
      expect(token).toBe("initial-token");
    });

    it("should refresh token when expired", async () => {
      // Set an expired token
      await Effect.runPromise(
        manager.setToken(createExpiredTokenSession())
      );

      const session = await Effect.runPromise(manager.getToken());
      expect(session.token).toBe("refreshed-token-1");
      expect(refreshCount).toBe(1);
    });

    it("should return same token for concurrent requests", async () => {
      // Set an expired token
      await Effect.runPromise(
        manager.setToken(createExpiredTokenSession())
      );

      // Make concurrent requests
      const promises = Array.from({ length: 5 }, () =>
        Effect.runPromise(manager.getToken())
      );

      const results = await Promise.all(promises);

      // All should have the same token
      expect(results.every((r) => r.token === "refreshed-token-1")).toBe(true);
      // Should only have refreshed once
      expect(refreshCount).toBe(1);
    });

    it("should invalidate token", async () => {
      await Effect.runPromise(manager.invalidateToken());

      const session = await Effect.runPromise(manager.getToken());
      expect(session.token).toBe("refreshed-token-1");
      expect(refreshCount).toBe(1);
    });

    it("should set new token", async () => {
      const newSession = createMockTokenSession(3600000, "new-token", "new-refresh");
      await Effect.runPromise(manager.setToken(newSession));

      const session = await Effect.runPromise(manager.getToken());
      expect(session.token).toBe("new-token");
    });

    it("should retry on failure with exponential backoff", async () => {
      let attemptCount = 0;
      const failingManager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () =>
            Effect.gen(function* () {
              attemptCount++;
              if (attemptCount < 3) {
                throw new AuthenticationError({
                  code: "TOKEN_EXPIRED",
                  message: "Token expired",
                });
              }
              return createMockTokenSession(3600000, "success-token", "success-refresh");
            }),
          getTokenFn: () => Effect.succeed(createExpiredTokenSession()),
          maxRetries: 3,
          baseDelayMs: 10, // Short delay for testing
          jitter: false,
        })
      );

      const session = await Effect.runPromise(failingManager.getToken());
      expect(session.token).toBe("success-token");
      expect(attemptCount).toBe(3);
    });

    it("should fail after max retries", async () => {
      const failingManager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () =>
            Effect.fail(
              new AuthenticationError({
                code: "TOKEN_EXPIRED",
                message: "Token expired",
              })
            ),
          getTokenFn: () => Effect.succeed(createExpiredTokenSession()),
          maxRetries: 2,
          baseDelayMs: 10,
          jitter: false,
        })
      );

      await expect(
        Effect.runPromise(failingManager.getToken())
      ).rejects.toThrow(AuthenticationError);
    });

    it("should not retry non-retryable errors", async () => {
      const failingManager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () =>
            Effect.fail(
              new AuthenticationError({
                code: "INVALID_TOKEN",
                message: "Invalid token",
              })
            ),
          getTokenFn: () => Effect.succeed(createExpiredTokenSession()),
          maxRetries: 3,
          baseDelayMs: 10,
          isRetryable: (error) =>
            error instanceof AuthenticationError &&
            error.error.code === "TOKEN_EXPIRED",
        })
      );

      await expect(
        Effect.runPromise(failingManager.getToken())
      ).rejects.toThrow(AuthenticationError);
    });

    it("should call onRetry callback", async () => {
      const onRetry = vi.fn();
      const failingManager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () =>
            Effect.gen(function* () {
              throw new AuthenticationError({
                code: "TOKEN_EXPIRED",
                message: "Token expired",
              });
            }),
          getTokenFn: () => Effect.succeed(createExpiredTokenSession()),
          maxRetries: 2,
          baseDelayMs: 10,
          jitter: false,
          onRetry,
        })
      );

      try {
        await Effect.runPromise(failingManager.getToken());
      } catch {
        // Expected to fail
      }

      expect(onRetry).toHaveBeenCalled();
      expect(onRetry.mock.calls[0][0]).toBe(1); // First attempt
      expect(onRetry.mock.calls[0][2]).toBe(10); // baseDelayMs
    });

    it("should respect refresh threshold", async () => {
      const thresholdMs = 5000; // 5 seconds
      const managerWithThreshold = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () =>
            Effect.succeed(createMockTokenSession(3600000, "refreshed", "refreshed")),
          getTokenFn: () =>
            Effect.succeed({
              ...createMockTokenSession(thresholdMs - 1000, "about-to-expire", "refresh"),
              // Token expires in less than threshold
            }),
          refreshThresholdMs: thresholdMs,
        })
      );

      const session = await Effect.runPromise(managerWithThreshold.getToken());
      expect(session.token).toBe("refreshed");
    });
  });

  describe("createRetryableRequest", () => {
    it("should make successful request", async () => {
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) =>
        Effect.succeed({ data: "success" })
      );

      const retryableRequest = createRetryableRequest(requestFn, {
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
      });

      const result = await Effect.runPromise(retryableRequest("arg1", "arg2"));
      expect(result).toEqual({ data: "success" });
      expect(requestFn).toHaveBeenCalledWith("arg1", "arg2", "");
    });

    it("should retry on token expired response", async () => {
      let attempt = 0;
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) =>
        Effect.succeed({
          status: attempt++ === 0 ? 401 : 200,
          data: "success",
        })
      );

      const retryableRequest = createRetryableRequest(requestFn, {
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
        isTokenExpiredResponse: (response: unknown) =>
          typeof response === "object" &&
          response !== null &&
          (response as Record<string, unknown>).status === 401,
      });

      const result = await Effect.runPromise(retryableRequest("arg1"));
      expect(result).toEqual({ status: 200, data: "success" });
      expect(requestFn).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries", async () => {
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) =>
        Effect.succeed({ status: 401, data: "error" })
      );

      const retryableRequest = createRetryableRequest(requestFn, {
        maxRetries: 2,
        baseDelayMs: 10,
        jitter: false,
        isTokenExpiredResponse: (response: unknown) =>
          typeof response === "object" &&
          response !== null &&
          (response as Record<string, unknown>).status === 401,
      });

      await expect(
        Effect.runPromise(retryableRequest("arg1"))
      ).rejects.toThrow(AuthenticationError);
    });

    it("should not retry non-401 errors", async () => {
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) =>
        Effect.succeed({ status: 500, data: "server error" })
      );

      const retryableRequest = createRetryableRequest(requestFn, {
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
        isTokenExpiredResponse: (response: unknown) =>
          typeof response === "object" &&
          response !== null &&
          (response as Record<string, unknown>).status === 401,
      });

      const result = await Effect.runPromise(retryableRequest("arg1"));
      expect(result).toEqual({ status: 500, data: "server error" });
      expect(requestFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("createAuthenticatedRequest", () => {
    let manager: TokenRefreshManager;

    beforeEach(async () => {
      let refreshCount = 0;
      manager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () =>
            Effect.gen(function* () {
              refreshCount++;
              return createMockTokenSession(
                3600000,
                `refreshed-token-${refreshCount}`,
                `refresh-${refreshCount}`
              );
            }),
          getTokenFn: () =>
            Effect.succeed(createMockTokenSession(3600000, "initial-token", "initial-refresh")),
        })
      );
    });

    it("should include token in request", async () => {
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) =>
        Effect.succeed({ data: "success" })
      );

      const authenticatedRequest = createAuthenticatedRequest(requestFn, {
        tokenManager: manager,
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
      });

      const result = await Effect.runPromise(authenticatedRequest("arg1", "arg2"));
      expect(result).toEqual({ data: "success" });
      expect(requestFn).toHaveBeenCalledWith("arg1", "arg2", "initial-token");
    });

    it("should refresh token and retry on 401", async () => {
      let attempt = 0;
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) => {
        const token = _args[_args.length - 1] as string;
        if (token === "initial-token") {
          attempt++;
          return Effect.succeed({ status: 401, data: "unauthorized" });
        }
        return Effect.succeed({ status: 200, data: "success" });
      });

      const authenticatedRequest = createAuthenticatedRequest(requestFn, {
        tokenManager: manager,
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
        isTokenExpiredResponse: (response: unknown) =>
          typeof response === "object" &&
          response !== null &&
          (response as Record<string, unknown>).status === 401,
      });

      const result = await Effect.runPromise(authenticatedRequest("arg1"));
      expect(result).toEqual({ status: 200, data: "success" });
      expect(requestFn).toHaveBeenCalledTimes(2);
      // Second call should have the refreshed token
      expect(requestFn.mock.calls[1][2]).toBe("refreshed-token-1");
    });

    it("should invalidate token on 401", async () => {
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) =>
        Effect.succeed({ status: 401, data: "unauthorized" })
      );

      const authenticatedRequest = createAuthenticatedRequest(requestFn, {
        tokenManager: manager,
        maxRetries: 0, // No retries
        baseDelayMs: 10,
        jitter: false,
        isTokenExpiredResponse: (response: unknown) =>
          typeof response === "object" &&
          response !== null &&
          (response as Record<string, unknown>).status === 401,
      });

      try {
        await Effect.runPromise(authenticatedRequest("arg1"));
      } catch {
        // Expected to fail
      }

      // Token should be invalidated
      const tokenOpt = await Effect.runPromise(Ref.get((manager as any)._currentToken));
      expect(Option.isNone(tokenOpt)).toBe(true);
    });

    it("should call onRetry callback", async () => {
      const onRetry = vi.fn();
      let attempt = 0;
      const requestFn = vi.fn().mockImplementation((..._args: unknown[]) => {
        attempt++;
        return Effect.succeed({ status: attempt === 1 ? 401 : 200, data: "success" });
      });

      const authenticatedRequest = createAuthenticatedRequest(requestFn, {
        tokenManager: manager,
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
        isTokenExpiredResponse: (response: unknown) =>
          typeof response === "object" &&
          response !== null &&
          (response as Record<string, unknown>).status === 401,
        onRetry,
      });

      await Effect.runPromise(authenticatedRequest("arg1"));

      expect(onRetry).toHaveBeenCalled();
      expect(onRetry.mock.calls[0][0]).toBe(1); // First retry attempt
    });
  });

  describe("Exponential Backoff with Jitter", () => {
    it("should calculate delay with exponential backoff", async () => {
      const manager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () => Effect.succeed(createMockTokenSession()),
          getTokenFn: () => Effect.succeed(createExpiredTokenSession()),
          baseDelayMs: 1000,
          backoffMultiplier: 2,
          jitter: false,
        })
      );

      // Access private method through any cast
      const calculateDelay = (manager as any)._calculateDelay as (
        attempt: number
      ) => number;

      expect(calculateDelay(1)).toBe(1000); // 1000 * 2^0 = 1000
      expect(calculateDelay(2)).toBe(2000); // 1000 * 2^1 = 2000
      expect(calculateDelay(3)).toBe(4000); // 1000 * 2^2 = 4000
    });

    it("should cap delay at maxDelayMs", async () => {
      const manager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () => Effect.succeed(createMockTokenSession()),
          getTokenFn: () => Effect.succeed(createExpiredTokenSession()),
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
          jitter: false,
        })
      );

      const calculateDelay = (manager as any)._calculateDelay as (
        attempt: number
      ) => number;

      expect(calculateDelay(1)).toBe(1000);
      expect(calculateDelay(2)).toBe(2000);
      expect(calculateDelay(3)).toBe(4000);
      expect(calculateDelay(4)).toBe(5000); // Capped at maxDelayMs
      expect(calculateDelay(5)).toBe(5000); // Still capped
    });

    it("should add jitter to delay", async () => {
      const manager = await Effect.runPromise(
        TokenRefreshManager.make({
          refreshTokenFn: () => Effect.succeed(createMockTokenSession()),
          getTokenFn: () => Effect.succeed(createExpiredTokenSession()),
          baseDelayMs: 1000,
          backoffMultiplier: 1,
          jitter: true,
        })
      );

      const calculateDelay = (manager as any)._calculateDelay as (
        attempt: number
      ) => number;

      // With jitter, delay should be between baseDelay and baseDelay * 1.5
      const delay = calculateDelay(1);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1500);
    });
  });
});
