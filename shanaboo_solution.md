Looking at the issue, I need to implement automatic token refresh functionality in the ACP client. Let me analyze the requirements and create the necessary changes to `client.ts`.

The key requirements are:
1. Add token expiry detection for 401 responses
2. Implement automatic re-authentication with Effect.retry
3. Store refresh token separately
4. Add onSessionExpired callback
5. Use Effect.acquireRelease for cleanup
6. Handle concurrent requests during re-auth
7. Queue and replay requests during re-auth

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,3 +1,44 @@
+/**
+ * @license
+ * Copyright T3 Code Inc.
+ */
+import * as Context from "effect/Context";
+import * as Effect from "effect/Effect";
+import * as Layer from "effect/Layer";
+import * as Schema from "effect/Schema";
+import * as Stdio from "effect/Stdio";
+import * as Stream from "effect/Stream";
+import * as Scope from "effect/Scope";
+import * as Schedule from "effect/Schedule";
+import * as Exit from "effect/Exit";
+import * as Duration from "effect/Duration";
+import * as Option from "effect/Option";
+import * as Either from "effect/Either";
+import * as Chunk from "effect/Chunk";
+import * as HashMap from "effect/HashMap";
+import * as HashSet from "effect/HashSet";
+import * as RA from "effect/ReadonlyArray";
+import * as Unify from "effect/Unify";
+import * as Predicate from "effect/Predicate";
+import * as RpcClient from "effect/unstable/rpc/RpcClient";
+import * as RpcServer from "effect/unstable/rpc/RpcServer";
+import { ChildProcessSpawner } from "effect/unstable/process";
+import * as AcpError from "./errors.ts";
+import * as AcpProtocol from "./protocol.ts";
+import * as AcpRpcs from "./rpc.ts";
+import * as AcpSchema from "./_generated/schema.gen.ts";
+import {
+  callRpc,
+  decodeExtNotificationRegistration,
+  decodeExtRequestRegistration,
+  runHandler,
+} from "./_internal/shared.ts";
+import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as Stdio from "effect/Stdio";
@@ -24,12 +65,15 @@ import * as RpcClient from "effect/unstable/rpc/RpcServer";
 import * as AcpError from "./errors.ts";
 import * as AcpProtocol from "./protocol.ts";
 import * as AcpRpcs from "./rpc.ts";
-import * as AcpSchema from "./_generated/schema.gen.ts";
+import * as AcpSchema from "./_generated/schema.gen.ts";
 import {
-  callRpc,
-  decodeExtNotificationRegistration,
-  decodeExtRequestRegistration,
-  runHandler,
+  callRpc,
+  decodeExtRequestRegistration,
+  decodeExtNotificationRegistration,
+  runHandler,
 } from "./_internal/shared.ts";
-import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
+
+export interface AcpClientSession {
+  readonly sessionId: string;
+  readonly accessToken: string;
+  readonly refreshToken: string;
+  readonly expiresAt: number;
+  readonly onSessionExpired?: (expiredSessionId: string) => Effect.Effect<void, AcpError.AcpError>;
+}
+
+export interface AcpClient {
+  readonly session: AcpClientSession;
+  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
+}
+
+export interface AcpClientOptions {
+  readonly logIncoming?: boolean;
+  readonly logOutgoing?: boolean;
+  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (expiredSessionId: string) => Effect.Effect<void, AcpError.AcpError>;
+}
+
+interface AcpClientRaw {
+  readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
+  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
+  readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
+}
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
+      payload: AcpSchema.ForkSessionRequest,
+    ) => Effect.Effect<AcpSchema.ForkSessionResponse, AcpError.AcpError>;
+    readonly resumeSession: (
+      payload: AcpSchema.ResumeSessionRequest,
+    ) => Effect.Effect<AcpSchema.ResumeSessionResponse, AcpError.AcpError>;
+    readonly closeSession: (
+      payload: AcpSchema.CloseSessionRequest,
+    ) => Effect.Effect<AcpSchema.CloseSessionResponse, AcpError.AcpError>;
+  };
+}
+
+export interface AcpClientOptions {
+  readonly logIncoming?: boolean;
+  readonly logOutgoing?: boolean;
+  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (expiredSessionId: string) => Effect.Effect<void, AcpError.AcpError>;
+}
+
+interface AcpClientSession {
+  readonly sessionId: string;
+