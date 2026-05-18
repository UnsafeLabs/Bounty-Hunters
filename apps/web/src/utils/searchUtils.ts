typescript
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { useHotkeys } from 'react-hotkeys-hook';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SearchSource = 'chat' | 'file' | 'git';

export interface SearchResult {
  source: SearchSource;
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResultGroup {
  source: SearchSource;
  count: number;
  items: SearchResult[];
}

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

export interface SearchQueryResult {
  groups: SearchResultGroup[];
  nextCursor: string | null;
}

export interface SearchOptions {
  query: string;
  useRegex: boolean;
  caseSensitive: boolean;
  cursor?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<SearchSource, string> = {
  chat: '💬',
  file: '📁',
  git: '🔀',
};

const SOURCE_LABELS: Record<SearchSource, string> = {
  chat: 'Chat Messages',
  file: 'Files',
  git: 'Git Commits',
};

const DEBOUNCE_DELAY = 250;
const REGEX_TIMEOUT_MS = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a regex pattern string.
 */
export function validateRegex(pattern: string): { valid: boolean; error?: string } {
  if (typeof pattern !== 'string') {
    return { valid: false, error: 'Pattern must be a string' };
  }
  if (!pattern.trim()) {
    return { valid: false, error: 'Pattern cannot be empty' };
  }
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown regex error';
    console.warn(`[GlobalSearch] Invalid regex pattern: "${pattern}" – ${message}`);
    return { valid: false, error: message };
  }
}

/**
 * Builds a RegExp from a search query string with safety timeout.
 */
export function buildSearchPattern(
  query: string,
  useRegex: boolean,
  caseSensitive: boolean
): RegExp {
  if (typeof query !== 'string') {
    throw new TypeError('Query must be a string');
  }
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Query cannot be empty');
  }

  const flags = caseSensitive ? 'g' : 'gi';

  if (useRegex) {
    // Validate before constructing
    const validation = validateRegex(trimmed);
    if (!validation.valid) {
      throw new SyntaxError(`Invalid regex: ${validation.error}`);
    }
    return new RegExp(trimmed, flags);
  }

  // Escape special characters for literal search
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, flags);
}

/**
 * Safe regex execution with timeout and iteration limit to prevent ReDoS.
 * Throws if execution takes too long or exceeds max matches.
 */
function safeRegexExec(
  regex: RegExp,
  text: string,
  timeoutMs: number = REGEX_TIMEOUT_MS,
  maxMatches: number = 100_000
): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const start = performance.now();
  let match: RegExpExecArray | null;

  // Clone regex to avoid mutating original
  const pattern = new RegExp(regex.source, regex.flags);

  while ((match = pattern.exec(text)) !== null) {
    if (performance.now() - start > timeoutMs) {
      throw new Error('Regex execution timed out');
    }
    matches.push(match);
    if (matches.length >= maxMatches) {
      throw new Error('Regex execution exceeded maximum matches');
    }
    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) {
      pattern.lastIndex++;
    }
  }

  return matches;
}

/**
 * Returns an array of segments (text + highlighted flag) for rendering.
 * Uses safe regex execution with timeout.
 */
export function highlightTextToSegments(
  text: string,
  query: string | RegExp,
  caseSensitive: boolean = false
): HighlightSegment[] {
  if (typeof text !== 'string' || (typeof query !== 'string' && !(query instanceof RegExp))) {
    console.warn('[GlobalSearch] highlightTextToSegments: invalid arguments', { text, query });
    return [{ text: text ?? '', highlighted: false }];
  }

  try {
    const pattern =
      query instanceof RegExp
        ? new RegExp(query.source, query.flags.includes('g') ? query.flags : query.flags + 'g')
        : buildSearchPattern(query, false, caseSensitive);

    const matches = safeRegexExec(pattern, text);
    const segments: HighlightSegment[] = [];
    let lastIndex = 0;

    for (const match of matches) {
      if (match.index > lastIndex) {
        segments.push({ text: text.slice(lastIndex, match.index), highlighted: false });
      }
      segments.push({ text: match[0], highlighted: true });
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), highlighted: false });
    }

    return segments.length > 0 ? segments : [{ text, highlighted: false }];
  } catch (err) {
    console.error('[GlobalSearch] highlightTextToSegments error:', err);
    return [{ text, highlighted: false }];
  }
}

/**
 * Groups search results by source, preserving order: chat, file, git.
 */
export function groupResultsBySource(results: SearchResult[]): SearchResultGroup[] {
  if (!Array.isArray(results)) {
    console.warn('[GlobalSearch] groupResultsBySource: results is not an array');
    return [];
  }

  const grouped: Record<SearchSource, SearchResultGroup> = {
    chat: { source: 'chat', count: 0, items: [] },
    file: { source: 'file', count: 0, items: [] },
    git: { source: 'git', count: 0, items: [] },
  };

  for (const result of results) {
    if (result && typeof result === 'object' && result.source in grouped) {
      grouped[result.source as SearchSource].items.push(result);
      grouped[result.source as SearchSource].count++;
    }
  }

  return [grouped.chat, grouped.file, grouped.git].filter((g) => g.count > 0);
}

