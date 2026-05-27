```diff
--- a/t3code/apps/desktop/src/electron/protocol.ts
+++ b/t3code/apps/desktop/src/electron/protocol.ts
@@ -0,0 +1,298 @@
+import * as Cause from "effect/Cause";
+import * as Context from "effect/Context";
+import * as Data from "effect/Data";
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
+    return `Failed to register ${this.scheme}: file protocol.`;
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
+    environment.path.join(environment.appRoot, "apps/web/dist"),
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
+      return environment.path.join(staticRoot, "index.html");
+    }
+    const candidatePath = environment.path.join(staticRoot, normalizedPath.value);
+    const isFile = yield* fileSystem.exists(candidatePath).pipe(
+      Effect.andThen((exists) => (exists ? fileSystem.isFile(candidatePath) : Effect.succeed(false))),
+      Effect.orElseSucceed(() => false),
+    );
+    if (isFile) {
+      return candidatePath;
+    }
+    const withHtml = candidatePath + ".html";
+    const hasHtml = yield* fileSystem.exists(withHtml).pipe(Effect.orElseSucceed(() => false));
+    if (hasHtml) {
+      return withHtml;
+    }
+    return environment.path.join(staticRoot, "index.html");
+  },
+);
+
+export const ElectronProtocolLive = Layer.effect(
+  ElectronProtocol,
+  Effect.gen(function* () {
+    const fileSystem = yield* FileSystem.FileSystem;
+    const environment = yield* DesktopEnvironment;
+
+    const registerFileProtocol = <E, R>(input: {
+      readonly scheme: string;
+      readonly handler: (
+        request: Electron.ProtocolRequest,
+      ) => Effect.Effect<Electron.ProtocolResponse, E, R>;
+      readonly onFailure?: (
+        request: Electron.ProtocolRequest,
+        cause: Cause.Cause<E>,
+      ) => Electron.ProtocolResponse;
+    }): Effect.Effect<void, ElectronProtocolRegistrationError, R | Scope.Scope> =>
+      Effect.acquireUseRelease(
+        Effect.sync(() => {
+          const handler = (request: Electron.ProtocolRequest, callback: (response: Electron.ProtocolResponse) => void) => {
+            Effect.runPromise(input.handler(request)).then(
+              (response) => callback(response),
+              (error) => {
+                if (input.onFailure) {
+                  callback(input.onFailure(request, Cause.fail(error)));
+                } else {
+                  callback({ statusCode: 500, data: "Internal Server Error" });
+                }
+              },
+            );
+          };
+          Electron.protocol.handle(input.scheme, handler);
+          return handler;
+        }),
+        () => Effect.