import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { it, assert } from "@effect/vitest";

import * as AcpError from "../errors.ts";
import { isAuthError, makeTokenRefresh } from "../token-refresh.ts";

// ─── Auth error detection ──────────────────────────────────────────────

it("isAuthError returns true for AcpRequestError with code -32000", () => {
  const error = new AcpError.AcpRequestError({
    code: -32000,
    errorMessage: "Authentication required",
  });
  assert.isTrue(isAuthError(error));
});

it("isAuthError returns false for AcpRequestError with other codes", () => {
  const error = new AcpError.AcpRequestError({
    code: -32601,
    errorMessage: "Method not found",
  });
  assert.isFalse(isAuthError(error));
});

it("isAuthError returns false for non-AcpRequestError errors", () => {
  const error = new AcpError.AcpTransportError({
    detail: "Transport error",
    cause: new Error("test"),
  });
  assert.isFalse(isAuthError(error));
});

// ─── Token refresh behavior ────────────────────────────────────────────

it.effect("withRefresh retries the effect after a successful token refresh", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const refreshToken = yield* Ref.make(0);

    const refreshEffect = Ref.update(refreshToken, (n) => n + 1).pipe(
      Effect.asVoid,
    );

    const { withRefresh } = yield* makeTokenRefresh(refreshEffect);

    const failingThenOk = Effect.sync(() => {
      attempts++;
      if (attempts === 1) {
        throw new AcpError.AcpRequestError({
          code: -32000,
          errorMessage: "Token expired",
        });
      }
      return "success";
    });

    const result = yield* withRefresh(failingThenOk);
    assert.equal(result, "success");
    assert.equal(attempts, 2);
    // Refresh was called once
    assert.equal(yield* Ref.get(refreshToken), 1);
  }),
);

it.effect("withRefresh propagates the error when refresh fails", () =>
  Effect.gen(function* () {
    const refreshEffect = Effect.fail(
      new AcpError.AcpRequestError({
        code: -32603,
        errorMessage: "Refresh endpoint unavailable",
      }),
    );

    const { withRefresh } = yield* makeTokenRefresh(refreshEffect);

    const operation = Effect.fail(
      new AcpError.AcpRequestError({
        code: -32000,
        errorMessage: "Token expired",
      }),
    );

    const result = yield* Effect.exit(withRefresh(operation));

    assert.isTrue(result._tag === "Failure");
  }),
);

it.effect("withRefresh passes through non-auth errors without refreshing", () =>
  Effect.gen(function* () {
    let refreshCalled = false;
    const refreshEffect = Effect.sync(() => {
      refreshCalled = true;
    });

    const { withRefresh } = yield* makeTokenRefresh(refreshEffect);

    const operation = Effect.fail(
      new AcpError.AcpRequestError({
        code: -32601,
        errorMessage: "Method not found",
      }),
    );

    const result = yield* Effect.exit(withRefresh(operation));

    assert.isTrue(result._tag === "Failure");
    // Refresh should NOT have been called for non-auth error
    assert.isFalse(refreshCalled);
  }),
);

it.effect(
  "concurrent requests during refresh are queued (only one refresh happens)",
  () =>
    Effect.gen(function* () {
      const refreshCount = yield* Ref.make(0);

      // Refresh takes time (simulated with a deferred)
      const refreshDeferred = yield* Deferred.make<void, AcpError.AcpError>();
      const refreshEffect = Ref.update(refreshCount, (n) => n + 1).pipe(
        Effect.flatMap(() => Deferred.await(refreshDeferred)),
      );

      const { withRefresh } = yield* makeTokenRefresh(refreshEffect);

      // Simulated operation that fails with auth error on first call
      let callCount = 0;
      const operation = Effect.sync(() => {
        callCount++;
        if (callCount <= 1) {
          throw new AcpError.AcpRequestError({
            code: -32000,
            errorMessage: "Token expired",
          });
        }
        return "ok";
      });

      // Fire two concurrent operations that will hit auth error
      const fiber1 = yield* withRefresh(operation).pipe(Effect.fork);
      const fiber2 = yield* withRefresh(operation).pipe(Effect.fork);

      // Yield to let both fibers start and hit the auth error
      yield* Effect.sleep("10 millis");

      // Only one refresh should have been triggered
      const count = yield* Ref.get(refreshCount);
      assert.equal(count, 1);

      // Complete the refresh
      yield* Deferred.succeed(refreshDeferred, void 0);

      // Both fibers should complete
      const result1 = yield* Fiber.join(fiber1);
      const result2 = yield* Fiber.join(fiber2);

      assert.equal(result1, "ok");
      assert.equal(result2, "ok");
      // Refresh was still only called once
      assert.equal(yield* Ref.get(refreshCount), 1);
    }),
);
