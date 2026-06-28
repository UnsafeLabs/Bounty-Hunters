/**
 * Request body size limiting with per-route overrides.
 *
 * Pure, parameterized helpers that resolve the maximum request body size for a
 * route and decide whether an incoming request's declared `Content-Length` fits
 * within budget, plus a thin adapter that turns an over-budget decision into a
 * `413 Payload Too Large` response. The limits table is an ordinary validated
 * value, so callers supply their own per-route overrides instead of relying on a
 * single hard-coded global ceiling.
 *
 * @module bodySizeLimit
 */
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

/**
 * Default ceiling (10 MiB ≈ 10 MB) applied to any route without an explicit
 * override, matching the spec's 10 MB default. This is a generous ceiling for
 * this server's body-accepting routes, which carry small JSON control-plane
 * payloads (orchestration commands, auth credentials); the OTLP traces proxy
 * gets the larger override below for batched spans.
 */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Override (50 MiB ≈ 50 MB) for the browser OTLP traces proxy — batched trace
 * payloads are far larger than ordinary command payloads. Mirrors the spec's
 * 50 MB large-payload tier.
 */
export const OTLP_TRACES_MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024;

/** Route key for the OTLP traces proxy override (mirrors the registered path). */
export const OTLP_TRACES_PROXY_ROUTE_KEY = "/api/observability/v1/traces";

/**
 * BodySizeLimits - Resolved limits table: a default ceiling plus per-route
 * overrides keyed by the route's registered path.
 */
export interface BodySizeLimits {
  readonly defaultMaxBytes: number;
  readonly routeOverrides: Readonly<Record<string, number>>;
}

const assertByteBudget = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      `${label} must be a non-negative safe integer number of bytes, received: ${String(value)}`,
    );
  }
};

/**
 * Build a validated {@link BodySizeLimits} table. Every byte budget — the
 * default and each override — must be a non-negative safe integer; anything else
 * throws a `TypeError` rather than silently producing an unenforceable limit.
 */
export const makeBodySizeLimits = (input: {
  readonly defaultMaxBytes: number;
  readonly routeOverrides?: Readonly<Record<string, number>>;
}): BodySizeLimits => {
  assertByteBudget(input.defaultMaxBytes, "defaultMaxBytes");
  const routeOverrides = input.routeOverrides ?? {};
  for (const [routeKey, maxBytes] of Object.entries(routeOverrides)) {
    assertByteBudget(maxBytes, `routeOverrides[${routeKey}]`);
  }
  return { defaultMaxBytes: input.defaultMaxBytes, routeOverrides };
};

/** Default production limits: 10 MiB everywhere, 50 MiB for the OTLP traces proxy. */
export const DEFAULT_BODY_SIZE_LIMITS: BodySizeLimits = {
  defaultMaxBytes: DEFAULT_MAX_REQUEST_BODY_BYTES,
  routeOverrides: {
    [OTLP_TRACES_PROXY_ROUTE_KEY]: OTLP_TRACES_MAX_REQUEST_BODY_BYTES,
  },
};

/**
 * Parse a raw `Content-Length` header into a non-negative integer byte count.
 * Returns `undefined` when the header is absent or malformed (so the caller
 * cannot pre-check); absurdly large declared sizes are clamped to
 * `Number.MAX_SAFE_INTEGER` so the comparison still flags them as over budget.
 */
export const parseContentLength = (header: string | undefined): number | undefined => {
  if (header === undefined) {
    return undefined;
  }
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
};

/** Resolve the effective max body size for a route: override, else default. */
export const resolveMaxBodyBytes = (limits: BodySizeLimits, routeKey: string): number =>
  limits.routeOverrides[routeKey] ?? limits.defaultMaxBytes;

/**
 * BodySizeDecision - Outcome of evaluating a request against its route budget.
 * `contentLength` is `undefined` when the request did not declare a parseable
 * `Content-Length` (such a request is allowed through this pre-check).
 */
export interface BodySizeDecision {
  readonly allowed: boolean;
  readonly maxBytes: number;
  readonly contentLength: number | undefined;
}

/**
 * Decide whether a request's declared body size is within the route's budget.
 * A missing/unparseable `Content-Length` is allowed (cannot be pre-checked); a
 * zero budget rejects any non-empty declared body.
 */
export const evaluateRequestBodyLimit = (
  limits: BodySizeLimits,
  routeKey: string,
  contentLengthHeader: string | undefined,
): BodySizeDecision => {
  const maxBytes = resolveMaxBodyBytes(limits, routeKey);
  const contentLength = parseContentLength(contentLengthHeader);
  const allowed = contentLength === undefined || contentLength <= maxBytes;
  return { allowed, maxBytes, contentLength };
};

/**
 * Build the `413 Payload Too Large` response for an over-budget decision. The
 * advertised limit is emitted as `X-Max-Body-Size` (per the spec) and the
 * request's received `Content-Length` is echoed back — both in the body text
 * and as `X-Received-Content-Length` — so callers can debug what was rejected.
 */
export const payloadTooLargeResponse = (
  decision: BodySizeDecision,
): HttpServerResponse.HttpServerResponse => {
  const headers: Record<string, string> = {
    "X-Max-Body-Size": String(decision.maxBytes),
  };
  if (decision.contentLength !== undefined) {
    headers["X-Received-Content-Length"] = String(decision.contentLength);
  }
  const receivedText =
    decision.contentLength === undefined ? "unknown" : `${decision.contentLength} bytes`;
  return HttpServerResponse.text(
    `Payload Too Large: received ${receivedText} which exceeds the ${decision.maxBytes}-byte limit for this route.`,
    { status: 413, headers },
  );
};

/**
 * Enforce a route's body size budget against a raw `Content-Length` header.
 * Returns a `413` response when the declared size exceeds the limit, or
 * `undefined` when the request is allowed to proceed.
 */
export const enforceRequestBodyLimit = (
  limits: BodySizeLimits,
  routeKey: string,
  contentLengthHeader: string | undefined,
): HttpServerResponse.HttpServerResponse | undefined => {
  const decision = evaluateRequestBodyLimit(limits, routeKey, contentLengthHeader);
  return decision.allowed ? undefined : payloadTooLargeResponse(decision);
};

/**
 * Effect adapter that enforces a route's body size budget against the current
 * {@link HttpServerRequest}. Yields a `413` response when the declared
 * `Content-Length` exceeds the limit, or `undefined` when the request may
 * proceed — letting any body-accepting route guard itself with a single
 * `const tooLarge = yield* enforceRequestBodyLimitForRequest(...)` line.
 */
export const enforceRequestBodyLimitForRequest = (limits: BodySizeLimits, routeKey: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return enforceRequestBodyLimit(limits, routeKey, request.headers["content-length"]);
  });
