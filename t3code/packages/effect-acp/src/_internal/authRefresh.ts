import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import * as AcpError from "../errors.ts";
import type * as AcpSchema from "../_generated/schema.gen.ts";

/**
 * JSON-RPC error code an ACP agent returns when (re-)authentication is required.
 * @see AcpRequestError.authRequired
 */
export const AUTH_REQUIRED_ERROR_CODE = -32000;

export interface AcpAuthRefreshOptions {
  /**
   * Re-authentication request replayed against the agent when a request fails
   * because the session expired. The agent re-runs its login flow for the given
   * `methodId` and refreshes the underlying token.
   * @see https://agentclientprotocol.com/protocol/schema#authenticate
   */
  readonly authenticate: AcpSchema.AuthenticateRequest;
  /**
   * Invoked with the expired session id (when the failing request carried one)
   * immediately before re-authentication is attempted. Useful for surfacing the
   * expiry to callers or invalidating cached session state.
   */
  readonly onSessionExpired?: (
    sessionId: AcpSchema.SessionId | undefined,
  ) => Effect.Effect<void, never>;
  /**
   * Maximum number of automatic re-authentication attempts per request.
   * @defaultValue 1
   */
  readonly maxRetries?: number;
}

export interface AuthRefresh {
  /**
   * Wraps an agent request so that an "authentication required" failure triggers
   * a single coalesced re-authentication and a retry of the original request.
   */
  readonly wrap: <A>(
    sessionId: AcpSchema.SessionId | undefined,
    request: Effect.Effect<A, AcpError.AcpError>,
  ) => Effect.Effect<A, AcpError.AcpError>;
}

export const isSessionExpiredError = (error: AcpError.AcpError): boolean =>
  error._tag === "AcpRequestError" && error.code === AUTH_REQUIRED_ERROR_CODE;

export const make = (
  options: AcpAuthRefreshOptions,
  authenticate: (
    payload: AcpSchema.AuthenticateRequest,
  ) => Effect.Effect<unknown, AcpError.AcpError>,
): Effect.Effect<AuthRefresh> =>
  Effect.gen(function* () {
    const maxRetries = options.maxRetries ?? 1;
    // `generation` advances once per completed re-authentication so concurrent
    // expired requests coalesce onto a single refresh instead of stampeding the
    // agent; `semaphore` serializes the refresh critical section.
    const generation = yield* Ref.make(0);
    const semaphore = yield* Semaphore.make(1);

    const refresh = (startGeneration: number, sessionId: AcpSchema.SessionId | undefined) =>
      semaphore.withPermits(1)(
        Effect.flatMap(Ref.get(generation), (current) =>
          current !== startGeneration
            ? // Another request already refreshed while we waited for the permit.
              Effect.void
            : (options.onSessionExpired
                ? options.onSessionExpired(sessionId)
                : Effect.void
              ).pipe(
                Effect.andThen(authenticate(options.authenticate)),
                Effect.andThen(Ref.update(generation, (value) => value + 1)),
                Effect.asVoid,
              ),
        ),
      );

    const wrap = <A>(
      sessionId: AcpSchema.SessionId | undefined,
      request: Effect.Effect<A, AcpError.AcpError>,
    ): Effect.Effect<A, AcpError.AcpError> => {
      const attempt = (remaining: number): Effect.Effect<A, AcpError.AcpError> =>
        Effect.flatMap(Ref.get(generation), (startGeneration) =>
          request.pipe(
            Effect.catchIf(isSessionExpiredError, (error) =>
              remaining <= 0
                ? Effect.fail(error)
                : refresh(startGeneration, sessionId).pipe(
                    Effect.andThen(attempt(remaining - 1)),
                  ),
            ),
          ),
        );
      return attempt(maxRetries);
    };

    return { wrap };
  });
