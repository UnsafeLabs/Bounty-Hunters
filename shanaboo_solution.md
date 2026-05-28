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
@@ -24,9 +25,16 @@ import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
 export interface AcpClientOptions {
   readonly logIncoming?: boolean;
   readonly logOutgoing?: boolean;
   readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;
 }
 
+export interface AcpClientState {
+  readonly accessToken: string | null;
+  readonly refreshToken: string | null;
+  readonly sessionId: string | null;
+}
+
 type AcpClientRaw = {
   readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
   readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
@@ -108,6 +116,8 @@ export interface AcpClientShape {
 
 export class AcpClient extends Context.Tag("AcpClient")<AcpClient, AcpClientShape>() {}
 
+const ACP_CLIENT_STATE = Context.Tag<AcpClientState>("AcpClientState");
+
 const makeRawClient = Effect.gen(function* () {
   const stdio = yield* Stdio.Stdio;
   const options = yield* Effect.context<AcpClientOptions | never>().pipe(
@@ -115,6 +125,8 @@ const makeRawClient = Effect.gen(function* () {
     Effect.orElseSucceed(() => ({}))
   );
 
+  const stateRef = yield* FiberRef.make<AcpClientState>({ accessToken: null, refreshToken: null, sessionId: null });
+
   const childProcess = yield* ChildProcessSpawner.create({
     command: "node",
     args: ["--experimental-strip-types", new URL("./server.ts", import.meta.url).pathname],
@@ -157,6 +169,8 @@ const makeRawClient = Effect.gen(function* () {
     Effect.map((response) => response.result)
   );
 
+  const requestQueue: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void; method: string; payload: unknown }> = [];
+
   const notifications = Stream.fromQueue(notificationQueue).pipe(
     Stream.tap((notification) => {
       if (options.logIncoming) {
@@ -175,6 +189,8 @@ const makeRawClient = Effect.gen(function* () {
     })
   );
 
+  let isReAuthenticating = false;
+
   const request = (method: string, payload: unknown): Effect.Effect<unknown, AcpError.AcpError> =>
     Effect.gen(function* () {
       const id = crypto.randomUUID();
@@ -183,6 +199,8 @@ const makeRawClient = Effect.gen(function* () {
         jsonrpc: "2.0",
         method,
         params: payload,
+        ...(state.accessToken ? { headers: { Authorization: `Bearer ${state.accessToken}` } } : {}),
       };
 
       if (options.logOutgoing) {
@@ -196,6 +214,8 @@ const makeRawClient = Effect.gen(function* () {
         Effect.map((response) => response.result)
       );
 
+      const state = yield* FiberRef.get(stateRef);
+
       const result = yield* Effect.race(
         responseEffect,
         Effect.gen(function* () {
@@ -206,6 +226,75 @@ const makeRawClient = Effect.gen(function* () {
         })
       );
 
+      if (result === "401") {
+        return yield* Effect.fail(new AcpError.AuthenticationError("Unauthorized"));
+      }
+
+      return result;
+    }).pipe(
+      Effect.catchAll((error) => {
+        if (error instanceof AcpError.AuthenticationError) {
+          return Effect.gen(function* () {
+            const state = yield* FiberRef.get(stateRef);
+
+            if (isReAuthenticating) {
+              return yield* Effect.async<unknown, AcpError.AcpError>((resume) => {
+                requestQueue.push({
+                  resolve: (value) => resume(Effect.succeed(value)),
+                  reject: (error) => resume(Effect.fail(error)),
+                  method,
+                  payload,
+                });
+              });
+            }
+
+            isReAuthenticating = true;
+
+            const reAuthEffect = Effect.gen(function* () {
+              if (state.sessionId && options.onSessionExpired) {
+                yield* options.onSessionExpired(state.sessionId);
+              }
+
+              if (!state.refreshToken) {
+                return yield* Effect.fail(new AcpError.AuthenticationError("No refresh token available"));
+              }
+
+              const refreshResponse = yield* Effect.tryPromise({
+                try: () => fetch("/auth/refresh", {
+                  method: "POST",
+                  headers: { "Content-Type": "application/json" },
+                  body: JSON.stringify({ refreshToken: state.refreshToken }),
+                }),
+                catch: () => new AcpError.AuthenticationError("Refresh failed"),
+              });
+
+              if (!refreshResponse.ok) {
+                return yield* Effect.fail(new AcpError.AuthenticationError("Refresh failed"));
+              }
+
+              const newTokens = yield* Effect.tryPromise({
+                try: () => refreshResponse.json(),
+                catch: () => new AcpError.AuthenticationError("Failed to parse refresh response"),
+              });
+
+              yield* FiberRef.set(stateRef, {
+                accessToken: newTokens.accessToken,
+                refreshToken: newTokens.refreshToken ?? state.refreshToken,
+                sessionId: newTokens.sessionId ?? state.sessionId,
+              });
+
+              return yield* request(method, payload);
+            }).pipe(
+              Effect.acquireRelease(
+                Effect.succeed(void 0),
+                () => Effect.sync(() => { isReAuthenticating = false; })
+              )
+            );
+
+            return yield* Effect.retry(reAuthEffect, { schedule: Schedule.once, while: (error) => error instanceof AcpError.AuthenticationError });
+          });
+        }
+        return Effect.fail(error);
+      })
+    );
+
       return result;
     });
 
@@ -215,6 +304,8 @@ const makeRawClient = Effect.gen(function* () {
       jsonrpc: "2.0",
       method,
       params: payload,
+      ...(state.accessToken ? { headers: { Authorization: `Bearer ${state.accessToken