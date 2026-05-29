Looking at the issue description and the code, I need to implement automatic token refresh functionality in the ACP client. The main requirements are:

1. Add token expiry detection for 401 Unauthorized responses
2. Implement automatic re-authentication with Effect.retry
3. Store refresh token separately 
4. Add onSessionExpired callback
5. Use Effect.acquireRelease for proper cleanup
6. Queue concurrent requests during re-auth

Let me analyze the current client.ts file and implement the required changes:

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,10 +1,10 @@
-import * as Context from "effect/Context";
-import * as Effect from "effect/Effect";
-import * as Stdio from "effect/Stdio";
-import * as Layer from "effect/Layer";
-import * as Schema from "effect/Schema";
-import * as Scope from "effect/Scope";
-import * as Stream from "effect/Stream";
+import * as Context from "effect/Context";
+import * as Effect from "effect/Effect";
+import * as Stdio from "effect/Stdio";
+import * as Layer from "effect/Layer";
+import * as Schema from "effect/Schema";
+import * as Scope from "effect/Scope";
+import * as Stream from "effect/Stream";
 import * as RpcClient from "effect/unstable/rpc/RpcClient";
 import * as RpcServer from "effect/unstable/rpc/RpcServer";
 import { ChildProcessSpawner } from "effect/unstable/process";
@@ -13,6 +13,16 @@ import { ChildProcessSpawner } from "effect/unstable/process";
 import * as AcpError from "./errors.ts";
 import * as AcpProtocol from "./protocol.ts";
 import * as AcpRpcs from "./rpc.ts";
-import * as AcpSchema from "./_generated/schema.gen.ts";
 import {
   callRpc,
   decodeExtNotificationRegistration,
@@ -20,7 +30,7 @@ import {
   runHandler,
 } from "./_internal/shared.ts";
 import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";
-
+import { Schedule) from "effect/Schedule";
+import * as Exit from "effect/Exit";
 export interface AcpClientOptions {
   readonly logIncoming?: boolean;
   readonly logOutgoing?: boolean;
@@ -29,6 +39,8 @@ export interface AcpClientOptions {
 
 type AcpClientRaw = {
   readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
-  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
+  readonly request: (
+    method: string,
+    payload: unknown
+  ) => Effect.Effect<unknown, AcpError.AcpError>;
   readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
 };
@@ -36,12 +50,12 @@ type AcpClientRaw = {
 export interface AcpClientShape {
   readonly raw: AcpClientRaw;
   readonly agent: {
-    /**
-     * Initializes the ACP session and negotiates capabilities.
-     * @see https://agentclientprotocol.com/protocol/schema#initialize
-     */
-    readonly initialize: (
-      payload: AcpSchema.InitializeRequest,
-    ) => Effect.Effect<AcpSchema.InitializeResponse, AcpError.AcpError>;
+    /**
+     * Initializes the ACP session and negotiates capabilities.
+     * @see https://agentclientprotocol.com/protocol/schema#initialize
+     */
+    readonly initialize: (
+      payload: AcpSchema.InitializeRequest,
+    ) => Effect.Effect<AcpSchema.InitializeResponse, AcpError.AcpError>;
+
     /**
@@ -49,7 +65,7 @@ export interface AcpClientShape {
      * @see https://agentclientprotocol.com/protocol/schema#authenticate
      */
     readonly authenticate: (
-      payload: AcpSchema.AuthenticateRequest,
+      payload: AcpSchema.AuthenticateRequest
     ) => Effect.Effect<AcpSchema.AuthenticateResponse, AcpError.AcpError>;
     /**
      * Logs out the current ACP identity.
@@ -57,6 +73,15 @@ export interface AcpClientShape {
      */
     readonly logout: (
       payload: AcpSchema.LogoutRequest,
+    ) => Effect.Effect<AcpSchema.LogoutResponse, AcpError.AcpError>;
+
+    /** 
+     * Retries a request with automatic token refresh on 401
+     * @param method - The RPC method name
+     * @param payload - The RPC payload
+     * @param maxRetries - Maximum number of retry attempts
+     */
+    readonly retryRequestWithRefresh: (
+      method: string,
+      payload: unknown,
+      maxRetries: number = 1
+    ) => Effect.Effect<unknown, AcpError.AcpError>;
+
+    /**
+     * Creates a new session with the given configuration
+     * @param config - Session configuration
+     */
+    readonly createSession: (
+      config: AcpSchema.AcpSessionConfig
     ) => Effect.Effect<AcpSchema.AcpSession, AcpError.AcpError>;
+
+    /**
+     * Closes the current session
+     */
+    readonly closeSession: () => Effect.Effect<void, AcpError.AcpError>;
+
+    /**
+     * Lists available sessions
+     */
+    readonly listSessions: () => Effect.Effect<AcpSchema.AcpSessionList, AcpError.AcpError>;
+    
+    /**
+     * Loads a session by ID
+     * @param sessionId - The session ID to load
+     */
+    readonly loadSession: (sessionId: string) => Effect.Effect<AcpSchema.AcpSession, AcpError.AcpError>;
+    
+    /**
+     * Authenticates with the given credentials
+     * @param credentials - Authentication credentials
+     */
+    readonly authenticate: (credentials: AcpSchema.AcpCredentials) => Effect.Effect<AcpSchema.AcpAuthResponse, AcpError.AcpError>;
+    
+    /**
+     * Sends a request to the ACP service
+     * @param method - The RPC method to call
+     * @param payload - The request payload
+     */
+    readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
+    
+     /**
+     * Sends a notification to the ACP service
+     * @param method - The notification method to send
+     * @param payload - The notification payload
+     */
+    readonly notify: (method: string, payload: unknown)