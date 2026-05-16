import type { DiffLineAnnotation } from "@pierre/diffs";

export type DiffCommentSide = "deletions" | "additions";

export interface DiffInlineComment {
  readonly key: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly side: DiffCommentSide;
  readonly body: string;
  readonly collapsed: boolean;
  readonly createdAt: string;
}

export interface DiffCommentEditor {
  readonly key: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly side: DiffCommentSide;
  readonly draft: string;
}

export type DiffCommentAnnotationMetadata =
  | {
      readonly kind: "comment";
      readonly comment: DiffInlineComment;
    }
  | {
      readonly kind: "editor";
      readonly editor: DiffCommentEditor;
    };

const diffCommentSessionStore = new Map<string, Record<string, DiffInlineComment>>();

export function buildDiffCommentKey(input: {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly side: DiffCommentSide;
}): string {
  return `${input.filePath}:${input.side}:${input.lineNumber}`;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function buildDiffCommentResetKey(input: {
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly patch: string | undefined;
}): string {
  return `${input.threadId ?? "no-thread"}:${input.turnId ?? "conversation"}:${hashString(input.patch ?? "")}`;
}

export function readDiffCommentSession(
  resetKey: string,
): Record<string, DiffInlineComment> {
  return { ...(diffCommentSessionStore.get(resetKey) ?? {}) };
}

export function writeDiffCommentSession(
  resetKey: string,
  commentsByKey: Readonly<Record<string, DiffInlineComment>>,
): void {
  if (Object.keys(commentsByKey).length === 0) {
    diffCommentSessionStore.delete(resetKey);
    return;
  }
  diffCommentSessionStore.set(resetKey, { ...commentsByKey });
}

export function clearDiffCommentSessionsForTests(): void {
  diffCommentSessionStore.clear();
}

export function countPendingDiffComments(
  commentsByKey: Readonly<Record<string, DiffInlineComment>>,
): number {
  return Object.values(commentsByKey).filter((comment) => comment.body.trim().length > 0).length;
}

export function buildDiffCommentAnnotations(input: {
  readonly filePath: string;
  readonly commentsByKey: Readonly<Record<string, DiffInlineComment>>;
  readonly activeEditor: DiffCommentEditor | null;
}): Array<DiffLineAnnotation<DiffCommentAnnotationMetadata>> {
  const annotations: Array<DiffLineAnnotation<DiffCommentAnnotationMetadata>> = [];

  for (const comment of Object.values(input.commentsByKey)) {
    if (comment.filePath !== input.filePath || comment.key === input.activeEditor?.key) {
      continue;
    }
    annotations.push({
      side: comment.side,
      lineNumber: comment.lineNumber,
      metadata: {
        kind: "comment",
        comment,
      },
    });
  }

  if (input.activeEditor?.filePath === input.filePath) {
    annotations.push({
      side: input.activeEditor.side,
      lineNumber: input.activeEditor.lineNumber,
      metadata: {
        kind: "editor",
        editor: input.activeEditor,
      },
    });
  }

  return annotations.toSorted((left, right) => {
    if (left.lineNumber !== right.lineNumber) {
      return left.lineNumber - right.lineNumber;
    }
    return left.side.localeCompare(right.side);
  });
}
