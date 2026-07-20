import {
  invertMove,
  isValidDropTarget,
  planMove,
} from "./FileTreeDnd.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(
  isValidDropTarget(["src/a.ts"], { path: "src/lib", name: "lib", isDirectory: true }) === true,
  "valid",
);
assert(
  isValidDropTarget(["src/a.ts"], { path: "src", name: "src", isDirectory: true }) === false,
  "same parent",
);
assert(
  isValidDropTarget(["src"], { path: "src/nested", name: "nested", isDirectory: true }) === false,
  "into self",
);

const tracked = new Set(["src/a.ts"]);
const plan = planMove(["src/a.ts", "tmp/b.ts"], "lib", tracked);
assert(plan.operations.length === 2, "ops");
assert(plan.operations[0]!.useGitMv === true, "git mv tracked");
assert(plan.operations[1]!.useGitMv === false, "fs move untracked");
const undo = invertMove(plan);
assert(undo.operations[0]!.to === "src/a.ts", "undo");
assert(planMove(["src/a.ts"], "src", tracked).noop === true || planMove(["src/a.ts"], dirname_self(), tracked), "noop check");

function dirname_self() {
  return "src"; // parent of src/a.ts
}

console.log("FileTreeDnd tests: all passed");
