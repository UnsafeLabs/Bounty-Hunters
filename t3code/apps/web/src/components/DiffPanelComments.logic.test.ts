import { beforeEach, describe, expect, it } from "vitest";

import {
  buildDiffCommentAnnotations,
  buildDiffCommentKey,
  buildDiffCommentResetKey,
  clearDiffCommentSessionsForTests,
  countPendingDiffComments,
  readDiffCommentSession,
  type DiffInlineComment,
  writeDiffCommentSession,
} from "./DiffPanelComments.logic";

describe("DiffPanelComments logic", () => {
  beforeEach(() => {
    clearDiffCommentSessionsForTests();
  });

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

  it("builds stable reset keys that are scoped to patch content", () => {
    const first = buildDiffCommentResetKey({
      threadId: "thread-1",
      turnId: "turn-1",
      patch: "diff --git a/src/app.ts b/src/app.ts\n+one",
    });
    const matching = buildDiffCommentResetKey({
      threadId: "thread-1",
      turnId: "turn-1",
      patch: "diff --git a/src/app.ts b/src/app.ts\n+one",
    });
    const changedPatch = buildDiffCommentResetKey({
      threadId: "thread-1",
      turnId: "turn-1",
      patch: "diff --git a/src/app.ts b/src/app.ts\n+two",
    });

    expect(first).toBe(matching);
    expect(first).not.toBe(changedPatch);
    expect(first).not.toContain("diff --git");
  });

  it("stores pending comments per reset key", () => {
    const resetKey = buildDiffCommentResetKey({
      threadId: "thread-1",
      turnId: "turn-1",
      patch: "patch-a",
    });
    const otherResetKey = buildDiffCommentResetKey({
      threadId: "thread-1",
      turnId: "turn-2",
      patch: "patch-a",
    });
    const comment: DiffInlineComment = {
      key: "src/app.ts:additions:7",
      filePath: "src/app.ts",
      side: "additions",
      lineNumber: 7,
      body: "Use the shared helper here.",
      collapsed: false,
      createdAt: "2026-05-16T03:30:00.000Z",
    };

    writeDiffCommentSession(resetKey, { [comment.key]: comment });

    expect(readDiffCommentSession(resetKey)).toEqual({ [comment.key]: comment });
    expect(readDiffCommentSession(otherResetKey)).toEqual({});
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

  it("sorts annotations by line number and side", () => {
    const commentsByKey: Record<string, DiffInlineComment> = {
      "src/app.ts:additions:10": {
        key: "src/app.ts:additions:10",
        filePath: "src/app.ts",
        side: "additions",
        lineNumber: 10,
        body: "Later",
        collapsed: false,
        createdAt: "2026-05-16T03:30:00.000Z",
      },
      "src/app.ts:deletions:2": {
        key: "src/app.ts:deletions:2",
        filePath: "src/app.ts",
        side: "deletions",
        lineNumber: 2,
        body: "Earlier",
        collapsed: false,
        createdAt: "2026-05-16T03:31:00.000Z",
      },
    };

    const annotations = buildDiffCommentAnnotations({
      filePath: "src/app.ts",
      commentsByKey,
      activeEditor: {
        key: "src/app.ts:additions:2",
        filePath: "src/app.ts",
        side: "additions",
        lineNumber: 2,
        draft: "Inline draft",
      },
    });

    expect(annotations.map((annotation) => `${annotation.lineNumber}:${annotation.side}`)).toEqual([
      "2:additions",
      "2:deletions",
      "10:additions",
    ]);
  });
});
