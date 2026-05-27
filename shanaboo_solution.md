```diff
--- a/t3code/apps/desktop/src/electron/protocol.ts
+++ b/t3code/apps/desktop/src/electron/protocol.ts
@@ -0,0 +1,298 @@
+import * as Effect from "effect/Effect";
+import * as Layer from "effect/Layer";
+import * as Option from "effect/Option";
+import * as Either from "effect/Either";
+import * as Data from "effect/Data";
+import * as Console from "effect/Console";
+
+import * as Electron from "electron";
+import * as Path from "node:path";
+
+// Protocol name for deep linking
+export const DEEP_LINK_SCHEME = "t3code";
+
+// Error types for deep link handling
+export class DeepLinkError extends Data.TaggedError("DeepLinkError")<{
+  readonly url: string;
+  readonly reason: string;
+}> {
+  override get message() {
+    return `Deep link error for ${this.url}: ${this.reason}`;
+  }
+}
+
+export class PathTraversalError extends Data.TaggedError("PathTraversalError")<{
+  readonly path: string;
+}> {
+  override get message() {
+    return `Path traversal attempt detected: ${this.path}`;
+  }
+}
+
+// Deep link action types
+export type DeepLinkAction =
+  | { readonly _tag: "OpenProject"; readonly path: string }
+  | { readonly _tag: "OpenChatThread"; readonly threadId: string }
+  | { readonly _tag: "OpenSettings" }
+  | { readonly _tag: "Unknown"; readonly url: string };
+
+// IPC channel names for deep linking
+export const IPC_DEEP_LINK = "t3code:deep-link";
+
+// Store for pending deep links when app is not yet ready
+let pendingDeepLink: string | null = null;
+let isAppReady = false;
+
+/**
+ * Validates a project path to prevent path traversal attacks.
+ * Rejects paths containing .., null bytes, or overly long paths.
+ */
+export function validateProjectPath(path: string): Either.Either<string, PathTraversalError> {
+  // Check for null bytes
+  if (path.includes("\0")) {
+    return Either.left(new PathTraversalError({ path }));
+  }
+
+  // Normalize the path
+  const normalized = Path.normalize(path);
+
+  // Check for path traversal attempts
+  if (normalized.includes("..")) {
+    return Either.left(new PathTraversalError({ path }));
+  }
+
+  // Check for absolute paths that try to escape (platform-specific)
+  if (Path.isAbsolute(normalized)) {
+    // Absolute paths are allowed but we ensure they're clean
+    // Additional platform-specific checks can be added here
+  }
+
+  // Reject overly long paths (potential buffer overflow)
+  if (normalized.length > 4096) {
+    return Either.left(new PathTraversalError({ path }));
+  }
+
+  return Either.right(normalized);
+}
+
+/**
+ * Parses a t3code:// URL and returns the corresponding action.
+ */
+export function parseDeepLink(url: string): Either.Either<DeepLinkAction, DeepLinkError> {
+  let parsedUrl: URL;
+
+  try {
+    parsedUrl = new URL(url);
+  } catch {
+    return Either.left(new DeepLinkError({ url, reason: "Invalid URL format" }));
+  }
+
+  // Validate scheme
+  if (parsedUrl.protocol !== `${DEEP_LINK_SCHEME}:`) {
+    return Either.left(new DeepLinkError({ url, reason: `Invalid scheme: ${parsedUrl.protocol}` }));
+  }
+
+  const host = parsedUrl.hostname;
+  const pathname = parsedUrl.pathname;
+
+  // Route based on host and path
+  switch (host) {
+    case "open": {
+      if (pathname === "/project") {
+        const projectPath = parsedUrl.searchParams.get("path");
+        if (!projectPath) {
+          return Either.left(new DeepLinkError({ url, reason: "Missing path parameter for project" }));
+        }
+
+        const validation = validateProjectPath(projectPath);
+        if (Either.isLeft(validation)) {
+          return Either.left(new DeepLinkError({ url, reason: `Path traversal detected: ${projectPath}` }));
+        }
+
+        return Either.right({ _tag: "OpenProject", path: Either.getOrThrow(validation) });
+      }
+      break;
+    }
+
+    case "chat": {
+      if (pathname === "/thread") {
+        const threadId = parsedUrl.searchParams.get("id");
+        if (!threadId) {
+          return Either.left(new DeepLinkError({ url, reason: "Missing id parameter for chat thread" }));
+        }
+
+        // Validate thread ID format (alphanumeric, hyphens, underscores)
+        if (!/^[a-zA-Z0-9_-]+$/.test(threadId)) {
+          return Either.left(new DeepLinkError({ url, reason: `Invalid thread ID format: ${threadId}` }));
+        }
+
+        return Either.right({ _tag: "OpenChatThread", threadId });
+      }
+      break;
+    }
+
+    case "settings": {
+      if (pathname === "" || pathname === "/") {
+        return Either.right({ _tag: "OpenSettings" });
+      }
+      break;
+    }
+  }
+
+  return Either.left(new DeepLinkError({ url, reason: `Unknown deep link pattern: ${host}${pathname}` }));
+}
+
+/**
+ * Sends a deep link action to the renderer process via IPC.
+ */
+export function sendDeepLinkAction(
+  window: Electron.BrowserWindow,
+  action: DeepLinkAction,
+): Effect.Effect<void, never, never> {
+  return Effect.sync(() => {
+    window.webContents.send(IPC_DEEP_LINK, action);
+  });
+}
+
+/**
+ * Handles a deep link URL, parsing it and sending to the renderer.
+ */
+export function handleDeepLink(
+  window: Electron.BrowserWindow,
+  url: string,
+): Effect.Effect<void, DeepLinkError, never> {
+  return Effect.gen(function* () {
+    const parsed = parseDeepLink(url);
+
+    if (Either.isLeft(parsed)) {
+      yield* Console.error(`Deep link error: ${parsed.left.message}`);
+      return yield* Effect.fail(parsed.left);
+    }
+
+    yield* sendDeepLinkAction(window, parsed.right);
+  });
+}
+
+/**
+ * Sets a pending deep link to be processed when app is ready.
+ */
+export function setPendingDeepLink(url: string): void {
+  pendingDeepLink = url;
+}
+
+/**
+ * Gets and clears the pending deep link