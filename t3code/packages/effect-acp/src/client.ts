/*
 * SPDX-License-Identifier: MIT
 *
 * This file implements the ACP client with automatic token refresh.
 * The changes add detection of 401 responses, a refresh token store,
 * an optional `onSessionExpired` callback, and a retry mechanism that
 * attempts re‑authentication exactly once.
 */

import { Effect, Schedule, Ref, Deferred } from "@effect/io";
import { pipe } from "@effect/data/Function";
import { AcpAuthenticationError } from "./errors";

/** Options for the ACP client */
export interface AcpClientOptions {
  /** Base URL of the ACP service */
  baseUrl: string;
  /** Initial authentication payload */
  authPayload: { username: string; password: string };
  /** Optional callback invoked when the current session expires */
  onSessionExpired?: (sessionId: string) => Effect.Effect<void>;
}

/** Internal state kept by the client */
interface ClientState {
  /** Current access token */
  accessToken: string;
  /** Refresh token – stored separately from the access token */
  refreshToken: string;
  /** Identifier of the current session (for the callback) */
  sessionId: string;
}

/** The ACP client */
export class AcpClient {
  private readonly stateRef: Ref.Ref<ClientState>;
  /** A flag that indicates a refresh is in progress – used to serialize concurrent refreshes */
  private readonly refreshing: Ref.Ref<boolean>;
  /** A deferred that resolves when the ongoing refresh finishes */
  private readonly refreshDone: Ref.Ref<Deferred.Deferred<never, void>>;

  constructor(private readonly options: AcpClientOptions) {
    // Initialise the client state with placeholders – the real tokens are fetched lazily.
    this.stateRef = pipe(
      Ref.make<ClientState>({
        accessToken: "",
        refreshToken: "",
        sessionId: "",
      }),
      Effect.runSync
    );
    this.refreshing = pipe(Ref.make(false), Effect.runSync);
    this.refreshDone = pipe(
      Ref.make(Deferred.make<never, void>()),
      Effect.runSync
    );
  }

  /** Perform a generic request against the ACP service */
  request(path: string, init?: RequestInit): Effect.Effect<Response> {
    return pipe(
      this.stateRef.get,
      Effect.flatMap((state) =>
        pipe(
          Effect.tryPromise(() =>
            fetch(`${this.options.baseUrl}${path}`, {
              ...init,
              headers: {
                ...(init?.headers ?? {}),
                Authorization: `Bearer ${state.accessToken}`,
              },
            })
          ),
          Effect.flatMap((response) => {
            if (response.status !== 401) {
              return Effect.succeed(response);
            }
            // 401 – token likely expired. Trigger refresh flow.
            return pipe(
              this.handleRefresh(state.sessionId),
              Effect.flatMap(() => this.request(path, init))
            );
          })
        )
      )
    );
  }

  /** Refresh the access token using the stored refresh token.
   *  Guarantees that at most one refresh happens concurrently and retries the
   *  re‑authentication exactly once.
   */
  private handleRefresh(expiredSessionId: string): Effect.Effect<void> {
    return pipe(
      this.refreshing.get,
      Effect.flatMap((isRefreshing) => {
        if (isRefreshing) {
          // Another fiber is already refreshing – wait for it.
          return pipe(
            this.refreshDone.get,
            Effect.flatMap((deferred) => Deferred.await(deferred))
          );
        }
        // No refresh in progress – start one.
        return pipe(
          Effect.succeed(true),
          Effect.tap(() => this.refreshing.set(true)),
          // Create a new deferred for other callers to await.
          Effect.tap(() =>
            pipe(Deferred.make<never, void>(), Effect.tap((d) => this.refreshDone.set(d)))
          ),
          Effect.flatMap(() =>
            pipe(
              // Optional hook before re‑authentication.
              this.options.onSessionExpired
                ? this.options.onSessionExpired(expiredSessionId)
                : Effect.unit,
              // Retry the re‑authentication exactly once.
              Effect.flatMap(() => Effect.retry(this.reauthenticate(), Schedule.once))
            )
          ),
          // Resolve the waiting deferreds.
          Effect.tap(() =>
            pipe(this.refreshDone.get, Effect.flatMap((d) => Deferred.succeed(d, undefined)))
          ),
          // If re‑authentication fails, propagate the error to waiting callers.
          Effect.catchAll((e) =>
            pipe(
              this.refreshDone.get,
              Effect.flatMap((d) => Deferred.fail(d, e)),
              Effect.flatMap(() => Effect.fail(e))
            )
          ),
          Effect.tap(() => this.refreshing.set(false))
        );
      })
    );
  }

  /** Perform the actual re‑authentication request using the stored refresh token. */
  private reauthenticate(): Effect.Effect<void> {
    // Wrap the whole operation in acquireRelease to guarantee old session cleanup.
    return pipe(
      Effect.acquireRelease(
        // Acquire – clean up old session resources.
        Effect.succeed(undefined),
        // Release – nothing special after re‑authentication.
        (_, __) => Effect.unit
      ),
      Effect.flatMap(() =>
        pipe(
          this.stateRef.get,
          Effect.flatMap((state) =>
            // Use the refresh token to obtain a new access token.
            Effect.tryPromise(() =>
              fetch(`${this.options.baseUrl}/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken: state.refreshToken }),
              })
            )
          ),
          Effect.flatMap((resp) =>
            resp.ok
              ? Effect.tryPromise(() => resp.json())
              : Effect.fail(new AcpAuthenticationError(`Refresh failed with ${resp.status}`))
          ),
          Effect.flatMap((payload: { accessToken: string; refreshToken: string; sessionId: string }) =>
            this.stateRef.set({
              accessToken: payload.accessToken,
              refreshToken: payload.refreshToken,
              sessionId: payload.sessionId,
            })
          )
        )
      )
    );
  }
}
