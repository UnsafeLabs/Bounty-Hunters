import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { assert, it } from "@effect/vitest";

import * as AuthRefresh from "./authRefresh.ts";
import * as AcpError from "../errors.ts";

const sessionExpired = AcpError.AcpRequestError.authRequired("Session expired");

// Builds a request that fails with the session-expired error on its first
// invocation and succeeds with `value` afterwards, mirroring an expired token
// that becomes valid again once the client re-authenticates.
const failOnceThenSucceed = <A>(value: A) =>
  Effect.map(Ref.make(0), (tries) =>
    Effect.flatMap(Ref.updateAndGet(tries, (count) => count + 1), (count) =>
      count === 1 ? Effect.fail(sessionExpired) : Effect.succeed(value),
    ),
  );

it.effect("invokes onSessionExpired with the session id before re-authenticating", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<Array<string>>([]);
    const refresh = yield* AuthRefresh.make(
      {
        authenticate: { methodId: "cursor_login" },
        onSessionExpired: (sessionId) =>
          Ref.update(events, (current) => [...current, `expired:${sessionId}`]),
      },
      () => Ref.update(events, (current) => [...current, "authenticate"]),
    );
    const request = yield* failOnceThenSucceed("ok");

    const value = yield* refresh.wrap("session-1", request);

    assert.equal(value, "ok");
    assert.deepEqual(yield* Ref.get(events), ["expired:session-1", "authenticate"]);
  }),
);

it.effect("coalesces concurrent re-authentication for simultaneously expired requests", () =>
  Effect.gen(function* () {
    const authCount = yield* Ref.make(0);
    const failures = yield* Ref.make(0);
    // Holds the first re-authentication open until both requests have failed,
    // guaranteeing the refreshes genuinely overlap rather than running serially.
    const bothFailed = yield* Deferred.make<void>();
    const refresh = yield* AuthRefresh.make({ authenticate: { methodId: "cursor_login" } }, () =>
      Deferred.await(bothFailed).pipe(Effect.andThen(Ref.update(authCount, (count) => count + 1))),
    );

    const makeRequest = (value: string) =>
      Effect.map(Ref.make(0), (tries) =>
        refresh.wrap(
          value,
          Effect.flatMap(Ref.updateAndGet(tries, (count) => count + 1), (count) =>
            count === 1
              ? Effect.flatMap(Ref.updateAndGet(failures, (total) => total + 1), (total) =>
                  (total === 2 ? Deferred.succeed(bothFailed, void 0) : Effect.void).pipe(
                    Effect.andThen(Effect.fail(sessionExpired)),
                  ),
                )
              : Effect.succeed(value),
          ),
        ),
      );

    const requestA = yield* makeRequest("a");
    const requestB = yield* makeRequest("b");
    const results = yield* Effect.all([requestA, requestB], { concurrency: "unbounded" });

    assert.deepEqual(results, ["a", "b"]);
    assert.equal(yield* Ref.get(authCount), 1);
  }),
);

it.effect("retries up to the configured budget then surfaces the auth error", () =>
  Effect.gen(function* () {
    const authCount = yield* Ref.make(0);
    const refresh = yield* AuthRefresh.make(
      { authenticate: { methodId: "cursor_login" }, maxRetries: 2 },
      () => Ref.update(authCount, (count) => count + 1),
    );

    const error = yield* Effect.flip(refresh.wrap("session-1", Effect.fail(sessionExpired)));

    assert.equal(error._tag, "AcpRequestError");
    assert.equal((error as AcpError.AcpRequestError).code, AuthRefresh.AUTH_REQUIRED_ERROR_CODE);
    assert.equal(yield* Ref.get(authCount), 2);
  }),
);

it.effect("does not re-authenticate for errors unrelated to authentication", () =>
  Effect.gen(function* () {
    const authCount = yield* Ref.make(0);
    const refresh = yield* AuthRefresh.make({ authenticate: { methodId: "cursor_login" } }, () =>
      Ref.update(authCount, (count) => count + 1),
    );

    const error = yield* Effect.flip(
      refresh.wrap("session-1", Effect.fail(AcpError.AcpRequestError.internalError("boom"))),
    );

    assert.equal((error as AcpError.AcpRequestError).errorMessage, "boom");
    assert.equal(yield* Ref.get(authCount), 0);
  }),
);
