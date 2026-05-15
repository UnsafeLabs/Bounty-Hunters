import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Deferred from "effect/Deferred";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as AcpError from "./errors.ts";

// ─── Auth error detection ──────────────────────────────────────────────
// ACP error code -32000 = "Authentication required" / token expired

const AUTH_REQUIRED_CODE = -32000 as const;

export const isAuthError = (error: AcpError.AcpError): boolean =>
  error._tag === "AcpRequestError" &&
  (error as AcpError.AcpRequestError).code === AUTH_REQUIRED_CODE;

// ─── Refresh state (dedup concurrent refreshes) ────────────────────────

type RefreshState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Refreshing";
      readonly deferred: Deferred.Deferred<void, AcpError.AcpError>;
    };

export interface TokenRefresh {
  readonly withRefresh: <A, E extends AcpError.AcpError, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, AcpError.AcpError, R>;
}

// ─── Make token refresh mechanism ──────────────────────────────────────

export const makeTokenRefresh = Effect.fn("makeTokenRefresh")(function* (
  refreshAction: Effect.Effect<void, AcpError.AcpError>,
): Effect.fn.Return<TokenRefresh> {
  const state = yield* Ref.make<RefreshState>({ _tag: "Idle" });

  const retryPolicy: Schedule.Schedule<Duration.Duration> = Schedule.exponential(
    Duration.millis(100),
    2.0,
  ).pipe(Schedule.take(3));

  const doRefresh = Effect.fn("doRefresh")(function* () {
    const current = yield* Ref.get(state);
    switch (current._tag) {
      case "Refreshing": {
        // Another fiber is already refreshing — wait for it
        return yield* Deferred.await(current.deferred);
      }
      case "Idle": {
        const deferred = yield* Deferred.make<void, AcpError.AcpError>();
        yield* Ref.set(state, { _tag: "Refreshing", deferred });

        // Run refresh, resolve deferred for waiters, then reset state
        yield* refreshAction.pipe(
          Effect.tap(() => Deferred.succeed(deferred, void 0)),
          Effect.tapError((error: AcpError.AcpError) => Deferred.fail(deferred, error)),
          Effect.ensuring(Ref.set(state, { _tag: "Idle" })),
        );
      }
    }
  });

  const withRefresh = <A, E extends AcpError.AcpError, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, AcpError.AcpError, R> =>
    effect.pipe(
      Effect.catchIf(isAuthError, () =>
        doRefresh().pipe(
          Effect.flatMap(() => effect),
          Effect.retry(retryPolicy),
        ),
      ),
    );

  return { withRefresh };
});
