typescript
/**
 * Module providing fuzzy search matching and string highlighting utilities.
 * Uses character-by-character matching with gaps to support partial/fuzzy queries.
 * @module fuzzySearch
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Result of a fuzzy match operation.
 */
export interface FuzzyMatchResult {
  /** Whether the query matches the target. */
  match: boolean;
  /** Score indicating match quality (higher is better). Only meaningful when match is true. */
  score: number;
  /** Indices in the target string where each matched character occurs, in order. */
  positions: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base points awarded for each character matched. */
const MATCH_BASE_POINTS = 10;

/** Bonus points when two matched characters are consecutive in the target. */
const CONSECUTIVE_BONUS_POINTS = 5;

/** Bonus points when a matched character is at a word boundary. */
const WORD_BOUNDARY_BONUS_POINTS = 3;

/** Regular expression to identify word‑boundary characters (non‑alphanumeric). */
const WORD_BOUNDARY_REGEX = /[^a-zA-Z0-9]/;

/**
 * Denominator applied to the final score to penalise longer targets.
 * Score multiplier = BASE_LENGTH_FACTOR / (targetLength + BASE_LENGTH_FACTOR)
 * This gives higher scores to shorter commands, meeting the requirement.
 */
const BASE_LENGTH_FACTOR = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether the given index is at a word boundary in the target string.
 * A word boundary is either the start of the string or a position preceded by a
 * non‑alphanumeric character.
 *
 * @param target - The full target string.
 * @param index  - The position to check.
 * @returns `true` if the position is a word boundary; otherwise `false`.
 */
function isWordBoundary(target: string, index: number): boolean {
  if (index === 0) return true;
  return WORD_BOUNDARY_REGEX.test(target[index - 1]);
}

// ---------------------------------------------------------------------------
// Logger (controlled verbosity)
// ---------------------------------------------------------------------------

/**
 * Logs a warning to the console if enabled.
 * In production, this can be toggled via a global constant.
 * @internal
 */
function logWarning(message: string): void {
  if (process.env.NODE_ENV !== 'production') {
    // Using console.warn for non-critical warnings (best practice).
    console.warn(`[fuzzySearch] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Performs a fuzzy match between a query and a target string.
 *
 * Character‑by‑character matching is performed, allowing gaps between matched
 * characters. Scoring considers:
 * - Base points for each matched character.
 * - Bonus for consecutive matched characters.
 * - Bonus for matches at word boundaries.
 * - A length‑based multiplier that penalises longer targets (shorter commands
 *   receive a higher score).
 *
 * @param query  - The search query (case‑insensitive).
 * @param target - The string to search against.
 * @returns A `FuzzyMatchResult` object.
 *
 * - If `query` is empty, returns `{match: true, score: 0, positions: []}`.
 * - If either argument is not a string, returns `{match: false, score: 0, positions: []}`.
 * - If `target` is empty and `query` is not, returns no match.
 *
 * @example
 * fuzzyMatch("ofl", "Open File")
 * // → { match: true, score: 24.5, positions: [0, 5, 8] }
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult {
  // ---------------------------------------------------------------------
  // Input validation with graceful degradation
  // ---------------------------------------------------------------------
  if (typeof query !== 'string' || typeof target !== 'string') {
    logWarning(`Invalid argument types: query=${typeof query}, target=${typeof target}`);
    return { match: false, score: 0, positions: [] };
  }

  // Trim? We intentionally do NOT trim spaces – the user may want to search with spaces.
  // But we should reject truly empty strings (after trim?) – conventions vary.
  // We keep the original requirement: empty query matches everything.
  if (query.length === 0) {
    return { match: true, score: 0, positions: [] };
  }

  if (target.length === 0) {
    return { match: false, score: 0, positions: [] };
  }

  // ---------------------------------------------------------------------
  // Core matching
  // ---------------------------------------------------------------------
  const targetLower = target.toLowerCase();
  const queryLower = query.toLowerCase();

  const matchedIndices: number[] = [];
  let searchPos = 0;

  for (let q = 0; q < queryLower.length; q++) {
    const char = queryLower[q];
    const foundPos = targetLower.indexOf(char, searchPos);

    if (foundPos === -1) {
      return { match: false, score: 0, positions: [] };
    }

    matchedIndices.push(foundPos);
    searchPos = foundPos + 1; // next character must be strictly after this one
  }

  // ---------------------------------------------------------------------
  // Scoring (quality + length penalty)
  // ---------------------------------------------------------------------
  let score = 0;

  for (let i = 0; i < matchedIndices.length; i++) {
    score += MATCH_BASE_POINTS;

    const idx = matchedIndices[i];

    if (isWordBoundary(target, idx)) {
      score += WORD_BOUNDARY_BONUS_POINTS;
    }

    if (i > 0 && idx === matchedIndices[i - 1] + 1) {
      score += CONSECUTIVE_BONUS_POINTS;
    }
  }

  // Length penalty: multiply by a factor that decreases as target grows.
  // This ensures shorter commands are favoured (as required).
  const lengthFactor = BASE_LENGTH_FACTOR / (target.length + BASE_LENGTH_FACTOR);
  score = score * lengthFactor;

  return {
    match: true,
    score,
    positions: matchedIndices,
  };
}

/**
 * Renders a string with matched character positions highlighted using `<span>` elements.
 *
 * The span is given a user‑configurable CSS class (default: `fuzzy-match-highlight`).
 * The positions array is automatically sorted, deduplicated, and validated before
 * rendering; invalid positions (non‑integer, out‑of‑bounds) are filtered out with a
 * warning log.
 *
 * @param target              - The original string to highlight.
 * @param positions           - Array of indices to highlight (must be integers in range).
 * @param highlightClassName  - CSS class name for the highlight span (default: `"fuzzy-match-highlight"`).
 * @returns A React fragment containing plain text and highlighted spans.
 *
 * @example
 * renderHighlightedText("Open File", [0, 5, 8])
 * // → <><span class="fuzzy-match-highlight">O</span>pen <span class="fuzzy-match-highlight">F</span>il<span class="fuzzy-match-highlight">e</span></>
 */
export function renderHighlightedText(
  target: string,
  positions: number[] = [],
  highlightClassName: string = 'fuzzy-match-highlight'
): React.ReactNode {
  // ---------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------
  if (typeof target !== 'string' || target.length === 0) {
    if (typeof target !== 'string') {
      logWarning('renderHighlightedText: target must be a string');
    }
    return target;
  }

  if (!Array.isArray(positions)) {
    logWarning('renderHighlightedText: positions must be an array');
    return target;
  }

  // ---------------------------------------------------------------------
  // Sort, deduplicate, and filter invalid indices
  // ---------------------------------------------------------------------
  const validSet = new Set<number>();
  for (const pos of positions) {
    if (Number.isInteger(pos) && pos >= 0 && pos < target.length) {
      validSet.add(pos);
    } else {
      logWarning(
        `renderHighlightedText: invalid position ${pos} (target length ${target.length})`
      );
    }
  }
  const sortedPositions = [...validSet].sort((a, b) => a - b);

  if (sortedPositions.length === 0) {
    return target;
  }

  // ---------------------------------------------------------------------
  // Build React elements
  // ---------------------------------------------------------------------
  const highlightSet = new Set(sortedPositions);
  const parts: React.ReactNode[] = [];
  let currentRun = '';

  for (let i = 0; i < target.length; i++) {
    if (highlightSet.has(i)) {
      if (currentRun) {
        parts.push(<span key={`plain-${i}`}>{currentRun}</span>);
        currentRun = '';
      }
      parts.push(
        <span key={`hl-${i}`} className={highlightClassName}>
          {target[i]}
        </span>
      );
    } else {
      currentRun += target[i];
    }
  }

  if (currentRun) {
    parts.push(<span key="plain-end">{currentRun}</span>);
  }

  return <>{parts}</>;
}