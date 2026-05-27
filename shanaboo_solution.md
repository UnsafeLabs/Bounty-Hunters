```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,6 +1,7 @@
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as Stdio from "effect/Stdio";
+import * as FiberRef from "effect/FiberRef";
 import * as Layer from "effect/Layer";
 import * as Schema from "effect/Schema";
 import * as Scope from "effect/Scope";
@@ -22,9 +23,16 @@ import {
   runHandler,
 } from "./_internal/shared.ts";
 import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+import * as Queue from "effect/Queue";
+import * as Deferred from "effect/Deferred";
+import * as Option from "effect/Option";
+import * as Ref from "effect/Ref";
 
 export interface AcpClientOptions {
   readonly logIncoming?: boolean;
   readonly logOutgoing?: boolean;
   readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;
 }
 
 type AcpClientRaw = {
@@ -32,6 +40,20 @@ type AcpClientRaw = {
   readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
   readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
 };
 
+interface SessionState {
+  readonly sessionId: string;
+  readonly accessToken: string;
+  readonly refreshToken: string;
+}
+
+interface ClientState {
+  readonly session: Option.Option<SessionState>;
+  readonly reAuthDeferred: Option.Option<Deferred.Deferred<void, AcpError.AuthenticationError>>;
+  readonly requestQueue: Queue.Queue<{
+    readonly method: string;
+    readonly payload: unknown;
+    readonly deferred: Deferred.Deferred<unknown, AcpError.AcpError>;
+  }>;
+}
+
 export interface AcpClientShape {
   readonly raw: AcpClientRaw;
   readonly agent: {
@@ -93,3 +115,268 @@ export interface AcpClientShape {
     readonly closeSession: (
       payload: AcpSchema.CloseSessionRequest,
     ) => Effect.Effect<AcpSchema.CloseSessionResponse, AcpError.AcpError>;
+  };
+}
+
+export class AuthenticationError {
+  readonly _tag = "AuthenticationError";
+  constructor(readonly message: string) {}
+}
+
+export const makeAcpClient = Effect.gen(function* () {
+  const options = yield* Effect.context<AcpClientOptions>();
+  const clientOptions = options.get(AcpClientOptions) as AcpClientOptions;
+
+  const state = yield* Ref.make<ClientState>({
+    session: Option.none(),
+    reAuthDeferred: Option.none(),
+    requestQueue: yield* Queue.unbounded(),
+  });
+
+  const is401Error = (error: AcpError.AcpError): boolean => {
+    return error._tag === "AcpProtocolError" && (error as any).status === 401;
+  };
+
+  const getSessionId = (): Effect.Effect<string, AcpError.AcpError> =>
+    Effect.gen(function* () {
+      const current = yield* state.get;
+      return yield* Option.match(current.session, {
+        onNone: () => Effect.fail(new AcpError.AcpProtocolError({ message: "No active session" }) as AcpError.AcpError),
+        onSome: (s) => Effect.succeed(s.sessionId),
+      });
+    });
+
+  const cleanupSession = (sessionId: string): Effect.Effect<void, never> =>
+    Effect.gen(function* () {
+      yield* Effect.log(`Cleaning up session: ${sessionId}`);
+      yield* state.set({
+        session: Option.none(),
+        reAuthDeferred: Option.none(),
+        requestQueue: yield* Queue.unbounded(),
+      });
+    }).pipe(Effect.catchAllCause(() => Effect.void));
+
+  const reAuthenticate = (expiredSessionId: string): Effect.Effect<void, AcpError.AuthenticationError> =>
+    Effect.gen(function* () {
+      yield* Effect.log("Starting re-authentication");
+
+      const current = yield* state.get;
+      const refreshToken = Option.match(current.session, {
+        onNone: () => "",
+        onSome: (s) => s.refreshToken,
+      });
+
+      if (clientOptions.onSessionExpired) {
+        yield* clientOptions.onSessionExpired(expiredSessionId);
+      }
+
+      yield* Effect.acquireRelease(
+        Effect.succeed(void 0),
+        () => cleanupSession(expiredSessionId)
+      );
+
+      yield* Effect.fail(new AuthenticationError("Re-authentication not yet implemented - stub"));
+    }).pipe(
+      Effect.mapError((e) => new AcpError.AuthenticationError({ message: String(e) }))
+    );
+
+  const withRetry = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E | AcpError.AuthenticationError> =>
+    Effect.gen(function* () {
+      const result = yield* effect.pipe(
+        Effect.catchAll((error) => {
+          if (error instanceof AcpError.AcpProtocolError && is401Error(error as AcpError.AcpError)) {
+            return Effect.gen(function* () {
+              const current = yield* state.get;
+              const sessionId = yield* getSessionId();
+
+              const reAuthResult = yield* Option.match(current.reAuthDeferred, {
+                onNone: () => Effect.gen(function* () {
+                  const deferred = yield* Deferred.make<void, AcpError.AuthenticationError>();
+                  yield* state.set({
+                    ...current,
+                    reAuthDeferred: Option.some(deferred),
+                  });
+
+                  yield* reAuthenticate(sessionId).pipe(
+                    Effect.tap(() => Deferred.succeed(deferred, void 0)),
+                    Effect.catchAll((err) => Effect.gen(function* () {
+                      Deferred.fail(deferred, err);
+                      return yield* Effect.fail(err);
+                    })),
+                    Effect.fork
+                  );
+
+                  return yield* Deferred.await(deferred);
+                }),
+                onSome: (deferred) => Deferred.await(deferred),
+              });
+
+              return yield* Effect.fail(error as AcpError.AcpError);
+            });
+          }
+          return Effect.fail(error);
+        })
+      );
+
+      return result;
+    });
+
+  const raw: AcpClientRaw = {
+    notifications: Stream.empty,
+    request: (method: