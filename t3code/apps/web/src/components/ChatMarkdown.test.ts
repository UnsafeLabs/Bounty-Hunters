import { describe, expect, it } from "vitest";

import { detectFenceLanguage, splitCodeLines } from "./ChatMarkdown";

describe("ChatMarkdown code block helpers", () => {
  it("detects common languages for unlabeled fenced code blocks", () => {
    expect(detectFenceLanguage('{"name":"t3code"}')).toBe("json");
    expect(detectFenceLanguage("const answer = 42;\nexport { answer };")).toBe("typescript");
    expect(detectFenceLanguage("def run():\n    return True")).toBe("python");
    expect(detectFenceLanguage("git status --short")).toBe("bash");
    expect(detectFenceLanguage("plain output with no obvious grammar")).toBe("text");
  });

  it("counts code block lines without treating a trailing newline as an extra blank line", () => {
    expect(splitCodeLines("one\ntwo\nthree\n")).toEqual(["one", "two", "three"]);
    expect(splitCodeLines("")).toEqual([""]);
  });
});
