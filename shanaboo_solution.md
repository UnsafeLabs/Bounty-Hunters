Looking at the issue description, I need to implement deep linking support for the `t3code://` custom protocol. The main file to modify is the Electron protocol handler.

Let me analyze what's needed:
1. Add deep linking support to handle `t3code://` URLs
2. Parse URL patterns for project, chat, and settings links
3. Route to correct views via IPC
4. Handle app lifecycle (already running vs new instance)
5. Validate URL parameters to prevent path traversal
6. Support all the specified URL patterns

```diff
--- a/t3code/apps/desktop/src/electron/ElectronProtocol.ts
+++ b/t3code/apps/desktop/./src/electron/ElectronProtocol.ts
@@ -1,3 +1,100 @@
+import * as Cause from "effect/Cause";
+import * as Context from "effect/Context";
+import * Data from "effect/Data";
+import * as Effect from "effect/Effect";
+import * as FileSystem from "effect/FileSystem";
+import * as Layer from "effect/Layer";
+import * as Option from "effect/Option";
+import * as Ref from "effect/Ref";
+import * as Scope from "effect/Scope";
+
+import * as Electron from "electron";
+
+import { DesktopEnvironment, type DesktopEnvironmentShape } from "../app/DesktopEnvironment.ts";
+
+export const DESKTOP_SCHEME = "t3code";
+
+export class ElectronProtocolRegistrationError extends Data.TaggedError(
+  "ElectronProtocolRegistrationError",
+)<{
+  readonly scheme: string;
+  readonly cause: unknown;
+}> {
+  override get message() {
+    return `Failed to register ${this.scheme} protocol.`;
+  }
+}
+
+export class ElectronProtocolStaticBundleMissingError extends Data.TaggedError(
+  "ElectronProtocolStaticBundleMissingError",
+)<{}> {
+  override get message() {
+    return "Desktop static bundle missing. Build apps/server (with bundled client) first.";
+  }
+}
+
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
+}
+
+export class ElectronProtocol extends Context.Service<ElectronProtocol, ElectronProtocolShape>()(
+  "t3/desktop/electron/Protocol",
+) {}
+
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
+const registerDesktopSchemePrivileges = Effect.sync(() => {
+  Electron.protocol.registerSchemesAsPrivileged([
+    {
+      scheme: DESKTOP_SCHEME,
+      privileges: {
+        standard: true,
+        secure: true,
+        supportFetchAPI: true,
+        corsEnabled: true,
+      },
+    },
+  ]);
+}).pipe(Effect.withSpan("desktop.electron.protocol.registerSchemePrivileges"));
+
+export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);
+
+const resolveDesktopStaticDir: Effect.Effect<
+  Option.Option<string>,
+  never,
+  FileSystem.FileSystem | DesktopEnvironment
+> = Effect.gen(function* () {
+  const fileSystem = yield* FileSystem.FileSystem;
+  const environment = yield* DesktopEnvironment;
+  const candidates = [
+    environment.path.join(environment.appRoot, "apps/server/dist/client"),
+    environment.path: string, "apps/web/dist"),
+  ];
+  for (const candidate of candidates) {
+    const hasIndex = yield* fileSystem
+      .exists(environment.path.join(candidate, "index.html"))
+      .pipe(Effect.orElseSucceed(() => false));
+    if (hasIndex) {  
+      return Option.some(candidate);
+    }
+  }
+  return Option.none<string>();
+});
+
+const resolveDesktopStaticPath = Effect.fn("desktop.electron.protocol.resolveDesktopStaticPath")(
+  function* (
+    staticRoot: string,
+    requestUrl: string,
+  ): Effect.fn.Return<string, never, FileSystem.FileSystem | DesktopEnvironment> {
+    const fileSystem = yield* FileSystem.FileSystem;
+    const environment = yield* DesktopEnvironment;
+    const url = new URL(requestUrl);
+    const rawPath = decodeURIComponent(url.pathname);
+    const normalizedPath = normalizeDesktopProtocolPathname(rawPath);
+    if (Option.isNone(normalizedPath)) {
+      return;
+    }
+    const normalized = normalizedPath.value;
+    const resolvedPath = environment.path.join(staticRoot, normalized);
+    const exists = yield* fileSystem.exists(resolvedPath);
+    if (!exists) {
+      return;
+    }
+    return resolvedPath;
+  }
+);
+
+export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);
+export const resolveDesktopStaticDir = Effect.fn;
+export const resolveDesktopStaticPath = Effect.fn;
+
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
+}
+
+export class ElectronProtocol extends Context.Service<ElectronProtocol, ElectronProtocolShape>()(
+  "t3/desktop/electron/Protocol",
+) {}
+
+export function normalizeDesktopProtocolPathname(rawPath: string): Option.Option<string> {
+  const segments: string[] = [];
+  for (const segment of rawPath.split("/")) {
+    if (segment.length === 0 || segment === ".") {
+      continue;
+    }
+   