import { DiffCommentStore, shouldCloseOnEscape } from "./DiffInlineComments.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const s = new DiffCommentStore(() => 1000);
s.add("a.ts", 10, "looks wrong");
s.add("a.ts", 10, "second");
s.add("b.ts", 3, "ok");
assert(s.listForLine("a.ts", 10).length === 2, "multi same line");
assert(s.totalCount() === 3, "badge count");
s.setCollapsed(s.listForLine("b.ts", 3)[0]!.id, true);
assert(s.listForLine("b.ts", 3)[0]!.collapsed === true, "collapse");
const snap = s.toJSON();
const s2 = new DiffCommentStore();
s2.fromJSON(snap);
assert(s2.totalCount() === 3, "persist");
s.clearAll();
assert(s.totalCount() === 0, "clear on new commit");
assert(shouldCloseOnEscape(true) === true, "esc");

console.log("DiffInlineComments tests: all passed");
