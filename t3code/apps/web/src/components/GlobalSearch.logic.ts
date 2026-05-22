import type {
  EnvironmentId,
  ProjectId,
  SidebarThreadSummary,
  ChatMessage,
} from "@t3tools/contracts";
import {
  normalizeSearchQuery,
  scoreQueryMatch,
  insertRankedSearchResult,
  type RankedSearchResult,
} from "@t3tools/shared/searchRanking";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  selectSidebarThreadsAcrossEnvironments,
  selectThreadMessages,
  useStore,
} from "../store";

export type SearchSourceKind = "chat" | "file" | "git";

export interface GlobalSearchMatch {
  readonly source: SearchSourceKind;
  readonly label: string;
  readonly preview: string;
  readonly sublabel?: string;
  readonly highlightRanges: ReadonlyArray<[number, number]>;
  readonly action: () => void;
}

export interface GlobalSearchGroup {
  readonly kind: SearchSourceKind;
  readonly label: string;
  readonly count: number;
  readonly matches: ReadonlyArray<GlobalSearchMatch>;
}

export interface SearchChatOptions {
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly messagesByThread: ReadonlyMap<
    string,
    ReadonlyArray<ChatMessage>
  >;
}

const CHAT_SEARCH_LIMIT = 20;
const SCORE_EXACT = 3;
const SCORE_PREFIX = 2;
const SCORE_BOUNDARY = 1;
const SCORE_INCLUDES = 0;

function findHighlightRanges(
  text: string,
  query: string,
): ReadonlyArray<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let startIndex = 0;

  for (let i = 0; i < 10; i++) {
    const index = lowerText.indexOf(lowerQuery, startIndex);
    if (index === -1) break;
    ranges.push([index, index + query.length]);
    startIndex = index + query.length;
  }

  return ranges;
}

export function searchChatMessages(
  query: string,
  options: SearchChatOptions,
): ReadonlyArray<GlobalSearchMatch> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];

  const ranked: Array<RankedSearchResult<GlobalSearchMatch>> = [];
  const threadById = new Map(
    options.threads.map((t) => [t.id, t]),
  );

  for (const [threadId, messages] of options.messagesByThread) {
    const thread = threadById.get(threadId);
    for (const message of messages) {
      const score = scoreQueryMatch({
        value: message.text.toLowerCase(),
        query: normalized,
        exactBase: SCORE_EXACT,
        prefixBase: SCORE_PREFIX,
        boundaryBase: SCORE_BOUNDARY,
        includesBase: SCORE_INCLUDES,
      });
      if (score === null) continue;

      const preview = message.text.length > 120
        ? `${message.text.slice(0, 120)}\u2026`
        : message.text;
      const ranges = findHighlightRanges(message.text, normalized);

      insertRankedSearchResult(ranked, {
        item: {
          source: "chat",
          label: thread?.title ?? threadId,
          preview,
          sublabel: message.role === "user" ? "You" : "Assistant",
          highlightRanges: ranges,
          action: () => {},
        },
        score,
        tieBreaker: thread?.title ?? threadId,
      }, CHAT_SEARCH_LIMIT);
    }
  }

  return ranked.map((r) => r.item);
}

export function useGlobalSearchResults(query: string): {
  readonly groups: ReadonlyArray<GlobalSearchGroup>;
} {
  const threads = useStore(
    useShallow(selectSidebarThreadsAcrossEnvironments),
  );

  const chatMatches = useMemo(
    () => searchChatMessages(query, { threads, messagesByThread: new Map() }),
    [query, threads],
  );

  const groups: GlobalSearchGroup[] = [];

  if (chatMatches.length > 0) {
    groups.push({
      kind: "chat",
      label: "Chat Messages",
      count: chatMatches.length,
      matches: chatMatches,
    });
  }

  return { groups };
}
