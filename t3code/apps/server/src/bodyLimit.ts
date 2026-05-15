import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { browserApiCorsHeaders } from "./httpCors.ts";

export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

export interface RequestBodySizeLimitOptions {
  readonly limitBytes?: number;
}

export interface OversizedRequestBodyInfo {
  readonly limitBytes: number;
  readonly receivedBytes: number;
}

export function parseContentLengthHeader(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolveRequestBodySizeLimit(options: RequestBodySizeLimitOptions = {}): number {
  return options.limitBytes ?? DEFAULT_REQUEST_BODY_LIMIT_BYTES;
}

export function oversizedRequestBodyInfo(
  headers: Record<string, string | undefined>,
  options: RequestBodySizeLimitOptions = {},
): OversizedRequestBodyInfo | null {
  const limitBytes = resolveRequestBodySizeLimit(options);
  const receivedBytes = parseContentLengthHeader(headers["content-length"]);
  if (receivedBytes === null || receivedBytes <= limitBytes) {
    return null;
  }

  return { limitBytes, receivedBytes };
}

export function payloadTooLargeResponse(info: OversizedRequestBodyInfo) {
  return HttpServerResponse.jsonUnsafe(
    {
      error: "Payload Too Large",
      limitBytes: info.limitBytes,
      receivedBytes: info.receivedBytes,
    },
    {
      status: 413,
      headers: {
        ...browserApiCorsHeaders,
        "X-Max-Body-Size": String(info.limitBytes),
      },
    },
  );
}

export const enforceRequestBodySizeLimit = (options: RequestBodySizeLimitOptions = {}) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const info = oversizedRequestBodyInfo(request.headers, options);
    return info ? payloadTooLargeResponse(info) : null;
  });
