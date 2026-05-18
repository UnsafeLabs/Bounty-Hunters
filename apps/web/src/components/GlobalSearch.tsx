tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  File,
  GitCommit,
  Search,
  X,
  Regex,
  CaseSensitive,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { searchService } from '@/services/searchService';
import type {
  SearchResult,
  SearchGroup,
  SearchFilters,
  SearchResponse,
} from '@/types/search';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce delay in milliseconds. */
const DEBOUNCE_MS = 300;

/** Default number of results per page. */
const PAGE_SIZE = 20;

/**
 * Mapping from source identifier to display label and icon component.
 * This is the single source of truth for group display properties.
 */
const GROUP_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  chat: { label: 'Chat Messages', icon: MessageSquare },
  files: { label: 'Files & Content', icon: File },
  git: { label: 'Git Commits', icon: GitCommit },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Validates a regular expression pattern.
 * @param pattern - The regex pattern to validate.
 * @returns `null` if valid, otherwise an error message.
 */
export function validateRegex(pattern: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown regex validation error';
  }
}

/**
 * Splits text into segments with highlight flags based on a query.
 * Supports literal and regex search, optionally case‑sensitive.
 *
 * @param text - The text to highlight.
 * @param query - The search term.
 * @param regex - Enable regex mode.
 * @param caseSensitive - Enable case sensitivity.
 * @returns An object containing an array of `{ text, highlight }` segments.
 */
export function highlightText(
  text: string,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): { segments: Array<{ text: string; highlight: boolean }> } {
  if (!query || !text) {
    return { segments: text ? [{ text, highlight: false }] : [] };
  }

  let pattern: RegExp;
  try {
    const source = regex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'g' : 'gi';
    pattern = new RegExp(source, flags);
  } catch {
    // Invalid regex – return text as plain segment
    return { segments: [{ text, highlight: false }] };
  }

  const segments: Array<{ text: string; highlight: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Clone pattern to prevent sticky flag mutation across calls
  const re = new RegExp(pattern.source, pattern.flags);
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        highlight: false,
      });
    }
    segments.push({ text: match[0], highlight: true });
    lastIndex = match.index + match[0].length;

    // Prevent infinite loop on zero‑length matches
    if (match.index === re.lastIndex) {
      re.lastIndex++;
    }
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), highlight: false });
  }
  return { segments };
}

// ---------------------------------------------------------------------------
// Hook: useGlobalSearch
// ---------------------------------------------------------------------------

/** Internal state for the global search hook. */
interface GlobalSearchState {
  /** Current raw query string. */
  query: string;
  /** Search filters. */
  filters: SearchFilters;
  /** Whether the search overlay is open. */
  open: boolean;
  /** Regex validation error message (persistent). */
  regexError: string | null;
}

/**
 * Custom hook that manages global search state, debouncing, infinite queries,
 * and keyboard shortcuts (Ctrl+Shift+F to open, Escape to close).
 *
 * @returns Search state and control functions.
 */
