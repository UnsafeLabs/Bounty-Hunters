import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Deferred from "effect/Deferred";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as AcpError from "./errors.ts";
import type { AcpClientShape } from "./client.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Error code used by ACP to signal "Authentication required". */
const AUTH_REQUIRED_CODE = -32000 as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the access token used in ACP authentication.
 *
 * Stores the current access token, an optional refresh token for obtaining
 * new credentials, and an optional expiry timestamp so the client can
 * proactively refresh before the token actually expires.
 */
export interface AcpTokenConfig {
  /** The current access token value */
  readonly accessToken: string;
  /**
   * A refresh token that can be exchanged for a new access token when the
   * current one expires.  If omitted, refresh is still attempted (the
   * provider may use other means).
   */
  readonly refreshToken?: string;
  /**
   * Epoch timestamp (milliseconds) when the access token expires.
   * When set, the framework will consider the token stale
   * `refreshThresholdMs` before this time and trigger a proactive refresh.
   */
  readonly expiresAt?: number;
}

/**
 * Provider interface for token lifecycle operations.
 *
 * Implement this to integrate with your identity provider (OAuth2, OIDC,
 * custom token service, etc.).
 */
export interface AcpTokenProvider {
  /**
   * Called when the current access token has expired (or is about to expire)
   * and a fresh one is needed.
   *
   * @param currentToken The current (expired or soon-to-expire) token config,
   *   including the refresh token that was stored when the previous token was
   *   issued.
   * @returns A new {@link AcpTokenConfig} containing the refreshed credentials.
   */
  readonly refresh: (
    currentToken: AcpTokenConfig,
  ) => Effect.Effect<AcpTokenConfig, AcpTokenRefreshError>;
}

/**
 * Options for configuring the automatic token refresh behaviour.
 */
export interface AcpTokenRefreshOptions {
  /**
   * How many milliseconds *before* the actual `expiresAt` to trigger a
   * proactive refresh.  Uses the {@link AcpTokenConfig.expiresAt} field.
   *
   * @defaultValue 60_000 (one minute)
   */
  readonly refreshThresholdMs?: number;
}

// ---------------------------------------------------------------------------
// Tagged Error
// ---------------------------------------------------------------------------

/**
 * Error that is produced when a token refresh operation fails.
 *
 * This is a terminal failure – the original request will **not** be retried
 * after a refresh failure.
 */
