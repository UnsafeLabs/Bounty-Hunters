import { describe, it, expect, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProviderCache, ProviderCacheLive, getConfig } from "./ProviderCache.ts";

describe("ProviderCache", () => {
  describe("getConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("should return default TTL values", () => {
      const config = getConfig();
      expect(config.modelListTTL).toBe(5 * 60 * 1000); // 5 minutes
      expect(config.capabilitiesTTL).toBe(15 * 60 * 1000); // 15 minutes
      expect(config.maxCacheSize).toBe(1000);
    });

    it("should read from environment variables", () => {
      process.env.CACHE_MODEL_LIST_TTL = "60000";
      process.env.CACHE_CAPABILITIES_TTL = "120000";
      process.env.CACHE_MAX_SIZE = "500";

      const config = getConfig();
      expect(config.modelListTTL).toBe(60000);
      expect(config.capabilitiesTTL).toBe(120000);
      expect(config.maxCacheSize).toBe(500);
    });
  });

  describe("ProviderCacheLive", () => {
    const cacheLayer = ProviderCacheLive;

    it("should cache model list responses", () =>
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        let fetchCount = 0;

        const fetcher = () =>
          Effect.sync(() => {
            fetchCount++;
            return [{ id: "model-1" }, { id: "model-2" }];
          });

        const result1 = yield* cache.getModelList("test-provider", fetcher);
        const result2 = yield* cache.getModelList("test-provider", fetcher);

        expect(result1).toEqual(result2);
        expect(fetchCount).toBe(1); // Only fetched once
      }).pipe(Effect.scoped, Effect.provide(cacheLayer), Effect.runPromise));

    it("should cache capability queries", () =>
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        let fetchCount = 0;

        const fetcher = () =>
          Effect.sync(() => {
            fetchCount++;
            return { supportsStreaming: true, maxTokens: 4096 };
          });

        const result1 = yield* cache.getCapabilities("test-key", fetcher);
        const result2 = yield* cache.getCapabilities("test-key", fetcher);

        expect(result1).toEqual(result2);
        expect(fetchCount).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(cacheLayer), Effect.runPromise));

    it("should invalidate cache for provider", () =>
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        let fetchCount = 0;

        const fetcher = () =>
          Effect.sync(() => {
            fetchCount++;
            return [{ id: `model-${fetchCount}` }];
          });

        const result1 = yield* cache.getModelList("provider-1", fetcher);
        yield* cache.invalidateProvider("provider-1");
        const result2 = yield* cache.getModelList("provider-1", fetcher);

        expect(fetchCount).toBe(2);
        expect(result1).not.toEqual(result2);
      }).pipe(Effect.scoped, Effect.provide(cacheLayer), Effect.runPromise));

    it("should track cache hit/miss metrics", () =>
      Effect.gen(function* () {
        const cache = yield* ProviderCache;

        const fetcher = () => Effect.succeed([{ id: "model" }]);

        yield* cache.getModelList("provider-1", fetcher); // miss
        yield* cache.getModelList("provider-1", fetcher); // hit
        yield* cache.getModelList("provider-2", fetcher); // miss
        yield* cache.getModelList("provider-2", fetcher); // hit

        const metrics = yield* cache.getMetrics();

        expect(metrics.hits).toBe(2);
        expect(metrics.misses).toBe(2);
        expect(metrics.hitRate).toBe(0.5);
      }).pipe(Effect.scoped, Effect.provide(cacheLayer), Effect.runPromise));

    it("should handle concurrent requests with deduplication", () =>
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        let fetchCount = 0;

        const fetcher = () =>
          Effect.sync(() => {
            fetchCount++;
            return [{ id: "shared-model" }];
          });

        // Simulate concurrent requests
        const [result1, result2, result3] = yield* Effect.all([
          cache.getModelList("concurrent-provider", fetcher),
          cache.getModelList("concurrent-provider", fetcher),
          cache.getModelList("concurrent-provider", fetcher),
        ]);

        expect(result1).toEqual(result2);
        expect(result2).toEqual(result3);
        // Effect.Cache should deduplicate concurrent lookups
        expect(fetchCount).toBeLessThanOrEqual(1);
      }).pipe(Effect.scoped, Effect.provide(cacheLayer), Effect.runPromise));

    it("should not cache errors", () =>
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        let callCount = 0;

        const failingFetcher = () =>
          Effect.sync(() => {
            callCount++;
            if (callCount === 1) throw new Error("API Error");
            return [{ id: "recovered" }];
          });

        // First call fails
        yield* cache.getModelList("error-provider", failingFetcher).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );

        // Second call should retry (not cached error)
        const result = yield* cache.getModelList("error-provider", failingFetcher);

        expect(callCount).toBe(2);
        expect(result).toEqual([{ id: "recovered" }]);
      }).pipe(Effect.scoped, Effect.provide(cacheLayer), Effect.runPromise));
  });
});
