"use client";

import type { ProjectGlobalSearchFileMatch, ProjectGlobalSearchGitMatch } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CaseSensitiveIcon,
  FileTextIcon,
  GitCommitIcon,
  MessageSquareIcon,
  RegexIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { readEnvironmentApi } from "../environmentApi";
import { cn } from "../lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "../store";
import type { Project } from "../types";
import { Button } from "./ui/button";
import { CommandDialog, CommandDialogPopup } from "./ui/command";
import { Input } from "./ui/input";
import {
  buildGlobalSearchMatcher,
  highlightSearchText,
  searchChatMessages,
  type ChatSearchResult,
  type GlobalSearchMatcher,
} from "./GlobalSearch.logic";

const PROJECT_RESULT_LIMIT = 20;

interface ProjectSearchResult {
  readonly project: Project;
  readonly fileMatches: ReadonlyArray<ProjectGlobalSearchFileMatch>;
  readonly gitMatches: ReadonlyArray<ProjectGlobalSearchGitMatch>;
  readonly filesTruncated: boolean;
  readonly gitTruncated: boolean;
}

function isGlobalSearchShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "f" &&
    event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey
  );
}

function HighlightedText({
  text,
  matcher,
  className,
}: {
  readonly text: string;
  readonly matcher: GlobalSearchMatcher;
  readonly className?: string;
}) {
  return (
    <span className={className}>
      {highlightSearchText(text, matcher).map((segment, index) =>
        segment.match ? (
          <mark className="rounded-sm bg-primary/16 px-0.5 text-foreground" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

function ResultGroup({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <section className="border-t first:border-t-0">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-popover/96 px-4 py-2 text-muted-foreground text-xs backdrop-blur">
        <span className="font-medium">{title}</span>
        <span>{count}</span>
      </div>
      <div className="px-2 pb-2">{children}</div>
    </section>
  );
}

function ChatResultRow({
  result,
  matcher,
  onSelect,
}: {
  readonly result: ChatSearchResult;
  readonly matcher: GlobalSearchMatcher;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-start gap-3 rounded-md px-2 py-2 text-start hover:bg-accent"
      onClick={onSelect}
    >
      <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm">{result.threadTitle}</span>
          <span className="shrink-0 text-muted-foreground text-xs">{result.projectName}</span>
        </span>
        <HighlightedText
          className="mt-0.5 block truncate text-muted-foreground text-xs"
          matcher={matcher}
          text={result.snippet}
        />
      </span>
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {result.role}
      </span>
    </button>
  );
}

function FileResultRow({
  project,
  result,
  matcher,
}: {
  readonly project: Project;
  readonly result: ProjectGlobalSearchFileMatch;
  readonly matcher: GlobalSearchMatcher;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md px-2 py-2">
      <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm">{result.path}</span>
          <span className="shrink-0 text-muted-foreground text-xs">:{result.lineNumber}</span>
        </span>
        <HighlightedText
          className="mt-0.5 block truncate text-muted-foreground text-xs"
          matcher={matcher}
          text={result.preview}
        />
      </span>
      <span className="max-w-32 shrink-0 truncate text-muted-foreground text-xs">
        {project.name}
      </span>
    </div>
  );
}

function GitResultRow({
  project,
  result,
  matcher,
}: {
  readonly project: Project;
  readonly result: ProjectGlobalSearchGitMatch;
  readonly matcher: GlobalSearchMatcher;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md px-2 py-2">
      <GitCommitIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <HighlightedText
          className="block truncate text-sm"
          matcher={matcher}
          text={result.subject}
        />
        <span className="mt-0.5 block truncate text-muted-foreground text-xs">
          {result.shortSha} | {result.author}
        </span>
      </span>
      <span className="max-w-32 shrink-0 truncate text-muted-foreground text-xs">
        {project.name}
      </span>
    </div>
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const navigate = useNavigate();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectThreadsAcrossEnvironments));
  const trimmedQuery = query.trim();
  const matcherResult = useMemo(
    () => buildGlobalSearchMatcher(query, { regex, caseSensitive }),
    [caseSensitive, query, regex],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isGlobalSearchShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const chatResults = useMemo(() => {
    if (trimmedQuery.length === 0 || matcherResult.status !== "valid") {
      return [];
    }
    return searchChatMessages({ projects, threads, matcher: matcherResult.matcher });
  }, [matcherResult, projects, threads, trimmedQuery.length]);

  const projectSearchQuery = useQuery({
    queryKey: [
      "global-search",
      projects.map((project) => `${project.environmentId}:${project.cwd}`),
      trimmedQuery,
      regex,
      caseSensitive,
    ],
    queryFn: async (): Promise<ProjectSearchResult[]> => {
      const results = await Promise.all(
        projects.map(async (project) => {
          const api = readEnvironmentApi(project.environmentId);
          if (!api) {
            return null;
          }
          const result = await api.projects.globalSearch({
            cwd: project.cwd,
            query: trimmedQuery,
            limit: PROJECT_RESULT_LIMIT,
            regex,
            caseSensitive,
          });
          return { project, ...result };
        }),
      );
      return results.filter((result): result is ProjectSearchResult => result !== null);
    },
    enabled:
      open && trimmedQuery.length > 0 && matcherResult.status === "valid" && projects.length > 0,
    placeholderData: (previous) => previous ?? [],
  });

  const projectResults = projectSearchQuery.data ?? [];
  const fileResults = projectResults.flatMap((result) =>
    result.fileMatches.map((match) => ({ project: result.project, match })),
  );
  const gitResults = projectResults.flatMap((result) =>
    result.gitMatches.map((match) => ({ project: result.project, match })),
  );
  const hasAnyResults = chatResults.length > 0 || fileResults.length > 0 || gitResults.length > 0;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
    }
  };

  const matcher = matcherResult.status === "valid" ? matcherResult.matcher : null;

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandDialogPopup
        aria-label="Global search"
        className="overflow-hidden p-0"
        data-testid="global-search"
        onBackdropPointerDown={() => handleOpenChange(false)}
      >
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              aria-invalid={matcherResult.status === "invalid"}
              autoFocus
              className="border-transparent bg-transparent shadow-none before:hidden has-focus-visible:ring-0"
              nativeInput
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search chat, files, and commits..."
              size="lg"
              type="search"
              unstyled
              value={query}
            />
            <Button
              aria-pressed={regex}
              className={cn(regex && "bg-accent")}
              onClick={() => setRegex((value) => !value)}
              size="icon-sm"
              title="Regex"
              variant="ghost"
            >
              <RegexIcon />
            </Button>
            <Button
              aria-pressed={caseSensitive}
              className={cn(caseSensitive && "bg-accent")}
              onClick={() => setCaseSensitive((value) => !value)}
              size="icon-sm"
              title="Case sensitive"
              variant="ghost"
            >
              <CaseSensitiveIcon />
            </Button>
          </div>
          {matcherResult.status === "invalid" ? (
            <div className="px-6 pb-1 text-destructive text-xs">{matcherResult.message}</div>
          ) : null}
        </div>
        <div className="max-h-[min(34rem,72vh)] min-h-32 overflow-y-auto">
          {trimmedQuery.length === 0 ? null : matcher ? (
            <>
              <ResultGroup count={chatResults.length} title="Chat">
                {chatResults.map((result) => (
                  <ChatResultRow
                    key={result.id}
                    matcher={matcher}
                    onSelect={() => {
                      handleOpenChange(false);
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: {
                          environmentId: result.environmentId,
                          threadId: result.threadId,
                        },
                      });
                    }}
                    result={result}
                  />
                ))}
              </ResultGroup>
              <ResultGroup count={fileResults.length} title="Files">
                {fileResults.map(({ project, match }) => (
                  <FileResultRow
                    key={`${project.environmentId}:${project.id}:file:${match.path}:${match.lineNumber}`}
                    matcher={matcher}
                    project={project}
                    result={match}
                  />
                ))}
              </ResultGroup>
              <ResultGroup count={gitResults.length} title="Git">
                {gitResults.map(({ project, match }) => (
                  <GitResultRow
                    key={`${project.environmentId}:${project.id}:git:${match.sha}`}
                    matcher={matcher}
                    project={project}
                    result={match}
                  />
                ))}
              </ResultGroup>
              {!hasAnyResults && !projectSearchQuery.isFetching ? (
                <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No results
                </div>
              ) : null}
              {projectSearchQuery.isFetching ? (
                <div className="border-t px-4 py-3 text-muted-foreground text-xs">Searching...</div>
              ) : null}
            </>
          ) : null}
        </div>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
