Looking at the issue description, I need to implement automatic token refresh functionality in the ACP client. Let me analyze the requirements and implement the solution.

The issue asks for:
1. Automatic token refresh when session expires (401 Unauthorized responses)
2. Effect.retry with custom schedule for re-auth
3. Store refresh token separately
4. Add onSessionExpired callback
5. Use Effect.acquireRelease for proper cleanup
6. Queue concurrent requests during re-auth
7. Handle AuthenticationError when re-auth fails

Let me implement these changes in the ACP client:

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,49 +1,108 @@
+import * as Context from "effect/Context";
+import * as Effect from "effect/Effect";
+import * as Schedule from "effect/Schedule";
+import * as Layer from "effect/Layer";
+import * as Queue from "effect/Queue";
+import * as Schema from "effect/Schema";
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as Stdio from "effect/Stdio";
 import * as Layer from "effect/Layer";
-import * as Schema from "effect/Schema";
-import * as Scope from "effect/Scope";
-import * as Stream from "effect/Stream";
+import * as Queue from "effect/Queue";
+import * as Schedule from "effect/Schedule";
+import * as Deferred from "effect/Deferred";
+import * as Stream from "effect/Stream";
 import * as RpcClient from "effect/unstable/rpc/RpcServer";
+import * as Scope from "effect/Scope";
 
+import * as AcpError from "./errors.ts";
+import * as AcpProtocol from "./protocol.ts";
+import * as AcpRpcs from "./rpc.ts";
+import { callRpc, decodeExtNotificationRegistration, decodeExtRequestRegistration, runHandler } from "./_internal/shared.ts";
+import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+
+import * as AcpError from "./errors.ts";
+import * as AcpProtocol from "./protocol.ts";
+import * as AcpRpcs from "./rpc.ts";
+import {
+  callRpc,
+  decodeExtNotificationRegistration,
+  decodeExtRequestRegistration,
+  runHandler,
+} from "./_internal/shared.ts";
+import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+
+interface AcpClientOptions {
+  readonly logIncoming?: boolean;
+  readonly logOutgoing?: boolean;
+  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;
+}
+
+interface AcpSession {
+  accessToken: string;
+  refreshToken: string;
+  expiresAt: number;
+}
+
+type AcpClientRaw = {
+  readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
+  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
+  readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
+};
+
+interface AcpClientShape {
+  readonly raw: AcpClientRaw;
+  readonly agent: {
+    readonly initialize: (
+      payload: AcpSchema.InitializeRequest,
+    ) => Effect.Effect<AcpSchema.InitializeResponse, AcpError.AcpError>;
+    readonly authenticate: (
+      payload: AcpSchema.AuthenticateRequest,
+    ) => Effect.Effect<AcpSchema.AuthenticateResponse, AcpError.AcpError>;
+    readonly logout: (
+      payload: AcpSchema.LogoutRequest,
+    ) => Effect.Effect<AcpSchema.LogoutResponse, AcpError.AcpError>;
+    readonly createSession: (
+      payload: AcpSchema.NewSessionRequest,
+    ) => Effect.Effect<AcpSchema.NewSessionResponse, AcpError.AcpError>;
+    readonly loadSession: (
+      payload: AcpSchema.LoadSessionRequest,
+    ) => Effect.Effect<AcpSchema.LoadSessionResponse, AcpError.AcpError>;
+    readonly listSessions: (
+      payload: AcpSchema.ListSessionsRequest,
+    ) => Effect.Effect<AcpSchema.ListSessionsResponse, AcpError.AcpError>;
+    readonly forkSession: (
+      payload: AcpAcpSchema.ForkSessionRequest,
+    ) => Effect.Effect<AcpSchema.ForkSessionResponse, AcpError.AcpError>;
+    readonly resumeSession: (
+      payload: AcpSchema.ResumeSessionRequest,
+    ) => Effect.Effect<AcpSchema.ResumeSessionResponse, AcpError.AcpError>;
+    readonly closeSession: (
+      payload: AcpSchema.CloseSessionRequest,
+    ) => Effect.Effect<AcpSchema.CloseSessionResponse, AcpError.AcpError>;
+  };
+  readonly raw: AcpClientRaw;
+}
+
+interface AcpClient {
+  readonly raw: AcpClientRaw;
+  readonly session: AcpSession;
+  readonly requestQueue: Queue.Queue<Effect.Effect<any, any, any>>;
+}
+
+const makeAcpClient = (options: AcpClientOptions = {}): Effect.Effect<AcpClient, AcpError.AcpError> => {
+  return Effect.gen(function* ($) {
+    // Create a queue for handling requests
+    const requestQueue = yield* $(Queue.unbounded<Effect.Effect<any, any, any>>());
+    
+    // Simulate client initialization
+    const client = {
+      raw: {
+        request: (method: string, payload: unknown) => Effect.succeed(payload),
+        notify: (method: string, payload: unknown) => Effect.succeed(payload),
+        notifications: Stream.empty
+      },
+      session: {
+        accessToken: "dummy-access-token",
+        refreshToken: "dummy-refresh-token",
+        expiresAt: Date.now() + 3600000 // 1 hour from now
+      }
+    };
+    
+    return client;
+  });
+}
+
+const makeAcpClientWithRefresh = (options: AcpClientOptions = {}): Effect.Effect<AcpClient, AcpError.AcpError> => {
+  return Effect.gen(function* ($) {
+    const requestQueue = yield* $(Queue.unbounded<Effect.Effect<any, any, any>>());
+    return {
+      raw: {
+        request: (method: string, payload: unknown) => Effect.succeed(payload),
+        notify: (method: string, payload: unknown) => Effect.succeed(payload),
+        notifications: Stream.empty
+      },
