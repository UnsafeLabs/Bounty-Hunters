import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  CaseSensitiveIcon,
  FileTextIcon,
  GitCommitIcon,
  MessageSquareIcon,
  RegexIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useStore } from "../store";
import { projectSearchEntriesQueryOptions } from "../lib/projectReactQuery";
import { gitBranchSearchInfiniteQueryOptions } from "../lib/gitReactQuery";
import {
  createGlobalSearchMatcher,
  searchChatMessages,
  searchGitRefs,
  searchProjectEntries,
  takeProgressiveResults,
  type GlobalSearchResult,
  type GlobalSearchSource,
} from "./GlobalSearch.logic";

const INITIAL_VISIBLE_RESULTS = 20;
const VISIBLE_RESULTS_STEP = 20;

const SOURCE_LABELS: Record<GlobalSearchSource, string> = {
  chat: "Chat",
  file: "Files",
  git: "Git",
};

function sourceIcon(source: GlobalSearchSource) {
  if (source === "chat") return <MessageSquareIcon className="size-4" />;
  if (source === "file") return <FileTextIcon className="size-4" />;
  return <GitCommitIcon className="size-4" />;
}

function isGlobalSearchShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f";
}

function ToggleButton({
  active,
  label,
  onClick,
  icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex size-8 items-center justify-center rounded-md border text-xs transition ${
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
      title={label}
    >
      {icon}
    </button>
  );
}

function HighlightedText({
  text,
  matcher,
}: {
  text: string;
  matcher: ReturnType<typeof createGlobalSearchMatcher>;
}) {
  return (
    <>
      {matcher.highlight(text).map((part, index) =>
        part.matched ? (
          <mark key={index} className="rounded-sm bg-yellow-300 px-0.5 text-black">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function ResultRow({
  result,
  matcher,
}: {
  result: GlobalSearchResult;
  matcher: ReturnType<typeof createGlobalSearchMatcher>;
}) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="mt-1 flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {sourceIcon(result.source)}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">
            <HighlightedText text={result.title} matcher={matcher} />
          </span>
          {result.lineNumber ? (
            <span className="shrink-0 text-xs text-muted-foreground">line {result.lineNumber}</span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{result.context}</div>
        <div className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/80">
          <HighlightedText text={result.preview} matcher={matcher} />
        </div>
      </div>
    </div>
  );
}

function ResultGroup({
  source,
  results,
  matcher,
}: {
  source: GlobalSearchSource;
  results: ReadonlyArray<GlobalSearchResult>;
  matcher: ReturnType<typeof createGlobalSearchMatcher>;
}) {
  if (results.length === 0) {
    return null;
  }

  return (
    <section aria-label={`${SOURCE_LABELS[source]} results`}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-y border-border bg-muted/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
        <span className="inline-flex items-center gap-2">
          {sourceIcon(source)}
          {SOURCE_LABELS[source]}
        </span>
        <span>{results.length}</span>
      </div>
      {results.map((result) => (
        <ResultRow key={result.id} result={result} matcher={matcher} />
      ))}
    </section>
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_RESULTS);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const environmentState = useStore((state) =>
    activeEnvironmentId ? state.environmentStateById[activeEnvironmentId] : undefined,
  );
  const firstProjectId = environmentState?.projectIds[0] ?? null;
  const activeProject =
    environmentState && firstProjectId ? environmentState.projectById[firstProjectId] : undefined;
  const activeProjectCwd = activeProject?.cwd ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isGlobalSearchShortcut(event)) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(handle);
  }, [open]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_RESULTS);
  }, [query, regex, caseSensitive]);

  const matcher = useMemo(
    () => createGlobalSearchMatcher({ query, regex, caseSensitive }),
    [caseSensitive, query, regex],
  );
  const trimmedQuery = query.trim();
  const searchEnabled = open && trimmedQuery.length > 0 && matcher.error === null;

  const fileSearch = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: activeEnvironmentId,
      cwd: activeProjectCwd,
      query: trimmedQuery,
      enabled: searchEnabled && activeProjectCwd !== null,
      limit: 120,
    }),
  );

  const gitSearch = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      environmentId: activeEnvironmentId,
      cwd: activeProjectCwd,
      query: trimmedQuery,
      enabled: searchEnabled && activeProjectCwd !== null,
    }),
  );

  const chatResults = useMemo(() => {
    if (!environmentState || !searchEnabled) return [];
    return searchChatMessages(
      {
        threads: Object.values(environmentState.threadShellById),
        messagesByThreadId: environmentState.messageByThreadId,
        projectsById: environmentState.projectById,
      },
      matcher,
    );
  }, [environmentState, matcher, searchEnabled]);

  const fileResults = useMemo(
    () => searchProjectEntries(fileSearch.data?.entries ?? [], matcher),
    [fileSearch.data?.entries, matcher],
  );

  const gitResults = useMemo(() => {
    const refs = gitSearch.data?.pages.flatMap((page) => page.refs) ?? [];
    return searchGitRefs(refs, matcher);
  }, [gitSearch.data?.pages, matcher]);

  const grouped = useMemo(
    () => ({
      chat: takeProgressiveResults(chatResults, visibleCount),
      file: takeProgressiveResults(fileResults, visibleCount),
      git: takeProgressiveResults(gitResults, visibleCount),
    }),
    [chatResults, fileResults, gitResults, visibleCount],
  );
  const totalResults = chatResults.length + fileResults.length + gitResults.length;
  const visibleResults = grouped.chat.length + grouped.file.length + grouped.git.length;

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      className="fixed inset-0 z-50 bg-background/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
    >
      <div className="mx-auto flex h-[min(760px,calc(100dvh-2rem))] max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats, files, and git history..."
            aria-label="Search chats, files, and git history"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <ToggleButton
            active={regex}
            label="Toggle regex search"
            onClick={() => setRegex((current) => !current)}
            icon={<RegexIcon className="size-4" />}
          />
          <ToggleButton
            active={caseSensitive}
            label="Toggle case-sensitive search"
            onClick={() => setCaseSensitive((current) => !current)}
            icon={<CaseSensitiveIcon className="size-4" />}
          />
          <button
            type="button"
            aria-label="Close global search"
            onClick={() => setOpen(false)}
            className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            title="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {matcher.error ? (
          <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            Invalid regex: {matcher.error}
          </div>
        ) : null}

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollTop + element.clientHeight >= element.scrollHeight - 96) {
              setVisibleCount((current) => current + VISIBLE_RESULTS_STEP);
              if (gitSearch.hasNextPage && !gitSearch.isFetchingNextPage) {
                void gitSearch.fetchNextPage();
              }
            }
          }}
        >
          {trimmedQuery.length === 0 ? (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
              Start typing to search across chat messages, workspace paths, and git refs.
            </div>
          ) : totalResults === 0 && !fileSearch.isPending && !gitSearch.isPending ? (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
              No results found.
            </div>
          ) : (
            <>
              <ResultGroup source="chat" results={grouped.chat} matcher={matcher} />
              <ResultGroup source="file" results={grouped.file} matcher={matcher} />
              <ResultGroup source="git" results={grouped.git} matcher={matcher} />
              {visibleResults < totalResults || gitSearch.hasNextPage ? (
                <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                  Scroll to load more results.
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{totalResults} results</span>
          <span>Esc closes</span>
        </div>
      </div>
    </div>
  );
}
