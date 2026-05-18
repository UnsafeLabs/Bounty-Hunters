tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ----------------------------------------------------------------------------
// Types & Interfaces
// ----------------------------------------------------------------------------

/** Represents a registered command in the palette. */
interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string; // e.g., "Ctrl+P"
  action: () => void;
}

/** Result of a fuzzy match operation, including score and match indices. */
interface FuzzyMatchResult {
  command: Command;
  score: number;
  matchIndices: number[];
}

/** Props for the CommandPalette component. */
interface CommandPaletteProps {
  commands: Command[];
  placeholderText?: string;
  emptyMessage?: string;
  onClose?: () => void;
}

// ----------------------------------------------------------------------------
// Constants & Logger
// ----------------------------------------------------------------------------

const WORD_BOUNDARY_REGEX = /[\s_-]/;

/**
 * Simple structured logger that respects environment.
 * In production, only error messages are emitted.
 */
const logger = {
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV === "development") {
      console.debug(`[CommandPalette] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[CommandPalette] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[CommandPalette] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`[CommandPalette] ${message}`, ...args);
  },
};

// ----------------------------------------------------------------------------
// Core Fuzzy Matching Functions (exported for reuse)
// ----------------------------------------------------------------------------

/**
 * Performs character‑by‑character fuzzy matching between `query` and `target`.
 *
 * The algorithm scans `target` once, trying to match each character of `query`
 * sequentially. Characters are matched case‑insensitively. Gaps are allowed.
 *
 * @param query  – The search string (non‑empty).
 * @param target – The string to search within.
 * @returns An array of indices in `target` where matched characters occur,
 *          or `null` if no complete match is found.
 *
 * @example
 * fuzzyMatchIndices("ofl", "Open File") // returns [0, 5, 8]
 * fuzzyMatchIndices("abc", "def")       // returns null
 */
export function fuzzyMatchIndices(
  query: string,
  target: string,
): number[] | null {
  if (typeof query !== "string" || typeof target !== "string") {
    logger.warn(
      `fuzzyMatchIndices: arguments must be strings. Query: ${query}, Target: ${target}`,
    );
    return null;
  }

  const ql = query.length;
  const tl = target.length;

  if (ql === 0) {
    logger.debug("fuzzyMatchIndices: empty query returns empty array.");
    return [];
  }

  // Cannot possibly match if query is longer than target
  if (ql > tl) {
    logger.debug(
      `fuzzyMatchIndices: query (${ql}) longer than target (${tl}), returning null.`,
    );
    return null;
  }

  const indices: number[] = [];
  let qi = 0; // index in query
  let ti = 0; // index in target

  while (qi < ql && ti < tl) {
    const qc = query[qi]!.toLowerCase();
    const tc = target[ti]!.toLowerCase();

    if (qc === tc) {
      indices.push(ti);
      qi++;
    }
    ti++;
  }

  // If we consumed all query characters, we have a full match
  if (qi === ql) {
    logger.debug(
      `fuzzyMatchIndices: found match for "${query}" in "${target}" at indices [${indices}]`,
    );
    return indices;
  }

  logger.debug(
    `fuzzyMatchIndices: no complete match for "${query}" in "${target}"`,
  );
  return null;
}

/**
 * Calculates a relevance score for a successful fuzzy match.
 *
 * Scoring heuristics:
 * - Consecutive matches → +2 per consecutive pair (after the first of the pair)
 * - Word boundary matches → +5 per boundary (character preceded by space, underscore, hyphen)
 * - Match starting at index 0 → +10 (one‑time bonus)
 * - Shorter commands → higher score via `1 / sqrt(length)` factor
 *
 * @param matchIndices – Indices in `target` where matched characters lie.
 * @param target       – The original target string (used for length and boundaries).
 * @returns A numeric score (higher = better match).
 */
export function calculateScore(
  matchIndices: number[],
  target: string,
): number {
  if (!Array.isArray(matchIndices) || matchIndices.length === 0) {
    logger.debug("calculateScore: empty matchIndices, returning 0.");
    return 0;
  }

  if (typeof target !== "string" || target.length === 0) {
    logger.warn("calculateScore: invalid target string, returning 0.");
    return 0;
  }

  const len = target.length;
  let score = 0;
  let consecutiveCount = 1;
  let lastIndex = -1;

  // Cache word boundary checks to avoid repeated regex calls
  const precomputedBoundary = new Array<boolean>(len);
  precomputedBoundary[0] = true; // first character is always word boundary
  for (let i = 1; i < len; i++) {
    precomputedBoundary[i] = WORD_BOUNDARY_REGEX.test(target[i - 1]!);
  }

  for (const idx of matchIndices) {
    // Validate index bounds
    if (typeof idx !== "number" || idx < 0 || idx >= len) {
      logger.warn(
        `calculateScore: invalid index ${idx} in matchIndices, skipping.`,
      );
      continue;
    }

    // Consecutive match bonus
    if (lastIndex !== -1 && idx === lastIndex + 1) {
      consecutiveCount++;
      if (consecutiveCount >= 2) {
        score += 2; // bonus for each consecutive pair after the first
      }
    } else {
      consecutiveCount = 1;
    }

    // Word boundary match bonus
    if (precomputedBoundary[idx]) {
      score += 5;
    }

    lastIndex = idx;
  }

  // Starting match bonus (only once, for the very first matched character)
  if (matchIndices.length > 0 && matchIndices[0] === 0) {
    score += 10;
  }

  // Shorter commands get a boost
  score += (1 / Math.sqrt(len)) * 10;

  logger.debug(
    `calculateScore: matchIndices=[${matchIndices}], target="${target}", score=${score.toFixed(2)}`,
  );
  return score;
}

/**
 * Main fuzzy matching entry point.
 *
 * If `query` is empty, returns `null` – the caller should handle that case
 * separately to show all commands unfiltered.
 *
 * @param query  – The search string.
 * @param target – The target string to search.
 * @returns A `FuzzyMatchResult` if a match is found, otherwise `null`.
 */
export function fuzzyMatch(
  query: string,
  target: string,
): FuzzyMatchResult | null {
  if (typeof query !== "string" || typeof target !== "string") {
    logger.warn(
      `fuzzyMatch: arguments must be strings. Query: ${query}, Target: ${target}`,
    );
    return null;
  }

  if (query.length === 0) {
    logger.debug("fuzzyMatch: empty query, returning null (caller handles).");
    return null;
  }

  const indices = fuzzyMatchIndices(query, target);
  if (indices === null) {
    return null;
  }

  const score = calculateScore(indices, target);

  // Return a stub Command – the actual Command object is merged in the component.
  return {
    command: { id: "", label: "", action: () => {} } as Command,
    score,
    matchIndices: indices,
  };
}

// ----------------------------------------------------------------------------
// Component Helpers
// ----------------------------------------------------------------------------

/**
 * Renders a command label with matched characters wrapped in `<span>` elements
 * that have the CSS class `fuzzy-match-highlight`.
 *
 * @param label   – The original command label.
 * @param indices – Array of character indices to highlight.
 * @returns An array of React nodes for rendering.
 */
function renderHighlightedLabel(
  label: string,
  indices: number[],
): React.ReactNode {
  if (typeof label !== "string") {
    logger.warn(
      `renderHighlightedLabel: label must be a string, got ${typeof label}`,
    );
    return String(label);
  }

  // If no indices or empty, return plain text
  if (!Array.isArray(indices) || indices.length === 0) {
    return label;
  }

  // Filter out-of-bounds and non-integer indices, then sort ascending
  const validIndices = indices
    .filter(
      (idx) => Number.isInteger(idx) && idx >= 0 && idx < label.length,
    )
    .sort((a, b) => a - b);

  if (validIndices.length === 0) {
    logger.debug(
      `renderHighlightedLabel: no valid indices for label "${label}", returning raw.`,
    );
    return label;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const idx of validIndices) {
    if (idx < lastIndex) continue; // safety: skip duplicates if any

    // Text before the matched character
    if (idx > lastIndex) {
      parts.push(label.slice(lastIndex, idx));
    }

    // Highlighted character
    parts.push(
      <span key={idx} className="fuzzy-match-highlight">
        {label[idx]}
      </span>,
    );
    lastIndex = idx + 1;
  }

  // Text after the last matched character
  if (lastIndex < label.length) {
    parts.push(label.slice(lastIndex));
  }

  return parts;
}

// ----------------------------------------------------------------------------
// CommandPalette Component
// ----------------------------------------------------------------------------

/**
 * CommandPalette – a searchable command palette with fuzzy matching.
 *
 * Features:
 * - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 * - Real‑time fuzzy filtering with score‑based sorting
 * - Highlighted matched characters
 * - Empty query shows all commands in default order
 * - Supports Command.shortcut display
 * - Accessible (ARIA attributes)
 *
 * @example
 *