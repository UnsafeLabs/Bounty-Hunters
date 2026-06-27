import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/HttpServerRequest";
import * as HttpServerResponse from "effect/HttpServerResponse";
import * as HttpRouter from "effect/HttpRouter";
import * as Duration from "effect/Duration";

/**
 * Request body size limiting middleware.
 *
 * - Default limit: 10MB for regular requests
 * - File upload limit: 50MB for file upload endpoints
 * - Per-route override capability
 * - Returns 413 Payload Too Large before reading entire body
 * - Includes X-Max-Body-Size header on 413 responses
 */

export const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024; // 10MB
export const FILE_UPLOAD_BODY_LIMIT = 50 * 1024 * 1024; // 50MB

// Routes that allow larger bodies (file uploads)
const FILE_UPLOAD_ROUTES = new Set<string>([
  "/api/attachments",
  "/api/files/upload",
  "/api/attachments/upload",
]);

// Per-route overrides
const routeOverrides = new Map<string, number>();

/**
 * Set a custom body size limit for a specific route.
 */
export function setRouteBodyLimit(route: string, limitBytes: number): void {
  routeOverrides.set(route, limitBytes);
}

/**
 * Get the applicable body size limit for a given route.
 */
export function getBodyLimit(route: string): number {
  // Check per-route override first
  const override = routeOverrides.get(route);
  if (override !== undefined) return override;

  // Check file upload routes
  if (FILE_UPLOAD_ROUTES.has(route)) return FILE_UPLOAD_BODY_LIMIT;

  // Default limit
  return DEFAULT_BODY_LIMIT;
}

/**
 * Middleware that checks Content-Length against the body size limit.
 * Returns 413 if the limit is exceeded, before reading the body.
 */
export const bodySizeLimitMiddleware = HttpRouter.makeMiddleware(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const route = request.url;
    const limit = getBodyLimit(route);
    const contentLength = parseInt(request.headers["content-length"] ?? "0", 10);

    if (contentLength > limit) {
      return yield* HttpServerResponse.json(
        {
          error: "Payload Too Large",
          message: `Request body exceeds the maximum allowed size.`,
          limit: limit,
          limitFormatted: formatBytes(limit),
          received: contentLength,
          receivedFormatted: formatBytes(contentLength),
        },
        {
          status: 413,
          headers: {
            "Content-Type": "application/json",
            "X-Max-Body-Size": String(limit),
          },
        },
      );
    }

    return yield* Effect.succeed(request);
  }),
);

/**
 * Format bytes into human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Helper to create a route-specific body size limit layer.
 */
export function withBodyLimit(route: string, limitBytes: number) {
  setRouteBodyLimit(route, limitBytes);
  return bodySizeLimitMiddleware;
}
