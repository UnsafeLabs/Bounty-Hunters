import {
  buildMatcher,
  pageHits,
  searchDocuments,
  type SearchDocument,
} from "./GlobalSearch.logic.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const docs: SearchDocument[] = [
  { source: "chat", id: "c1", title: "Thread A", body: "hello world payment BTC" },
  { source: "file", id: "f1", title: "readme.md", body: "line1\npayment setup\nline3", meta: { line: "2" } },
  { source: "git", id: "g1", title: "abc123", body: "fix payment flow", meta: { author: "me", date: "2026-07-20" } },
];

const empty = searchDocuments(docs, "");
assert(empty.hits.length === 0, "empty clears");

const r = searchDocuments(docs, "payment");
assert(r.hits.length === 3, "all sources");
assert(r.groups.chat.length === 1 && r.groups.file.length === 1 && r.groups.git.length === 1, "grouped");
assert(r.hits[0]!.highlightedPreview.includes("<mark>"), "highlight");

const reBad = searchDocuments(docs, "(", { regex: true });
assert(reBad.error, "bad regex");

const reOk = searchDocuments(docs, "pay.*BTC", { regex: true });
assert(reOk.hits.some((h) => h.source === "chat"), "regex ok");

const page = pageHits(r.hits, 0, 2);
assert(page.length === 2, "page");

const m = buildMatcher("x", { caseSensitive: true });
assert(m.ok && m.test("x") && !m.test("X"), "case");

console.log("GlobalSearch logic tests: all passed");
