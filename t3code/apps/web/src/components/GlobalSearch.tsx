import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, X, MessageSquare, FileText, GitBranch, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { useCommandPaletteStore } from "~/commandPaletteStore";

// Types for search results
interface SearchResultItem {
  id: string;
  type: "chat" | "file" | "git";
  title: string;
  preview: string;
  matchedTerms: string[];
  metadata: {
    threadId?: string;
    environmentId?: string;
    filePath?: string;
    lineNumber?: number;
    commitHash?: string;
    author?: string;
    date?: string;
  };
}

interface SearchResponse {
  results: SearchResultItem[];
  hasMore: boolean;
  nextCursor?: string;
  totalCount: number;
}

interface SearchParams {
  query: string;
  cursor?: string;
  limit?: number;
  regex?: boolean;
  caseSensitive?: boolean;
  sources?: ("chat" | "file" | "git")[];
}

// Highlight matched terms in text
function HighlightText({ text, matchedTerms }: { text: string; matchedTerms: string[] }) {
  if (!matchedTerms.length) return <span>{text}</span>;

  const escapedTerms = matchedTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escapedTerms.join("|")})`, "gi");

  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

// Result group component
function ResultGroup({ title, icon: Icon, count, children, isOpen, onToggle }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title}</span>
        <span className="ml-auto px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded-full">
          {count}
        </span>
        <span className="ml-1">
          {isOpen ? (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
      </button>
      {isOpen && <div className="px-6 pb-3">{children}</div>}
    </div>
  );
}

// Individual result item
function SearchResultItem({ item, onClick }: { item: SearchResultItem; onClick: () => void }) {
  const icons = {
    chat: MessageSquare,
    file: FileText,
    git: GitBranch,
  };
  const Icon = icons[item.type];

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 hover:bg-accent/50 transition-colors rounded-lg text-left group"
    >
      <Icon className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm truncate">{item.title}</span>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded capitalize">
            {item.type}
          </span>
        </div>
        <div className="text-sm text-muted-foreground line-clamp-2">
          <HighlightText text={item.preview} matchedTerms={item.matchedTerms} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {item.metadata.filePath && (
            <span className="font-mono truncate">{item.metadata.filePath}</span>
          )}
          {item.metadata.lineNumber && (
            <span>:{item.metadata.lineNumber}</span>
          )}
          {item.metadata.author && (
            <span>• {item.metadata.author}</span>
          )}
          {item.metadata.date && (
            <span>• {new Date(item.metadata.date).toLocaleDateString()}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// Main Global Search Component
export function GlobalSearch() {
  const { open, setOpen, toggleOpen } = useCommandPaletteStore();
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [selectedSources, setSelectedSources] = useState<("chat" | "file" | "git")[]>(["chat", "file", "git"]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    chat: true,
    file: true,
    git: true,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fetch search results
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } = useInfiniteQuery({
    queryKey: ["globalSearch", query, regex, caseSensitive, selectedSources],
    queryFn: async ({ pageParam }) => {
      if (!query.trim()) return { results: [], hasMore: false, totalCount: 0 };

      const params = new URLSearchParams({
        q: query,
        limit: "20",
        regex: regex.toString(),
        caseSensitive: caseSensitive.toString(),
        sources: selectedSources.join(","),
      });

      if (pageParam) params.append("cursor", pageParam);

      const res = await fetch(`/api/search/global?${params}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<SearchResponse>;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!query.trim() && open,
    initialPageParam: undefined,
    placeholderData: keepPreviousData,
  });

  // Flatten results from all pages
  const allResults = data?.pages.flatMap(page => page.results) ?? [];
  const totalCount = data?.pages[0]?.totalCount ?? 0;

  // Group results by type
  const groupedResults = allResults.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {} as Record<string, SearchResultItem[]>);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "F") {
        e.preventDefault();
        toggleOpen();
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, toggleOpen, setOpen]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
    }
  }, [open]);

  // Clear results when query is empty
  const displayedResults = query.trim() ? allResults : [];

  const handleResultClick = useCallback((item: SearchResultItem) => {
    // Navigate to the result
    if (item.type === "chat" && item.metadata.threadId && item.metadata.environmentId) {
      window.location.href = `/chat/${item.metadata.environmentId}/${item.metadata.threadId}`;
    } else if (item.type === "file" && item.metadata.filePath) {
      // Open file in editor - this would integrate with your file tree
      console.log("Open file:", item.metadata.filePath);
    } else if (item.type === "git" && item.metadata.commitHash) {
      // Open commit view
      console.log("Open commit:", item.metadata.commitHash);
    }
    setOpen(false);
    setQuery("");
  }, [setOpen]);

  const toggleGroup = (type: string) => {
    setOpenGroups(prev => ({ ...prev, [type]: !prev[type] }));
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-16"
      onClick={(e) => {
        if (e.target === overlayRef.current) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <div className="w-full max-w-3xl bg-background border border-border shadow-xl rounded-xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search across chat, files, and git history... (Ctrl+Shift+F)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent placeholder:text-muted-foreground"
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Options */}
        <div className="px-4 py-2 border-b border-border flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={regex}
                onChange={(e) => setRegex(e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-muted-foreground">Regex</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-muted-foreground">Aa</span>
            </label>
          </div>
          <Separator orientation="vertical" className="h-5 mx-1" />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Sources:</span>
            {(["chat", "file", "git"] as const).map((source) => (
              <label key={source} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSources.includes(source)}
                  onChange={(e) => setSelectedSources(
                    e.target.checked
                      ? [...selectedSources, source]
                      : selectedSources.filter(s => s !== source)
                  )}
                  className="rounded border-input"
                />
                <span className="text-muted-foreground capitalize">{source}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="h-[60vh] p-3">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Searching...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center py-12 text-destructive">
              Failed to search. Please try again.
            </div>
          )}

          {query.trim() && !isLoading && displayedResults.length === 0 && !error && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              No results found for "{query}"
            </div>
          )}

          {displayedResults.length > 0 && (
            <div className="space-y-2">
              <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <span>{totalCount} result{totalCount !== 1 ? "s" : ""}</span>
                {isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>

              {(["chat", "file", "git"] as const).map((type) => {
                const results = groupedResults[type] || [];
                if (results.length === 0) return null;

                const Icons = { chat: MessageSquare, file: FileText, git: GitBranch };
                const Icon = Icons[type];

                return (
                  <ResultGroup
                    key={type}
                    title={type.charAt(0).toUpperCase() + type.slice(1)}
                    icon={Icon}
                    count={results.length}
                    isOpen={openGroups[type]}
                    onToggle={() => toggleGroup(type)}
                  >
                    <div className="space-y-1">
                      {results.map((item) => (
                        <SearchResultItem
                          key={item.id}
                          item={item}
                          onClick={() => handleResultClick(item)}
                        />
                      ))}
                    </div>
                  </ResultGroup>
                );
              })}

              {hasNextPage && (
                <Button
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Loading more...
                    </>
                  ) : (
                    "Load more results"
                  )}
                </Button>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border bg-muted/50">
          <p className="text-xs text-muted-foreground text-center">
            <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-[10px] font-mono">Esc</kbd>{" "}
            Close • <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-[10px] font-mono">⌘⇧F</kbd>{" "}
            Toggle
          </p>
        </div>
      </div>
    </div>
  );
}

// Export a hook to use global search anywhere
export function useGlobalSearch() {
  const { open, setOpen, toggleOpen } = useCommandPaletteStore();
  return { open, setOpen, toggleOpen };
}