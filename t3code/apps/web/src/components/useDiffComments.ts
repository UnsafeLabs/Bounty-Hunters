/**
 * Inline commenting on diff lines in DiffPanelShell.
 * Adds click handlers and comment storage for code review.
 */

import { useState, useCallback, useRef, useEffect } from "react";

interface DiffComment {
  id: string;
  filePath: string;
  line: number;
  side: "left" | "right";
  content: string;
  author: string;
  createdAt: number;
  resolved: boolean;
}

interface DiffLine {
  type: "added" | "removed" | "context" | "header";
  leftLine?: number;
  rightLine?: number;
  content: string;
}

interface UseDiffCommentsOptions {
  filePath: string;
  initialComments?: DiffComment[];
  onCommentAdded?: (comment: DiffComment) => void;
  onCommentResolved?: (commentId: string) => void;
}

/**
 * Hook for managing inline diff comments.
 */
export function useDiffComments(options: UseDiffCommentsOptions) {
  const { filePath, initialComments = [], onCommentAdded, onCommentResolved } = options;
  const [comments, setComments] = useState<DiffComment[]>(initialComments);
  const [activeLine, setActiveLine] = useState<{ line: number; side: "left" | "right" } | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  /**
   * Handle click on a diff line to open comment box.
   */
  const handleLineClick = useCallback((line: number, side: "left" | "right") => {
    setActiveLine({ line, side });
    setIsComposing(true);
  }, []);

  /**
   * Submit a new comment.
   */
  const submitComment = useCallback(
    (content: string, author: string = "user") => {
      if (!activeLine || !content.trim()) return;

      const comment: DiffComment = {
        id: crypto.randomUUID(),
        filePath,
        line: activeLine.line,
        side: activeLine.side,
        content: content.trim(),
        author,
        createdAt: Date.now(),
        resolved: false,
      };

      setComments((prev) => [...prev, comment]);
      setIsComposing(false);
      setActiveLine(null);
      onCommentAdded?.(comment);
    },
    [activeLine, filePath, onCommentAdded]
  );

  /**
   * Cancel comment composition.
   */
  const cancelComment = useCallback(() => {
    setIsComposing(false);
    setActiveLine(null);
  }, []);

  /**
   * Resolve a comment.
   */
  const resolveComment = useCallback(
    (commentId: string) => {
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c))
      );
      onCommentResolved?.(commentId);
    },
    [onCommentResolved]
  );

  /**
   * Delete a comment.
   */
  const deleteComment = useCallback((commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }, []);

  /**
   * Get comments for a specific line.
   */
  const getCommentsForLine = useCallback(
    (line: number, side: "left" | "right") => {
      return comments.filter(
        (c) => c.line === line && c.side === side && c.filePath === filePath
      );
    },
    [comments, filePath]
  );

  /**
   * Get comment count per line for gutter indicators.
   */
  const getCommentCounts = useCallback(() => {
    const counts: Record<string, number> = {};
    for (const comment of comments) {
      if (comment.filePath === filePath && !comment.resolved) {
        const key = `${comment.side}-${comment.line}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }, [comments, filePath]);

  return {
    comments,
    activeLine,
    isComposing,
    handleLineClick,
    submitComment,
    cancelComment,
    resolveComment,
    deleteComment,
    getCommentsForLine,
    getCommentCounts,
  };
}
