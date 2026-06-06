import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { browserApiCorsHeaders } from "./httpCors.ts";

export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES = 50 * 1024 * 1024;
export const BODY_LIMIT_HEADER = "X-Max-Body-Size";

export class RequestBodyTooLargeError extends Data.TaggedError("RequestBodyTooLargeError")<{
  readonly limitBytes: number;
  readonly receivedBytes: number;
}> {}

export function resolveRequestBodyLimit(limitBytes?: number): number {
  if (typeof limitBytes === "number" && Number.isFinite(limitBytes) && limitBytes > 0) {
    return Math.floor(limitBytes);
  }
  return DEFAULT_REQUEST_BODY_LIMIT_BYTES;
}

export function parseContentLengthBytes(headers: Record<string, string | undefined>) {
  const value = headers["content-length"];
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

export function requestBodyLimitExceeded(
  headers: Record<string, string | undefined>,
  limitBytes = DEFAULT_REQUEST_BODY_LIMIT_BYTES,
) {
  const receivedBytes = parseContentLengthBytes(headers);
  const resolvedLimitBytes = resolveRequestBodyLimit(limitBytes);
  if (receivedBytes === undefined || receivedBytes <= resolvedLimitBytes) {
    return undefined;
  }
  return new RequestBodyTooLargeError({
    limitBytes: resolvedLimitBytes,
    receivedBytes,
  });
}

export const enforceRequestBodyLimit = (limitBytes = DEFAULT_REQUEST_BODY_LIMIT_BYTES) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const error = requestBodyLimitExceeded(request.headers, limitBytes);
    if (error) {
      return yield* error;
    }
  });

export const respondToRequestBodyTooLarge = (error: RequestBodyTooLargeError) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        error: "Payload Too Large",
        limit: error.limitBytes,
        received: error.receivedBytes,
      },
      {
        status: 413,
        headers: {
          ...browserApiCorsHeaders,
          [BODY_LIMIT_HEADER]: String(error.limitBytes),
        },
      },
    ),
  );