/**
 * Sanitize a string for safe HTML rendering (prevent XSS when using dangerouslySetInnerHTML).
 */
function sanitizeHtml(text: string): string {
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] });
}

// ─────────────────────────────────────────────────────────────────────────────
// API Simulation (replace with actual API calls)
// ─────────────────────────────────────────────────────────────────────────────

async function searchApi(options: SearchOptions): Promise<SearchQueryResult> {
  // Simulated delay
  await new Promise((r) => setTimeout(r, 200));

  const { query, useRegex, caseSensitive, cursor } = options;

  if (!query.trim()) {
    return { groups: [], nextCursor: null };
  }

  // Validate regex if enabled
  if (useRegex) {
    const validation = validateRegex(query);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }

  // Build pattern for simulation
  const pattern = buildSearchPattern(query, useRegex, caseSensitive);

  // Mock data – replace with real database queries
  const mockResults: SearchResult[] = [
    {
      source: 'chat',
      id: 'chat-1',
      title: 'How to implement global search?',
      snippet: 'I think we should use React Query for infinite scrolling...',
      metadata: { thread: 'feature-discussion', author: 'Alice' },
    },
    {
      source: 'chat',
      id: 'chat-2',
      title: 'ReDoS prevention strategies',
      snippet: 'We need to add timeout and iteration limits to regex execution.',
      metadata: { thread: 'security', author: 'Bob' },
    },
    {
      source: 'file',
      id: 'file-1',
      title: 'searchUtils.ts',
      snippet: 'export function validateRegex(pattern: string) { ... }',
      metadata: { path: 'src/utils/searchUtils.ts', line: 42 },
    },
    {
      source: 'file',
      id: 'file-2',
      title: 'GlobalSearch.tsx',
      snippet: 'const GlobalSearch: React.FC = () => { ... }',
      metadata: { path: 'src/components/GlobalSearch.tsx', line: 1 },
    },
    {
      source: 'git',
      id: 'git-1',
      title: 'Add global search functionality',
      snippet: 'feat: Implement GlobalSearch component with Ctrl+Shift+F',
      metadata: { author: 'Developer', date: '2025-01-15' },
    },
  ];

  // Filter by regex match on title+snippet
  const filtered = mockResults.filter((r) => {
    const text = `${r.title} ${r.snippet || ''}`;
    return safeRegexExec(pattern, text).length > 0;
  });

  // Paginate (simulate cursor-based)
  const pageSize = 5;
  const startIndex = cursor ? parseInt(cursor, 10) : 0;
  const pageItems = filtered.slice(startIndex, startIndex + pageSize);
  const nextCursor =
    startIndex + pageSize < filtered.length ? String(startIndex + pageSize) : null;

  const groups = groupResultsBySource(pageItems);

  return { groups, nextCursor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  useRegex: boolean;
  caseSensitive: boolean;
  onToggleRegex: () => void;
  onToggleCase: () => void;
  regexError: string | null;
}

const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onKeyDown,
  useRegex,
  caseSensitive,
  onToggleRegex,
  onToggleCase,
  regexError,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="search-input-container">
      <div className="search-input-wrapper">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search across chat, files, and git history..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Global search"
        />
        {value && (
          <button
            className="search-clear-btn"
            onClick={() => onChange('')}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      <div className="search-options">
        <label className="search-option">
          <input
            type="checkbox"
            checked={useRegex}
            onChange={onToggleRegex}
          />
          <span>Regex</span>
        </label>
        <label className="search-option">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={onToggleCase}
          />
          <span>Case sensitive</span>
        </label>
      </div>
      {regexError && <div className="search-regex-error">Regex error: {regexError}</div>}
    </div>
  );
};

interface HighlightedTextProps {
  text: string;
  query: string;
  useRegex: boolean;
  caseSensitive: boolean;
}

const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  query,
  useRegex,
  caseSensitive,
}) => {
  const segments = useMemo(() => {
    if (!query.trim()) return [{ text, highlighted: false }];
    try {
      const pattern = buildSearchPattern(query, useRegex, caseSensitive);
      return highlightTextToSegments(text, pattern, caseSensitive);
    } catch {
      return [{ text, highlighted: false }];
    }
  }, [text, query, useRegex, caseSensitive]);

  return (
    <>
      {segments.map((seg, idx) =>
        seg.highlighted ? (
          <mark key={idx}>{seg.text}</mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        )
      )}
    </>
  );
};

interface SearchResultItemProps {
  result: SearchResult;
  query: string;
  useRegex: boolean;
  caseSensitive: boolean;
}

