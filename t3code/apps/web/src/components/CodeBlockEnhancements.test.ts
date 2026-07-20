import {
  COLLAPSE_LINE_THRESHOLD,
  COLLAPSE_PREVIEW_LINES,
  buildCodeBlock,
  copyPayload,
  detectLanguage,
  expandCodeBlock,
  highlightCode,
} from "./CodeBlockEnhancements.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(detectLanguage("const x = 1") === "js" || detectLanguage("const x = 1") === "ts", "detect js");
assert(detectLanguage("def foo():\n  pass") === "py", "detect py");
assert(detectLanguage("x", "TypeScript") === "ts", "hint");

const short = buildCodeBlock("const a = 1;\nconst b = 2;", "ts");
assert(short.collapsed === false, "short open");
assert(short.highlightedHtml.includes("tok-kw"), "highlight");
assert(copyPayload(short) === "const a = 1;\nconst b = 2;", "copy exact");

const longCode = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
const long = buildCodeBlock(longCode, "txt");
assert(long.lines.length === 25 && long.collapsed === true, "collapse");
assert(COLLAPSE_LINE_THRESHOLD === 20 && COLLAPSE_PREVIEW_LINES === 10, "consts");
const expanded = expandCodeBlock(long);
assert(expanded.collapsed === false, "expanded");
assert(highlightCode("return 1", "ts").includes("tok-kw"), "return kw");

// inline not affected: we only process fenced blocks via buildCodeBlock
console.log("CodeBlockEnhancements tests: all passed");
