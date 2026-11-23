import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Array from "effect/Array";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

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
export interface GlobalSearchServiceShape {
  search: (params: GlobalSearchParams) => Effect.Effect<GlobalSearchResponse, never>;
}

export const GlobalSearchService = Context.Service<GlobalSearchServiceShape>("GlobalSearchService");

const makeGlobalSearchService = Effect.gen(function* () {
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

export const searchRouteLayer = HttpRouter.add(
  "GET",
  "/api/search/global",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.jsonUnsafe({ results: [], hasMore: false, totalCount: 0 }, { status: 400 });
    }
    
    const query = url.value.searchParams.get("q") || "";
    const cursorParam = url.value.searchParams.get("cursor");
    const cursor: string | undefined = cursorParam === null ? undefined : cursorParam;
    const limit = parseInt(url.value.searchParams.get("limit") || "20", 10);
    const regex = url.value.searchParams.get("regex") === "true";
    const caseSensitive = url.value.searchParams.get("caseSensitive") === "true";
    const sources = (url.value.searchParams.get("sources") || "chat,file,git").split(",") as (
      | "chat"
      | "file"
      | "git"
    )[];

    // Debug log
    console.log("[search] query:", query, "cursor:", cursor, "limit:", limit, "regex:", regex, "caseSensitive:", caseSensitive, "sources:", sources);

    if (!query.trim()) {
      return HttpServerResponse.jsonUnsafe(
        { results: [], hasMore: false, totalCount: 0 },
        { status: 200 }
      );
    }

    const service = yield* GlobalSearchService;
    const results = yield* service.search({ query, cursor, limit, regex, caseSensitive, sources });
    
    console.log("[search] results:", JSON.stringify(results, null, 2));
    
    return HttpServerResponse.jsonUnsafe(results, { status: 200 });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        console.log("[search] ERROR:", cause);
        return HttpServerResponse.jsonUnsafe(
          { results: [], hasMore: false, totalCount: 0 },
          { status: 500 }
        );
      })
    )
  )
).pipe(Layer.provide(GlobalSearchServiceLive));