import { describe, expect, it } from "vitest";

import {
  buildDiffCommentAnnotations,
  buildDiffCommentKey,
  countPendingDiffComments,
  type DiffInlineComment,
} from "./DiffPanelComments.logic";

describe("DiffPanelComments logic", () => {
  it("builds stable keys that distinguish side and line", () => {
    expect(
      buildDiffCommentKey({
        filePath: "src/app.ts",
        side: "additions",
        lineNumber: 12,
      }),
    ).toBe("src/app.ts:additions:12");
    expect(
      buildDiffCommentKey({
        filePath: "src/app.ts",
        side: "deletions",
        lineNumber: 12,
      }),
    ).toBe("src/app.ts:deletions:12");
  });

  it("counts only non-empty pending comments", () => {
    const commentsByKey: Record<string, DiffInlineComment> = {
      one: {
        key: "one",
        filePath: "src/app.ts",
        side: "additions",
        lineNumber: 1,
        body: "Looks good",
        collapsed: false,
        createdAt: "2026-05-16T03:30:00.000Z",
      },
      empty: {
        key: "empty",
        filePath: "src/app.ts",
        side: "additions",
        lineNumber: 2,
        body: "   ",
        collapsed: false,
        createdAt: "2026-05-16T03:31:00.000Z",
      },
    };

    expect(countPendingDiffComments(commentsByKey)).toBe(1);
  });

  it("builds annotations for one file and replaces a saved comment with the active editor", () => {
    const commentsByKey: Record<string, DiffInlineComment> = {
      "src/app.ts:additions:7": {
        key: "src/app.ts:additions:7",
        filePath: "src/app.ts",
        side: "additions",
        lineNumber: 7,
        body: "Use the shared helper here.",
        collapsed: false,
        createdAt: "2026-05-16T03:30:00.000Z",
      },
      "src/other.ts:additions:1": {
        key: "src/other.ts:additions:1",
        filePath: "src/other.ts",
        side: "additions",
        lineNumber: 1,
        body: "Other file",
        collapsed: false,
        createdAt: "2026-05-16T03:31:00.000Z",
      },
    };

    const annotations = buildDiffCommentAnnotations({
      filePath: "src/app.ts",
      commentsByKey,
      activeEditor: {
        key: "src/app.ts:additions:7",
        filePath: "src/app.ts",
        side: "additions",
        lineNumber: 7,
        draft: "Edited body",
      },
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      side: "additions",
      lineNumber: 7,
      metadata: {
        kind: "editor",
        editor: {
          draft: "Edited body",
        },
      },
    });
  });
});
