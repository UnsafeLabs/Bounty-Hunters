import { describe, it, expect } from "vitest";
import {
  parseCodeBlockMeta,
  detectLanguage,
  shouldShowCopyButton,
  getCollapsedPreview,
  addLineNumbers,
  isInlineCode,
} from "./CodeBlockRenderer.ts";

describe("parseCodeBlockMeta", () => {
  it("returns correct meta for short code block", () => {
    const code = "const a = 1;\nconst b = 2;";
    const meta = parseCodeBlockMeta(code, "typescript");

    expect(meta.lineCount).toBe(2);
    expect(meta.shouldCollapse).toBe(false);
    expect(meta.language).toBe("typescript");
  });

  it("collapses long code blocks", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const code = lines.join("\n");
    const meta = parseCodeBlockMeta(code, null);

    expect(meta.lineCount).toBe(30);
    expect(meta.shouldCollapse).toBe(true);
    expect(meta.collapsedLines).toBe(10);
  });

  it("handles empty language hint", () => {
    const meta = parseCodeBlockMeta("hello", "");
    expect(meta.language).toBe("");
  });
});

describe("detectLanguage", () => {
  it("uses language hint when provided", () => {
    expect(detectLanguage("any code", "python")).toBe("python");
  });

  it("detects Python from syntax", () => {
    expect(detectLanguage("def hello():\n    pass", null)).toBe("python");
  });

  it("detects TypeScript imports", () => {
    expect(detectLanguage("import React from 'react'", null)).toBe("typescript");
  });

  it("detects JSON", () => {
    expect(detectLanguage('{"name": "test"}', null)).toBe("json");
  });

  it("detects SQL", () => {
    expect(detectLanguage("SELECT * FROM users", null)).toBe("sql");
  });

  it("returns null for unrecognized code", () => {
    expect(detectLanguage("x = 42", null)).toBeNull();
  });
});

describe("shouldShowCopyButton", () => {
  it("shows for non-empty code", () => {
    expect(shouldShowCopyButton("hello")).toBe(true);
  });

  it("hides for empty code", () => {
    expect(shouldShowCopyButton("   ")).toBe(false);
  });
});

describe("getCollapsedPreview", () => {
  it("returns first 10 lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const code = lines.join("\n");
    const preview = getCollapsedPreview(code);

    const previewLines = preview.split("\n");
    expect(previewLines.length).toBe(10);
  });
});

describe("addLineNumbers", () => {
  it("adds line numbers", () => {
    const result = addLineNumbers("a\nb\nc");
    expect(result).toBe("1  a\n2  b\n3  c");
  });

  it("pads line numbers", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const result = addLineNumbers(lines.join("\n"));
    expect(result).toContain(" 1  line 0");
    expect(result).toContain("10  line 9");
  });
});

describe("isInlineCode", () => {
  it("detects inline code", () => {
    expect(isInlineCode("`code`")).toBe(true);
  });

  it("detects multi-line as not inline", () => {
    expect(isInlineCode("```\ncode\n```")).toBe(false);
  });
});
