import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { Search, X, FileIcon, MessageSquareIcon, GitCommitIcon, RegexIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  activeThreadId?: string;
  workspaceRoot?: string;
}

interface SearchResult {
  id: string;
  type: "chat" | "file" | "git";
  title: string;
  preview: string;
  metadata?: {
    threadId?: string;
    threadTitle?: string;
    filePath?: string;
    lineNumber?: number;
    commitHash?: string;
    author?: string;
    date?: string;
  };
  score: number;
}

interface SearchSource {
  type: "chat" | "file" | "git";
  label: string;
  icon: typeof MessageSquareIcon;
  count: number;
}

const SEARCH_SOURCES: SearchSource[] = [
  { type: "chat", label: "Chat Messages", icon: MessageSquareIcon, count: 0 },
  { type: "file", label: "Files", icon: FileIcon, count: 0 },
  { type: "git", label: "Git History", icon: GitCommitIcon, count: 0 },
];

const PAGE_SIZE = 20;

export const GlobalSearch = memo(function GlobalSearch({
  open,
  onClose,
  activeThreadId,
  workspaceRoot,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [selectedSource, setSelectedSource] = useState<"all" | "chat" | "file" | "git">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Validate regex pattern
  const regexError = useMemo(() => {
    if (!useRegex || !query) return null;
    try {
      new RegExp(query, caseSensitive ? "" : "i");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid regex pattern";
    }
  }, [query, useRegex, caseSensitive]);

  // Build search pattern
  const searchPattern = useMemo(() => {
    if (!query) return null;
    if (useRegex) {
      try {
        return new RegExp(query, caseSensitive ? "" : "i");
      } catch {
        return null;
      }
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, caseSensitive ? "" : "i");
  }, [query, useRegex, caseSensitive]);

  // Search chat messages
  const chatSearchQuery = useInfiniteQuery({
    queryKey: ["global-search", "chat", query, selectedSource, caseSensitive, useRegex],
    queryFn: async ({ pageParam = 0 }) => {
      if (!searchPattern || (selectedSource !== "all" && selectedSource !== "chat")) {
        return { results: [], nextCursor: null };
      }

      // Simulate API call - in real implementation, this would call a backend endpoint
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Mock results for demonstration
      const mockResults: SearchResult[] = [
        {
          id: "chat-1",
          type: "chat",
          title: "Discussion about authentication",
          preview: "We need to implement proper <mark>JWT</mark> tokens for the API",
          metadata: {
            threadId: "thread-123",
            threadTitle: "Auth Implementation",
          },
          score: 0.95,
        },
        {
          id: "chat-2",
          type: "chat",
          title: "Bug report: Login issue",
          preview: "Users are reporting that the <mark>login</mark> page crashes on mobile",
          metadata: {
            threadId: "thread-456",
            threadTitle: "Mobile Bugs",
          },
          score: 0.87,
        },
      ].filter((r) => searchPattern.test(r.title + " " + r.preview));

      return {
        results: mockResults.slice(pageParam, pageParam + PAGE_SIZE),
        nextCursor: pageParam + PAGE_SIZE < mockResults.length ? pageParam + PAGE_SIZE : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!searchPattern && (selectedSource === "all" || selectedSource === "chat"),
  });

  // Search files
  const fileSearchQuery = useInfiniteQuery({
    queryKey: ["global-search", "files", query, selectedSource, caseSensitive, useRegex],
    queryFn: async ({ pageParam = 0 }) => {
      if (!searchPattern || (selectedSource !== "all" && selectedSource !== "file")) {
        return { results: [], nextCursor: null };
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockResults: SearchResult[] = [
        {
          id: "file-1",
          type: "file",
          title: "src/auth/login.ts",
          preview: "export function <mark>authenticate</mark>(user: string, pass: string) {",
          metadata: {
            filePath: "src/auth/login.ts",
            lineNumber: 42,
          },
          score: 0.92,
        },
        {
          id: "file-2",
          type: "file",
          title: "src/components/Header.tsx",
          preview: "const <mark>Header</mark> = () => { return <nav>...</nav> }",
          metadata: {
            filePath: "src/components/Header.tsx",
            lineNumber: 15,
          },
          score: 0.85,
        },
      ].filter((r) => searchPattern.test(r.title + " " + r.preview));

      return {
        results: mockResults.slice(pageParam, pageParam + PAGE_SIZE),
        nextCursor: pageParam + PAGE_SIZE < mockResults.length ? pageParam + PAGE_SIZE : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!searchPattern && (selectedSource === "all" || selectedSource === "file"),
  });

  // Search git history
  const gitSearchQuery = useInfiniteQuery({
    queryKey: ["global-search", "git", query, selectedSource, caseSensitive, useRegex],
    queryFn: async ({ pageParam = 0 }) => {
      if (!searchPattern || (selectedSource !== "all" && selectedSource !== "git")) {
        return { results: [], nextCursor: null };
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const mockResults: SearchResult[] = [
        {
          id: "git-1",
          type: "git",
          title: "Fix authentication bug",
          preview: "Resolved issue with <mark>JWT</mark> token expiration handling",
          metadata: {
            commitHash: "abc1234",
            author: "John Doe",
            date: "2026-11-05",
          },
          score: 0.9,
        },
        {
          id: "git-2",
          type: "git",
          title: "Add user login feature",
          preview: "Implemented <mark>login</mark> page with form validation",
          metadata: {
            commitHash: "def5678",
            author: "Jane Smith",
            date: "2026-11-03",
          },
          score: 0.88,
        },
      ].filter((r) => searchPattern.test(r.title + " " + r.preview));

      return {
        results: mockResults.slice(pageParam, pageParam + PAGE_SIZE),
        nextCursor: pageParam + PAGE_SIZE < mockResults.length ? pageParam + PAGE_SIZE : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!searchPattern && (selectedSource === "all" || selectedSource === "git"),
  });

  // Combine all results
  const allResults = useMemo(() => {
    const chatResults = chatSearchQuery.data?.pages.flatMap((p) => p.results) ?? [];
    const fileResults = fileSearchQuery.data?.pages.flatMap((p) => p.results) ?? [];
    const gitResults = gitSearchQuery.data?.pages.flatMap((p) => p.results) ?? [];

    return [...chatResults, ...fileResults, ...gitResults].sort((a, b) => b.score - a.score);
  }, [chatSearchQuery.data, fileSearchQuery.data, gitSearchQuery.data]);

  // Count results by source
  const resultCounts = useMemo(() => {
    return {
      chat: allResults.filter((r) => r.type === "chat").length,
      file: allResults.filter((r) => r.type === "file").length,
      git: allResults.filter((r) => r.type === "git").length,
    };
  }, [allResults]);

  const isLoading = chatSearchQuery.isLoading || fileSearchQuery.isLoading || gitSearchQuery.isLoading;

  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh]">
      <div className="w-full max-w-3xl rounded-lg border border-border bg-background shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border p-4">
          <Search className="size-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across chat, files, and git history..."
            className="border-0 p-0 focus-visible:ring-0"
          />
          {query && (
            <Button variant="ghost" size="icon" onClick={handleClear} className="size-8">
              <X className="size-4" />
            </Button>
          )}
        </div>

        {/* Search options */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={useRegex ? "default" : "outline"}
                size="sm"
                onClick={() => setUseRegex(!useRegex)}
                className="gap-1.5"
              >
                <RegexIcon className="size-3.5" />
                Regex
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle regular expression search</TooltipContent>
          </Tooltip>

          <Button
            variant={caseSensitive ? "default" : "outline"}
            size="sm"
            onClick={() => setCaseSensitive(!caseSensitive)}
            className="text-xs"
          >
            Aa
          </Button>

          {regexError && (
            <Badge variant="destructive" className="ml-2 text-xs">
              {regexError}
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-1">
            {SEARCH_SOURCES.map((source) => {
              const count = resultCounts[source.type];
              const isActive = selectedSource === "all" || selectedSource === source.type;
              const Icon = source.icon;

              return (
                <Button
                  key={source.type}
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedSource(selectedSource === source.type ? "all" : source.type)}
                  className="gap-1.5 text-xs"
                >
                  <Icon className="size-3.5" />
                  {source.label}
                  {count > 0 && <Badge variant="outline">{count}</Badge>}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="max-h-[60vh]">
          {query && !searchPattern && !regexError && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Enter a search term to begin
            </div>
          )}

          {query && searchPattern && allResults.length === 0 && !isLoading && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          )}

          {allResults.length > 0 && (
            <div className="divide-y divide-border">
              {allResults.map((result) => (
                <SearchResultItem key={result.id} result={result} />
              ))}
            </div>
          )}

          {/* Load more triggers */}
          {chatSearchQuery.hasNextPage && (
            <div ref={chatSearchQuery.fetchNextPage as any} className="h-4" />
          )}
          {fileSearchQuery.hasNextPage && (
            <div ref={fileSearchQuery.fetchNextPage as any} className="h-4" />
          )}
          {gitSearchQuery.hasNextPage && (
            <div ref={gitSearchQuery.fetchNextPage as any} className="h-4" />
          )}

          {isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">Searching...</div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <div>
            {allResults.length > 0 && (
              <span>
                {allResults.length} result{allResults.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">Esc</kbd>{" "}
              to close
            </span>
            <span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">↵</kbd>{" "}
              to select
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

const SearchResultItem = memo(function SearchResultItem({ result }: { result: SearchResult }) {
  const Icon =
    result.type === "chat"
      ? MessageSquareIcon
      : result.type === "file"
        ? FileIcon
        : GitCommitIcon;

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
    >
      <div className="mt-0.5 rounded-md bg-muted p-1.5">
        <Icon className="size-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{result.title}</span>
          {result.metadata?.lineNumber && (
            <Badge variant="outline" className="text-[10px]">
              Line {result.metadata.lineNumber}
            </Badge>
          )}
          {result.metadata?.author && (
            <span className="text-xs text-muted-foreground">by {result.metadata.author}</span>
          )}
          {result.metadata?.date && (
            <span className="text-xs text-muted-foreground">{result.metadata.date}</span>
          )}
        </div>

        {result.metadata?.filePath && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {result.metadata.filePath}
          </div>
        )}

        {result.metadata?.threadTitle && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            in {result.metadata.threadTitle}
          </div>
        )}

        <div
          className="mt-1 line-clamp-2 text-sm text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: result.preview }}
        />
      </div>
    </button>
  );
});

// Global keyboard shortcut hook
export function useGlobalSearchShortcut() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "F") {
        event.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { open, setOpen };
}