function useGlobalSearch() {
  const [state, setState] = useState<GlobalSearchState>({
    query: '',
    filters: { regex: false, caseSensitive: false },
    open: false,
    regexError: null,
  });

  // Convenience setters (derive state updates)
  const open = useCallback(
    () =>
      setState((prev) => ({
        ...prev,
        open: true,
        regexError: null,
      })),
    [],
  );

  const close = useCallback(
    () =>
      setState((prev) => ({
        ...prev,
        open: false,
        regexError: null,
      })),
    [],
  );

  const setQuery = useCallback(
    (query: string) =>
      setState((prev) => {
        // Validate regex on every keystroke when regex mode is on
        let regexError: string | null = null;
        if (prev.filters.regex && query) {
          regexError = validateRegex(query);
        }
        return { ...prev, query, regexError };
      }),
    [],
  );

  const toggleFilter = useCallback(
    (key: keyof SearchFilters) =>
      setState((prev) => {
        const newFilters = { ...prev.filters, [key]: !prev.filters[key] };
        // Re‑evaluate regex error if regex mode was toggled
        let regexError = prev.regexError;
        if (key === 'regex' && newFilters.regex && prev.query) {
          regexError = validateRegex(prev.query);
        } else if (key === 'regex' && !newFilters.regex) {
          regexError = null;
        }
        return { ...prev, filters: newFilters, regexError };
      }),
    [],
  );

  // Debounced query – used only when query is non‑empty
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (state.query) {
      debounceRef.current = setTimeout(() => {
        setDebouncedQuery(state.query);
      }, DEBOUNCE_MS);
    } else {
      // Empty query → clear debounced immediately → results clear
      setDebouncedQuery('');
    }
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [state.query]);

  // Infinite query for search results
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['globalSearch', debouncedQuery, state.filters],
    queryFn: async ({
      pageParam,
    }: {
      pageParam: number | string | undefined;
    }): Promise<SearchResponse> => {
      if (!debouncedQuery) {
        return { groups: [], nextCursor: undefined };
      }

      // Validate regex before API call
      const regexError = state.filters.regex
        ? validateRegex(debouncedQuery)
        : null;
      if (regexError) {
        // Should not happen because query is disabled, but for safety
        toast.error(`Invalid regex: ${regexError}`);
        return { groups: [], nextCursor: undefined };
      }

      try {
        return await searchService.searchAll(
          debouncedQuery,
          pageParam,
          state.filters,
        );
      } catch (error: unknown) {
        // Log and surface error
        const msg =
          error instanceof Error ? error.message : 'Unknown search error';
        console.error('[GlobalSearch] searchAll failed:', msg);
        toast.error(`Search failed: ${msg}`);
        return { groups: [], nextCursor: undefined };
      }
    },
    initialPageParam: undefined as number | string | undefined,
    getNextPageParam: (lastPage: SearchResponse) => lastPage.nextCursor,
    enabled: debouncedQuery.length > 0 && state.regexError === null,
    staleTime: 10_000,
  });

  // Merged groups from all pages (using GROUP_CONFIG for display values)
  const groups: Array<SearchGroup & { label: string; icon: React.ComponentType<{ className?: string }> }> =
    useMemo(() => {
      if (!infiniteQuery.data?.pages) return [];

      const groupMap: Record<
        string,
        SearchGroup & {
          label: string;
          icon: React.ComponentType<{ className?: string }>;
        }
      > = {};

      for (const page of infiniteQuery.data.pages) {
        for (const group of page.groups) {
          const config = GROUP_CONFIG[group.source] ?? {
            label: group.source,
            icon: Search, // fallback icon
          };
          const existing = groupMap[group.source];
          if (existing) {
            existing.results.push(...group.results);
            existing.count += group.count;
          } else {
            groupMap[group.source] = {
              ...group,
              label: config.label,
              icon: config.icon,
              results: [...group.results],
            };
          }
        }
      }
      return Object.values(groupMap);
    }, [infiniteQuery.data]);

  const isLoading = infiniteQuery.isFetching && debouncedQuery.length > 0;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!state.open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [state.open, close]);

  return {
    query: state.query,
    filters: state.filters,
    open,
    close,
    setQuery,
    toggleFilter,
    groups,
    isLoading,
    fetchNextPage: infiniteQuery.fetchNextPage,
    hasNextPage: infiniteQuery.hasNextPage,
    isFetchingNextPage: infiniteQuery.isFetchingNextPage,
    debouncedQuery,
    regexError: state.regexError,
  };
}

// ---------------------------------------------------------------------------
// Sub‑components
// ---------------------------------------------------------------------------

/** Props for SearchResultItem. */
interface SearchResultItemProps {
  result: SearchResult;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
}

/**
 * Renders a single search result with highlighted preview and metadata.
 */