const SearchResultItem: React.FC<SearchResultItemProps> = ({
  result,
  query,
  useRegex,
  caseSensitive,
}) => {
  return (
    <div className="search-result-item" key={result.id}>
      <div className="search-result-header">
        <span className="search-result-icon">{SOURCE_ICONS[result.source]}</span>
        <span className="search-result-title">
          <HighlightedText
            text={result.title}
            query={query}
            useRegex={useRegex}
            caseSensitive={caseSensitive}
          />
        </span>
      </div>
      {result.snippet && (
        <div className="search-result-snippet">
          <HighlightedText
            text={result.snippet}
            query={query}
            useRegex={useRegex}
            caseSensitive={caseSensitive}
          />
        </div>
      )}
      <div className="search-result-meta">
        {result.metadata && (
          <>
            {result.source === 'chat' && result.metadata.thread && (
              <span className="meta-tag">Thread: {String(result.metadata.thread)}</span>
            )}
            {result.source === 'file' && result.metadata.path && (
              <span className="meta-tag">{String(result.metadata.path)}:{String(result.metadata.line)}</span>
            )}
            {result.source === 'git' && result.metadata.author && (
              <span className="meta-tag">
                {String(result.metadata.author)} @ {String(result.metadata.date)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

interface SearchGroupProps {
  group: SearchResultGroup;
  query: string;
  useRegex: boolean;
  caseSensitive: boolean;
}

const SearchGroup: React.FC<SearchGroupProps> = ({
  group,
  query,
  useRegex,
  caseSensitive,
}) => {
  return (
    <div className="search-group" key={group.source}>
      <div className="search-group-header">
        <span className="search-group-icon">{SOURCE_ICONS[group.source]}</span>
        <span className="search-group-label">{SOURCE_LABELS[group.source]}</span>
        <span className="search-group-count">({group.count})</span>
      </div>
      <div className="search-group-items">
        {group.items.map((item) => (
          <SearchResultItem
            key={item.id}
            result={item}
            query={query}
            useRegex={useRegex}
            caseSensitive={caseSensitive}
          />
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main GlobalSearch Component
// ─────────────────────────────────────────────────────────────────────────────

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setDebouncedQuery('');
      setRegexError(null);
    }
  }, [isOpen]);

  // React Query infinite scroll
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    isError,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['globalSearch', debouncedQuery, useRegex, caseSensitive],
    queryFn: ({ pageParam }) =>
      searchApi({
        query: debouncedQuery,
        useRegex,
        caseSensitive,
        cursor: pageParam ?? null,
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isOpen && debouncedQuery.trim().length > 0,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  // Validate regex on query change
  useEffect(() => {
    if (useRegex && query.trim()) {
      const validation = validateRegex(query);
      setRegexError(validation.valid ? null : validation.error ?? 'Unknown error');
    } else {
      setRegexError(null);
    }
  }, [query, useRegex]);

  // Flatten pages into groups
  const allGroups = useMemo(() => {
    if (!data?.pages) return [];
    const combined: SearchResult[] = [];
    for (const page of data.pages) {
      for (const group of page.groups) {
        for (const item of group.items) {
          combined.push(item);
        }
      }
    }
    return groupResultsBySource(combined);
  }, [data]);

  // Scroll to bottom to trigger infinite fetch
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.target as HTMLDivElement;
      if (
        target.scrollHeight - target.scrollTop - target.clientHeight < 200 &&
        hasNextPage &&
        !isFetchingNextPage
      ) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  // Clear results immediately when query is empty
  useEffect(() => {
    if (!query.trim()) {
      // React Query will not fetch because enabled is false
    }
  }, [query]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Toggle functions
  const toggleRegex = useCallback(() => setUseRegex((v) => !v), []);
  const toggleCase = useCallback(() => setCaseSensitive((v) => !v), []);

  // Close on overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="global-search-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="global-search-modal" role="dialog" aria-label="Global search">
        <SearchInput
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          useRegex={useRegex}
          caseSensitive={caseSensitive}
          onToggleRegex={toggleRegex}
          onToggleCase={toggleCase}
          regexError={regexError}
        />

        <div className="search-results-container" onScroll={handleScroll}>
          {!debouncedQuery.trim() && !isFetching && (
            <div className="search-empty">Start typing to search across chat, files, and git history.</div>
          )}

          {isError && (
            <div className="search-error">
              Error searching: {(error as Error).message}
            </div>
          )}

          {allGroups.length > 0 && (
            <>
              {allGroups.map((group) => (
                <SearchGroup
                  key={group.source}
                  group={group}
                  query={debouncedQuery}
                  useRegex={useRegex}
                  caseSensitive={caseSensitive}
                />
              ))}
            </>
          )}

          {debouncedQuery.trim() && !isFetching && allGroups.length === 0 && !isError && (
            <div className="search-no-results">No results found.</div>
          )}

          {isFetchingNextPage && <div className="search-loading">Loading more...</div>}
        </div>

        <div className="search-footer">
          <span>Ctrl+Shift+F to open</span>
          <span>Escape to close</span>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Global Hook for Keyboard Shortcut
// ─────────────────────────────────────────────────────────────────────────────

export function useGlobalSearchShortcut() {
  const [isOpen, setIsOpen] = useState(false);

  useHotkeys('ctrl+shift+f', (e) => {
    e.preventDefault();
    setIsOpen((prev) => !prev);
  });

  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, close };
}

export default GlobalSearch;