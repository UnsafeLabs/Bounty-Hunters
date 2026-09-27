import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import * as AcpError from "./errors.ts";

export interface SessionTokens {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly sessionId?: string;
}

export interface ReauthResult {
  readonly accessToken: string;
  readonly refreshToken?: string;
}

export interface SessionAuthCallbacks {
  readonly authenticate: (input: {
    readonly refreshToken: string;
  }) => Effect.Effect<ReauthResult, AcpError.AcpError>;
  readonly closeSession?: (sessionId: string) => Effect.Effect<unknown, AcpError.AcpError>;
  readonly onSessionExpired?: (sessionId: string | undefined) => Effect.Effect<void>;
}

const AUTH_FAILURE_MESSAGE =
  /unauthorized|unauthenticated|forbidden|session expired|session has expired|invalid token|token expired|authentication required|auth required/i;

const errorMessageOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const record = error as { readonly errorMessage?: unknown; readonly message?: unknown };
    if (typeof record.errorMessage === "string") {
      return record.errorMessage;
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
  }
  return "unknown error";
};

/**
 * Detects session authentication failures: the ACP equivalent of HTTP 401.
 * Matches explicit 401 codes, this codebase's own authRequired code (-32000),
 * and auth-flavored protocol messages.
 */
export const isSessionAuthFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as {
    readonly _tag?: unknown;
    readonly code?: unknown;
    readonly errorMessage?: unknown;
  };
  if (record._tag !== "AcpRequestError") {
    return false;
  }
  if (record.code === 401 || record.code === -32000) {
    return true;
  }
  return typeof record.errorMessage === "string" && AUTH_FAILURE_MESSAGE.test(record.errorMessage);
};

interface SessionAuthState {
  readonly tokens: SessionTokens;
  readonly reauth: Option.Option<Deferred.Deferred<void, AcpError.AuthenticationError>>;
}

export interface SessionAuthConfig {
  readonly initialTokens?: SessionTokens;
  readonly authenticate: SessionAuthCallbacks["authenticate"];
  readonly closeSession?: SessionAuthCallbacks["closeSession"];
  readonly onSessionExpired?: SessionAuthCallbacks["onSessionExpired"];
}

export interface SessionRefresher {
  readonly run: <A>(
    request: Effect.Effect<A, AcpError.AcpError>,
  ) => Effect.Effect<A, AcpError.AcpError | AcpError.AuthenticationError>;
  readonly setTokens: (tokens: SessionTokens) => Effect.Effect<void>;
  readonly getTokens: Effect.Effect<SessionTokens>;
}

export const makeSessionRefresher = Effect.fn("effect-acp/sessionAuth.makeSessionRefresher")(
  function* (
    callbacks: SessionAuthCallbacks,
    initialTokens: SessionTokens = {},
  ): Effect.fn.Return<SessionRefresher> {
    const state = yield* Ref.make<SessionAuthState>({
      tokens: initialTokens,
      reauth: Option.none(),
    });

    const setTokens = (tokens: SessionTokens) =>
      Ref.update(state, (current) => ({ ...current, tokens }));
    const getTokens = Ref.get(state).pipe(Effect.map((current) => current.tokens));

    const closeStaleSession = (sessionId: string | undefined) =>
      sessionId !== undefined && callbacks.closeSession !== undefined
        ? callbacks.closeSession(sessionId).pipe(Effect.ignore)
        : Effect.void;

    const failAuth = (sessionId: string | undefined, detail: string) =>
      Effect.fail(
        new AcpError.AuthenticationError({
          ...(sessionId !== undefined ? { sessionId } : {}),
          detail,
        }),
      );

    const reauthenticateOnce = (expired: SessionTokens) => {
      const refreshToken = expired.refreshToken;
      if (refreshToken === undefined) {
        return failAuth(expired.sessionId, "no refresh token available for re-authentication");
      }
      const authenticateNew = Effect.retry(
        callbacks.authenticate({ refreshToken }),
        Schedule.recurs(0),
      ).pipe(
        Effect.mapError(
          (error) =>
            new AcpError.AuthenticationError({
              ...(expired.sessionId !== undefined ? { sessionId: expired.sessionId } : {}),
              detail: `re-authentication failed: ${errorMessageOf(error)}`,
            }),
        ),
        Effect.tap((result) =>
          Ref.update(state, (current) => ({
            ...current,
            tokens: {
              ...current.tokens,
              accessToken: result.accessToken,
              ...(result.refreshToken !== undefined ? { refreshToken: result.refreshToken } : {}),
            },
          })),
        ),
        Effect.asVoid,
      );
      return Effect.acquireRelease(
        closeStaleSession(expired.sessionId).pipe(Effect.as(expired)),
        (captured, exit) =>
          Exit.isSuccess(exit) ? Effect.void : closeStaleSession(captured.sessionId),
      ).pipe(
        Effect.flatMap(() => authenticateNew),
        Effect.scoped,
      );
    };

    const replayOnce = <A>(
      request: Effect.Effect<A, AcpError.AcpError>,
      sessionId: string | undefined,
    ): Effect.Effect<A, AcpError.AcpError | AcpError.AuthenticationError> =>
      Effect.matchEffect(request, {
        onFailure: (error) =>
          isSessionAuthFailure(error)
            ? failAuth(sessionId, "session expired again immediately after re-authentication")
            : Effect.fail(error),
        onSuccess: (value) => Effect.succeed(value),
      });

    const run = <A>(
      request: Effect.Effect<A, AcpError.AcpError>,
    ): Effect.Effect<A, AcpError.AcpError | AcpError.AuthenticationError> =>
      Effect.matchEffect(request, {
        onFailure: (error) => {
          if (!isSessionAuthFailure(error)) {
            return Effect.fail(error);
          }
          return Effect.gen(function* () {
            const gate = yield* Deferred.make<void, AcpError.AuthenticationError>();
            const assignment = yield* Ref.modify(
              state,
              (
                current,
              ): readonly [
                {
                  readonly leader: boolean;
                  readonly gate: Deferred.Deferred<void, AcpError.AuthenticationError>;
                },
                SessionAuthState,
              ] =>
                Option.isSome(current.reauth)
                  ? [{ leader: false, gate: current.reauth.value }, current]
                  : [
                      { leader: true, gate },
                      { ...current, reauth: Option.some(gate) },
                    ],
            );
            if (!assignment.leader) {
              // Follower: wait for the in-flight re-auth (fails with the
              // typed AuthenticationError when re-auth fails), then replay once.
              yield* Deferred.await(assignment.gate);
              const tokens = yield* getTokens;
              return yield* replayOnce(request, tokens.sessionId);
            }
            // Leader: notify, re-authenticate once, release waiters, replay.
            const expired = (yield* Ref.get(state)).tokens;
            if (callbacks.onSessionExpired !== undefined) {
              yield* callbacks.onSessionExpired(expired.sessionId);
            }
            const clearInflight = Ref.update(state, (current) => ({
              ...current,
              reauth: Option.none(),
            }));
            yield* reauthenticateOnce(expired).pipe(
              Effect.tap(() =>
                Deferred.succeed(assignment.gate, undefined).pipe(Effect.andThen(clearInflight)),
              ),
              Effect.tapError((authError) =>
                Deferred.fail(assignment.gate, authError).pipe(Effect.andThen(clearInflight)),
              ),
            );
            const tokens = yield* Ref.get(state).pipe(Effect.map((current) => current.tokens));
            return yield* replayOnce(request, tokens.sessionId);
          });
        },
        onSuccess: (value) => Effect.succeed(value),
      });

    return { run, setTokens, getTokens };
  },
);
