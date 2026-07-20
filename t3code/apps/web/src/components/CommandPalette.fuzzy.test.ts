import { fuzzyFilter, fuzzyMatch } from "./CommandPalette.fuzzy.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const m = fuzzyMatch("ofl", "Open File");
assert(m !== null, "match ofl");
assert(m!.indices.length === 3, "3 indices");
assert(m!.highlighted.includes("fuzzy-match"), "highlight");

const cmds = ["Open File", "Open Folder", "Close File", "Save", "Quit App", "Format Document"];
const filtered = fuzzyFilter("ofl", cmds);
assert(filtered[0]!.text === "Open File" || filtered[0]!.text.includes("Open"), "best first");
assert(fuzzyFilter("", cmds).length === cmds.length, "empty shows all");
assert(fuzzyFilter("s", cmds).some((r) => r.text === "Save"), "single char");

// 200 commands perf sanity
const many = Array.from({ length: 200 }, (_, i) => `Command Number ${i} Action`);
const t0 = Date.now();
fuzzyFilter("cna", many);
assert(Date.now() - t0 < 200, "perf");

console.log("CommandPalette fuzzy tests: all passed");
