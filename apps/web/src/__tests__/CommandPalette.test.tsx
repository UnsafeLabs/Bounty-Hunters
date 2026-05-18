typescript
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCommandPaletteStore } from '../stores/CommandPaletteStore';

// --------------------------------------------------------------------
// Types
// --------------------------------------------------------------------
interface Command {
  id: string;
  name: string;
  description?: string;
  category?: string;
  shortcut?: string;
  action: () => void;
}

/** A span of matched characters in the command name */
interface HighlightedSpan {
  start: number;
  end: number;
}

/** Result of a fuzzy match operation */
interface FuzzyMatchResult {
  matched: boolean;
  highlightRanges: HighlightedSpan[];
}

/** Internal representation with precomputed score and highlights */
interface ScoredCommand {
  command: Command;
  score: number;
  highlightRanges: HighlightedSpan[];
}

// --------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------
const MAX_COMMANDS = 200;
const DEBOUNCE_MS = 150;
const ERROR_MESSAGE = 'An error occurred while filtering commands.';
const NO_RESULTS_MESSAGE = 'No matching commands found.';
const LOG_PREFIX = '[CommandPalette]';

// --------------------------------------------------------------------
// Fuzzy Matching Algorithm
// --------------------------------------------------------------------

/**
 * Performs character‑by‑character fuzzy matching of `query` against `target`.
 * Allows gaps between matched letters. Returns the match result and the
 * spans to highlight.
 *
 * @param query - The search query (lowercased internally).
 * @param target - The command name to match against.
 * @returns A FuzzyMatchResult indicating success and highlight ranges.
 */
const fuzzyMatch = (query: string, target: string): FuzzyMatchResult => {
  if (!query) {
    return { matched: false, highlightRanges: [] };
  }

  const normalizedQuery = query.toLowerCase();
  const normalizedTarget = target.toLowerCase();
  const targetLen = normalizedTarget.length;
  const queryLen = normalizedQuery.length;

  if (queryLen > targetLen) {
    return { matched: false, highlightRanges: [] };
  }

  // Greedy matching – scan target from left to right
  const indices: number[] = [];
  let targetIdx = 0;
  for (let i = 0; i < queryLen; i++) {
    const char = normalizedQuery[i];
    // Find the next occurrence in target starting from targetIdx
    const foundIdx = normalizedTarget.indexOf(char, targetIdx);
    if (foundIdx === -1) {
      return { matched: false, highlightRanges: [] };
    }
    indices.push(foundIdx);
    targetIdx = foundIdx + 1;
  }

  // Convert indices to non‑overlapping highlight spans
  const highlightRanges: HighlightedSpan[] = [];
  let start = indices[0];
  let end = start + 1;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === end) {
      // consecutive characters – extend the span
      end++;
    } else {
      // gap – finalise current span, start new one
      highlightRanges.push({ start, end });
      start = indices[i];
      end = start + 1;
    }
  }
  // last span
  highlightRanges.push({ start, end });

  return { matched: true, highlightRanges };
};

// --------------------------------------------------------------------
// Scoring & Highlighting
// --------------------------------------------------------------------

/**
 * Computes a quality score for a fuzzy match result.
 * Higher consecutive matches, word‑boundary matches, shorter names,
 * and exact prefix matches yield a higher score.
 *
 * @param query - The search query (original case).
 * @param name - The full command name.
 * @param ranges - The highlight ranges from fuzzyMatch.
 * @returns A numeric score (higher = better match).
 */
const calculateScore = (
  query: string,
  name: string,
  ranges: HighlightedSpan[],
): number => {
  let score = 0;

  for (const range of ranges) {
    const length = range.end - range.start;
    // Consecutive matches are weighted heavily
    score += length * 10;

    // Bonus for matches at word boundaries
    const charBefore = range.start > 0 ? name[range.start - 1] : '';
    if (
      charBefore === ' ' ||
      (charBefore >= 'a' && charBefore <= 'z' && name[range.start] >= 'A' && name[range.start] <= 'Z')
    ) {
      score += 5;
    }
  }

  // Shorter commands are easier to match exactly, so give a small bonus
  score += Math.max(0, 50 - name.length);

  // Exact prefix match (case‑insensitive) rewards a lot
  if (name.toLowerCase().startsWith(query.toLowerCase())) {
    score += 20;
  }

  return score;
};

/**
 * Generates a React node with highlighted spans for matched characters.
 * The ranges are assumed to be sorted by start (as produced by fuzzyMatch).
 *
 * @param text - The original command name.
 * @param ranges - Array of HighlightedSpan objects (must be sorted by start).
 * @returns A React element with <span> tags for highlights.
 */
const highlightText = (
  text: string,
  ranges: HighlightedSpan[],
): React.ReactNode => {
  if (ranges.length === 0) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const range of ranges) {
    // Text before this highlight
    if (range.start > cursor) {
      parts.push(
        <React.Fragment key={`text-${cursor}`}>
          {text.slice(cursor, range.start)}
        </React.Fragment>,
      );
    }
    // The highlighted span
    if (range.end > range.start) {
      parts.push(
        <span
          key={`hl-${range.start}`}
          className="fuzzy-match-highlight"
          data-testid={`highlight-${range.start}`}
        >
          {text.slice(range.start, range.end)}
        </span>,
      );
    }
    cursor = range.end;
  }

  // Trailing text
  if (cursor < text.length) {
    parts.push(
      <React.Fragment key={`text-${cursor}`}>
        {text.slice(cursor)}
      </React.Fragment>,
    );
  }

  return <>{parts}</>;
};

