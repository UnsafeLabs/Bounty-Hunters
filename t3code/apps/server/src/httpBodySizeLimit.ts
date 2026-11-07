import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

export class RequestBodyTooLargeError extends Data.TaggedError("RequestBodyTooLargeError")<{
  readonly limit: number;
  readonly received: number;
}> {}

export interface BodySizeLimitConfig {
  readonly defaultLimit: number;
  readonly uploadLimit: number;
  readonly routeOverrides?: ReadonlyMap<string, number>;
}

const DEFAULT_BODY_SIZE_LIMIT: BodySizeLimitConfig = {
  defaultLimit: 10 * 1024 * 1024, // 10MB
  uploadLimit: 50 * 1024 * 1024, // 50MB
  routeOverrides: new Map(),
};

export function createBodySizeLimitConfig(
  overrides: Partial<BodySizeLimitConfig> = {},
): BodySizeLimitConfig {
  return {
    defaultLimit: overrides.defaultLimit ?? DEFAULT_BODY_SIZE_LIMIT.defaultLimit,
    uploadLimit: overrides.uploadLimit ?? DEFAULT_BODY_SIZE_LIMIT.uploadLimit,
    routeOverrides: overrides.routeOverrides ?? DEFAULT_BODY_SIZE_LIMIT.routeOverrides,
  };
}

export function checkBodySizeLimit(
  request: HttpServerRequest.HttpServerRequest,
  config: BodySizeLimitConfig = DEFAULT_BODY_SIZE_LIMIT,
): Effect.Effect<void, RequestBodyTooLargeError> {
  return Effect.gen(function* () {
    const contentLengthHeader = request.headers["content-length"];
    if (!contentLengthHeader) {
      return; // No content-length header, allow request
    }

    const contentLength = parseInt(contentLengthHeader, 10);
    if (isNaN(contentLength)) {
      return; // Invalid content-length, allow request
    }

    const url = request.url;
    const limit = getLimitForRoute(url, config);

    if (contentLength > limit) {
      return yield* new RequestBodyTooLargeError({
        limit,
        received: contentLength,
      });
    }
  });
}

function getLimitForRoute(url: string, config: BodySizeLimitConfig): number {
  // Check for route-specific overrides
  if (config.routeOverrides) {
    for (const [routePrefix, limit] of config.routeOverrides.entries()) {
      if (url.startsWith(routePrefix)) {
        return limit;
      }
    }
  }

  // Check if it's an upload route
  if (url.includes("/upload") || url.includes("/attachment")) {
    return config.uploadLimit;
  }

  // Default limit
  return config.defaultLimit;
}

export function createBodySizeLimitMiddleware(
  config: BodySizeLimitConfig = DEFAULT_BODY_SIZE_LIMIT,
) {
  return <E, R>(
    effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, E | RequestBodyTooLargeError, R> =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      yield* checkBodySizeLimit(request, config).pipe(
        Effect.catchTag("RequestBodyTooLargeError", (error) =>
          Effect.fail(error),
        ),
      );

      return yield* effect;
    });
}

export function createBodySizeLimitErrorResponse(
  error: RequestBodyTooLargeError,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(
    {
      error: "Payload Too Large",
      message: `Request body size (${error.received} bytes) exceeds limit (${error.limit} bytes)`,
      limit: error.limit,
      received: error.received,
    },
    {
      status: 413,
      headers: {
        "X-Max-Body-Size": error.limit.toString(),
      },
    },
  );
}
