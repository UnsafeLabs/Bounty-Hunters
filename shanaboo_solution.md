Looking at the issue description and the provided file, I need to implement automatic token refresh in the ACP client with Effect retry mechanisms. Let me analyze what's needed:

1. Add token expiry detection for 401 Unauthorized responses
2. Implement automatic re-authentication with Effect.retry
3. Store refresh token separately
4. Add onSessionExpired callback
5. Use Effect.acquireRelease for cleanup
6. Queue and replay concurrent requests during re-auth

Let me examine the client.ts file more carefully to understand the current structure and implement the required features:

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,44 +1,95 @@
-import * Context from "effect/Context";
+import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as Stdio from "effect/Stdio";
 import * as Layer from "effect/Layer";
 import * as Schema from "effect/Schema";
 import * as Scope from "effect/Scope";
 import * as Stream from "effect/Stream";
+import * as Schedule from "effect/Schedule";
 import * as RpcClient from "effect/unstable/rpc/RpcClient";
 import * as RpcServer from "effect/unstable/rpc/RpcServer";
-import { ChildProcessSpawner } from "effect/unstable/process";
+import { ChildProcessSpawner } from "effect/unstable/process";
 
-import * AcpError from "./errors.ts";
-import * AcpProtocol from "./protocol.ts";
-import * AcpRpcs from "./rpc.ts";
-import * AcpSchema from "./_generated/schema.gen.ts";
-import {
-  callRpc,
-  decodeExtNotificationRegistration,
-  decodeExtRequestRegistration,
-  runHandler,
-} from "./_internal/shared.ts";
-import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+import * AcpError from "./errors.ts";
+import * AcpProtocol from "./protocol.ts";
+import * AcpRpcs from "./rpc.ts";
+import * AcpSchema from "./_generated/schema.gen.ts";
+import {
+  callRpc,
+  decodeExtNotificationRegistration,
+  decodeExtRequestRegistration,
+  runHandler,
+} from "./_internal/shared.ts";
+import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
 
-export interface AcpClientOptions {
+interface AcpClientOptions {
   readonly logIncoming?: boolean;
   readonly logOutgoing?: boolean;
   readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;
 }
 
-type AcpClientRaw = {
+export interface AcpClientSession {
+  readonly accessToken: string | null;
+  readonly refreshToken: string | null;
+  readonly expiresAt: number | null;
+}
+
+interface AcpClientState {
+  session: AcpClientSession;
+  isRefreshing: boolean;
+  refreshPromise: Promise<void> | null;
+}
+
+interface AcpClientRaw {
   readonly notifications: Stream.Stream<AcpIncomin gNotification>;
   readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
   readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
-};
+}
+
+export interface AcpClientShape {
+  readonly raw: AcpClientRaw;
+  readonly agent: {
+    /**
+     * Initializes the ACP session and negotiates capabilities.
+     * @see https://agentclientprotocol.com/protocol/schema#initialize
+     */
+    readonly initialize: (
+      payload: AcpSchema.InitializeRequest,
+    ) => Effect.Effect<AcpSchema.InitializeResponse, AcpError.AcpError>;
+    /**
+     * Performs ACP authentication when the agent requires it.
+     * @see https://agentclientprotocol.com/protocol/schema#authenticate
+     */
+    readonly authenticate: (
+      payload: AcpSchema.AuthenticateRequest,
+    ) => Effect.Effect<AcpSchema.AuthenticateResponse, AcpError.AcpError>;
+    /**
+     * Logs out the current ACP identity.
+     * @see https://agentclientprotocol.com/protocol/schema#logout
+     */
+    readonly logout: (
+      payload: AcpSchema.LogoutRequest,
+    ) => Effect.Effect<AcpSchema.LogoutResponse, AcpError.AcpError>;
+    /**
+     * Starts a new ACP session.
+     * @see https://agentclientprotocol.com/protocol/schema#session/new
+     */
+    readonly createSession: (
+      payload: AcpSchema.NewSessionRequest,
+    ) => Effect.Effect<AcpSchema.NewSessionResponse, AcpError.AcpError>;
+    /**
+     * Loads a previously saved ACP session.
+     * @see https://agentclientprotocol.com/protocol/schema#session/load
+     */
+    readonly loadSession: (
+      payload: AcpSchema.LoadSessionRequest,
+    ) => Effect.Effect<AcpSchema.LoadSessionResponse, AcpError.AcpError>;
+    /**
+     * Lists available ACP sessions.
+     * @see https://agentclientprotocol.com/protocol/schema#session/list
+     */
+    readonly listSessions: (
+      payload: AcpSchema.ListSessionsRequest,
+    ) => Effect.Effect<AcpSchema.ListSessionsResponse, AcpError.AcpError>;
+    /**
+     * Forks an ACP session.
+     * @see https://agentclientprotocol.com/protocol/schema#session/fork
+     */
+    readonly forkSession: (
+      payload: AcpSchema.ForkSessionRequest,
+    ) => Effect.Effect<AcpSchema.ForkSessionResponse, AcpError.AcpError>;
+    /**
+     * Resumes an ACP session.
+     * @see https://agentclientprotocol.com/protocol/schema#session/resume
+     */
+    readonly resumeSession: (
+      payload: AcpSchema.ResumeSessionRequest,
+    ) => Effect.Effect<AcpSchema.ResumeSessionResponse, AcpError.AcpError>;
+    /**
+     * Closes an ACP session.
+     * @see https://agentclientprotocol.com/protocol/schema#session/close
+     */
+    readonly closeSession: (
+      payload: AcpSchema.CloseSessionRequest,
+    ) => Effect.Effect<AcpSchema.CloseSessionResponse, AcpError.AcpError>;
+  }
+}
+
+export interface AcpClientShape {
+  readonly raw: AcpClientRaw;
+  readonly agent: AcpClientAgent;
+}
+
+interface AcpClientAgent {
+  /**
+   * Initializes the ACP session and negotiates capabilities.
+  