// --------------------------------------------------------------------
// Main Component
// --------------------------------------------------------------------

const CommandPalette: React.FC = () => {
  const {
    isOpen,
    query,
    commands,
    setQuery,
    executeCommand,
    close,
    selectedIndex,
    setSelectedIndex,
  } = useCommandPaletteStore();

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const [scoredResults, setScoredResults] = useState<ScoredCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevQueryRef = useRef<string>('');

  // ------------------------------------------------------------------
  // Derived filtered list of Command objects (for rendering)
  // ------------------------------------------------------------------
  const filteredCommands: Command[] = useMemo(
    () => scoredResults.map((s) => s.command),
    [scoredResults],
  );

  // ------------------------------------------------------------------
  // Fuzzy filtering + scoring logic
  // ------------------------------------------------------------------

  /**
   * Performs fuzzy filtering and scoring on the command list.
   * Called inside the debounced effect.
   *
   * @param searchQuery - The current search string.
   * @returns An array of ScoredCommand, sorted by descending score.
   */
  const filterAndScoreCommands = useCallback(
    (searchQuery: string): ScoredCommand[] => {
      if (!searchQuery.trim()) {
        // Empty query: return all commands in original order with score 0
        return commands.slice(0, MAX_COMMANDS).map((cmd) => ({
          command: cmd,
          score: 0,
          highlightRanges: [],
        }));
      }

      const trimmedQuery = searchQuery.trim().slice(0, 64); // Limit query length
      const scored: ScoredCommand[] = [];

      for (let i = 0; i < commands.length && i < MAX_COMMANDS; i++) {
        const cmd = commands[i];
        try {
          const { matched, highlightRanges } = fuzzyMatch(trimmedQuery, cmd.name);
          if (matched) {
            const score = calculateScore(trimmedQuery, cmd.name, highlightRanges);
            scored.push({ command: cmd, score, highlightRanges });
          }
        } catch (err) {
          // Log error but continue processing other commands
          console.error(`${LOG_PREFIX} Fuzzy match error for "${cmd.name}":`, err);
          // Optionally include the command without highlights
          scored.push({ command: cmd, score: 0, highlightRanges: [] });
        }
      }

      // Sort by score descending; for equal scores, preserve original order
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return commands.indexOf(a.command) - commands.indexOf(b.command);
      });

      return scored;
    },
    [commands],
  );

  // ------------------------------------------------------------------
  // Debounced effect to recompute filtered results
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;

    const currentQuery = query ?? '';

    // Clear previous debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (currentQuery === prevQueryRef.current) {
      // Query unchanged – skip recomputation
      return;
    }

    setLoading(true);
    setError(null);

    debounceTimerRef.current = setTimeout(() => {
      try {
        const results = filterAndScoreCommands(currentQuery);
        setScoredResults(results);
        // Reset selection to 0 when results change
        if (results.length > 0) {
          setSelectedIndex(0);
        } else {
          setSelectedIndex(-1);
        }
        prevQueryRef.current = currentQuery;
      } catch (err) {
        console.error(`${LOG_PREFIX} Filtering error:`, err);
        setError(ERROR_MESSAGE);
        setScoredResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [isOpen, query, filterAndScoreCommands, setSelectedIndex]);

  // ------------------------------------------------------------------
  // Focus input when open
  // ------------------------------------------------------------------
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // ------------------------------------------------------------------
  // Keyboard navigation
  // ------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const listLength = filteredCommands.length;
      if (listLength === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((selectedIndex + 1) % listLength);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((selectedIndex - 1 + listLength) % listLength);
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < listLength) {
            executeCommand(filteredCommands[selectedIndex]);
            close();
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
        default:
          break;
      }
    },
    [filteredCommands, selectedIndex, setSelectedIndex, executeCommand, close],
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (!isOpen) return null;

  const showNoResults = !loading && !error && filteredCommands.length === 0;

  return (
    <div className="command-palette-overlay" onClick={close}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="listbox"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          type="text"
          value={query ?? ''}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands..."
          className="command-palette-input"
          aria-label="Command search"
        />
        {loading && <div className="command-palette-loading">Filtering…</div>}
        {error && <div className="command-palette-error">{error}</div>}
        {showNoResults && (
          <div className="command-palette-empty">{NO_RESULTS_MESSAGE}</div>
        )}
        {!loading && !error && filteredCommands.length > 0 && (
          <div className="command-palette-list" ref={listRef}>
            {scoredResults.map((sc, idx) => {
              const { command, highlightRanges } = sc;
              return (
                <div
                  key={command.id}
                  className={`command-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onClick={() => {
                    executeCommand(command);
                    close();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  role="option"
                  aria-selected={idx === selectedIndex}
                >
                  <span className="command-name">
                    {highlightText(command.name, highlightRanges)}
                  </span>
                  {command.category && (
                    <span className="command-category">{command.category}</span>
                  )}
                  {command.shortcut && (
                    <span className="command-shortcut">{command.shortcut}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommandPalette;