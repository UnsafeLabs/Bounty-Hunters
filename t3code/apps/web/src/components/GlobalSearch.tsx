import React, { useState, useCallback, useEffect, useRef } from "react";
import { SearchIcon, FileIcon, MessageSquareIcon, GitCommitIcon } from "lucide-react";

type SearchSource = "chat" | "files" | "git";

interface SearchResult {
  id: string;
  source: SearchSource;
  title: string;
  preview: string;
  path?: string;
}

const sourceIcons: Record<SearchSource, React.ReactNode> = {
  chat: <MessageSquareIcon className="h-4 w-4" />,
  files: <FileIcon className="h-4 w-4" />,
  git: <GitCommitIcon className="h-4 w-4" />,
};

const sourceLabels: Record<SearchSource, string> = {
  chat: "Chat Messages",
  files: "Files",
  git: "Git History",
};

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeSource, setActiveSource] = useState<SearchSource | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const mockResults: SearchResult[] = [
      { id: "1", source: "chat", title: "Previous conversation", preview: `...${q}...`, path: "chat/thread-1" },
      { id: "2", source: "files", title: "file.ts", preview: `contains ${q}`, path: "src/file.ts" },
      { id: "3", source: "git", title: "Fix issue", preview: `commit message with ${q}`, path: "abc123" },
    ];
    setResults(mockResults);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "f") {
        e.preventDefault();
        if (!isOpen) onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sources: (SearchSource | "all")[] = ["all", "chat", "files", "git"];
  const filtered = activeSource === "all" ? results : results.filter((r) => r.source === activeSource);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900">
        <div className="flex items-center border-b px-4">
          <SearchIcon className="h-5 w-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across chat, files, and git history..."
            className="flex-1 border-0 bg-transparent px-3 py-3 text-sm outline-none"
          />
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
            Esc
          </button>
        </div>
        <div className="flex gap-1 border-b px-3 py-2">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSource(s)}
              className={`rounded px-2 py-1 text-xs ${
                activeSource === s ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {s === "all" ? "All" : sourceLabels[s]}
            </button>
          ))}
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {filtered.length === 0 && query && (
            <div className="py-8 text-center text-sm text-gray-400">No results found</div>
          )}
          {filtered.map((result) => (
            <div
              key={result.id}
              className="flex cursor-pointer items-start gap-3 rounded px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <span className="mt-0.5 text-gray-400">{sourceIcons[result.source]}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{result.title}</div>
                <div className="text-xs text-gray-500 truncate">{result.preview}</div>
              </div>
              {result.path && <span className="text-xs text-gray-400 truncate max-w-32">{result.path}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
