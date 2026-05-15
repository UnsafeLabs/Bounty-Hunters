/**
 * httpBodySizeLimit - Request body size limiting middleware.
 *
 * Provides per-route configurable body size limits that return HTTP 413
 * Payload Too Large when exceeded. Routes that accept POST/PUT/PATCH
 * request bodies can opt in by wrapping their handler with
 * `enforceBodySizeLimit()`.
 *
 * @module httpBodySizeLimit
 */
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

/**
 * Default body size limit: 10 MB.
 */
export const DEFAULT_BODY_SIZE_LIMIT = 10 * 1024 * 1024;

/**
 * Per-route body size limit overrides keyed by HTTP method + path pattern.
 */
export interface BodySizeLimitConfig {
  readonly defaultLimit: number;
  readonly routes?: Readonly<Record<string, number>>;
}

/**
 * BodySizeLimit - Service that resolves the maximum allowed body size for a
 * given request.
 */
export class BodySizeLimit extends Context.Service<
  BodySizeLimit,
  BodySizeLimitConfig
>()("t3/config/BodySizeLimit") {}

/**
 * Parse the Content-Length header from a request as a number.
 * Returns `null` if the header is missing or unparseable (chunked encoding).
 */
const parseContentLength = (
  headers: Record<string, string | string[] | undefined>,
): number | null => {
  const raw = headers["content-length"];
  if (raw === undefined || raw === null) {
    return null;
  }
  const rawStr = Array.isArray(raw) ? raw[0] : raw;
  if (rawStr === undefined) return null;
  const n = Number(rawStr);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Enforce body size limit for a request.
 *
 * Call this at the start of a route handler to check whether the incoming
 * request's Content-Length exceeds the allowed limit. Returns an Effect
 * that either succeeds (body size is within limits) or produces an
 * HttpServerResponse with status 413.
 *
 * Pass `maxBytes` to set an explicit limit for a specific route, or omit
 * to resolve from the `BodySizeLimit` service configuration.
 *
 * Usage:
 * ```
 * Effect.gen(function* () {
 *   yield* enforceBodySizeLimit(1024 * 1024);
 *   // ... handler logic
 * })
 * ```
 */
export const enforceBodySizeLimit = (
  maxBytes?: number,
): Effect.Effect<void, HttpServerResponse.HttpServerResponse, never> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const contentLength = parseContentLength(request.headers);

    // Absent Content-Length can't be checked — allow the request through
    // (chunked transfer encoding or streaming bodies).
    if (contentLength === null) {
      return;
    }

    const limit = maxBytes !== undefined
      ? maxBytes
      : yield* Effect.flatMap(
          BodySizeLimit,
          (config: BodySizeLimitConfig) => {
            // Resolve per-route limit
            const method = request.method;
            const pathname = request.url.pathname;
            const routes = config.routes;
            if (routes) {
              // Exact method + path
              const exactKey = `${method}:${pathname}`;
              if (exactKey in routes) return Effect.succeed(routes[exactKey]);
              // Method + wildcard prefix
              const segments = pathname.split("/").filter(Boolean);
              for (let i = segments.length; i > 0; i--) {
                const prefix = `${method}:/${segments.slice(0, i).join("/")}/*`;
                if (prefix in routes) return Effect.succeed(routes[prefix]);
              }
              // Method-only default
              if (method in routes) return Effect.succeed(routes[method]);
              // Global wildcard
              if ("*" in routes) return Effect.succeed(routes["*"]);
            }
            return Effect.succeed(config.defaultLimit);
          },
        ),
    );

    if (contentLength > limit) {
      return yield* Effect.fail(
        HttpServerResponse.text(
          `Payload Too Large: request body size (${contentLength} bytes) exceeds limit (${limit} bytes)`,
          { status: 413 },
        ),
      );
    }
  });
