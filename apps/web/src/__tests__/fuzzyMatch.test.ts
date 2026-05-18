typescript
/**
 * Represents the result of a fuzzy match operation.
 */
export interface FuzzyMatchResult {
  /** Whether the query matched the target */
  match: boolean;
  /** A score representing match quality (higher is better) */
  score: number;
  /** Indices in the target string where query characters were matched (sorted ascending) */
  positions: readonly number[];
}

/**
 * Custom error for invalid inputs to fuzzy matching functions.
 */
export class FuzzyMatchInputError extends Error {
  /** @param message - Description of the error */
  constructor(message: string) {
    super(message);
    this.name = 'FuzzyMatchInputError';
  }
}

/**
 * Minimal structured logger for production. Replace with a real logging framework if needed.
 */
const logger = {
  debug: (message: string, ...args: unknown[]): void => {
    // Uncomment below for development debugging:
    // console.debug(`[FuzzyMatch] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(`[FuzzyMatch] ${message}`, ...args);
  },
};

/**
 * Checks if the given value is a valid non‑null string.
 * @param value - Value to check.
 * @returns `true` if `typeof value === 'string'`.
 */
const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Computes the set of indices that are at word boundaries in the target string.
 * A word boundary is either the start of the string (index 0) or a position right after
 * a word separator character (space, underscore, hyphen, dot, slash, backslash).
 *
 * @param target - The string to analyse.
 * @returns A `Set<number>` of indices that lie on word boundaries.
 */
function computeWordBoundaries(target: string): Set<number> {
  const boundaries = new Set<number>();
  const separatorRegex = /[\s_\-/.\\]/;
  let inSeparator = true;  // start of string is a boundary

  for (let i = 0; i < target.length; i++) {
    if (inSeparator) {
      boundaries.add(i);
      inSeparator = false;
    }
    if (separatorRegex.test(target[i])) {
      inSeparator = true;
    }
  }
  return boundaries;
}

/**
 * Performs a case‑insensitive fuzzy match on a target string.
 *
 * Characters of the query are matched in order against the target, allowing
 * gaps between them. The function returns a score that rewards:
 *  - Consecutive matched characters (higher bonus)
 *  - Matches at word boundaries (after spaces, underscores, hyphens, or start)
 *  - Shorter target strings (favors precision).
 *
 * @param query  - The search string (e.g. user input). Must be a non‑empty string.
 * @param target - The string to search against. Must be a non‑null string.
 * @returns A {@link FuzzyMatchResult} with match flag, score, and positions.
 * @throws {FuzzyMatchInputError} If either argument is not a string.
 *
 * @example
 * const result = fuzzyMatch('ofl', 'Open File');
 * // => { match: true, score: 8.25, positions: [0, 5, 7] }
 */
