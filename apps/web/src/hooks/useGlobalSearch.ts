typescript
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  KeyboardEvent,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import {
  MessageSquare,
  File,
  GitCommit,
  Search,
  X,
  Loader2,
  AlertCircle,
  Regex,
  CaseSensitive,
  ChevronDown,
} from 'lucide-react';
import { validateRegex, buildRegexPattern } from '../utils/searchUtils';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Simple structured logger for the GlobalSearch module.
 * Respects NODE_ENV to suppress debug logs in production.
 */
const logger = {
  debug: (...args: unknown[]): void =>
    process.env.NODE_ENV === 'development'
      ? console.debug('[GlobalSearch]', ...args)
      : undefined,
  info: (...args: unknown[]): void =>
    console.info('[GlobalSearch]', ...args),
  warn: (...args: unknown[]): void =>
    console.warn('[GlobalSearch]', ...args),
  error: (...args: unknown[]): void =>
    console.error('[GlobalSearch]', ...args),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents a single search match from any source. */
export interface SearchResultItem {
  /** Unique identifier across sources. */
  readonly id: string;
  /** Source type: 'chat' | 'file' | 'git'. */
  readonly source: 'chat' | 'file' | 'git';
  /** Human‑readable title (e.g. thread name, file path, commit hash). */
  readonly title: string;
  /** Preview snippet containing the matched terms. */
  readonly preview: string;
  /** Optional secondary info (e.g. author, line number). */
  readonly subtitle?: string;
  /** Optional timestamp (ISO string). */
  readonly timestamp?: string;
  /** Raw matched text for highlighting. */
  readonly matchText?: string;
  /** Any additional metadata. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Group of results by source. */
export interface SearchResultGroup {
  readonly source: 'chat' | 'file' | 'git';
  readonly label: string;
  readonly icon: 'MessageSquare' | 'File' | 'GitCommit';
  readonly items: readonly SearchResultItem[];
}

/** Combined API response shape. */
interface SearchResponse {
  readonly groups: readonly SearchResultGroup[];
  readonly nextCursor?: string | null;
}

/**
 * Filters that the user can toggle.
 */
export interface SearchFilters {
  /** Enable regex matching (case sensitivity then obeys the regex flags). */
  readonly regex: boolean;
  /** When false, case‑insensitive matching (default). When true, case‑sensitive. */
  readonly caseSensitive: boolean;
}

/** Regex validation result. */
interface RegexValidation {
  readonly valid: boolean;
  readonly error: string | null;
}

/** Return type of the useGlobalSearch hook. */
export interface UseGlobalSearchReturn {
  /** Current query string. */
  readonly query: string;
  /** Current filter state. */
  readonly filters: SearchFilters;
  /** Whether the search overlay is open. */
  readonly overlayOpen: boolean;
  /** Groups of paginated results (accumulated). */
  readonly groups: readonly SearchResultGroup[];
  /** Whether a fetch is in progress (initial loading). */
  readonly isLoading: boolean;
  /** Whether a fetch is in progress (including background refetches). */
  readonly isFetching: boolean;
  /** Error object from the latest fetch. */
  readonly error: Error | null;
  /** Regex validation result for the current query. */
  readonly regexValidation: RegexValidation | null;
  /** Whether there are more pages to load. */
  readonly hasNextPage: boolean;
  /** Whether the next page is currently loading. */
  readonly isFetchingNextPage: boolean;
  /** Update the search query (debounce applied internally). */
  setQuery: (q: string) => void;
  /** Toggle regex mode on/off. */
  toggleRegex: () => void;
  /** Toggle case sensitivity on/off. */
  toggleCaseSensitivity: () => void;
  /** Open the search overlay. */
  openOverlay: () => void;
  /** Close the search overlay and clear state. */
  closeOverlay: () => void;
  /** Load the next page of results. */
  loadMore: () => void;
  /** Manually refetch (e.g. after error). */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;
const DEFAULT_FILTERS: SearchFilters = {
  regex: false,
  caseSensitive: false,
};
const MAX_QUERY_LENGTH = 500;
const MAX_REGEX_PATTERN_LENGTH = 200;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Highlight matched terms in a text string.
 *
 * Escapes HTML to prevent XSS, then wraps matched parts with `<mark>` tags.
 *
 * @param text - The original text to highlight.
 * @param query - The search query (raw or regex pattern).
 * @param isRegex - Whether the query should be treated as a regex.
 * @param caseSensitive - Whether matching is case‑sensitive.
 * @returns HTML‑safe string with `<mark>` elements around matched portions.
 */
function highlightMatch(
  text: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
): string {
  if (!query || !text) {
    return escapeHtml(text);
  }

  let pattern: string;
  try {
    if (isRegex) {
      const validation = validateRegex(query);
      if (!validation.valid) {
        // fallback to literal search if regex is invalid
        pattern = escapeRegexSpecialChars(query);
      } else {
        pattern = query;
      }
    } else {
      pattern = escapeRegexSpecialChars(query);
    }

    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);

    // Escape HTML first, then split the string by the regex pattern
    const escaped = escapeHtml(text);
    const parts = escaped.split(regex);

    // Reconstruct with <mark> tags for matched segments
    const result: string[] = [];
    let lastIndex = 0;
    // We need to interleave matches; we can use exec in a loop
    const re = new RegExp(pattern, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(escaped)) !== null) {
      const before = escaped.slice(lastIndex, match.index);
      if (before) result.push(before);
      result.push(`<mark>${match[0]}</mark>`);
      lastIndex = match.index + match[0].length;
      // Avoid infinite loops on zero‑length matches
      if (match.index === re.lastIndex) re.lastIndex++;
    }
    const remaining = escaped.slice(lastIndex);
    if (remaining) result.push(remaining);
    return result.join('');
  } catch (error) {
    logger.error('Highlight match error', { error, text, query, isRegex, caseSensitive });
    return escapeHtml(text);
  }
}

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

/** Escape special regex characters in a literal string. */
function escapeRegexSpecialChars(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

/**
 * Performs the actual search request via the backend API.
 *
 * @param query - The search string.
 * @param filters - Current search filters (regex, caseSensitive).
 * @param cursor - Cursor for pagination (null for first page).
 * @returns A promise resolving to SearchResponse.
 * @throws Error if the request fails or returns a non-OK status.
 */
async function performSearch(
  query: string,
  filters: SearchFilters,
  cursor?: string | null,
): Promise<SearchResponse> {
  if (!query.trim()) {
    // Empty query returns no results immediately
    return { groups: [], nextCursor: null };
  }

  // Input validation
  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(`Query too long (max ${MAX_QUERY_LENGTH} characters)`);
  }
  if (filters.regex && query.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(`Regex pattern too long (max ${MAX_REGEX_PATTERN_LENGTH} characters)`);
  }

  const params = new URLSearchParams({
    q: query,
    regex: String(filters.regex),
    caseSensitive: String(filters.caseSensitive),
  });
  if (cursor) {
    params.set('cursor', cursor);
  }

  const url = `/api/search?${params.toString()}`;
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      let errorMessage = `Search API returned ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody?.message) {
          errorMessage = errorBody.message;
        }
      } catch {
        // ignore parsing error
      }
      throw new Error(errorMessage);
    }

    const data: SearchResponse = await response.json();

    // Validate response shape
    if (!data || !Array.isArray(data.groups)) {
      throw new Error('Invalid search response format');
    }

    logger.debug('Search request completed', {
      query,
      filters,
      duration: performance.now() - startTime,
      groupCount: data.groups.length,
    });

    return data;
  } catch (error) {
    logger.error('Search request failed', {
      query,
      filters,
      cursor,
      error,
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Hook: useGlobalSearch
// ---------------------------------------------------------------------------

/**
 * React hook that manages global search state, including debounced queries,
 * filter toggles, overlay visibility, and infinite query loading.
 *
 * @returns {UseGlobalSearchReturn} Search state and actions.
 */
export function useGlobalSearch(): UseGlobalSearchReturn {
  const [query, setQueryState] = useState<string>('');
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [overlayOpen, setOverlayOpen] = useState<boolean>(false);
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounce query updates
  const setQuery = useCallback((q: string) => {
    // Truncate if too long
    const sanitized = q.slice(0, MAX_QUERY_LENGTH);
    setQueryState(sanitized);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(sanitized);
    }, DEBOUNCE_MS);
  }, []);

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Toggle filters
  const toggleRegex = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      regex: !prev.regex,
    }));
  }, []);

  const toggleCaseSensitivity = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      caseSensitive: !prev.caseSensitive,
    }));
  }, []);

  // Overlay visibility
  const openOverlay = useCallback(() => {
    setOverlayOpen(true);
    // Focus the input after opening
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    setQuery('');
    setDebouncedQuery('');
  }, [setQuery]);

  // Infinite query
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery<SearchResponse, Error>({
    queryKey: ['globalSearch', debouncedQuery, filters],
    queryFn: ({ pageParam }) =>
      performSearch(debouncedQuery, filters, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: overlayOpen && debouncedQuery.trim().length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });

  // Merge all pages into a flat group list
  const groups = useMemo(() => {
    if (!data) return [];
    const merged: SearchResultGroup[] = [];
    const sourceMap = new Map<string, SearchResultGroup>();

    for (const page of data.pages) {
      if (!page?.groups) continue;
      for (const group of page.groups) {
        const key = group.source;
        if (sourceMap.has(key)) {
          const existing = sourceMap.get(key)!;
          // Merge items, avoid duplicates by id
          const existingIds = new Set(existing.items.map((i) => i.id));
          const newItems = group.items.filter((item) => !existingIds.has(item.id));
          existing.items = [...existing.items, ...newItems];
        } else {
          sourceMap.set(key, {
            source: group.source,
            label: group.label,
            icon: group.icon,
            items: [...group.items],
          });
        }
      }
    }
    // Preserve order: chat, file, git
    const sourceOrder = ['chat', 'file', 'git'] as const;
    for (const source of sourceOrder) {
      const g = sourceMap.get(source);
      if (g) merged.push(g);
    }
    return merged;
  }, [data]);

  // Regex validation
  const regexValidation: RegexValidation | null = useMemo(() => {
    if (!filters.regex || !query) return null;
    return validateRegex(query);
  }, [filters.regex, query]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      // Ctrl+Shift+F to open overlay
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        if (overlayOpen) {
          closeOverlay();
        } else {
          openOverlay();
        }
      }
      // Escape to close
      if (e.key === 'Escape' && overlayOpen) {
        closeOverlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [overlayOpen, openOverlay, closeOverlay]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    query,
    filters,
    overlayOpen,
    groups,
    isLoading,
    isFetching,
    error,
    regexValidation,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    setQuery,
    toggleRegex,
    toggleCaseSensitivity,
    openOverlay,
    closeOverlay,
    loadMore,
    refetch: () => refetch(),
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Props for the GlobalSearchOverlay component. */
export interface GlobalSearchOverlayProps {
  /** Search hook return value. */
  search: UseGlobalSearchReturn;
}

/**
 * Overlay component that displays the global search interface.
 * Supports portals to render outside the normal DOM hierarchy.
 */
export const GlobalSearchOverlay: React.FC<GlobalSearchOverlayProps> = ({
  search,
}) => {
  const {
    query,
    filters,
    overlayOpen,
    groups,
    isLoading,
    isFetching,
    error,
    regexValidation,
    hasNextPage,
    isFetchingNextPage,
    setQuery,
    toggleRegex,
    toggleCaseSensitivity,
    closeOverlay,
    loadMore,
    refetch,
  } = search;

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll handler for infinite scrolling
  const handleScroll = useCallback(() => {
    const listEl = listRef.current;
    if (!listEl || !hasNextPage || isFetchingNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = listEl;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadMore();
    }
  }, [hasNextPage, isFetchingNextPage, loadMore]);

  // Focus input when overlay opens
  useEffect(() => {
    if (overlayOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [overlayOpen]);

  if (!overlayOpen) return null;

  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'MessageSquare':
        return <MessageSquare className="size-4 text-blue-500" />;
      case 'File':
        return <File className="size-4 text-amber-500" />;
      case 'GitCommit':
        return <GitCommit className="size-4 text-purple-500" />;
      default:
        return <Search className="size-4 text-gray-500" />;
    }
  };

  const sourceLabel = (source: string): string => {
    switch (source) {
      case 'chat':
        return 'Chat Messages';
      case 'file':
        return 'Files';
      case 'git':
        return 'Git Commits';
      default:
        return source;
    }
  };

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeOverlay();
      }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
          <Search className="size-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chat, files, git history... (Ctrl+Shift+F)"
            className="flex-1 bg-transparent border-0 outline-none text-base text-gray-900 dark:text-gray-100 placeholder-gray-400"
            maxLength={MAX_QUERY_LENGTH}
            aria-label="Search input"
          />
          <button
            onClick={toggleRegex}
            className={`p-2 rounded-md transition-colors ${
              filters.regex
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'
            }`}
            title="Toggle regex search"
            aria-label="Toggle regex mode"
          >
            <Regex className="size-4" />
          </button>
          <button
            onClick={toggleCaseSensitivity}
            className={`p-2 rounded-md transition-colors ${
              filters.caseSensitive
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'
            }`}
            title="Toggle case sensitivity"
            aria-label="Toggle case sensitivity"
          >
            <CaseSensitive className="size-4" />
          </button>
          <button
            onClick={closeOverlay}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
            title="Close search (Esc)"
            aria-label="Close search overlay"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Regex validation error */}
        {regexValidation && !regexValidation.valid && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm border-b border-gray-200 dark:border-gray-700">
            <AlertCircle className="inline-block size-4 mr-1" />
            Invalid regex: {regexValidation.error}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <AlertCircle className="size-4" />
            <span>Search failed: {error.message}</span>
            <button onClick={() => refetch()} className="ml-auto underline">
              Retry
            </button>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-8 animate-spin text-gray-400" />
          </div>
        )}

        {/* Results */}
        {!isLoading && !error && (
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="max-h-96 overflow-y-auto"
          >
            {groups.length === 0 && query.trim() ? (
              <div className="py-8 text-center text-gray-500">
                No results found for &quot;{query}&quot;
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.source} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {renderIcon(group.icon)}
                    <span>{sourceLabel(group.source)}</span>
                    <span className="ml-auto text-xs text-gray-400">
                      {group.items.length}{' '}
                      {group.items.length === 1 ? 'result' : 'results'}
                    </span>
                  </div>
                  {/* Items */}
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors"
                        onClick={() => {
                          // Handle navigation (e.g., dispatch event)
                          // For now, just close overlay
                          logger.info('Selected item', { item });
                          // closeOverlay();
                        }}
                      >
                        <div className="flex items-start gap-3">
                          {renderIcon(group.icon)}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {item.title}
                            </div>
                            {item.subtitle && (
                              <div className="text-xs text-gray-500 mt-0.5">
                                {item.subtitle}
                              </div>
                            )}
                            <div
                              className="mt-1 text-sm text-gray-600 dark:text-gray-400 line-clamp-2"
                              dangerouslySetInnerHTML={{
                                __html: highlightMatch(
                                  item.preview,
                                  query,
                                  filters.regex,
                                  filters.caseSensitive,
                                ),
                              }}
                            />
                            {item.timestamp && (
                              <div className="text-xs text-gray-400 mt-1">
                                {new Date(item.timestamp).toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}

            {/* Infinite scroll loader */}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="size-5 animate-spin text-gray-400" />
              </div>
            )}

            {/* End of results */}
            {!hasNextPage && groups.length > 0 && (
              <div className="py-4 text-center text-xs text-gray-400">
                End of results
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Portal to body to avoid z-index issues
  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return null; // SSR fallback
};

/**
 * GlobalSearch component that can be embedded anywhere.
 * Attaches keyboard listeners automatically.
 *
 * @example
 * <GlobalSearch />
 */
export const GlobalSearch: React.FC = () => {
  const search = useGlobalSearch();
  return <GlobalSearchOverlay search={search} />;
};

export default GlobalSearch;