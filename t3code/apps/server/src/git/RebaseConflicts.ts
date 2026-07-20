/**
 * Rebase conflict detection and abort/continue helpers (issue #823).
 */

export type GitErrorTag = "RebaseConflict" | "GitCommandFailed" | "NotInRebase";

export class GitTaggedError extends Error {
  readonly _tag: GitErrorTag;
  constructor(tag: GitErrorTag, message: string) {
    super(message);
    this._tag = tag;
    this.name = "GitTaggedError";
  }
}

export interface RebaseState {
  inProgress: boolean;
  conflictFiles: string[];
}

export interface GitRunner {
  /** returns {code, stdout, stderr} */
  run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  pathExists(rel: string): Promise<boolean>;
}

export async function detectRebaseInProgress(git: GitRunner): Promise<boolean> {
  return git.pathExists(".git/REBASE_HEAD");
}

export async function getConflictFiles(git: GitRunner): Promise<string[]> {
  const res = await git.run(["diff", "--name-only", "--diff-filter=U"]);
  if (res.code !== 0 && res.stdout.trim() === "") {
    // empty conflict list may still be code 0
  }
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function afterRebase(
  git: GitRunner,
  rebaseResult: { code: number; stderr: string },
): Promise<RebaseState> {
  const inProgress = await detectRebaseInProgress(git);
  if (rebaseResult.code === 0 && !inProgress) {
    return { inProgress: false, conflictFiles: [] };
  }
  const conflictFiles = await getConflictFiles(git);
  if (conflictFiles.length > 0 || inProgress) {
    return { inProgress: true, conflictFiles };
  }
  if (rebaseResult.code !== 0) {
    throw new GitTaggedError(
      "GitCommandFailed",
      rebaseResult.stderr || "rebase failed",
    );
  }
  return { inProgress: false, conflictFiles: [] };
}

export async function abortRebase(git: GitRunner): Promise<void> {
  const res = await git.run(["rebase", "--abort"]);
  if (res.code !== 0) {
    throw new GitTaggedError("GitCommandFailed", res.stderr || "abort failed");
  }
}

export async function continueRebase(git: GitRunner): Promise<RebaseState> {
  const res = await git.run(["rebase", "--continue"]);
  return afterRebase(git, res);
}

export function rebaseConflictsEvent(state: RebaseState): {
  type: "rebase.conflicts";
  files: string[];
  inProgress: boolean;
} {
  return {
    type: "rebase.conflicts",
    files: state.conflictFiles,
    inProgress: state.inProgress,
  };
}
