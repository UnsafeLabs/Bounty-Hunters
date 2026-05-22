"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CaseSensitiveIcon,
  FileIcon,
  GitCommitIcon,
  MessageSquareIcon,
  RegexIcon,
  SearchIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useGlobalSearchStore } from "../globalSearchStore";
import { useGlobalSearchResults, type GlobalSearchGroup } from "./GlobalSearch.logic";
import { Input } from "./ui/input";
import { Kbd, KbdGroup } from "./ui/kbd";
import { ScrollArea } from "./ui/scroll-area";
import { Toggle } from "./ui/toggle";
import { cn } from "../lib/utils";

const EMPTY_GROUPS: ReadonlyArray<GlobalSearchGroup> = [];

function highlightText(
  text: string,
  ranges: ReadonlyArray<[number, number]>,
): ReactNode {
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let lastEnd = 0;
  for (const [start, end] of ranges) {
    if (start > lastEnd) parts.push(text.slice(lastEnd, start));
    parts.push(
      <mark
        key={start}
        className="rounded-sm bg-accent/60 px-0.5 text-accent-foreground"
      >
        {text.slice(start, end)}
      </mark>,
    );
    lastEnd = end;
  }
  if (lastEnd < text.length) parts.push(text.slice(lastEnd));
  return parts;
}

const sourceIcon: Record<GlobalSearchGroup["kind"], ReactNode> = {
  chat: <MessageSquareIcon className="h-4 w-4" />,
  file: <FileIcon className="h-4 w-4" />,
  git: <GitCommitIcon className="h-4 w-4" />,
};

const sourceLabel: Record<GlobalSearchGroup["kind"], string> = {
  chat: "Chat Messages",
  file: "Files",
  git: "Git Commits",
};

function SearchResults({
  groups,
  query,
  regexMode,
  isValidRegex,
}: {
  readonly groups: ReadonlyArray<GlobalSearchGroup>;
  readonly query: string;
  readonly regexMode: boolean;
  readonly isValidRegex: boolean;
}) {
  if (regexMode && !isValidRegex) {
    return (
      <div className="px-3 py-8 text-center text-destructive text-sm">
        Invalid regex pattern
      </div>
    );
  }

  if (!query) {
    return (
      <div className="px-3 py-8 text-center text-muted-foreground/60 text-sm">
        Type to search chats, files, and git history
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-muted-foreground text-sm">
        No results found
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[min(24rem,60vh)]">
      {groups.map((group) => (
        <div key={group.kind} className="p-1">
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground/80 text-xs font-medium">
            {sourceIcon[group.kind]}
            <span>{sourceLabel[group.kind]}</span>
            <span className="text-muted-foreground/50">({group.count})</span>
          </div>
          {group.matches.map((match, i) => (
            <div
              key={`${match.source}:${match.label}:${i}`}
              className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-foreground text-sm font-medium">
                  {match.label}
                </span>
                {match.sublabel ? (
                  <span className="truncate text-muted-foreground text-xs">
                    {match.sublabel}
                  </span>
                ) : null}
                <span className="line-clamp-2 text-muted-foreground/70 text-xs">
                  {match.highlightRanges.length > 0
                    ? highlightText(match.preview, match.highlightRanges)
                    : match.preview}
                </span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </ScrollArea>
  );
}

export function GlobalSearchOverlay() {
  const open = useGlobalSearchStore((store) => store.open);
  const setOpen = useGlobalSearchStore((store) => store.setOpen);
  const toggleOpen = useGlobalSearchStore((store) => store.toggleOpen);
  const storeQuery = useGlobalSearchStore((store) => store.query);
  const setQuery = useGlobalSearchStore((store) => store.setQuery);
  const [regexMode, setRegexMode] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const deferredQuery = useDeferredValue(storeQuery);

  const { groups } = useGlobalSearchResults(
    caseSensitive ? deferredQuery : deferredQuery.toLowerCase(),
  );

  const isValidRegex = useMemo(() => {
    if (!regexMode || !deferredQuery) return true;
    try {
      new RegExp(deferredQuery, caseSensitive ? "" : "iu");
      return true;
    } catch {
      return false;
    }
  }, [regexMode, deferredQuery, caseSensitive]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "f" && event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleOpen]);

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    },
    [setQuery],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {open ? (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop
            className="fixed inset-0 z-50 bg-background/60 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
            onPointerDown={() => setOpen(false)}
          />
          <DialogPrimitive.Viewport className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center px-4 py-[max(--spacing(4),4vh)] sm:py-[10vh]">
            <DialogPrimitive.Popup className="pointer-events-auto -translate-y-[calc(1.25rem*var(--nested-dialogs))] relative row-start-2 flex max-h-105 min-h-0 w-full min-w-0 max-w-xl scale-[calc(1-0.1*var(--nested-dialogs))] flex-col rounded-2xl border bg-popover not-dark:bg-clip-padding text-popover-foreground opacity-[calc(1-0.1*var(--nested-dialogs))] shadow-lg/5 outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0">
              <div className="relative flex items-center px-2.5 py-1.5">
                <SearchIcon className="pointer-events-none absolute start-5 size-4 text-muted-foreground/60" />
                <input
                  autoFocus
                  className="flex h-10 w-full rounded-md border-0 bg-transparent ps-9 text-sm outline-none placeholder:text-muted-foreground/60"
                  placeholder="Search chats, files, and git history\u2026"
                  value={storeQuery}
                  onChange={handleQueryChange}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setOpen(false);
                  }}
                />
              </div>
              <div className="flex items-center gap-1 border-b px-3 py-1.5">
                <Toggle
                  size="sm"
                  pressed={regexMode}
                  onPressedChange={setRegexMode}
                  aria-label="Enable regex search"
                  className="h-6 gap-1 px-1.5 text-xs"
                >
                  <RegexIcon className="h-3 w-3" />
                  .*
                </Toggle>
                <Toggle
                  size="sm"
                  pressed={caseSensitive}
                  onPressedChange={setCaseSensitive}
                  aria-label="Toggle case sensitivity"
                  className="h-6 gap-1 px-1.5 text-xs"
                >
                  <CaseSensitiveIcon className="h-3 w-3" />
                  Aa
                </Toggle>
              </div>
              <SearchResults
                groups={groups}
                query={deferredQuery}
                regexMode={regexMode}
                isValidRegex={isValidRegex}
              />
              <div className="flex items-center justify-between gap-2 rounded-b-[calc(var(--radius-2xl)-1px)] border-t px-5 py-3 text-muted-foreground text-xs">
                <KbdGroup className="items-center gap-1.5">
                  <Kbd>Esc</Kbd>
                  <span>Close</span>
                </KbdGroup>
                <KbdGroup className="items-center gap-1.5">
                  <Kbd>&uarr;</Kbd>
                  <Kbd>&darr;</Kbd>
                  <span>Navigate</span>
                </KbdGroup>
              </div>
            </DialogPrimitive.Popup>
          </DialogPrimitive.Viewport>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}
