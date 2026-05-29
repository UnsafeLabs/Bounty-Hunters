Looking at the issue description, I need to implement automatic token refresh functionality in the ACP client. Let me analyze what's needed:

1. Add token expiry detection for 401 Unauthorized responses
2. Implement automatic re-authentication with Effect retry logic
3. Store refresh token separately 
4. Add onSessionExpired callback
5. Use Effect.acquireRelease for proper cleanup
6. Handle concurrent request queuing during re-auth

Let me implement these changes in the client.ts file:

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,159 +1,326 @@
-import * as Context from "effect/Context";
-import * as Effect from "effect/Effect";
-import * as Stdio from "effect/Stdio";
-import * as Layer from "effect/Layer";
-import * as Schema from "effect/Schema";
-import * as Scope from "effect/Scope";
-import * as Stream from "effect/Stream";
-import * * as RpcClient from "effect/unstable/rpc/RpcClient";
-import * * as RpcServer from "effect/unstable/rpc/RpcServer";
-import { ChildProcessSpawner } from "effect/unstable/process";
-
-import * * as AcpError from "./errors.ts";
-import * * as AcpProtocol from "./protocol.ts";
-import * * as AcpRpcs from "./rpc.ts";
-import * * as AcpSchema from "./_generated/schema.gen.ts";
-import { AGENT_METHODS, CLIENT_METHODS } from "./_generated/meta.gen.ts";
-import {
-  callRpc,
-  decodeExtNotificationRegistration,
-  decodeExtRequestRegistration,
-  runHandler,
-} from "./_internal/shared.ts";
-import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+import * as Context from "effect/Context";
+import * Effect from "effect/Effect";
+import * Stdio from "effect/Stdio";
+import * Layer from "effect/Layer";
+import * Schema from "effect/Schema";
+import * Scope from "effect/Scope";
+import * Stream from "effect/Stream";
+import * Schedule from "effect/Schedule";
+import * Fiber from "effect/Fiber";
+import * Queue from "effect/Queue";
+import * Rc from "effect/Rc";
+import * RpcClient from "effect/unstable/rpc/RpcClient";
+import * RpcServer from "effect/unstable/rpc/RpcServer";
+import { ChildProcessSpawner } from "effect/unstable/process";
+
+import * * as AcpError from "./errors.ts";
+import * * as AcpProtocol from "./protocol.ts";
+import * * as AcpRpcs from "./rpc.ts";
+import * * as AcpSchema from "./_generated/schema.gen.ts";
+import { AGENT_METHODS, CLIENT_METHODS } from "./_generated/meta.gen.ts";
+import {
+  callRpc,
+  decodeExtNotificationRegistration,
+  decodeExtRequestRegistration,
+  runHandler,
+} from "./_internal/shared.ts";
+import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+
+export interface AcpClientOptions {
+  readonly logIncoming?: boolean;
+  readonly logOutgoing?: boolean;
+  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, AcpError.AcpError>;
+}
+
+interface SessionState {
+  readonly accessToken: string;
+  readonly refreshToken: string;
+  readonly sessionId: string;
+}
+
+interface AcpClientState {
+  readonly session: SessionState | null;
+  readonly isRefreshing: boolean;
+  readonly refreshQueue: Effect.Effect<any, any, any>[];
+}
+
+export interface AcpClientOptions {
+  readonly logIncoming?: boolean;
+  readonly logOutgoing?: boolean;
+  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, AcpError.AcpError>;
+}
+
+type AcpClientRaw = {
+  readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
+  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
+  readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
+};
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
+    readonly forkSession