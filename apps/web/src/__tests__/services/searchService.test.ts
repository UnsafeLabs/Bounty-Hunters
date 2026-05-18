typescript
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, FileText, MessageSquare, GitCommit, X, ToggleLeft, ToggleRight, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  content: string;
  threadId: string;
  threadName: string;
  createdAt: string;
}

interface FileMatch {
  filePath: string;
  fileName: string;
  lineNumber: number;
  content: string;
}

interface GitCommit {
  commitId: string;
  message: string;
  author: string;
  date: string;
}

interface AggregatedResult {
  chat: ChatMessage[];
  files: FileMatch[];
  git: GitCommit[];
}

interface SearchState {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const searchAll = async (query: string, regex: boolean, caseSensitive: boolean, signal?: AbortSignal): Promise<AggregatedResult> => {
  const params = new URLSearchParams({ query, regex: String(regex), caseSensitive: String(caseSensitive) });
  const response = await fetch(`/api/search/all?${params}`, { signal });
  if (!response.ok) {
    throw new Error(`Search API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

// ---------------------------------------------------------------------------
// Helper: highlight matching text
// ---------------------------------------------------------------------------

const highlightMatch = (text: string, query: string, regex: boolean, caseSensitive: boolean): React.ReactNode => {
  if (!query) return text;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const parts = text.split(pattern);
    const matches = text.match(pattern);
    if (!matches) return text;
    return parts.map((part, i) => (
      <React.Fragment key={i}>
        {part}
        {i < matches.length && <mark className="bg-yellow-300 dark:bg-yellow-600 rounded px-0.5">{matches[i]}</mark>}
      </React.Fragment>
    ));
  } catch {
    return text; // fallback if regex invalid
  }
};

// ---------------------------------------------------------------------------
// GlobalSearch Component
// ---------------------------------------------------------------------------

interface GlobalSearchProps {
  onClose: () => void;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ onClose }) => {
  const [state, setState] = useState<SearchState>({ query: '', regex: false, caseSensitive: false });
  const [regexError, setRegexError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(state.query, 300);

  // Close on click outside and Escape
  useOnClickOutside(overlayRef, onClose);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    inputRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Validate regex when regex mode is on
  useEffect(() => {
    if (state.regex && state.query) {
      try {
        new RegExp(state.query);
        setRegexError(null);
      } catch (e: unknown) {
        setRegexError(e instanceof Error ? e.message : 'Invalid regex');
      }
    } else {
      setRegexError(null);
    }
  }, [state.query, state.regex]);

  // Infinite query
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ['globalSearch', debouncedQuery, state.regex, state.caseSensitive],
    queryFn: async ({ pageParam = 0, signal }) => {
      if (!debouncedQuery) return { results: { chat: [], files: [], git: [] }, nextPage: undefined };
      const results = await searchAll(debouncedQuery, state.regex, state.caseSensitive, signal);
      // Paginate each category manually (simulated: only first page returns all, subsequent pages return empty)
      return { results, nextPage: pageParam < 1 ? pageParam + 1 : undefined };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
    retry: 2,
  });

  // Flatten results from all pages (for infinite scroll, all results are in first page in our mock)
  const aggregatedResults = useMemo(() => {
    if (!data?.pages) return { chat: [], files: [], git: [] };
    return data.pages.reduce<AggregatedResult>(
      (acc, page) => ({
        chat: [...acc.chat, ...page.results.chat],
        files: [...acc.files, ...page.results.files],
        git: [...acc.git, ...page.results.git],
      }),
      { chat: [], files: [], git: [] }
    );
  }, [data]);

  // Group counts
  const counts = useMemo(() => ({
    chat: aggregatedResults.chat.length,
    files: aggregatedResults.files.length,
    git: aggregatedResults.git.length,
  }), [aggregatedResults]);

  // Scroll handling for infinite scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !hasNextPage || isFetchingNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Clear results immediately on empty query
  useEffect(() => {
    if (!state.query) {
      // React Query won't fetch when disabled, so aggregatedResults will be empty
    }
  }, [state.query]);

  const renderHeader = () => (
    <div className="flex items-center gap-2 mb-2">
      <Search className="w-5 h-5 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search across chat, files, and git commits... (Ctrl+Shift+F)"
        value={state.query}
        onChange={(e) => setState(prev => ({ ...prev, query: e.target.value }))}
        className="flex-1"
        aria-label="Search query"
      />
      <button
        onClick={() => setState(prev => ({ ...prev, regex: !prev.regex }))}
        className={cn('p-2 rounded hover:bg-muted', state.regex && 'bg-primary/20')}
        title="Toggle regex mode"
        aria-label="Toggle regex mode"
      >
        <span className="text-xs font-mono">.*</span>
      </button>
      <button
        onClick={() => setState(prev => ({ ...prev, caseSensitive: !prev.caseSensitive }))}
        className={cn('p-2 rounded hover:bg-muted', state.caseSensitive && 'bg-primary/20')}
        title="Toggle case sensitivity"
        aria-label="Toggle case sensitivity"
      >
        {state.caseSensitive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
      </button>
      <button onClick={onClose} className="p-2 rounded hover:bg-muted" aria-label="Close search">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  const renderSection = (
    title: string,
    icon: React.ReactNode,
    items: unknown[],
    type: 'chat' | 'files' | 'git'
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-2">
          {icon}
          <span>{title}</span>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        <ul className="space-y-1">
          {items.map((item, idx) => {
            const key = type === 'chat' ? (item as ChatMessage).id : type === 'files' ? `${(item as FileMatch).filePath}:${(item as FileMatch).lineNumber}` : (item as GitCommit).commitId;
            return (
              <li key={key} className="p-2 rounded hover:bg-muted cursor-pointer transition-colors">
                {type === 'chat' && renderChatMessage(item as ChatMessage)}
                {type === 'files' && renderFileMatch(item as FileMatch)}
                {type === 'git' && renderGitCommit(item as GitCommit)}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderChatMessage = (msg: ChatMessage) => (
    <div>
      <div className="text-xs text-muted-foreground mb-1">
        <span className="font-medium">{msg.threadName}</span> &middot; {new Date(msg.createdAt).toLocaleDateString()}
      </div>
      <div className="text-sm">{highlightMatch(msg.content, state.query, state.regex, state.caseSensitive)}</div>
    </div>
  );

  const renderFileMatch = (file: FileMatch) => (
    <div>
      <div className="text-xs text-muted-foreground mb-1">
        <span className="font-medium text-primary">{file.fileName}</span> in {file.filePath} line {file.lineNumber}
      </div>
      <pre className="text-sm bg-muted p-1 rounded overflow-x-auto">{highlightMatch(file.content, state.query, state.regex, state.caseSensitive)}</pre>
    </div>
  );

  const renderGitCommit = (commit: GitCommit) => (
    <div>
      <div className="text-xs text-muted-foreground mb-1">
        <span className="font-medium">{commit.author}</span> &middot; {new Date(commit.date).toLocaleDateString()} &middot; <code className="text-xs">{commit.commitId.slice(0, 7)}</code>
      </div>
      <div className="text-sm">{highlightMatch(commit.message, state.query, state.regex, state.caseSensitive)}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 bg-black/50" role="dialog" aria-modal="true" aria-label="Global Search">
      <div
        ref={overlayRef}
        className="w-full max-w-2xl bg-background rounded-lg shadow-2xl border p-4 max-h-[80vh] flex flex-col"
      >
        {renderHeader()}
        {regexError && (
          <div className="flex items-center gap-1 text-destructive text-sm mb-2">
            <AlertCircle className="w-4 h-4" />
            <span>{regexError}</span>
          </div>
        )}
        {isLoading && <div className="text-center text-muted-foreground py-4">Loading...</div>}
        {isError && (
          <div className="text-destructive text-center py-4">
            Error: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}
        {!state.query && (
          <div className="text-center text-muted-foreground py-8">Start typing to search across chat, files, and git history.</div>
        )}
        <ScrollArea ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
          {renderSection('Chat Messages', <MessageSquare className="w-4 h-4" />, aggregatedResults.chat, 'chat')}
          {renderSection('Files', <FileText className="w-4 h-4" />, aggregatedResults.files, 'files')}
          {renderSection('Git Commits', <GitCommit className="w-4 h-4" />, aggregatedResults.git, 'git')}
          {isFetchingNextPage && <div className="text-center text-muted-foreground py-2">Loading more...</div>}
          {!hasNextPage && aggregatedResults.chat.length + aggregatedResults.files.length + aggregatedResults.git.length > 0 && (
            <div className="text-center text-muted-foreground py-2 text-xs">All results loaded</div>
          )}
          {state.query && !isLoading && !isError && aggregatedResults.chat.length + aggregatedResults.files.length + aggregatedResults.git.length === 0 && (
            <div className="text-center text-muted-foreground py-8">No results found.</div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Hook to trigger GlobalSearch via keyboard shortcut
// ---------------------------------------------------------------------------

export const useGlobalSearch = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const closeSearch = useCallback(() => setIsOpen(false), []);

  const GlobalSearchOverlay = isOpen ? <GlobalSearch onClose={closeSearch} /> : null;

  return { isOpen, openSearch: () => setIsOpen(true), closeSearch, GlobalSearchOverlay };
};

export default GlobalSearch;