export function fuzzyMatch(query: unknown, target: unknown): FuzzyMatchResult {
  // ---- Input validation ----
  if (!isString(query)) {
    throw new FuzzyMatchInputError(
      `fuzzyMatch: expected query to be a string, got ${typeof query}`,
    );
  }
  if (!isString(target)) {
    throw new FuzzyMatchInputError(
      `fuzzyMatch: expected target to be a string, got ${typeof target}`,
    );
  }

  // ---- Edge cases ----
  if (query.length === 0) {
    logger.debug('fuzzyMatch: empty query – returning match with score 0');
    return { match: true, score: 0, positions: [] };
  }
  if (query.length > target.length) {
    logger.debug('fuzzyMatch: query longer than target – no match');
    return { match: false, score: 0, positions: [] };
  }

  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const targetLen = target.length;
  const queryLen = query.length;

  // ---- Character matching (greedy, left‑to‑right) ----
  const positions: number[] = [];
  let targetIdx = 0;

  for (let qi = 0; qi < queryLen; qi++) {
    const ch = lowerQuery[qi];
    // Find next occurrence in target starting from targetIdx
    const foundAt = lowerTarget.indexOf(ch, targetIdx);
    if (foundAt === -1) {
      logger.debug(
        `fuzzyMatch: query character '${query[qi]}' not found after index ${targetIdx} – returning no match`,
      );
      return { match: false, score: 0, positions: [] };
    }
    positions.push(foundAt);
    targetIdx = foundAt + 1;
  }

  // ---- Scoring ----
  const wordBoundaries = computeWordBoundaries(target);

  let score = 0;
  const consecutiveBonus = 10;
  const wordBoundaryBonus = 5;
  const lengthPenaltyFactor = 1.5; // penalises longer targets

  let consecutiveCount = 0;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];

    // Word‑boundary bonus
    if (wordBoundaries.has(pos)) {
      score += wordBoundaryBonus;
    }

    // Consecutive matches: bonus increases with run length
    if (i > 0 && positions[i] === positions[i - 1] + 1) {
      consecutiveCount++;
    } else {
      consecutiveCount = 0;
    }
    if (consecutiveCount > 0) {
      score += consecutiveCount * consecutiveBonus;
    }

    // Base match point (every matched character contributes)
    score += 1;
  }

  // Length penalty: reward matches in shorter targets
  const extraLength = Math.max(targetLen - queryLen, 0);
  score -= extraLength / lengthPenaltyFactor;

  // Ensure non‑negative score (lower bound is 0)
  if (score < 0) {
    score = 0;
  }

  logger.debug(
    `fuzzyMatch: query="${query}", target="${target}" -> score=${score}, positions=[${positions}]`,
  );

  return { match: true, score, positions: Object.freeze([...positions]) };
}

/**
 * A scored item returned by {@link fuzzySearch}.
 * @template T - The original item type.
 */
export interface ScoredItem<T> {
  /** The original item that matched */
  item: T;
  /** The score from the fuzzy match (higher is better) */
  score: number;
  /** Positions where query characters matched in `getString(item)` */
  positions: readonly number[];
}

/**
 * Filters an array of items using fuzzy matching on a string extracted from each item,
 * then sorts the results by score descending (best matches first).
 *
 * @param query    - The search string. Must be a string.
 * @param items    - Array of items to search through.
 * @param getString - Function that returns the string to match against for each item.
 * @returns An array of {@link ScoredItem} sorted by score descending. Items that don't
 *          match are omitted.
 * @throws {FuzzyMatchInputError} If `query` is not a string or `items` is not an array.
 *
 * @example
 * const commands = [{name: 'Open File'}, {name: 'Close File'}, {name: 'Save'}];
 * const results = fuzzySearch('ofl', commands, cmd => cmd.name);
 * // results[0].item => {name: 'Open File'} with score > 0
 */
export function fuzzySearch<T>(
  query: unknown,
  items: T[],
  getString: (item: T) => string,
): ScoredItem<T>[] {
  // ---- Input validation ----
  if (!isString(query)) {
    throw new FuzzyMatchInputError(
      `fuzzySearch: expected query to be a string, got ${typeof query}`,
    );
  }
  if (!Array.isArray(items)) {
    throw new FuzzyMatchInputError(
      `fuzzySearch: expected items to be an array, got ${typeof items}`,
    );
  }

  // Handle empty query: return all items with score 0 (preserve original order)
  if (query.length === 0) {
    logger.debug('fuzzySearch: empty query – returning all items with score 0');
    return items.map((item) => ({
      item,
      score: 0,
      positions: [],
    }));
  }

  // ---- Filter and score ----
  const results: ScoredItem<T>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const target = getString(item);
    if (!isString(target)) {
      logger.warn(
        `fuzzySearch: getString returned non-string at index ${i}, skipping – value type: ${typeof target}`,
      );
      continue; // skip invalid entries gracefully
    }

    const result = fuzzyMatch(query, target);
    if (result.match) {
      results.push({ item, score: result.score, positions: result.positions });
    }
  }

  // ---- Sort by score descending; stable sort preserves relative order for ties ----
  results.sort((a, b) => b.score - a.score);

  logger.debug(
    `fuzzySearch: query="${query}", returned ${results.length} results`,
  );

  return results;
}