Looking at the issue description and the provided file, I need to implement automatic token refresh in the ACP client with Effect retry functionality. Let me analyze what's needed:

1. Add token expiry detection for 401 Unauthorized responses
2. Implement automatic re-authentication with Effect.retry
3. Store refresh tokens separately
4. Add onSessionExpired callback
5. Use Effect.acquireRelease for proper cleanup
6. Queue concurrent requests during re-auth

Let me create the implementation:

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,3 +1,4 @@
+import * as Duration from "effect/Duration";
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as Stdio from "effect/Stdio";
@@ -5,12 +6,16 @@ import * as Layer from "effect/Layer";
 import * as Schema from "effect/Schema";
 import * as Scope from "effect/Scope";
 import * as Stream from "effect/Stream";
+import * as Schedule from "effect/Schedule";
 import * as RpcClient from "effect/unstable/rpc/RpcClient";
 import * as RpcServer from "effect/unstable/rpc/RpcServer";
+import * as Queue from "effect/Queue";
+import * as Deferred from "effect/Deferred";
 import { ChildProcessSpawner } from "effect/unstable/process";
 
 import * as AcpError from "./errors.ts";
 import * as AcpProtocol from "./protocol.ts";
+import * as AcpSchema from "./_generated/schema.gen.ts";
 import * as AcpRpcs from "./rpc.ts";
 import * as AcpSchema from "./_generated/schema.gen.ts";
 import { AGENT_METHODS, CLIENT_METHODS } from "./_generated/meta.gen.ts";
@@ -18,14 +23,6 @@ import {
   runHandler,
 } from "./_internal/shared.ts";
 import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
-
-export interface AcpClientOptions {
-  readonly logIncoming?: boolean;
-  readonly logOutgoing?: boolean;
-  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
-}
-
-type AcpClientRaw = {
-  readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
-  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
-  readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
-};
+import { pipe } from "effect/Function";
+import * as Exit from "effect/Exit";
+import * as Fiber from "effect/Fiber";
 
+export interface AcpClientOptions {
+  readonly logIncoming?: boolean;
+  readonly logOutgoing?: boolean;
+  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;
+}
+
+interface AcpSessionState {
+  readonly accessToken: string;
+  readonly refreshToken: string;
+  readonly sessionId: string;
+  readonly expiresAt: Date;
+}
+
+interface QueuedRequest {
+  readonly method: string;
+  readonly payload: unknown;
+  readonly deferred: Deferred.Deferred<unknown, AcpError.AcpError>;
+}
+
+interface AcpClientRaw {
+  readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
+  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
+  readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
+  readonly sessionState: AcpSessionState | undefined;
+  readonly requestQueue: Queue.Queue<QueuedRequest>;
+  readonly isRefreshing: boolean;
+}
 
-export interface AcpClientShape {
-  readonly raw: AcpClientRaw;
+export interface AcpClientShape {
+  readonly raw: AcpClientRaw;
   readonly agent: {
     /**
      * Initializes the ACP session and negotiates capabilities.
@@ -170,3 +167,157 @@ export const makeAcpClient = (options?: AcpClientOptions) =>
     ),
   );
 };
+
+/**
+ * Creates an ACP client with automatic token refresh capabilities
+ */
+export const makeAcpClientWithRefresh = (options?: AcpClientOptions) =>
+  Effect.gen(function* (_) {
+    const stdio = yield* _(makeChildStdio);
+    const requestQueue = yield* _(Queue.unbounded<QueuedRequest>());
+    
+    let sessionState: AcpSessionState | undefined = undefined;
+    let isRefreshing = false;
+    
+    const processQueue = (client: AcpClientRaw) =>
+      Effect.gen(function* (_) {
+        while (yield* _(Queue.size(requestQueue)) > 0) {
+          const request = yield* _(Queue.take(requestQueue));
+          const { method, payload, deferred } = request;
+          
+          const result = yield* _(Effect.exit(client.request(method, payload)));
+          yield* _(Deferred.complete(deferred, result));
+        }
+      });
+
+    const refreshSession = (client: AcpClientRaw) =>
+      Effect.acquireRelease(
+        Effect.gen(function* (_) {
+          if (!sessionState || !sessionState.refreshToken) {
+            return yield* _(Effect.fail(new AcpError.AcpError({ message: "No refresh token available" })));
+          }
+
+          // Call onSessionExpired callback if provided
+          if (options?.onSessionExpired && sessionState.sessionId) {
+            yield* _(options.onSessionExpired(sessionState.sessionId));
+          }
+
+          // Perform re-authentication using refresh token
+          const refreshResponse = yield* _(
+            client.request("authenticate", {
+              refreshToken: sessionState.refreshToken
+            } as AcpSchema.AuthenticateRequest)
+          );
+
+          // Update session state with new tokens
+          const authResponse = refreshResponse as AcpSchema.AuthenticateResponse;
+          sessionState = {
+            accessToken: authResponse.accessToken,
+            refreshToken: authResponse.refreshToken || sessionState.refreshToken,
+            sessionId: authResponse.sessionId || sessionState.sessionId,
+            expiresAt: new Date(Date.now() + authResponse.expiresIn * 1000)
+          };
+
+          return sessionState;
+        }),
+        (_, exit) => 
+          Effect.gen(function* (_) {
+            if (Exit.isFailure(exit)) {
+              // Clear session state on failure
+              sessionState = undefined;
+            }
+          })
+      );
+
