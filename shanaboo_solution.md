Looking at the issue description, I need to add rebase conflict detection and resolution functionality to the GitManager class. However, I don't see the actual GitManager.ts file in the provided file listing. Let me examine the structure and create the necessary implementation.

```diff
--- a/t3code/apps/server/src/git/GitManager.ts
+++ b/t3code/apps/server/src/git/GitManager.ts
@@ -1,15 +1,145 @@
+import { Effect, pipe } from "effect";
+import * as cp from "node:child_process";
+import * as fs from "node:fs";
+import * as path from "node:path";
+import { GitError, type GitResult } from "../types";
+
+export interface GitManager {
+  rebase: (upstream: string) => Effect.Effect<GitResult, GitError>;
+  getConflictFiles: () => Effect.Effect<GitResult, GitError>;
+  abortRebase: () => Effect.Effect<GitResult, GitError>;
+  continueRebase: () => Effect.Effect<GitResult, GitError>;
+}
+
+export const makeGitManager = (workingDir: string): GitManager => {
+  const runGitCommand = (command: string): Effect.Effect<GitResult, GitError> =>
+    pipe(
+      Effect.try({
+        try: () => new cp.execSync(`cd ${workingDir} && ${command}`, { encoding: 'utf8' }),
+        catch: () => new GitError('Git command failed')
+      }),
+      Effect.map(toString)
+    );
+  
+  const rebase = (upstream: string) => 
+    pipe(
+      runGitCommand(`git rebase ${upstream}`),
+      Effect.catchAll(() => 
+        pipe(
+          detectRebaseConflicts(),
+          Effect.flatMap(conflicts => 
+            Effect.fail(new Error('Rebase conflicts detected'))
+          )
+        )
+      )
+    );
+  
+  const detectRebaseConflicts = () => 
+    pipe(
+      runGitCommand('git diff --name-only --diff-filter=U'),
+      Effect.map((output) => {
+        const conflictedFiles = output.split('\n').filter(file => file.trim() !== '');
+        return conflictedFiles;
+      })
+    );
+
+  const getConflictFiles = () => 
+    pipe(
+      runGitCommand('git diff --name-only --diff-filter=U'),
+      Effect.map(output => output.split('\n').filter(file => file.trim() !== ''))
+    );
+  
+  const abortRebase = () => 
+    pipe(
+      runGitCommand('git rebase --abort'),
+      Effect.map(() => ({ success: true, message: 'Rebase aborted successfully' }))
+    );
+
+  const continueRebase = () => 
+    pipe(
+      runGitCommand('git add .'),
+      Effect.flatMap(() => runGitCommand('git rebase --continue')),
+      Effect.map(() => ({ success: true, message: 'Rebase continued successfully' }))
+    );
+  
+  const checkRebaseConflicts = () => {
+    const rebaseHeadPath = path.join(workingDir, '.git', 'REBASE_HEAD');
+    return fs.existsSync(rebaseHeadPath);
+  };
+  
+  return {
+    rebase,
+    getConflictFiles,
+    abortRebase,
+    continueRebase
+  };
+};
+
+export const makeGitManagerWithConflictDetection = (workingDir: string) => {
+  const manager = makeGitManager(workingDir);
+  
+  return {
+    ...manager,
+    rebase: (upstream: string) => 
+      pipe(
+        manager.rebase(upstream),
+        Effect.catchAll(() => 
+          pipe(
+            detectRebaseConflicts(),
+            Effect.flatMap(conflicts => 
+              Effect.fail(new Error('Rebase conflicts detected'))
+            )
+          )
+        )
+      ),
+    detectRebaseConflicts,
+    getConflictFiles,
+    abortRebase,
+    continueRebase
+  };
+};
+
+export interface GitManagerWithConflicts extends GitManager {
+  detectRebaseConflicts: () => Effect.Effect<boolean>;
+  getConflictFiles: () => Effect.Effect<string[]>;
+  abortRebase: () => Effect.Effect<GitResult>;
+  continueRebase: () => Effect.Effect<GitResult>;
+}
+
+export const createGitManager = (workingDir: string): GitManagerWithConflicts => {
+  const baseManager = makeGitManagerWithConflictDetection(workingDir);
+  return {
+    ...baseManager,
+    rebase: (upstream: string) => 
+      pipe(
+        baseManager.rebase(upstream),
+        Effect.catchAll(() => 
+          pipe(
+            baseManager.detectRebaseConflicts(),
+            Effect.flatMap(conflicts => 
+              Effect.fail(new Error('Rebase conflicts detected'))
+            )
+          )
+        )
+      )
+  };
+};
+
+const detectRebaseConflicts = () => 
+  pipe(
+    Effect.try(() => fs.existsSync(path.join(workingDir, '.git', 'REBASE_HEAD'))),
+    Effect.map(exists => Boolean(exists))
+  );
+
+export const makeGitManagerWithConflictDetection = (workingDir: string) => {
+  const baseManager = makeGitManager(workingDir);
+  
+  const detectRebaseConflicts = () => 
+    pipe(
+      runGitCommand('git status'),
+      Effect.map(output => {
+        const hasConflicts = output.includes('Unmerged paths');
+        return Effect.succeed(hasConflicts);
+      })
+    );
+  
+  return {
+    ...baseManager,
+    getConflictFiles: () => 
+      pipe(
+        runGitCommand('git diff --name-only --diff-filter=U'),
+        Effect.map(output => output.split('\n').filter(file => file.trim() !== ''))
+      ),
+    abortRebase: () => 
+      pipe(
+        runGit(workingDir, 'git rebase --abort'),
+        Effect.map(() => ({ success: true, message: 'Rebase aborted successfully' }))
+      ),
+    continueRebase: () => 
+      pipe(
+        runGit(workingDir, 'git add .'),
+        Effect.flatMap(() => runGit(workingDir, 'git rebase --continue')),
+        Effect.map(() => ({ success: true, message: 'Rebase continued successfully' }))
+      )
+  };
+};
+
+export const runGit = (workingDir: string, command: string) => 
+  pipe(
+    Effect.try(() => cp.execSync(`cd ${workingDir} && ${command}`, { encoding: '