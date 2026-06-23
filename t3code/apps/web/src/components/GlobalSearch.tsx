"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  SearchIcon,
  MessageSquareIcon,
  FileIcon,
  GitCommitIcon,
  XIcon,
  AsteriskIcon,
  TypeIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useStore, selectThreadsAcrossEnvironments, selectProjectsAcrossEnvironments } from "../store";
import { useShallow } from "zustand/react/shallow";
import { readEnvironmentApi } from "../environmentApi";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { Dialog, DialogPopup } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Kbd, KbdGroup } from "./ui/kbd";
import { ScrollArea } from "./ui/scroll-area";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { buildThreadRouteParams } from "../threadRoutes";

interface SearchResult {
  id: string;
  type: "chat" | "file" | "git";
  title: string;
  preview: string;
  matchRanges: Array<{ start: number; end: number }>;
  threadRef?: { environmentId: string; threadId: string };
  filePath?: string;
  lineNumber?: number;
  author?: string;
  date?: string;
}

interface GlobalSearchState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

let globalSearchStore: GlobalSearchState | null = null;

export function getGlobalSearchStore(): GlobalSearchState {
  if (!globalSearchStore) {
    let open = false;
    const listeners = new Set<() => void>();
    globalSearchStore = {
      get open() {
        return open;
      },
      setOpen: (value: boolean) => {
        open = value;
        listeners.forEach((l) => l());
      },
      toggleOpen: () => {
        open = !open;
        listeners.forEach((l) => l());
      },
    };
  }
  return globalSearchStore;
}

function highlightMatches(text: string, ranges: Array<{ start: number; end: number }>): React.ReactNode {
  if (ranges.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  ranges.forEach((range, i) => {
    if (range.start > lastEnd) {
      parts.push(text.slice(lastEnd, range.start));
    }
    parts.push(
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
        {text.slice(range.start, range.end)}
      </mark>
    );
    lastEnd = range.end;
  });
  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }
  return parts;
}

