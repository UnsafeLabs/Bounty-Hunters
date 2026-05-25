Looking at the issue description and the provided code, I need to fix the SSH askpass script that's currently leaking passwords via insecure temporary file permissions. The main problems are:

1. The POSIX script writes passwords to temporary files without proper security
2. No proper cleanup of temporary files
3. No validation of script paths

Let me analyze the current code and create the necessary fixes:

```diff
--- a/t3code/packages/ssh/src/auth.ts
+++ b/t3code/packages/ssh/src/auth.ts
@@ -1,3 +1,4 @@
+// biome-ignore: lint/correctness/noUnusedImport
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * FileSystem = "effect/FileSystem";
@@ -19,6 +20,10 @@ import { SshPasswordPromptError } from "./errors.ts";
 
 export interface SshPasswordRequest {
   readonly destination: string;
+  readonly username: string | null;
+  readonly prompt: string;
+  readonly attempt: number;
+}
+
 export interface SshAskpassFile {
   readonly path: string;
   readonly contents: string;
@@ -27,6 +31,7 @@ export interface SshAskpassFile {
 export interface SshAskpassHelperDescriptor {
   readonly launcherPath: string;
   readonly files: ReadonlyArray<SshAskpassFile>;
+  readonly mode?: number;
 }
 
 export interface SshAuthOptions {
@@ -34,6 +38,7 @@ export interface SshAuthOptions {
   readonly authSecret?: string | null;
   readonly batchMode?: "yes" | "no";
   readonly interactiveAuth?: boolean;
+  readonly platform?: NodeJS.Platform;
 }
 
 export class SshPasswordPrompt extends Context.Service<SshPasswordPrompt, SshPasswordPromptShape>()(
@@ -42,6 +47,7 @@ export class SshPasswordPrompt extends Context.Service<SshPasswordPrompt, SshPa
   static readonly disabledLayer = Layer.succeed(
     SshPasswordPrompt,
     SshPasswordPrompt.of({
+      isAvailable: false,
       request: () => Effect.succeed(null),
     }),
   );
@@ -53,7 +59,7 @@ export const getDefaultSshAskpassDirectory = Effect.fn("ssh/auth.getDefaultSshAskp
   function* () {
     const fs = yield* FileSystem.FileSystem;
     const path = yield* Path.Path;
-    const parentDirectory = yield* fs.makeTempDirectory({ prefix: "t3code-ssh-runtime-" });
+    const parentDirectory = yield* fs.makeTempDirectory({ prefix: "t3code-ssh-runtime-" });
     return path.join(parentDirectory, SSH_ASKPASS_DIR_NAME);
   },
@@ -61,7 +67,7 @@ export const getDefaultSshAskpassDirectory = Effect.fn("ssh/auth.getDefaultSshAskp
 function* (input: {
   readonly directory: string;
   readonly platform?: NodeJS.Platform;
-}): Effect.fn.Return<SshAskpassHelperDescriptor, never, Path.Path> {
+}): Effect.Effect<SshAskpassHelperDescriptor, never, Path.Path> {
   const platform = input.platform ?? process.platform;
   const path = yield* Path.Path;
   const directory = input.directory;
@@ -70,7 +76,7 @@ function* (input: {
   if (platform === "win32") {
     const powershellPath = joinSshAskpassPath(directory, "ssh-askpass.ps1", platform);
     return {
-      launcherPath: joinSshAskpassPath(directory, "ssh-askpass.cmd", platform),
+      launcherPath: joinSshAskpassPath(directory, "ssh-askpass.cmd", platform),
       files: [
         {
           path: powershellPath,
@@ -79,7 +85,7 @@ function* (input: {
           contents: ASKPASS_WINDOWS_SCRIPT,
           mode: 0o755,
         },
-        {
+        {
           path: joinSshAskpassPath(directory, "ssh-askpass.cmd", platform),
           contents: ASKPASS_WINDOWS_LAUNCHER_SCRIPT,
           mode: 0o755,
@@ -88,7 +94,7 @@ function* (input: {
       ],
     };
   }
-  return {
+  return {
     launcherPath: joinSshAskstatPassPath(directory, "ssh-askpass.sh", platform),
     files: [
       {
@@ -97,7 +103,7 @@ function* (input: {
         path: joinSshAskpassPath(directory, "ssh-askpass.sh", platform),
         contents: ASKPASS_POSIX_SCRIPT,
         mode: 0o755,
-      },
+      },
       {
         path: joinSshAskpassPath(directory, "ssh-askpass.sh", platform),
         contents: ASKPASS_POSIX_SCRIPT,
@@ -106,7 +112,7 @@ function* (input: {
         mode: 0o755,
       },
     ],
-  };
+  };
 }
 
 const joinSshAskpassPath = (
@@ -115,7 +121,7 @@ const joinSshAskpassPath = (
   directory: string,
   fileName: string,
   platform: NodeJS.Platform,
-): string => {
+): string => {
   const trimmed = directory.replace(/[\\/]+$/u, "");
   return platform === "win32" ? `${trimmed}\\${fileName}` : `${trimmed}/${fileName}`;
 };
@@ -124,7 +130,7 @@ export const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
 # from the renderer's in-app prompt. We never expose a native dialog here - if
 # T3_SSH_AUTH_SECRET is missing, that's a caller bug and we fail loudly.
-if [ "\${T3_SSH_AUTH_SECRET+x}" = "x" ]; then
+if [ "\${T3_SSH_AUTH_SECRET+x}" = "x" ]; then
   printf "%s\\n" "$T3_SSH_AUTH_SECRET"
   exit 0
 fi
@@ -133,7 +139,7 @@ export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off
 powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\
 `;
 
-export const ASKPASS_WINDOWS_SCRIPT = `# Invoked by ssh via SSH_ASKPASS (through ssh-askpass.cmd) when T3 Code re-runs\
+export const ASKPASS_WINDOWS_SCRIPT = `# Invoked by ssh via SSH_ASKPASS (through ssh-askpass.cmd) when T3 Code re-runs\
 # ssh with a cached password from the renderer's in-app prompt. We never expose\
 # a native dialog here - if T3_SSH_AUTH_SECRET is missing, that's a caller bug\
 # and we fail loudly.\
@@ -142,7 +1