export class AcpTokenRefreshError extends Schema.TaggedErrorClass<AcpTokenRefreshError>()(
  "AcpTokenRefreshError",
  {
    errorMessage: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message() {
    return `Token refresh failed: ${this.errorMessage}`;
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/**
 * Internal representation of the refresh state.
 *
 * - `None` → no refresh is currently in-flight.
 * - `Some(deferred)` → a refresh is in-flight; concurrent callers should
 *   await the same deferred.
 */
type RefreshState = Option.Option<Deferred.Deferred<void, AcpTokenRefreshError>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the error is an `AcpRequestError` whose code indicates
 * that the client must re-authenticate.
 *
 * NOTE: When received via `Effect.catchTag("AcpRequestError", ...)`, the
 * value is already guaranteed to be an `AcpRequestError` instance, so this
 * is effectively a `code` check.
 */
const isAuthError = (error: AcpError.AcpRequestError): boolean =>
  error.code === AUTH_REQUIRED_CODE;

function shouldProactiveRefresh(
  config: AcpTokenConfig,
  thresholdMs: number,
): boolean {
  if (config.expiresAt === undefined) return false;
  return Date.now() >= config.expiresAt - thresholdMs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wraps an {@link AcpClientShape} with automatic token refresh.
 *
 * Every agent RPC and raw extension request is intercepted.  When the agent
 * responds with an "Authentication required" error (code `-32000`), or when
 * the token is proactively refreshed (based on `expiresAt` /
 * `refreshThresholdMs`), the token provider's `refresh` function is called
 * to obtain a fresh token.  Once the token has been refreshed, the original
 * request is transparently retried.
 *
 * **Concurrent requests** – If several requests encounter an auth error at
 * roughly the same time, they all wait on a single refresh operation and are
 * retried once the token has been rotated.  This prevents a stampede of
 * concurrent refresh calls.
 *
 * **Graceful degradation** – If the token provider's `refresh` function
 * fails, the original auth error is propagated to the caller.  No infinite
 * retry loop is created.
 *
 * @param client     The underlying ACP client shape.
 * @param provider   Token provider responsible for issuing fresh credentials.
 * @param initialToken  The starting token configuration.
 * @param options    Optional tuning parameters (refresh threshold, etc.).
 * @returns A new `AcpClientShape` with automatic token refresh applied.
 */
export const withTokenRefresh = (
  client: AcpClientShape,
  provider: AcpTokenProvider,
  initialToken: AcpTokenConfig,
  options?: AcpTokenRefreshOptions,
): AcpClientShape => {
  const refreshThresholdMs = options?.refreshThresholdMs ?? 60_000; // 1 min

  // Create refs for shared mutable state.  This is synchronous because
  // Ref.make runs in Sync and Effect.runSync unwraps it immediately.
  const state = Effect.runSync(
    Effect.gen(function* () {
      const tokenRef = yield* Ref.make<AcpTokenConfig>(initialToken);
      const refreshRef = yield* Ref.make<RefreshState>(Option.none());
      return { tokenRef, refreshRef };
    }),
  );

  // ── Internal refresh orchestrator ─────────────────────────────────────
  const doRefresh = (
    currentToken: AcpTokenConfig,
  ): Effect.Effect<void, AcpTokenRefreshError> =>
    provider.refresh(currentToken).pipe(
      Effect.flatMap((newToken) =>
        Ref.set(state.tokenRef, newToken).pipe(
          Effect.zipRight(
            // Clear the in-flight deferred so future callers
            // start a fresh refresh cycle.
            Ref.set(state.refreshRef, Option.none()),
          ),
        ),
      ),
    );

  /**
   * Attempt to obtain a fresh token.  If another request is already doing
   * this, we wait for that one to complete (stampede protection).
   */
  const refreshOrAwait = Effect.fnUntraced(function* () {
    const currentToken = yield* Ref.get(state.tokenRef);

    // Fast-path: check if we need a *proactive* refresh BEFORE making any
    // request (for early-reload scenarios).
    if (shouldProactiveRefresh(currentToken, refreshThresholdMs)) {
      yield* doRefresh(currentToken);
      return;
    }

    // Otherwise, try to coordinate with concurrent callers.
    const deferred = yield* Deferred.make<void, AcpTokenRefreshError>();

    const winner = yield* Ref.modify(state.refreshRef, (current) => {
      if (Option.isSome(current)) {
        // Somebody else is already refreshing – let them do it.
        return [false, current] as const;
      }
      // We are the first – claim the slot.
      return [true, Option.some(deferred)] as const;
    });

    if (!winner) {
      // Wait for the ongoing refresh to finish.
      const ongoing = yield* Ref.get(state.refreshRef);
      if (Option.isSome(ongoing)) {
        yield* Deferred.await(ongoing.value);
      }
      return;
    }

    // We won the slot – perform the actual refresh.
    yield* Effect.matchEffect(doRefresh(currentToken), {
      onSuccess: () => Deferred.succeed(deferred, void 0),
      onFailure: (e) =>
        Deferred.fail(deferred, e).pipe(Effect.as(Effect.fail(e))),
    }).pipe(Effect.flatten);
  });

  // ── Request wrapper (for raw requests and agent RPCs) ─────────────────
  const wrapRequest = <A>(
    request: Effect.Effect<A, AcpError.AcpError>,
  ): Effect.Effect<A, AcpError.AcpError> =>
    Effect.catchTag(request, "AcpRequestError", (error) => {
      if (!isAuthError(error)) {
        return Effect.fail(error);
      }

      // Auth error — try to refresh and retry exactly once.
      return refreshOrAwait.pipe(
        Effect.matchEffect({
          onSuccess: () =>
            // Retry the original request once.
            request.pipe(
              // If it still fails with auth, propagate the *original* error
              // to avoid infinite loops.
              Effect.catchTag("AcpRequestError", (retryError) => {
                if (isAuthError(retryError)) {
                  return Effect.fail(error);
                }
                return Effect.fail(retryError);
              }),
            ),
          onFailure: () => Effect.fail(error),
        }),
      );
    });

  // ── Build the wrapped client shape ──────────────────────────────────
  return {
    raw: {
      notifications: client.raw.notifications,
      request: (method, payload) =>
        wrapRequest(client.raw.request(method, payload)),
      notify: client.raw.notify,
    },
    agent: {
      initialize: (payload) =>
        wrapRequest(client.agent.initialize(payload)),
      authenticate: (payload) =>
        wrapRequest(client.agent.authenticate(payload)),
      logout: (payload) =>
        wrapRequest(client.agent.logout(payload)),
      createSession: (payload) =>
        wrapRequest(client.agent.createSession(payload)),
      loadSession: (payload) =>
        wrapRequest(client.agent.loadSession(payload)),
      listSessions: (payload) =>
        wrapRequest(client.agent.listSessions(payload)),
      forkSession: (payload) =>
        wrapRequest(client.agent.forkSession(payload)),
      resumeSession: (payload) =>
        wrapRequest(client.agent.resumeSession(payload)),
      closeSession: (payload) =>
        wrapRequest(client.agent.closeSession(payload)),
      setSessionModel: (payload) =>
        wrapRequest(client.agent.setSessionModel(payload)),
      setSessionConfigOption: (payload) =>
        wrapRequest(client.agent.setSessionConfigOption(payload)),
      prompt: (payload) =>
        wrapRequest(client.agent.prompt(payload)),
      cancel: (payload) => client.agent.cancel(payload),
    },
    handleRequestPermission: (handler) =>
      client.handleRequestPermission(handler),
    handleElicitation: (handler) =>
      client.handleElicitation(handler),
    handleReadTextFile: (handler) =>
      client.handleReadTextFile(handler),
    handleWriteTextFile: (handler) =>
      client.handleWriteTextFile(handler),
    handleCreateTerminal: (handler) =>
      client.handleCreateTerminal(handler),
    handleTerminalOutput: (handler) =>
      client.handleTerminalOutput(handler),
    handleTerminalWaitForExit: (handler) =>
      client.handleTerminalWaitForExit(handler),
    handleTerminalKill: (handler) =>
      client.handleTerminalKill(handler),
    handleTerminalRelease: (handler) =>
      client.handleTerminalRelease(handler),
    handleSessionUpdate: (handler) =>
      client.handleSessionUpdate(handler),
    handleElicitationComplete: (handler) =>
      client.handleElicitationComplete(handler),
    handleUnknownExtRequest: (handler) =>
      client.handleUnknownExtRequest(handler),
    handleUnknownExtNotification: (handler) =>
      client.handleUnknownExtNotification(handler),
    handleExtRequest: (method, payload, handler) =>
      client.handleExtRequest(method, payload, handler),
    handleExtNotification: (method, payload, handler) =>
      client.handleExtNotification(method, payload, handler),
  };
};