function findMatches(text: string, query: string, useRegex: boolean, caseSensitive: boolean): Array<{ start: number; end: number }> {
  if (!query) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  try {
    const flags = caseSensitive ? "g" : "gi";
    const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(pattern, flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) break;
    }
  } catch {
    // Invalid regex
  }
  return ranges;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const threads = useStore(useShallow(selectThreadsAcrossEnvironments));
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));

  // Fetch file search results
  const { data: fileResults, isLoading: filesLoading } = useQuery({
    queryKey: ["globalSearch", "files", query, primaryEnvironmentId],
    queryFn: async () => {
      if (!query || !primaryEnvironmentId) return [];
      const api = readEnvironmentApi(primaryEnvironmentId);
      if (!api) return [];
      try {
        const result = await api.projects.searchEntries({ query, limit: 50 });
        return result.entries || [];
      } catch {
        return [];
      }
    },
    enabled: query.length > 0 && !!primaryEnvironmentId,
    staleTime: 30_000,
  });

  // Fetch git log results
  const { data: gitResults, isLoading: gitLoading } = useQuery({
    queryKey: ["globalSearch", "git", query, primaryEnvironmentId],
    queryFn: async () => {
      if (!query || !primaryEnvironmentId) return [];
      const api = readEnvironmentApi(primaryEnvironmentId);
      if (!api) return [];
      try {
        // Use vcs to get git history - list refs and get commit info
        const refs = await api.vcs.listRefs({});
        return refs.refs || [];
      } catch {
        return [];
      }
    },
    enabled: query.length > 0 && !!primaryEnvironmentId,
    staleTime: 60_000,
  });

  // Build search results
  const results = useMemo(() => {
    const allResults: SearchResult[] = [];
    if (!query) return allResults;

    // Search chat messages
    threads.forEach((thread) => {
      const envState = useStore.getState().environmentStateById[thread.environmentId];
      if (!envState) return;
      const messages = envState.messageByThreadId[thread.id];
      if (!messages) return;
      Object.values(messages).forEach((msg) => {
        const content = msg.content || "";
        const ranges = findMatches(content, query, useRegex, caseSensitive);
        if (ranges.length > 0) {
          const previewStart = Math.max(0, ranges[0].start - 40);
          const previewEnd = Math.min(content.length, ranges[ranges.length - 1].end + 40);
          allResults.push({
            id: `chat-${thread.id}-${msg.id}`,
            type: "chat",
            title: thread.title || "Untitled Thread",
            preview: content.slice(previewStart, previewEnd),
            matchRanges: ranges.map((r) => ({
              start: r.start - previewStart,
              end: r.end - previewStart,
            })),
            threadRef: { environmentId: thread.environmentId, threadId: thread.id },
          });
        }
      });
    });

    // Search files
    fileResults?.forEach((entry: { path: string; content?: string }) => {
      const content = entry.content || entry.path;
      const ranges = findMatches(content, query, useRegex, caseSensitive);
      if (ranges.length > 0) {
        const previewStart = Math.max(0, ranges[0].start - 40);
        const previewEnd = Math.min(content.length, ranges[ranges.length - 1].end + 40);
        allResults.push({
          id: `file-${entry.path}`,
          type: "file",
          title: entry.path.split("/").pop() || entry.path,
          preview: content.slice(previewStart, previewEnd),
          matchRanges: ranges.map((r) => ({
            start: r.start - previewStart,
            end: r.end - previewStart,
          })),
          filePath: entry.path,
        });
      }
    });

    // Search git commits
    gitResults?.forEach((ref: { name: string; commit?: { message?: string; author?: string; date?: string } }) => {
      const message = ref.commit?.message || ref.name;
      const ranges = findMatches(message, query, useRegex, caseSensitive);
      if (ranges.length > 0) {
        const previewStart = Math.max(0, ranges[0].start - 40);
        const previewEnd = Math.min(message.length, ranges[ranges.length - 1].end + 40);
        allResults.push({
          id: `git-${ref.name}`,
          type: "git",
          title: ref.name,
          preview: message.slice(previewStart, previewEnd),
          matchRanges: ranges.map((r) => ({
            start: r.start - previewStart,
            end: r.end - previewStart,
          })),
          author: ref.commit?.author,
          date: ref.commit?.date,
        });
      }
    });

    return allResults;
  }, [query, threads, fileResults, gitResults, useRegex, caseSensitive]);

  // Group results by type
  const groupedResults = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    results.forEach((r) => {
      if (!groups[r.type]) groups[r.type] = [];
      groups[r.type].push(r);
    });
    return groups;
  }, [results]);

  const chatResults = groupedResults["chat"] || [];
  const fileResultList = groupedResults["file"] || [];
  const gitResultList = groupedResults["git"] || [];

  const totalCount = results.length;

  // Keyboard shortcut: Ctrl+Shift+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        const result = results[selectedIndex];
        if (result.threadRef) {
          navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(result.threadRef.environmentId, result.threadRef.threadId)),
          });
        }
        setOpen(false);
      }
    },
    [results, selectedIndex, navigate]
  );

  const isLoading = filesLoading || gitLoading;

  const typeIcons = {
    chat: <MessageSquareIcon className="w-4 h-4" />,
    file: <FileIcon className="w-4 h-4" />,
    git: <GitCommitIcon className="w-4 h-4" />,
  };

  const typeLabels = {
    chat: "Chat",
    file: "Files",
    git: "Git History",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-w-2xl w-full p-0 overflow-hidden">
        <div className="flex flex-col max-h-[80vh]">
          {/* Search input */}
          <div className="flex items-center gap-2 p-4 border-b">
            <SearchIcon className="w-5 h-5 text-muted-foreground shrink-0" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search across chat, files, and git history..."
              className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0"
            />
            <div className="flex items-center gap-1">
              <Button
                variant={useRegex ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setUseRegex(!useRegex)}
                title="Toggle regex"
              >
                <AsteriskIcon className="w-4 h-4" />
              </Button>
              <Button
                variant={caseSensitive ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setCaseSensitive(!caseSensitive)}
                title="Toggle case sensitivity"
              >
                <TypeIcon className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOpen(false)}
              >
                <XIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Results */}
          <ScrollArea className="flex-1">
            {isLoading && query && (
              <div className="p-4 text-center text-muted-foreground">Searching...</div>
            )}

            {!isLoading && query && totalCount === 0 && (
              <div className="p-4 text-center text-muted-foreground">No results found</div>
            )}

            {query && totalCount > 0 && (
              <div className="p-2">
                {/* Chat results */}
                {chatResults.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
                      {typeIcons.chat}
                      Chat ({chatResults.length})
                    </div>
                    {chatResults.map((result, idx) => {
                      const globalIdx = results.indexOf(result);
                      return (
                        <div
                          key={result.id}
                          className={cn(
                            "px-3 py-2 rounded-md cursor-pointer text-sm",
                            selectedIndex === globalIdx
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted"
                          )}
                          onClick={() => {
                            if (result.threadRef) {
                              navigate({
                                to: "/$environmentId/$threadId",
                                params: buildThreadRouteParams(
                                  scopeThreadRef(result.threadRef.environmentId, result.threadRef.threadId)
                                ),
                              });
                            }
                            setOpen(false);
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                        >
                          <div className="font-medium truncate">{result.title}</div>
                          <div className="text-muted-foreground truncate text-xs mt-0.5">
                            {highlightMatches(result.preview, result.matchRanges)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* File results */}
                {fileResultList.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
                      {typeIcons.file}
                      Files ({fileResultList.length})
                    </div>
                    {fileResultList.map((result, idx) => {
                      const globalIdx = results.indexOf(result);
                      return (
                        <div
                          key={result.id}
                          className={cn(
                            "px-3 py-2 rounded-md cursor-pointer text-sm",
                            selectedIndex === globalIdx
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted"
                          )}
                          onClick={() => setOpen(false)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                        >
                          <div className="font-medium truncate">{result.title}</div>
                          {result.filePath && (
                            <div className="text-muted-foreground text-xs">{result.filePath}</div>
                          )}
                          <div className="text-muted-foreground truncate text-xs mt-0.5">
                            {highlightMatches(result.preview, result.matchRanges)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Git results */}
                {gitResultList.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
                      {typeIcons.git}
                      Git History ({gitResultList.length})
                    </div>
                    {gitResultList.map((result, idx) => {
                      const globalIdx = results.indexOf(result);
                      return (
                        <div
                          key={result.id}
                          className={cn(
                            "px-3 py-2 rounded-md cursor-pointer text-sm",
                            selectedIndex === globalIdx
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted"
                          )}
                          onClick={() => setOpen(false)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                        >
                          <div className="font-medium truncate">{result.title}</div>
                          {(result.author || result.date) && (
                            <div className="text-muted-foreground text-xs">
                              {result.author} {result.date && `· ${new Date(result.date).toLocaleDateString()}`}
                            </div>
                          )}
                          <div className="text-muted-foreground truncate text-xs mt-0.5">
                            {highlightMatches(result.preview, result.matchRanges)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Footer */}
          <div className="flex items-center gap-3 px-4 py-2 border-t text-xs text-muted-foreground">
            <KbdGroup className="items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>Navigate</span>
            </KbdGroup>
            <KbdGroup className="items-center gap-1">
              <Kbd>Enter</Kbd>
              <span>Select</span>
            </KbdGroup>
            <KbdGroup className="items-center gap-1">
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </KbdGroup>
            {totalCount > 0 && (
              <span className="ml-auto">
                {totalCount} result{totalCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
