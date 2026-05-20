import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export class BodyLimitError extends Data.TaggedError("BodyLimitError")<{
  readonly maxBytes: number;
  readonly contentLength: number;
}> {}

export const withBodyLimit = (
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, BodyLimitError, HttpServerRequest.HttpServerRequest>,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Effect.Effect<HttpServerResponse.HttpServerResponse, BodyLimitError, HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const contentLengthHeader = request.headers["content-length"];
    if (typeof contentLengthHeader === "string") {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        return yield* new BodyLimitError({ maxBytes, contentLength });
      }
    }
    return yield* effect;
  });

export const respondToBodyLimitError = (error: BodyLimitError) =>
  HttpServerResponse.text(`Payload Too Large: body size ${error.contentLength} exceeds limit of ${error.maxBytes} bytes`, {
    status: 413,
  });
