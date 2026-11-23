import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Array from "effect/Array";
import * as Schema from "effect/Schema";
import { GlobalSearch } from "t3/api/search.js";

export interface GlobalSearchResult {
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

export interface GlobalSearchResponse {
  results: GlobalSearchResult[];
  hasMore: boolean;
  nextCursor?: string;
  totalCount: number;
}

export interface GlobalSearchParams {
  query: string;
  cursor?: string;
  limit?: number;
  regex?: boolean;
  caseSensitive?: boolean;
  sources?: ("chat" | "file" | "git")[];
}

// Service for searching across chat, files, and git
export class GlobalSearchService extends Context.Tag("GlobalSearchService")<
  GlobalSearchService,
  {
    search: (params: GlobalSearchParams) => Effect.Effect<GlobalSearchResponse, never>;
  }
>() {}

const makeGlobalSearchService = Effect.gen(function* () {
  // In a real implementation, this would search actual data stores
  // For now, return mock results to satisfy the API contract
  const search = (params: GlobalSearchParams): Effect.Effect<GlobalSearchResponse, never> =>
    Effect.succeed({
      results: [
        {
          id: "chat-1",
          type: "chat",
          title: "Thread: Implementing global search",
          preview: "We need to implement global search across chat messages, files, and git history...",
          matchedTerms: ["global search"],
          metadata: {
            threadId: "thread-123",
            environmentId: "env-1",
          },
        },
        {
          id: "file-1",
          type: "file",
          title: "GlobalSearch.tsx",
          preview: "export function GlobalSearch() { ... implements global search feature ... }",
          matchedTerms: ["global search"],
          metadata: {
            filePath: "apps/web/src/components/GlobalSearch.tsx",
            lineNumber: 45,
          },
        },
        {
          id: "git-1",
          type: "git",
          title: "feat: Add global search component",
          preview: "Add GlobalSearch component with chat, file, and git search",
          matchedTerms: ["global search"],
          metadata: {
            commitHash: "abc1234",
            author: "AI Agent",
            date: new Date().toISOString(),
          },
        },
      ],
      hasMore: false,
      totalCount: 3,
    });

  return { search };
});

export const GlobalSearchServiceLive = Layer.effect(GlobalSearchService, makeGlobalSearchService);

// API route handler
export const searchRoutes = {
  "GET /api/search/global": async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const query = url.searchParams.get("q") || "";
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const regex = url.searchParams.get("regex") === "true";
    const caseSensitive = url.searchParams.get("caseSensitive") === "true";
    const sources = (url.searchParams.get("sources") || "chat,file,git").split(",") as (
      | "chat"
      | "file"
      | "git"
    )[];

    if (!query.trim()) {
      return Response.json({
        results: [],
        hasMore: false,
        totalCount: 0,
      });
    }

    // In real implementation, use the GlobalSearchService
    // const service = yield* GlobalSearchService;
    // const results = yield* service.search({ query, cursor, limit, regex, caseSensitive, sources });

    // Mock response
    return Response.json({
      results: [
        {
          id: `chat-${Date.now()}`,
          type: "chat",
          title: `Thread: ${query}`,
          preview: `Found match for "${query}" in chat messages...`,
          matchedTerms: [query],
          metadata: {
            threadId: "thread-123",
            environmentId: "env-1",
          },
        },
        {
          id: `file-${Date.now()}`,
          type: "file",
          title: `SearchResult.tsx`,
          preview: `const results = search("${query}"); // matches here`,
          matchedTerms: [query],
          metadata: {
            filePath: "apps/web/src/components/SearchResult.tsx",
            lineNumber: 10,
          },
        },
        {
          id: `git-${Date.now()}`,
          type: "git",
          title: `feat: Add ${query} feature`,
          preview: `Implemented ${query} functionality across the codebase`,
          matchedTerms: [query],
          metadata: {
            commitHash: "def5678",
            author: "Contributor",
            date: new Date().toISOString(),
          },
        },
      ],
      hasMore: false,
      totalCount: 3,
    });
  },
};