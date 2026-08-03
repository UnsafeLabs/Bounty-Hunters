import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import { makeProviderCache } from "./ProviderCache.ts";

describe("ProviderCache", () => {
  it("caches model list responses on hit and fetches fresh on miss", async () => {
    const fetcher = vi.fn().mockImplementation((providerId: string) =>
      Effect.succeed([{ slug: "gpt-4o", name: "GPT-4o" }]),
    );

    const program = Effect.gen(function* () {
      const cache = yield* makeProviderCache;

      // 1st call -> Miss
      const models1 = yield* cache.getModels("openai", fetcher);
      expect(models1).toEqual([{ slug: "gpt-4o", name: "GPT-4o" }]);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 2nd call -> Hit
      const models2 = yield* cache.getModels("openai", fetcher);
      expect(models2).toEqual([{ slug: "gpt-4o", name: "GPT-4o" }]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    await Effect.runPromise(program);
  });

  it("caches capability responses and respects provider invalidation", async () => {
    const capFetcher = vi.fn().mockImplementation((providerId: string, modelId: string) =>
      Effect.succeed({ supportsTools: true, maxTokens: 128000 }),
    );

    const program = Effect.gen(function* () {
      const cache = yield* makeProviderCache;

      // 1st call -> Miss
      const caps1 = yield* cache.getCapabilities("openai", "gpt-4o", capFetcher);
      expect(caps1).toEqual({ supportsTools: true, maxTokens: 128000 });
      expect(capFetcher).toHaveBeenCalledTimes(1);

      // 2nd call -> Hit
      const caps2 = yield* cache.getCapabilities("openai", "gpt-4o", capFetcher);
      expect(caps2).toEqual({ supportsTools: true, maxTokens: 128000 });
      expect(capFetcher).toHaveBeenCalledTimes(1);

      // Invalidate provider cache
      yield* cache.invalidateProvider("openai");

      // 3rd call -> Miss after invalidation
      const caps3 = yield* cache.getCapabilities("openai", "gpt-4o", capFetcher);
      expect(caps3).toEqual({ supportsTools: true, maxTokens: 128000 });
      expect(capFetcher).toHaveBeenCalledTimes(2);
    });

    await Effect.runPromise(program);
  });

  it("invalidates all entries on invalidateAll", async () => {
    const modelFetcher = vi.fn().mockImplementation(() =>
      Effect.succeed([{ slug: "claude-3-5-sonnet" }]),
    );

    const program = Effect.gen(function* () {
      const cache = yield* makeProviderCache;

      yield* cache.getModels("anthropic", modelFetcher);
      expect(modelFetcher).toHaveBeenCalledTimes(1);

      yield* cache.invalidateAll();

      yield* cache.getModels("anthropic", modelFetcher);
      expect(modelFetcher).toHaveBeenCalledTimes(2);
    });

    await Effect.runPromise(program);
  });
});
