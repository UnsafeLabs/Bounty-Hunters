Looking at the issue description and the provided file, I need to implement automatic token refresh functionality in the ACP client. Let me analyze what's needed:

1. Add token expiry detection for 401 responses
2. Implement automatic re-authentication with Effect.retry
3. Store refresh token separately
4. Add onSessionExpired callback
5. Use Effect.acquireRelease for proper cleanup
6. Handle concurrent requests during re-auth

Let me create the implementation:

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/effect-acp/src/client.ts
@@ -1,195 +1,335 @@
-import * as Context from "effect/Context";
-import * as Effect from "effect/Effect";
-import * as Stdio from "effect/Stdio";
-import * as Layer from "effect/Layer";
-import * as Schema from "effect/Schema";
-import * as Scope from "effect/Scope";
-import * as Stream from "effect/Stream";
-import * as RpcClient from "effect/unstable/rpc/RpcClient";
-import * as RpcServer from "effect/unstable/rpc/RpcServer";
-import { ChildProcessSpawner } from "effect/unstable/process";
+import * as Context from "effect/Context";
+import * as Effect from "effect/Effect";
+import * as Stdio from "effect/Stdio";
+import * as Layer from "effect/Layer";
+import * as Schema from "effect/Schema";
+import * as Scope from "effect/Scope";
+import * as Stream from "effect/Stream";
+import * as RpcClient from "effect/unstable/rpc/RpcClient";
+import * as RpcServer from "effect/unstable/rpc/RpcServer";
+import { ChildProcessSpawner } from "effect/unstable/process";
+import * as Queue from "effect/Queue";
+import * as Deferred from "effect/Deferred";
+import * as Exit from "effect/Exit";
+import * as FiberRef from "effect/FiberRef";
+
+export interface AcpClientOptions {
+  readonly logIncoming?: boolean;
+  readonly logOutgoing?: boolean;
+  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
+  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;
+}
+
+export interface AcpClientSession {
+  readonly accessToken: string;
+  readonly refreshToken: string;
+  readonly sessionId: string;
+  readonly isAuthenticated: boolean;
+}
+
+interface AcpClientState {
+  currentSession: AcpClientSession | null;
+  isRefreshing: boolean;
+  requestQueue: Array<{
+    deferred: Deferred.Deferred<any, any>;
+    request: () => Effect.Effect<any, any, any>;
+  }>;
+}
+
+// Client state management
+let clientState: AcpClientState = {
+  currentSession: null,
+  isRefreshing: false,
+  requestQueue: []
+};
+
+// Token refresh state
+const refreshState = FiberRef.unsafeMake<AcpClientState>({
+  currentSession: null,
+  isRefreshing: false,
+  requestQueue: []
+});
+
+export const makeAcpClient = (
+  options: AcpClientOptions = {}
+) => {
+  return Effect.gen(function* () {
+    const client = yield* (AcpRpcs.AcpClient);
+    const sessionId = yield* (Effect.sync(() => crypto.randomUUID()));
+    
+    // Initialize client with refresh capabilities
+    const refreshClient = (request: () => Effect.Effect<any, any, any>) => {
+      return Effect.gen(function* () {
+        // Check if we're currently refreshing
+        const state = yield* (FiberRef.get(refreshState));
+        
+        if (state.isRefreshing) {
+          // If already refreshing, queue this request
+          const deferred = yield* (Deferred.make());
+          yield* (FiberRef.update((state) => ({
+            ...state,
+            requestQueue: [...state.requestQueue, { deferred, request }]
+          }), refreshState));
+          return yield* (deferred);
+        }
+        
+        // Mark as refreshing
+        yield* (FiberRef.update((state) => ({
+          ...state,
+          isRefreshing: true
+        }), refreshState));
+        
+        // Try to execute the request
+        const result = yield* (Effect.either(request()));
+        
+        // If we get a 401, we need to refresh
+        if (Exit.isFailure(result) && result.effect instanceof AcpError.AcpError) {
+          const error = result.effect;
+          if (error.status === 401) {
+            yield* (Effect.sync(() => {
+              // Call session expired callback if provided
+              if (options.onSessionExpired) {
+                options.onSessionExpired(state.currentSession?.sessionId || '');
+              }
+            }));
+            
+            // Attempt token refresh
+            const refreshResult = yield* (refreshToken(
+              state.currentSession?.refreshToken || '',
+              state.currentSession?.sessionId || ''
+            ));
+            
+            if (Exit.isSuccess(refreshResult)) {
+              // Update state with new tokens
+              const newTokens = refreshResult.value;
+              yield* (FiberRef.update((state) => ({
+                ...state,
+                currentSession: {
+                  ...state.currentSession,
+                  accessToken: newTokens.accessToken,
+                  refreshToken: newTokens.refreshToken
+                }
+              }), refreshState));
+            } else {
+              // Re-auth failed, propagate error
+              return yield* (Effect.fail(new Error("Token refresh failed")));
+            }
+          }
+        }
+        
+        return result;
+      }).pipe(
+        Effect.catchAll((error) => {
+          if (error instanceof AcpError.AcpError && error.status === 401) {
+            return yield* (handleTokenRefresh());
+          }
+          return Effect.fail(error);
+        })
+      );
+    }));
+    
+    const refreshToken = (
+      refreshToken: string,
+      sessionId: string
+    ) => {
+      return Effect.gen(function* () {
+        // Implement token refresh logic
+        const newTokens = yield* (callRpc("refresh", {
+          sessionId,
+          refreshToken
+        }));
+        
+        return {
+          accessToken: newTokens.access_token,
+          refreshToken: newTokens.refresh_token
+        };
+      });
+    };
+    
+    const handleTokenRefresh = () => {
+      return Effect.gen(function* () {
+        // Handle the token refresh process
+        const state = yield* (FiberRef.get(refreshState));
+        
+        if (!state.isRefreshing) {
+          yield* (FiberRef.update((state)