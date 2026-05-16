/**
 * Global Search component for searching across chat, files, and git history.
 *
 * Accessible via Ctrl+Shift+F, displays results grouped by source
 * with preview snippets and highlighted matches.
 *
 * @module GlobalSearch
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "~/lib/utils";
import { SearchIcon, XIcon, MessageSquareIcon, FileIcon, GitCommitIcon } from "lucide-react";

export type SearchResultType = "chat" | "file" | "git";

export interface SearchResult {
  readonly type: SearchResultType;
  readonly title: string;
  readonly preview: string;
  readonly matchStart: number;
  readonly matchEnd: number;
  readonly metadata?: {
    readonly threadId?: string;
    readonly filePath?: string;
    readonly line?: number;
    readonly commitHash?: string;
    readonly author?: string;
    readonly date?: string;
  };
}

interface GlobalSearchProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const RESULT_ICONS: Record<SearchResultType, typeof SearchIcon> = {
  chat: MessageSquareIcon,
  file: FileIcon,
  git: GitCommitIcon,
};

const RESULT_TYPE_LABELS: Record<SearchResultType, string> = {
  chat: "Chat Messages",
  file: "Files",
  git: "Git History",
};

function highlightMatch(text: string, start: number, end: number) {
  const before = text.slice(0, start);
  const match = text.slice(start, end);
  const after = text.slice(end);
  return (
    <>
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-800">{match}</mark>
      {after}
    </>
  );
}

const SearchResultItem = memo(function SearchResultItem({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (result: SearchResult) => void;
}) {
  const Icon = RESULT_ICONS[result.type];

  return (
    <button
      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      onClick={() => onSelect(result)}
    >
      <Icon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{result.title}</div>
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {highlightMatch(result.preview, result.matchStart, result.matchEnd)}
        </div>
        {result.metadata && (
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            {result.metadata.line && <span>Line {result.metadata.line}</span>}
            {result.metadata.author && <span>{result.metadata.author}</span>}
            {result.metadata.date && <span>{result.metadata.date}</span>}
          </div>
        )}
      </div>
    </button>
  );
});

const GlobalSearch = memo(function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Search query
  const { data: results, isLoading } = useQuery({
    queryKey: ["global-search", query, isRegex, isCaseSensitive],
    queryFn: async () => {
      if (!query) return [];

      // TODO: Implement actual search across chat, files, and git
      // This is a placeholder that returns mock results
      const mockResults: SearchResult[] = [
        {
          type: "chat",
          title: "User message",
          preview: `This is a sample chat message containing "${query}"`,
          matchStart: 45,
          matchEnd: 45 + query.length,
          metadata: { threadId: "thread-1" },
        },
        {
          type: "file",
          title: "src/components/App.tsx",
          preview: `const App = () => { /* ${query} */ return <div />; }`,
          matchStart: 25,
          matchEnd: 25 + query.length,
          metadata: { filePath: "src/components/App.tsx", line: 15 },
        },
        {
          type: "git",
          title: "feat: add new feature",
          preview: `Implemented ${query} functionality`,
          matchStart: 12,
          matchEnd: 12 + query.length,
          metadata: { commitHash: "abc123", author: "Developer", date: "2026-05-16" },
        },
      ];

      return mockResults;
    },
    enabled: query.length > 0,
  });

  // Group results by type
  const groupedResults = useMemo(() => {
    if (!results) return {};

    const grouped: Record<SearchResultType, SearchResult[]> = {
      chat: [],
      file: [],
      git: [],
    };

    for (const result of results) {
      grouped[result.type].push(result);
    }

    return grouped;
  }, [results]);

  const handleSelect = useCallback((result: SearchResult) => {
    // TODO: Navigate to the selected result
    console.log("Selected:", result);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />

      {/* Search panel */}
      <div className="relative w-full max-w-2xl bg-background border rounded-lg shadow-lg">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across chat, files, and git..."
            className="flex-1 bg-transparent outline-none"
          />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsRegex(!isRegex)}
              className={cn(
                "px-2 py-1 text-xs rounded",
                isRegex ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
              title="Regex search"
            >
              .*
            </button>
            <button
              onClick={() => setIsCaseSensitive(!isCaseSensitive)}
              className={cn(
                "px-2 py-1 text-xs rounded",
                isCaseSensitive ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
              title="Case sensitive"
            >
              Aa
            </button>
            <button onClick={onClose} className="p-1 hover:bg-muted rounded">
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Searching...
            </div>
          ) : results && results.length > 0 ? (
            <div>
              {Object.entries(groupedResults).map(([type, items]) => {
                if (items.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/50">
                      {RESULT_TYPE_LABELS[type as SearchResultType]} ({items.length})
                    </div>
                    {items.map((result, i) => (
                      <SearchResultItem key={i} result={result} onSelect={handleSelect} />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : query ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              No results found
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Type to search...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
          <div>
            <kbd className="px-1.5 py-0.5 bg-muted rounded">Esc</kbd> to close
          </div>
          <div>
            <kbd className="px-1.5 py-0.5 bg-muted rounded">Enter</kbd> to select
          </div>
        </div>
      </div>
    </div>
  );
});

export { GlobalSearch };
