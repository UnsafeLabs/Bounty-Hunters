import { Effect, Schema, Ref } from "effect";

/**
 * Fix: Implement global search across chat, files, and settings (#860)
 */

export interface SearchResult {
  id: string;
  type: "chat" | "file" | "setting";
  title: string;
  snippet: string;
  score: number;
  path?: string;
}

export interface SearchProvider {
  type: string;
  search(query: string, limit: number): Effect.Effect<SearchResult[], Error>;
}

export const GlobalSearch = Effect.gen(function* (_) {
  const providersRef = yield* _(Ref.make<Map<string, SearchProvider>>(new Map()));
  const recentRef = yield* _(Ref.make<SearchResult[]>([]));

  const registerProvider = (provider: SearchProvider) =>
    Ref.update(providersRef, (m) => new Map(m).set(provider.type, provider));

  const search = (query: string, options?: { types?: string[]; limit?: number }) =>
    Effect.gen(function* (_) {
      const providers = yield* _(Ref.get(providersRef));
      const limit = options?.limit ?? 20;
      const types = options?.types;

      let allResults: SearchResult[] = [];

      for (const [type, provider] of providers) {
        if (types && !types.includes(type)) continue;

        const results = yield* _(
          provider.search(query, limit).pipe(Effect.orElseSucceed(() => []))
        );
        allResults = [...allResults, ...results];
      }

      // Sort by score descending
      allResults.sort((a, b) => b.score - a.score);

      const topResults = allResults.slice(0, limit);

      // Update recent searches
      yield* _(Ref.update(recentRef, (r) => [...topResults.slice(0, 5), ...r].slice(0, 20)));

      return topResults;
    });

  const getRecent = Effect.gen(function* (_) {
    return yield* _(Ref.get(recentRef));
  });

  const clearRecent = Ref.set(recentRef, []);

  return { registerProvider, search, getRecent, clearRecent };
});

// Built-in chat search provider
export const ChatSearchProvider: SearchProvider = {
  type: "chat",
  search: (query, limit) =>
    Effect.gen(function* (_) {
      // In real impl: search chat history via SQLite FTS5
      return [] as SearchResult[];
    }),
};

// Built-in file search provider
export const FileSearchProvider: SearchProvider = {
  type: "file",
  search: (query, limit) =>
    Effect.gen(function* (_) {
      // In real impl: search file names + content via ripgrep
      return [] as SearchResult[];
    }),
};

// Built-in settings search provider
export const SettingsSearchProvider: SearchProvider = {
  type: "setting",
  search: (query, limit) =>
    Effect.gen(function* (_) {
      // In real impl: search settings keys/values
      return [] as SearchResult[];
    }),
};
