Looking at the issue, I need to add deep linking support via the `t3code://` custom protocol. The current file shows protocol handling but it's using `t3://` scheme and doesn't handle the deep linking patterns mentioned in the issue.

Let me analyze what needs to be done:
1. Change the scheme from `t3` to `t3code`
2. Add URL parsing for patterns like `t3code://open/project`, `t3code://chat/thread`, `t3code://settings`
3. Add IPC communication to route to correct views
4. Handle app launching/focusing
5. Add path traversal validation

```diff
--- a/t3code/apps/desktop/src/electron/ElectronProtocol.ts
+++ b/t3code/apps/desktop/src/electron/ElectronProtocol.ts
@@ -1,103 +1,249 @@
-import * as Cause from "effect/Cause";
-import * as Context from "effect/Context";
-import * as Data from "effect/Data";
-import * as Effect from "effect/Effect";
-import * as FileSystem from "effect/FileSystem";
-import * as Layer from "effect/Layer";
-import * as Option from "effect/Option";
-import * as Ref from "effect/Ref";
-import * as Scope from "effect/Scope";
+import * as Cause from "effect/Cause";
+import * as Context from "effect/Context";
+import * as Data from "effect/Data";
+import * as Effect from "effect/Effect";
+import * as FileSystem from "effect/FileSystem";
+import * as Layer from "effect/Layer";
+import * as Option from "effect/Option";
+import * as Ref from "effect/Ref";
+import * as Scope from "effect/Scope";
+import * as ipc from "electron";
 
-import * as Electron from "electron";
+import * as Electron from "electron";
 
-import { DesktopEnvironment, type DesktopEnvironmentShape } from "../app/DesktopEnvironment.ts";
+import { DesktopEnvironment, type DesktopEnvironmentShape } from "../app/DesktopEnvironment.ts";
 
-export const DESKTOP_SCHEME = "t3";
+export const DESKTOP_SCHEME = "t3code";
 
-export class ElectronProtocolRegistrationError extends Data.TaggedError(
-  "ElectronProtocolRegistrationError",
-)<{
-  readonly scheme: string;
-  readonly cause: unknown;
-}> {
-  override get message() {
-    return `Failed to register ${this.scheme}: file protocol.`;
-  }
-}
+export class ElectronProtocolRegistrationError extends Data.TaggedError(
+  "ElectronProtocolRegistrationError",
+)<{
+  readonly scheme: string;
+  readonly cause: unknown;
+}> {
+  override get message() {
+    return `Failed to register ${this.scheme}: file protocol.`;
+  }
+}
 
-export class ElectronProtocolStaticBundleMissingError extends Data.TaggedError(
-  "ElectronProtocolStaticBundleMissingError",
-)><{}> {
-  override get message() {
-    return "Desktop static bundle missing. Build apps/server (with bundled client) first.";
-  }
-}
+export class ElectronProtocolStaticBundleMissingError extends Data.TaggedError(
+  "ElectronProtocolStaticBundleMissingError",
+)<{}> {
+  override get message() {
+    return "Desktop static bundle missing. Build apps/server (with bundled client) first.";
+  }
+}
 
-export interface ElectronProtocolShape {
-  readonly registerFileProtocol: <E, R>(input: {
-    readonly scheme: string;
-    readonly handler: (
-      request: Electron.ProtocolRequest,
-    ) => Effect.Effect<Electron.ProtocolResponse, E, R>;
-    readonly onFailure?: (
-      request: Electron.ProtocolRequest,
-      cause: Cause.Cause<E>,
-    ) => Electron.ProtocolResponse;
-  }) => Effect.Effect<void, ElectronProtocolRegistrationError, R | Scope.Scope>;
-  readonly registerDesktopFileProtocol: Effect.Effect<
-    void,
-    ElectronProtocolRegistrationError | ElectronProtocolStaticBundleMissingError,
-    FileSystem.FileSystem | DesktopEnvironment | Scope.Scope
-  >;
-}
+export interface ElectronProtocolShape {
+  readonly registerFileProtocol: <E, R>(input: {
+    readonly scheme: string;
+    readonly handler: (
+      request: Electron.ProtocolRequest,
+    ) => Effect.Effect<Electron.ProtocolResponse, E, R>;
+    readonly onFailure?: (
+      request: Electron.ProtocolRequest,
+      cause: Cause.Cause<E>,
+    ) => Electron.ProtocolResponse;
+  }) => Effect.Effect<void, ElectronProtocolRegistrationError, R | Scope.Scope>;
+  readonly registerDesktopFileProtocol: Effect.Effect<
+    void,
+    ElectronProtocolRegistrationError | ElectronProtocolStaticBundleMissingError,
+    FileSystem.FileSystem | DesktopEnvironment | Scope.Scope
+  >;
+  readonly registerDeepLinkProtocol: Effect.Effect<
+    void,
+    ElectronProtocolRegistrationError,
+    Scope.Scope
+  >;
+}
 
-export class ElectronProtocol extends Context.Service<ElectronProtocol, ElectronProtocolShape>()(
-  "t3/desktop/electron/Protocol",
-) {}
+export class ElectronProtocol extends Context.Service<ElectronProtocol, ElectronProtocolShape>()(
+  "t3/desktop/electron/Protocol",
+) {}
 
-export function normalizeDesktopProtocolPathname(rawPath: string): Option.Option<string> {
-  const segments: string[] = [];
-  for (const segment of rawPath.split("/")) {
-    if (segment.length === 0 || segment === ".") {
-      continue;
-    }
-    if (segment === "..") {
-      return Option.none();
-    }
-    segments.push(segment);
-  }
-  return Option.some(segments.join("/"));
-}
+export function normalizeDesktopProtocolPathname(rawPath: string): Option.Option<string> {
+  const segments: string[] = [];
+  for (const segment of rawPath.split("/")) {
+    if (segment.length === 0 || segment === ".") {
+      continue;
+    }
+    if (segment === "..") {
+      return Option.none();
+    }
+    segments.push(segment);
+  }
+  return Option.some(segments.join("/"));
+}
+
+// Validate project path to prevent path traversal attacks
+export function validateProjectPath(path: string): boolean {
+  // Check for path traversal patterns
+  if (path.includes("..")) {
+    return false;
+  }
+  // Check for absolute path patterns that could be dangerous
+  if (path.startsWith("/") && path.length > 1) {
+    return false;
+  }
+  return true;
+}
+
+// Parse and handle deep link URLs
+export function handleDeepLink(url: string): void {
+  try {
+    const parsedUrl = new URL(url);
+    
+    if (parsedUrl.protocol !== `${DESKTOP_SCHEME}:`) {
+      throw new Error(`Invalid protocol: ${parsedUrl.protocol}`);
+    }
+
+    const mainWindow = Electron.BrowserWindow.getAll