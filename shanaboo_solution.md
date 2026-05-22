```diff
--- /dev/null
+++ b/t3code/apps/server/src/git/GitManager.ts
@@ -0,0 +1,1 @@
+// GitManager implementation with rebase conflict detection and resolution
+import { Effect } from "effect"
+import * as CP from "child_process"
+import * as FS from "fs"
+import * as Path from "path"
+
+// Types for git operations
+export interface GitError {
+  readonly _tag: "GitError"
+  readonly message: string
+  readonly command?: string
+}
+
+export interface RebaseConflictError {
+  readonly _tag: "RebaseConflictError"
+  readonly branch: string
+  readonly onto: string
+  readonly conflictedFiles: ReadonlyArray<string>
+}
+
+export interface RebaseInProgressError {
+  readonly _tag: "RebaseInProgressError"
+  readonly message: string
+}
+
+export interface NoRebaseInProgressError {
+  readonly _tag: "NoRebaseInProgressError"
+  readonly message: string
+}
+
+export type GitManagerError =
+  | GitError
+  | RebaseConflictError
+  | RebaseInProgressError
+  | NoRebaseInProgressError
+
+// Configuration for git operations
+interface GitManagerConfig {
+  readonly workingDirectory: string
+}
+
+// Helper to execute git commands
+const execGit = (
+  args: ReadonlyArray<string>,
+  cwd: string
+): Effect.Effect<never, GitError, string> =>
+  Effect.async((resume) => {
+    const child = CP.spawn("git", [...args], {
+      cwd,
+      stdio: ["ignore", "pipe", "pipe"],
+    })
+
+    let stdout = ""
+    let stderr = ""
+
+    child.stdout.on("data", (data: Buffer) => {
+      stdout += data.toString()
+    })
+
+    child.stderr.on("data", (data: Buffer) => {
+      stderr += data.toString()
+    })
+
+    child.on("close", (code) => {
+      if (code !== 0) {
+        resume(
+          Effect.fail({
+            _tag: "GitError",
+            message: stderr.trim() || `Git command failed with code ${code}`,
+            command: `git ${args.join(" ")}`,
+          })
+        )
+      } else {
+        resume(Effect.succeed(stdout.trim()))
+      }
+    })
+
+    child.on("error", (err) => {
+      resume(
+        Effect.fail({
+          _tag: "GitError",
+          message: err.message,
+          command: `git ${args.join(" ")}`,
+        })
+      )
+    })
+  })
+
+// Check if a rebase is in progress by looking for .git/REBASE_HEAD
+const isRebaseInProgress = (cwd: string): boolean => {
+  const rebaseHeadPath = Path.join(cwd, ".git", "REBASE_HEAD")
+  try {
+    FS.accessSync(rebaseHeadPath)
+    return true
+  } catch {
+    return false
+  }
+}
+
+// Get the current branch name
+const getCurrentBranch = (
+  cwd: string
+): Effect.Effect<never, GitError, string> =>
+  execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
+
+// GitManager class
+export class GitManager {
+  private readonly config: GitManagerConfig
+
+  constructor(config: GitManagerConfig) {
+    this.config = config
+  }
+
+  // Rebase the current branch onto another branch
+  rebase(onto: string): Effect.Effect<never, GitManagerError, void> {
+    const cwd = this.config.workingDirectory
+
+    return Effect.gen(function* (_) {
+      const currentBranch = yield* _(getCurrentBranch(cwd))
+
+      const result = yield* _(
+        Effect.either(
+          execGit(["rebase", onto], cwd)
+        )
+      )
+
+      if (result._tag === "Left") {
+        // Check if rebase failed due to conflicts
+        if (isRebaseInProgress(cwd)) {
+          const conflictedFiles = yield* _(getConflictFiles(cwd))
+          yield* _(
+            Effect.fail<RebaseConflictError>({
+              _tag: "RebaseConflictError",
+              branch: currentBranch,
+              onto,
+              conflictedFiles,
+            })
+          )
+        }
+        return yield* _(Effect.fail(result.left))
+      }
+
+      return void 0
+    })
+  }
+
+  // Get list of conflicted files
+  getConflictFiles(): Effect.Effect<never, GitError, ReadonlyArray<string>> {
+    return getConflictFiles(this.config.workingDirectory)
+  }
+
+  // Abort the current rebase
+  abortRebase(): Effect.Effect<never, GitManagerError, void> {
+    const cwd = this.config.workingDirectory
+
+    return Effect.gen(function* (_) {
+      if (!isRebaseInProgress(cwd)) {
+        yield* _(
+          Effect.fail<NoRebaseInProgressError>({
+            _tag: "NoRebaseInProgressError",
+            message: "No rebase in progress to abort",
+          })
+        )
+      }
+
+      yield* _(execGit(["rebase", "--abort"], cwd))
+      return void 0
+    })
+  }
+
+  // Continue the current rebase after conflicts are resolved
+  continueRebase(): Effect.Effect<never, GitManagerError, void> {
+    const cwd = this.config.workingDirectory
+
+    return Effect.gen(function* (_) {
+      if (!isRebaseInProgress(cwd)) {
+        yield* _(
+          Effect.fail<NoRebaseInProgressError>({
+            _tag: "NoRebaseInProgressError",
+            message: "No rebase in progress to continue",
+          })
+        )
+      }
+
+      // Check if there are still unresolved conflicts
+      const conflicts = yield* _(getConflictFiles(cwd))
+      if (conflicts.length > 0) {
+        yield* _(
+          Effect.fail<RebaseConflictError>({
+            _tag: "RebaseConflictError",
+            branch: yield* _(getCurrentBranch(cwd)),
+            onto: "unknown", // We don't track this currently
+            conflictedFiles: conflicts,
+          })
+        )
+      }
+
+      yield* _(execGit(["rebase", "--continue"], cwd))
+      return void 0
+    })
