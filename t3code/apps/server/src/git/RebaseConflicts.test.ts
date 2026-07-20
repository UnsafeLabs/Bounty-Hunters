import {
  GitTaggedError,
  afterRebase,
  detectRebaseInProgress,
  getConflictFiles,
  rebaseConflictsEvent,
  type GitRunner,
} from "./RebaseConflicts.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

function mockGit(opts: {
  rebaseHead?: boolean;
  conflicts?: string[];
  rebaseCode?: number;
}): GitRunner {
  return {
    async pathExists(rel) {
      return rel === ".git/REBASE_HEAD" && Boolean(opts.rebaseHead);
    },
    async run(args) {
      if (args[0] === "diff") {
        return { code: 0, stdout: (opts.conflicts ?? []).join("\n"), stderr: "" };
      }
      if (args[0] === "rebase") {
        return { code: opts.rebaseCode ?? 1, stdout: "", stderr: "conflict" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

const g = mockGit({ rebaseHead: true, conflicts: ["a.ts", "b.ts"], rebaseCode: 1 });
assert((await detectRebaseInProgress(g)) === true, "in progress");
assert((await getConflictFiles(g)).join() === "a.ts,b.ts", "files");
const state = await afterRebase(g, { code: 1, stderr: "conflict" });
assert(state.inProgress && state.conflictFiles.length === 2, "after");
const ev = rebaseConflictsEvent(state);
assert(ev.type === "rebase.conflicts" && ev.files.length === 2, "event");

const clean = mockGit({ rebaseHead: false, conflicts: [], rebaseCode: 0 });
const ok = await afterRebase(clean, { code: 0, stderr: "" });
assert(!ok.inProgress && ok.conflictFiles.length === 0, "clean");

console.log("RebaseConflicts tests: all passed");
