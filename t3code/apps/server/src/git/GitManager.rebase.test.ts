// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { expect } from "vitest";

import { GitCommandError } from "@t3tools/contracts";
import { type GitManagerShape } from "./GitManager.ts";
import {
  GitHubCli,
  type GitHubCliShape,
  GitHubCliError,
} from "../sourceControl/GitHubCli.ts";
import { type TextGenerationShape, TextGeneration } from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubSourceControlProvider from "../sourceControl/GitHubSourceControlProvider.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { makeGitManager } from "./GitManager.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  ProjectSetupScriptRunner,
  type ProjectSetupScriptRunnerShape,
} from "../project/Services/ProjectSetupScriptRunner.ts";
import { VcsProcess as VcsProcessOutput } from "../vcs/VcsProcess.ts";

function makeTempDir(prefix: string) {
  return Effect.sync(() => fs.mkdtempSync(path.join("/tmp", `${prefix}-XXXXXX`)));
}

function runGit(
  cwd: string,
  args: string[],
): Effect.Effect<
  void,
  GitCommandError | Error,
  GitVcsDriver.GitVcsDriver
> {
  return Effect.gen(function* () {
    const git = yield* GitVcsDriver.GitVcsDriver;
    yield* git.execute({
      operation: "test.runGit",
      cwd,
      args,
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new GitCommandError({
            operation: "test.runGit",
            command: `git ${args.join(" ")}`,
            cwd,
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      ),
    );
  });
}

function initRepo(cwd: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* runGit(cwd, ["init", "--initial-branch=main"]);
    yield* runGit(cwd, ["config", "user.email", "test@example.com"]);
    yield* runGit(cwd, ["config", "user.name", "Test User"]);
    yield* fs.writeFileString(path.join(cwd, "README.md"), "hello\n");
    yield* runGit(cwd, ["add", "README.md"]);
    yield* runGit(cwd, ["commit", "-m", "Initial commit"]);
  });
}

function createTextGeneration(): TextGenerationShape {
  return {
    generateCommitMessage: (input) =>
      Effect.succeed({
        subject: "Implement stacked git actions",
        body: "",
        ...(input.includeBranch
          ? { branch: "feature/implement-stacked-git-actions" }
          : {}),
      }),
    generatePrContent: () =>
      Effect.succeed({
        title: "Add stacked git actions",
        body: "",
      }),
    generateBranchName: () =>
      Effect.succeed({ branch: "update-workflow" }),
    generateThreadTitle: () =>
      Effect.succeed({ title: "Update workflow" }),
  };
}

function makeManager() {
  const gitHubCli: GitHubCliShape = {
    execute: (input) =>
      Effect.succeed({
        exitCode: 0,
        stdout: "[]\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
  };

  const textGeneration = createTextGeneration();
  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-git-manager-test-",
  });
  const serverSettingsLayer = ServerSettingsService.layerTest();

  const vcsDriverLayer = GitVcsDriver.layer.pipe(
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(ServerConfigLayer),
  );

  const sourceControlRegistryLayer = Layer.effect(
    SourceControlProviderRegistry.SourceControlProviderRegistry,
    GitHubSourceControlProvider.make().pipe(
      Effect.map((provider) =>
        SourceControlProviderRegistry.SourceControlProviderRegistry.of({
          get: () => Effect.succeed(provider),
          resolveHandle: () => Effect.succeed({ provider, context: null }),
          resolve: () => Effect.succeed(provider),
          discover: Effect.succeed([]),
        }),
      ),
      Effect.provide(Layer.succeed(GitHubCli, gitHubCli)),
    ),
  );

  const managerLayer = Layer.mergeAll(
    Layer.succeed(TextGeneration, textGeneration),
    Layer.succeed(ProjectSetupScriptRunner, {
      runForThread: () => Effect.succeed({ status: "no-script" as const }),
    } satisfies ProjectSetupScriptRunnerShape),
    vcsDriverLayer,
    serverSettingsLayer,
  ).pipe(
    Layer.provideMerge(sourceControlRegistryLayer),
    Layer.provideMerge(NodeServices.layer),
  );

  return makeGitManager().pipe(
    Effect.provide(managerLayer),
    Effect.map((manager) => ({ manager })),
  );
}

const GitManagerTestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-manager-test-" }),
  ),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(GitManagerTestLayer)("GitManager rebase", (it) => {
  it.effect("rebase completes when there are no conflicts", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("t3code-git-rebase-");
      yield* initRepo(repoDir);

      // Create a feature branch with a commit
      yield* runGit(repoDir, ["checkout", "-b", "feature"]);
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(path.join(repoDir, "feature.txt"), "feature\n");
      yield* runGit(repoDir, ["add", "feature.txt"]);
      yield* runGit(repoDir, ["commit", "-m", "Add feature"]);

      // Go back to main and make a different commit
      yield* runGit(repoDir, ["checkout", "main"]);
      yield* fs.writeFileString(path.join(repoDir, "main-update.txt"), "update\n");
      yield* runGit(repoDir, ["add", "main-update.txt"]);
      yield* runGit(repoDir, ["commit", "-m", "Update main"]);

      // Switch back to feature and rebase onto main
      yield* runGit(repoDir, ["checkout", "feature"]);

      const { manager } = yield* makeManager();
      const result = yield* manager.rebase({ cwd: repoDir, onto: "main" });

      expect(result.status).toBe("completed");
    }),
  );

  it.effect("rebase detects conflicts and returns conflicted files", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("t3code-git-rebase-conflict-");
      yield* initRepo(repoDir);

      const fs = yield* FileSystem.FileSystem;

      // Create a feature branch with a conflicting change
      yield* runGit(repoDir, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "feature change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Feature change"]);

      // Go back to main and make a conflicting change
      yield* runGit(repoDir, ["checkout", "main"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "main change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Main change"]);

      // Switch back to feature and rebase onto main (should conflict)
      yield* runGit(repoDir, ["checkout", "feature"]);

      const { manager } = yield* makeManager();
      const result = yield* manager.rebase({ cwd: repoDir, onto: "main" });

      expect(result.status).toBe("conflicts");
      if (result.status === "conflicts") {
        expect(result.files).toContain("README.md");
      }
    }),
  );

  it.effect("getConflictFiles returns empty array when no conflicts", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("t3code-git-no-conflict-");
      yield* initRepo(repoDir);

      const { manager } = yield* makeManager();
      const files = yield* manager.getConflictFiles({ cwd: repoDir });

      expect(files).toEqual([]);
    }),
  );

  it.effect("getConflictFiles lists conflicted files during active rebase", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("t3code-git-conflict-files-");
      yield* initRepo(repoDir);

      const fs = yield* FileSystem.FileSystem;

      // Create a feature branch with a conflicting change
      yield* runGit(repoDir, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "feature change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Feature change"]);

      // Go back to main and make a conflicting change
      yield* runGit(repoDir, ["checkout", "main"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "main change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Main change"]);

      // Switch back to feature and rebase onto main (should conflict)
      yield* runGit(repoDir, ["checkout", "feature"]);

      const { manager } = yield* makeManager();
      // Trigger rebase to create the conflict state
      yield* manager.rebase({ cwd: repoDir, onto: "main" });

      // Now get conflict files
      const files = yield* manager.getConflictFiles({ cwd: repoDir });
      expect(files).toContain("README.md");
    }),
  );

  it.effect("abortRebase restores the previous branch state", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("t3code-git-abort-rebase-");
      yield* initRepo(repoDir);

      const fs = yield* FileSystem.FileSystem;

      // Create a feature branch with a conflicting change
      yield* runGit(repoDir, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "feature change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Feature change"]);

      // Go back to main and make a conflicting change
      yield* runGit(repoDir, ["checkout", "main"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "main change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Main change"]);

      // Switch back to feature and rebase onto main (should conflict)
      yield* runGit(repoDir, ["checkout", "feature"]);

      const { manager } = yield* makeManager();
      const rebaseResult = yield* manager.rebase({ cwd: repoDir, onto: "main" });
      expect(rebaseResult.status).toBe("conflicts");

      // Abort the rebase
      yield* manager.abortRebase({ cwd: repoDir });

      // Verify we're back on the feature branch
      const status = yield* manager.localStatus({ cwd: repoDir });
      expect(status.refName).toBe("feature");
    }),
  );

  it.effect("continueRebase proceeds after conflicts are resolved", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("t3code-git-continue-rebase-");
      yield* initRepo(repoDir);

      const fs = yield* FileSystem.FileSystem;

      // Create a feature branch with a conflicting change
      yield* runGit(repoDir, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "feature change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Feature change"]);

      // Go back to main and make a conflicting change
      yield* runGit(repoDir, ["checkout", "main"]);
      yield* fs.writeFileString(path.join(repoDir, "README.md"), "main change\n");
      yield* runGit(repoDir, ["add", "README.md"]);
      yield* runGit(repoDir, ["commit", "-m", "Main change"]);

      // Switch back to feature and rebase onto main (should conflict)
      yield* runGit(repoDir, ["checkout", "feature"]);

      const { manager } = yield* makeManager();
      const rebaseResult = yield* manager.rebase({ cwd: repoDir, onto: "main" });
      expect(rebaseResult.status).toBe("conflicts");

      // Resolve the conflict by writing a resolved file
      yield* fs.writeFileString(
        path.join(repoDir, "README.md"),
        "resolved change\n",
      );
      yield* runGit(repoDir, ["add", "README.md"]);

      // Continue the rebase
      yield* manager.continueRebase({ cwd: repoDir });

      // Verify rebase completed - we should be on feature branch with the resolved commit
      const status = yield* manager.localStatus({ cwd: repoDir });
      expect(status.refName).toBe("feature");
    }),
  );

  it.effect("non-conflicting rebases work exactly as before", () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir("t3code-git-clean-rebase-");
      yield* initRepo(repoDir);

      const fs = yield* FileSystem.FileSystem;

      // Create a feature branch with a non-conflicting change
      yield* runGit(repoDir, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(repoDir, "feature-only.txt"), "feature\n");
      yield* runGit(repoDir, ["add", "feature-only.txt"]);
      yield* runGit(repoDir, ["commit", "-m", "Add feature file"]);

      // Go back to main and make a different non-conflicting change
      yield* runGit(repoDir, ["checkout", "main"]);
      yield* fs.writeFileString(path.join(repoDir, "main-only.txt"), "main\n");
      yield* runGit(repoDir, ["add", "main-only.txt"]);
      yield* runGit(repoDir, ["commit", "-m", "Add main file"]);

      // Switch back to feature and rebase onto main
      yield* runGit(repoDir, ["checkout", "feature"]);

      const { manager } = yield* makeManager();
      const result = yield* manager.rebase({ cwd: repoDir, onto: "main" });

      expect(result.status).toBe("completed");

      // Verify both files exist
      const featureExists = yield* fs
        .exists(path.join(repoDir, "feature-only.txt"))
        .pipe(Effect.catch(() => Effect.succeed(false)));
      const mainExists = yield* fs
        .exists(path.join(repoDir, "main-only.txt"))
        .pipe(Effect.catch(() => Effect.succeed(false)));

      expect(featureExists).toBe(true);
      expect(mainExists).toBe(true);
    }),
  );
});
