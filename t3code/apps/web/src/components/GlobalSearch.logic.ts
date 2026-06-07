import type { ChatMessage, Project, ThreadShell } from "../types";

export type GlobalSearchSource = "chat" | "file" | "git";

export interface GlobalSearchOptions {
  readonly query: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
}

export interface GlobalSearchMatcher {
  readonly error: string | null;
  readonly matches: (value: string) => boolean;
  readonly highlight: (value: string) => ReadonlyArray<{ text: string; matched: boolean }>;
}

export interface ChatSearchInput {
  readonly threads: ReadonlyArray<ThreadShell>;
  readonly messagesByThreadId: Record<string, Record<string, ChatMessage>>;
  readonly projectsById: Record<string, Project>;
}

export interface GlobalSearchResult {
  readonly id: string;
  readonly source: GlobalSearchSource;
  readonly title: string;
  readonly context: string;
  readonly preview: string;
  readonly lineNumber?: number;
  readonly href?: string;
  readonly timestamp?: string;
}

const SNIPPET_RADIUS = 72;

function normalizeQuery(options: GlobalSearchOptions): string {
  return options.caseSensitive ? options.query : options.query.toLocaleLowerCase();
}

export function createGlobalSearchMatcher(options: GlobalSearchOptions): GlobalSearchMatcher {
  const rawQuery = options.query.trim();
  if (rawQuery.length === 0) {
    return {
      error: null,
      matches: () => false,
      highlight: (value) => [{ text: value, matched: false }],
    };
  }

  if (options.regex) {
    try {
      const flags = options.caseSensitive ? "g" : "gi";
      const matcher = new RegExp(rawQuery, flags);
      return {
        error: null,
        matches: (value) => {
          matcher.lastIndex = 0;
          return matcher.test(value);
        },
        highlight: (value) => splitByRegex(value, matcher),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid regular expression.",
        matches: () => false,
        highlight: (value) => [{ text: value, matched: false }],
      };
    }
  }

  const normalizedQuery = normalizeQuery(options);
  return {
    error: null,
    matches: (value) =>
      (options.caseSensitive ? value : value.toLocaleLowerCase()).includes(normalizedQuery),
    highlight: (value) => splitByPlainText(value, normalizedQuery, options.caseSensitive),
  };
}

function splitByPlainText(
  value: string,
  normalizedQuery: string,
  caseSensitive: boolean,
): ReadonlyArray<{ text: string; matched: boolean }> {
  if (normalizedQuery.length === 0) {
    return [{ text: value, matched: false }];
  }

  const haystack = caseSensitive ? value : value.toLocaleLowerCase();
  const parts: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;
  while (cursor < value.length) {
    const index = haystack.indexOf(normalizedQuery, cursor);
    if (index < 0) {
      parts.push({ text: value.slice(cursor), matched: false });
      break;
    }
    if (index > cursor) {
      parts.push({ text: value.slice(cursor, index), matched: false });
    }
    parts.push({ text: value.slice(index, index + normalizedQuery.length), matched: true });
    cursor = index + normalizedQuery.length;
  }
  return parts.length > 0 ? parts : [{ text: value, matched: false }];
}

function splitByRegex(
  value: string,
  matcher: RegExp,
): ReadonlyArray<{ text: string; matched: boolean }> {
  const parts: Array<{ text: string; matched: boolean }> = [];
  matcher.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: value.slice(cursor, match.index), matched: false });
    }
    const matchedText = match[0];
    if (matchedText.length === 0) {
      matcher.lastIndex += 1;
      continue;
    }
    parts.push({ text: matchedText, matched: true });
    cursor = match.index + matchedText.length;
  }
  if (cursor < value.length) {
    parts.push({ text: value.slice(cursor), matched: false });
  }
  return parts.length > 0 ? parts : [{ text: value, matched: false }];
}

export function buildSnippet(value: string, matcher: GlobalSearchMatcher): string {
  const firstMatchedPart = matcher.highlight(value).find((part) => part.matched);
  if (!firstMatchedPart) {
    return value.slice(0, SNIPPET_RADIUS * 2);
  }

  const index = value.indexOf(firstMatchedPart.text);
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(value.length, index + firstMatchedPart.text.length + SNIPPET_RADIUS);
  return `${start > 0 ? "... " : ""}${value.slice(start, end)}${end < value.length ? " ..." : ""}`;
}

export function searchChatMessages(
  input: ChatSearchInput,
  matcher: GlobalSearchMatcher,
): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];
  for (const thread of input.threads) {
    const messages = Object.values(input.messagesByThreadId[thread.id] ?? {});
    for (const message of messages) {
      if (!matcher.matches(message.text)) {
        continue;
      }
      const project = input.projectsById[thread.projectId];
      results.push({
        id: `chat:${thread.id}:${message.id}`,
        source: "chat",
        title: thread.title,
        context: `${project?.name ?? "Project"} - ${message.role}`,
        preview: buildSnippet(message.text, matcher),
        href: `/chat/${thread.environmentId}/${thread.id}`,
        timestamp: message.createdAt,
      });
    }
  }
  return results.toSorted((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""));
}

export function searchProjectEntries(
  entries: ReadonlyArray<{ path: string; kind: "file" | "directory"; parentPath?: string }>,
  matcher: GlobalSearchMatcher,
): GlobalSearchResult[] {
  return entries
    .filter((entry) => matcher.matches(entry.path))
    .map((entry) => ({
      id: `file:${entry.path}`,
      source: "file" as const,
      title: entry.path,
      context: entry.kind === "file" ? "Workspace file" : "Workspace directory",
      preview: buildSnippet(entry.path, matcher),
      ...(entry.kind === "file" ? { lineNumber: 1 } : {}),
    }));
}

export function searchGitRefs(
  refs: ReadonlyArray<{
    name: string;
    isRemote?: boolean;
    remoteName?: string;
    current: boolean;
    isDefault: boolean;
    worktreePath: string | null;
  }>,
  matcher: GlobalSearchMatcher,
): GlobalSearchResult[] {
  return refs
    .filter(
      (ref) =>
        matcher.matches(ref.name) ||
        (ref.remoteName ? matcher.matches(ref.remoteName) : false) ||
        (ref.worktreePath ? matcher.matches(ref.worktreePath) : false),
    )
    .map((ref) => ({
      id: `git:${ref.name}:${ref.remoteName ?? ""}`,
      source: "git" as const,
      title: ref.name,
      context: [
        ref.isRemote ? "Remote ref" : "Local ref",
        ref.current ? "current" : null,
        ref.isDefault ? "default" : null,
      ]
        .filter(Boolean)
        .join(" - "),
      preview: buildSnippet(
        [ref.name, ref.remoteName, ref.worktreePath].filter(Boolean).join(" "),
        matcher,
      ),
    }));
}

export function takeProgressiveResults<T>(
  results: ReadonlyArray<T>,
  visibleCount: number,
): ReadonlyArray<T> {
  return results.slice(0, Math.max(0, visibleCount));
}
