 ```diff
--- a/t3code/packages/ssh/src/auth.ts
+++ b/t3code/packages/ssh/src/auth.ts
@@ -1,6 +1,7 @@
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as FileSystem from "effect/FileSystem";
+import * as HashMap from "effect/HashMap";
 import * as Layer from "effect/Layer";
 import * as Path from "effect/Path";
 import * as PlatformError from "effect/PlatformError";
@@ -56,6 +57,14 @@
   readonly platform?: NodeJS.Platform;
 }
 
+// Shell metacharacters that could cause injection if present in paths
+const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>!#*?\\]/;
+
+function containsShellMetacharacters(value: string): boolean {
+  return SHELL_METACHARACTERS.test(value);
+}
+
 const SSH_ASKPASS_DIR_NAME = "t3code-ssh-askpass";
 
 function joinSshAskpassPath(
@@ -68,6 +77,7 @@
 }
 
 export const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
+set -euo pipefail
 # Invoked by ssh via SSH_ASKPASS when T3 Code re-runs ssh with a cached password
 # from the renderer's in-app prompt. We never expose a native dialog here - if
 # T3_SSH_AUTH_SECRET is missing, that's a caller bug and we fail loudly.
@@ -80,6 +90,7 @@
 `;
 
 export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
+setlocal enabledelayedexpansion\r
 powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
 `;
 
@@ -88,11 +99,12 @@
 # a native dialog here - if T3_SSH_AUTHcid is missing, that's a caller bug\r
 # and we fail loudly.\r
 if ($null -ne $env:T3_SSH_AUTH_SECRET) {\r
-  [Console]::Out.WriteLine($env:T3_SSH_AUTH_SECRET)\r
+  $secureString = ConvertTo-SecureString -String $env:T3_SSH_AUTH_SECRET -AsPlainText -Force\r
+  [Console]::Out.WriteLine([System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)))\r
   exit 0\r
 }\r
 [Console]::Error.WriteLine("T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET.")\r
-exit 1\r
+exit 1\r
 `;
 
 export const getDefaultSshAskpassDirectory = Effect.fn("ssh/auth.getDefaultSshAskpassDirectory")(
@@ -111,6 +123,10 @@
   const path = yield* Path.Path;
   const directory = input.directory;
 
+  if (containsShellMetacharacters(directory)) {
+    return yield* Effect.fail(new Error("Askpass directory contains shell metacharacters"));
+  }
+
   if (platform === "win32") {
     const powershellPath = joinSshAskpassPath(directory, "ssh-askpass.ps1", platform);
     return {
@@ -123,6 +139,7 @@
           contents: ASKPASS_WINDOWS_LAUNCHER_SCRIPT,
         },
         {
+          path: powershellPath,
           contents: ASKPASS_WINDOWS_SCRIPT,
         },
       ],
@@ -130,6 +147,10 @@
   }
 
   const scriptPath = joinSshAskpassPath(directory, "ssh-askpass.sh", platform);
+  if (containsShellMetacharacters(scriptPath)) {
+    return yield* Effect.fail(new Error("Askpass script path contains shell metacharacters"));
+  }
+
   return {
     launcherPath: scriptPath,
     files: [
@@ -137,6 +158,7 @@
         path: scriptPath,
         contents: ASKPASS_POSIX_SCRIPT,
         mode: 0o700,
+        mode: 0o700,
       },
     ],
   };
@@ -148,6 +170,10 @@
   readonly authSecret?: string | null;
   readonly platform?: NodeJS.Platform;
 }): Effect.Effect<SshChildEnvironmentOptions, never, Path.Path> {
+  if (input.directory && containsShellMetacharacters(input.directory)) {
+    return yield* Effect.fail(new Error("Askpass directory contains shell metacharacters"));
+  }
+
   const platform = input.platform ?? process.platform;
   const path = yield* Path.Path;
   const directory = input.directory ?? (yield* getDefaultSshAskpassDirectory);
@@ -155,6 +181,10 @@
   if (platform === "win32") {
     const launcherPath = joinSshAskpassPath(directory, "ssh-askpass.cmd", platform);
     const scriptPath = joinSshAskpassPath(directory, "ssh-askpass.ps1", platform);
+    
+    if (containsShellMetacharacters(launcherPath) || containsShellMetacharacters(scriptPath)) {
+      return yield* Effect.fail(new Error("Askpass path contains shell metacharacters"));
+    }
 
     return {
       ...input,
@@ -167,6 +197,11 @@
 
   const scriptPath = joinSshAskpassPath(directory, "ssh-askpass.sh", platform);
 
+  if (containsShellMetacharacters(scriptPath)) {
+    return yield* Effect.fail(new Error("Askpass script path contains shell metacharacters"));
+  }
+
   return {
     ...input,
     askpassDirectory: directory,
@@ -181,6 +216,10 @@
   readonly authSecret?: string | null;
   readonly platform?: NodeJS.Platform;
 }): Effect.Effect<SshChildEnvironmentOptions, never, Path.Path> {
+  if (input.directory && containsShellMetacharacters(input.directory)) {
+    return yield* Effect.fail(new Error("Askpass directory contains shell metacharacters"));
+  }
+
   const platform = input.platform ?? process.platform;
   const path = yield* Path.Path;
   const directory = input.directory ?? (yield* getDefaultSshAskpassDirectory);
@@ -188,6 +227,10 @@
   if (platform === "win32") {
     const launcherPath = joinSshAskpassPath(directory, "ssh-askpass.cmd", platform);
     const scriptPath = joinSshAskpassPath(directory, "ssh-askpass.ps1", platform);
+    
+    if (containsShellMetacharacters(launcherPath) || containsShellMetacharacters(scriptPath)) {
+      return yield* Effect.fail(new Error("Askpass path contains shell metacharacters"));
+    }
 
     return {
       ...input,
@@ -200,6 +243,11 @@
