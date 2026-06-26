 ```diff
--- a/t3code/packages/ssh/src/auth.ts
+++ b/t3code/packages/ssh/src/auth.ts
@@ -1,6 +1,7 @@
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as FileSystem from "effect/FileSystem";
+import * as Hash from "effect/Hash";
 import * as Layer from "effect/Layer";
 import * as Path from "effect/Path";
 import * as PlatformError from "effect/PlatformError";
@@ -56,6 +57,7 @@
   readonly path: string;
   readonly contents: string;
   readonly mode?: number;
+  readonly cleanupScript?: string;
 }
 
 export interface SshAskpassHelperDescriptor {
@@ -108,6 +110,7 @@
   exit 1
 `;
 
+// Deprecated: Replaced by dynamic script generation with secure temp file handling
 export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
 powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
 `;
@@ -123,6 +126,7 @@
 exit 1\r
 `;
 
+// Validate script path to prevent shell