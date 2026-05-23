import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

export interface BodySizeLimitOptions {
  readonly maxSize?: number;
}

export function bodySizeLimit(options: BodySizeLimitOptions = {}) {
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;

  return <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | { _tag: "BodyTooLarge"; message: string }, R | HttpServerRequest.HttpServerRequest> =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const contentLength = request.headers["content-length"];

      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > maxSize) {
          return yield* {
            _tag: "BodyTooLarge" as const,
            message: `Request body too large: ${size} bytes (max: ${maxSize})`,
          };
        }
      }

      return yield* effect;
    }).pipe(
      Effect.catchTag("BodyTooLarge", (err) =>
        Effect.succeed(
          HttpServerResponse.text(err.message, { status: 413 }),
        ),
      ),
    );
}
