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
@@ -24,9 +25,14 @@ import {
   runHandler,
 } from "./_internal/shared.ts";
 import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+import { AuthenticationError } from "./errors.ts";
 
 export interface AcpClientOptions {
   readonly logIncoming?: boolean;
   readonly logOutgoing?: boolean;
   readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;
 }
 
 type AcpClientRaw = {
@@ -34,6 +40,20 @@ type AcpClientRaw = {
   readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
 };
 
+interface TokenState {
+  readonly accessToken: string;
+  readonly refreshToken: string;
+  readonly expiresAt: number;
+}
+
+interface SessionState {
+  readonly sessionId: string;
+  readonly tokenState: TokenState;
+}
+
+type RequestQueueItem = {
+  readonly resolve: (value: unknown) => void;
+  readonly reject: (error: unknown) => void;
+  readonly execute: Effect.Effect<unknown, AcpError.AcpError>;
+};
+
 export interface AcpClientShape {
   readonly raw: AcpClientRaw;
   readonly agent: {
@@ -91,4 +111,232 @@ export interface AcpClientShape {
      */
     readonly closeSession: (
       payload: AcpSchema.CloseSessionRequest,
-    ) => Effect.Effect<AcpSchema.CloseSessionResponse, AcpError.Ac
+    ) => Effect.Effect<AcpSchema.CloseSessionResponse, AcpError.AcpError>;
+  };
+}
+
+const makeAcpClient = Effect.gen(function* () {
+  const options = yield* AcpClientOptions;
+  const requestQueue: Array<RequestQueueItem> = [];
+  let isReAuthenticating = false;
+  let currentSessionState: SessionState | null = null;
+
+  const sessionStateRef = yield* FiberRef.make<SessionState | null>(null);
+  const isReAuthenticatingRef = yield* FiberRef.make(false);
+  const requestQueueRef = yield* FiberRef.make<Array<RequestQueueItem>>([]);
+
+  const setSessionState = (state: SessionState | null) => {
+    currentSessionState = state;
+    return FiberRef.set(sessionStateRef, state);
+  };
+
+  const getSessionState = (): SessionState | null => currentSessionState;
+
+  const setIsReAuthenticating = (value: boolean) => {
+    isReAuthenticating = value;
+    return FiberRef.set(isReAuthenticatingRef, value);
+  };
+
+  const getIsReAuthenticating = (): boolean => isReAuthenticating;
+
+  const addToQueue = (item: RequestQueueItem) => {
+    requestQueue.push(item);
+    return FiberRef.set(requestQueueRef, [...requestQueue]);
+  };
+
+  const getQueue = (): Array<RequestQueueItem> => [...requestQueue];
+
+  const clearQueue = () => {
+    requestQueue.length = 0;
+    return FiberRef.set(requestQueueRef, []);
+  };
+
+  const processQueue = (success: boolean) => {
+    const queue = getQueue();
+    clearQueue();
+    for (const item of queue) {
+      if (success) {
+        item.resolve(item.execute);
+      } else {
+        item.reject(new AuthenticationError("Re-authentication failed"));
+      }
+    }
+    return Effect.void;
+  };
+
+  const reAuthenticate = Effect.gen(function* () {
+    const sessionState = getSessionState();
+    if (!sessionState) {
+      return yield* new AuthenticationError("No session to re-authenticate");
+    }
+
+    yield* setIsReAuthenticating(true);
+
+    const oldSessionId = sessionState.sessionId;
+
+    if (options?.onSessionExpired) {
+      yield* options.onSessionExpired(oldSessionId);
+    }
+
+    const cleanupEffect = Effect.sync(() => {
+      currentSessionState = null;
+    });
+
+    const acquireEffect = Effect.sync(() => {
+      return { oldSessionId };
+    });
+
+    const releaseEffect = (resource: { oldSessionId: string }) => {
+      return Effect.sync(() => {
+        currentSessionState = null;
+      });
+    };
+
+    yield* Effect.acquireRelease(
+      acquireEffect,
+      releaseEffect
+    );
+
+    const newTokenState: TokenState = {
+      accessToken: `new_access_${Date.now()}`,
+      refreshToken: sessionState.tokenState.refreshToken,
+      expiresAt: Date.now() + 3600000,
+    };
+
+    const newSessionState: SessionState = {
+      sessionId: `session_${Date.now()}`,
+      tokenState: newTokenState,
+    };
+
+    yield* setSessionState(newSessionState);
+    yield* setIsReAuthenticating(false);
+
+    return newSessionState;
+  });
+
+  const retrySchedule = Effect.retry({
+    schedule: Schedule.recurs(1),
+    while: (error: AcpError.AcpError) => {
+      return error._tag === "AcpError" && (error as any).status === 401;
+    },
+  });
+
+  const executeWithRetry = <A>(effect: Effect.Effect<A, AcpError.AcpError>) => {
+    return Effect.gen(function* () {
+      const result = yield* effect.pipe(
+        Effect.catchAll((error) => {
+          if (
+            error._tag === "AcpError" &&
+            (error as any).status === 401
+          ) {
+            return Effect.gen(function* () {
+              if (getIsReAuthenticating()) {
+                return yield* Effect.async<A, AcpError.AcpError>((resume) => {
+                  addToQueue({
+                    resolve: (value) => resume(Effect.succeed(value as A)),
+                    reject: (error) => resume(Effect.fail(error as AcpError.AcpError)),
+                    execute: effect