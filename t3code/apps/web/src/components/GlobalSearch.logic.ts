import type { EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { Project, Thread } from "../types";

const SNIPPET_RADIUS = 56;
const MAX_CHAT_RESULTS = 80;

export interface GlobalSearchOptions {
  readonly regex: boolean;
  readonly caseSensitive: boolean;
}

export interface MatchRange {
  readonly start: number;
  readonly end: number;
}

export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

export interface GlobalSearchMatcher {
  readonly matches: (value: string) => boolean;
  readonly ranges: (value: string) => MatchRange[];
}

export type GlobalSearchMatcherResult =
  | {
      readonly status: "valid";
      readonly matcher: GlobalSearchMatcher;
    }
  | {
      readonly status: "invalid";
      readonly message: string;
    };

export interface ChatSearchResult {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly threadTitle: string;
  readonly projectName: string;
  readonly role: Thread["messages"][number]["role"];
  readonly snippet: string;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCase(input: string, caseSensitive: boolean): string {
  return caseSensitive ? input : input.toLowerCase();
}

function collectRegExpRanges(value: string, pattern: RegExp): MatchRange[] {
  const ranges: MatchRange[] = [];
  const globalPattern = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(value)) !== null) {
    const text = match[0] ?? "";
    if (text.length === 0) {
      globalPattern.lastIndex += 1;
      continue;
    }
    ranges.push({ start: match.index, end: match.index + text.length });
  }
  return ranges;
}

export function buildGlobalSearchMatcher(
  query: string,
  options: GlobalSearchOptions,
): GlobalSearchMatcherResult {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return {
      status: "valid",
      matcher: {
        matches: () => false,
        ranges: () => [],
      },
    };
  }

  if (options.regex) {
    try {
      const pattern = new RegExp(trimmedQuery, options.caseSensitive ? "" : "i");
      return {
        status: "valid",
        matcher: {
          matches: (value) => pattern.test(value),
          ranges: (value) => collectRegExpRanges(value, pattern),
        },
      };
    } catch (error) {
      return {
        status: "invalid",
        message: error instanceof Error ? error.message : "Invalid regular expression.",
      };
    }
  }

  const normalizedQuery = normalizeCase(trimmedQuery, options.caseSensitive);
  const literalPattern = new RegExp(escapeRegExp(trimmedQuery), options.caseSensitive ? "g" : "gi");
  return {
    status: "valid",
    matcher: {
      matches: (value) => normalizeCase(value, options.caseSensitive).includes(normalizedQuery),
      ranges: (value) => collectRegExpRanges(value, literalPattern),
    },
  };
}

export function createSnippet(value: string, ranges: ReadonlyArray<MatchRange>): string {
  const firstMatch = ranges[0];
  if (!firstMatch) {
    return value.trim().slice(0, SNIPPET_RADIUS * 2);
  }

  const start = Math.max(0, firstMatch.start - SNIPPET_RADIUS);
  const end = Math.min(value.length, firstMatch.end + SNIPPET_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < value.length ? "..." : "";
  return `${prefix}${value.slice(start, end).trim()}${suffix}`;
}

export function highlightSearchText(
  value: string,
  matcher: GlobalSearchMatcher,
): HighlightSegment[] {
  const ranges = matcher.ranges(value);
  if (ranges.length === 0) {
    return [{ text: value, match: false }];
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: value.slice(cursor, range.start), match: false });
    }
    segments.push({ text: value.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor), match: false });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

export function searchChatMessages(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly threads: ReadonlyArray<Thread>;
  readonly matcher: GlobalSearchMatcher;
  readonly limit?: number;
}): ChatSearchResult[] {
  const limit = input.limit ?? MAX_CHAT_RESULTS;
  const projectNameByScopedId = new Map(
    input.projects.map((project) => [`${project.environmentId}:${project.id}`, project.name]),
  );
  const results: ChatSearchResult[] = [];

  for (const thread of input.threads) {
    const projectName = projectNameByScopedId.get(`${thread.environmentId}:${thread.projectId}`);
    for (const message of thread.messages) {
      if (!input.matcher.matches(message.text)) {
        continue;
      }

      results.push({
        id: `${thread.environmentId}:${thread.id}:${message.id}`,
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        threadId: thread.id,
        messageId: message.id,
        threadTitle: thread.title,
        projectName: projectName ?? thread.projectId,
        role: message.role,
        snippet: createSnippet(message.text, input.matcher.ranges(message.text)),
      });
      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}