const SearchResultItem: React.FC<SearchResultItemProps> = ({
  result,
  query,
  regex,
  caseSensitive,
}) => {
  const { segments } = highlightText(
    result.preview,
    query,
    regex,
    caseSensitive,
  );

  return (
    <div className="cursor-pointer rounded-md p-2 hover:bg-accent/60 transition-colors">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="truncate">{result.title}</span>
        {result.lineNumber !== undefined && (
          <span className="text-xs text-muted-foreground ml-auto">
            Ln {result.lineNumber}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
        {segments.length > 0
          ? segments.map((seg, i) =>
              seg.highlight ? (
                <mark key={i} className="bg-yellow-200 dark:bg-yellow-600/40">
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )
          : result.preview}
      </div>
      {result.metadata && (
        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          {result.metadata.author && (
            <span>by {result.metadata.author}</span>
          )}
          {result.metadata.date && <span>{result.metadata.date}</span>}
          {result.metadata.thread && (
            <span className="italic">{result.metadata.thread}</span>
          )}
        </div>
      )}
    </div>
  );
};

/** Props for SearchGroupSection. */
interface SearchGroupSectionProps {
  group: SearchGroup & {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  };
  query: string;
  regex: boolean;
  caseSensitive: boolean;
}

/**
 * Renders a group section with heading and its results.
 */
const SearchGroupSection: React.FC<SearchGroupSectionProps> = ({
  group,
  query,
  regex,
  caseSensitive,
}) => {
  const GroupIcon = group.icon;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-foreground border-b pb-1">
        <GroupIcon className="h-4 w-4" />
        <span>
          {group.label} ({group.count})
        </span>
      </div>
      {group.results.map((result) => (
        <SearchResultItem
          key={result.id}
          result={result}
          query={query}
          regex={regex}
          caseSensitive={caseSensitive}
        />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component: GlobalSearch
// ---------------------------------------------------------------------------

/**
 * Global search overlay component.
 * Provides a keyboard‑accessible search interface with progressive result loading,
 * regex mode, case sensitivity toggle, and grouped display.
 */
const GlobalSearch: React.FC = () => {
  const {
    query,
    filters,
    open,
    close,
    setQuery,
    toggleFilter,
    groups,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    debouncedQuery,
    regexError,
  } = useGlobalSearch();

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto‑focus input when overlay opens
  useEffect(() => {
    if (open) {
      // Slight delay for transition
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on click outside overlay
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        close();
      }
    },
    [close],
  );

  // Infinite scroll observer
  useEffect(() => {
    if (!hasNextPage || !listRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    const sentinel = listRef.current.lastElementChild;
    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage, debouncedQuery, groups]);

  if (!open) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh]"
      onClick={handleBackdropClick}
    >
      {/* Overlay panel */}
      <div
        ref={overlayRef}
        className="w-full max-w-2xl max-h-[70vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Search bar */}
        <div className="flex items-center border-b border-border p-3 gap-2">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, files, commits… (Ctrl+Shift+F)"
            className="flex-1 bg-transparent outline-none text-foreground text-sm placeholder:text-muted-foreground"
            aria-label="Global search"
          />
          {/* Regex toggle */}
          <button
            onClick={() => toggleFilter('regex')}
            className={`p-1.5 rounded-md transition-colors ${
              filters.regex
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Toggle regex mode"
            aria-label="Toggle regex mode"
          >
            <Regex className="h-4 w-4" />
          </button>
          {/* Case sensitivity toggle */}
          <button
            onClick={() => toggleFilter('caseSensitive')}
            className={`p-1.5 rounded-md transition-colors ${
              filters.caseSensitive
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Toggle case sensitivity"
            aria-label="Toggle case sensitivity"
          >
            <CaseSensitive className="h-4 w-4" />
          </button>
          {/* Close button */}
          <button
            onClick={close}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Close (Escape)"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Regex error (persistent) */}
        {regexError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 text-destructive text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Invalid regex: {regexError}</span>
          </div>
        )}

        {/* Results area */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Empty state */}
          {!debouncedQuery && (
            <p className="text-center text-muted-foreground text-sm py-8">
              Type to start searching
            </p>
          )}

          {/* No results */}
          {debouncedQuery &&
            !isLoading &&
            groups.length === 0 &&
            regexError === null && (
              <p className="text-center text-muted-foreground text-sm py-8">
                No results found for &ldquo;{debouncedQuery}&rdquo;
              </p>
            )}

          {/* Results groups */}
          {groups.map((group) => (
            <SearchGroupSection
              key={group.source}
              group={group}
              query={debouncedQuery}
              regex={filters.regex}
              caseSensitive={filters.caseSensitive}
            />
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Fetching next page */}
          {isFetchingNextPage && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* End sentinel for infinite scroll */}
          {hasNextPage && <div className="h-1" />}
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;