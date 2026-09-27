import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import * as AcpError from "./errors.ts";
import * as SessionAuth from "./sessionAuth.ts";

const authFailure = (message = "Unauthorized") => AcpError.AcpRequestError.authRequired(message);

const codeFailure = (code: number, message: string) =>
  new AcpError.AcpRequestError({ code, errorMessage: message });

describe("sessionAuth", () => {
  it.effect("detects session authentication failures", () =>
    Effect.gen(function* () {
      assert.isTrue(SessionAuth.isSessionAuthFailure(authFailure()));
      assert.isTrue(SessionAuth.isSessionAuthFailure(codeFailure(401, "Unauthorized")));
      assert.isTrue(SessionAuth.isSessionAuthFailure(codeFailure(-32000, "whatever")));
      assert.isTrue(
        SessionAuth.isSessionAuthFailure(codeFailure(-32001, "Token expired, sign in again")),
      );
      assert.isFalse(
        SessionAuth.isSessionAuthFailure(AcpError.AcpRequestError.internalError("boom")),
      );
      assert.isFalse(SessionAuth.isSessionAuthFailure(codeFailure(-32603, "boom")));
      assert.isFalse(SessionAuth.isSessionAuthFailure(new Error("Unauthorized")));
      assert.isFalse(SessionAuth.isSessionAuthFailure(undefined));
    }),
  );

  it.effect("re-authenticates once, replays, and cleans up the old session", () =>
    Effect.gen(function* () {
      const authCalls = yield* Ref.make(0);
      const attempts = yield* Ref.make(0);
      const seenExpired: Array<string | undefined> = [];
      const seenClosed: Array<string> = [];

      const refresher = yield* SessionAuth.makeSessionRefresher(
        {
          authenticate: ({ refreshToken }) =>
            Ref.update(authCalls, (n) => n + 1).pipe(
              Effect.as({ accessToken: "access-2", refreshToken: `${refreshToken}-rotated` }),
            ),
          closeSession: (sessionId) =>
            Effect.sync(() => {
              seenClosed.push(sessionId);
            }).pipe(Effect.asVoid),
          onSessionExpired: (sessionId) =>
            Effect.sync(() => {
              seenExpired.push(sessionId);
            }).pipe(Effect.asVoid),
        },
        { accessToken: "access-1", refreshToken: "refresh-1", sessionId: "session-1" },
      );

      const request = Ref.updateAndGet(attempts, (n) => n + 1).pipe(
        Effect.flatMap((n) => (n <= 1 ? Effect.fail(authFailure()) : Effect.succeed("ok"))),
      );

      const result = yield* refresher.run(request);

      assert.equal(result, "ok");
      assert.equal(yield* Ref.get(authCalls), 1);
      assert.deepEqual(seenExpired, ["session-1"]);
      assert.deepEqual(seenClosed, ["session-1"]);
      assert.deepEqual(yield* refresher.getTokens, {
        accessToken: "access-2",
        refreshToken: "refresh-1-rotated",
        sessionId: "session-1",
      });
    }),
  );

  it.effect("queues concurrent requests behind a single re-authentication", () =>
    Effect.gen(function* () {
      const authCalls = yield* Ref.make(0);
      let failing = true;

      const refresher = yield* SessionAuth.makeSessionRefresher(
        {
          authenticate: () => {
            failing = false;
            return Ref.update(authCalls, (n) => n + 1).pipe(Effect.as({ accessToken: "access-2" }));
          },
        },
        { refreshToken: "refresh-1", sessionId: "session-1" },
      );

      const rerun = Effect.suspend(() =>
        failing ? Effect.fail(authFailure()) : Effect.succeed("replayed-ok"),
      );

      const results = yield* Effect.all(
        [refresher.run(rerun), refresher.run(rerun), refresher.run(rerun)],
        { concurrency: "unbounded" },
      );

      assert.equal(yield* Ref.get(authCalls), 1);
      assert.deepEqual(results, ["replayed-ok", "replayed-ok", "replayed-ok"]);
    }),
  );

  it.effect("fails queued requests with a typed AuthenticationError when re-auth fails", () =>
    Effect.gen(function* () {
      const refresher = yield* SessionAuth.makeSessionRefresher(
        {
          authenticate: () => Effect.fail(AcpError.AcpRequestError.internalError("idp down")),
        },
        { refreshToken: "refresh-1", sessionId: "session-1" },
      );

      const request = Effect.fail(authFailure());
      const tagged = <A>(
        effect: Effect.Effect<A, AcpError.AcpError | AcpError.AuthenticationError>,
      ) =>
        effect.pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catchTag("AuthenticationError", (error) =>
            Effect.succeed({ ok: false as const, detail: error.detail }),
          ),
        );
      const results = yield* Effect.all(
        [tagged(refresher.run(request)), tagged(refresher.run(request))],
        {
          concurrency: "unbounded",
        },
      );

      for (const result of results) {
        assert.isFalse(result.ok);
        if (!result.ok) {
          assert.isTrue(result.detail.includes("re-authentication failed"));
        }
      }
    }),
  );

  it.effect("passes through healthy and non-auth failures untouched", () =>
    Effect.gen(function* () {
      const authCalls = yield* Ref.make(0);
      const refresher = yield* SessionAuth.makeSessionRefresher({
        authenticate: () =>
          Ref.update(authCalls, (n) => n + 1).pipe(Effect.as({ accessToken: "x" })),
      });

      assert.equal(yield* refresher.run(Effect.succeed("fine")), "fine");
      const other = AcpError.AcpRequestError.internalError("boom");
      const outcome = yield* refresher.run(Effect.fail(other)).pipe(
        Effect.map(() => "succeeded" as const),
        Effect.catchTag("AcpRequestError", () => Effect.succeed("acp-request-error" as const)),
        Effect.catchTag("AuthenticationError", () => Effect.succeed("auth-error" as const)),
      );
      assert.equal(outcome, "acp-request-error");
      assert.equal(yield* Ref.get(authCalls), 0);
    }),
  );

  it.effect("fails fast with AuthenticationError when no refresh token exists", () =>
    Effect.gen(function* () {
      let authenticated = false;
      const refresher = yield* SessionAuth.makeSessionRefresher({
        authenticate: () => {
          authenticated = true;
          return Effect.succeed({ accessToken: "x" });
        },
      });

      const outcome = yield* refresher.run(Effect.fail(authFailure())).pipe(
        Effect.map(() => "succeeded" as const),
        Effect.catchTag("AuthenticationError", (error) =>
          Effect.succeed(`auth-error:${error.detail}`),
        ),
      );
      assert.isTrue(outcome.startsWith("auth-error:"));
      assert.isFalse(authenticated);
    }),
  );
});
