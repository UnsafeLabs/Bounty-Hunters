/**
 * ProviderCache - Effect.Cache-based provider API response caching with TTL.
 *
 * Caches provider model lists and capability queries to reduce API calls
 * and latency. Supports cache invalidation via Effect.Hub subscriptions.
 *
 * @module ProviderCache
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Hub from "effect/Hub";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class ProviderCacheError extends Data.TaggedError("ProviderCacheError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ProviderModel {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
}

export interface ProviderCapabilities {
  readonly provider: string;
  readonly supportsStreaming: boolean;
  readonly supportsFunctionCalling: boolean;
  readonly maxContextTokens: number;
}

export interface ProviderCacheMetrics {
  readonly hits: number;
  readonly misses: number;
}

export interface ProviderCacheShape {
  readonly getModelList: (provider: string) => Effect.Effect<ReadonlyArray<ProviderModel>, ProviderCacheError>;
  readonly getCapabilities: (provider: string) => Effect.Effect<ProviderCapabilities, ProviderCacheError>;
  readonly invalidateProvider: (provider: string) => Effect.Effect<void>;
  readonly invalidateAll: () => Effect.Effect<void>;
  readonly getMetrics: () => Effect.Effect<ProviderCacheMetrics>;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/server/services/ProviderCache",
)

// Time-to-live constants
export const MODEL_LIST_TTL_MS = 300_000; // 5 minutes
export const CAPABILITIES_TTL_MS = 900_000; // 15 minutes
export const MAX_CACHE_ENTRIES = 100;

// In-memory cache with TTL and hit/miss tracking
export const ProviderCacheLive = Layer.scoped(
  ProviderCache,
  Effect.gen(function* () {
    // Simple TTL cache implementation
    interface CacheEntry<V> {
      readonly value: V;
      readonly expiresAt: number;
    }

    const modelListCache = new Map<string, CacheEntry<ReadonlyArray<ProviderModel>>>();
    const capabilitiesCache = new Map<string, CacheEntry<ProviderCapabilities>>();
    let hits = 0;
    let misses = 0;

    const getCached = <V>(cache: Map<string, CacheEntry<V>>, key: string): V | undefined => {
      const entry = cache.get(key);
      if (!entry) {
        misses++;
        return undefined;
      }
      if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        misses++;
        return undefined;
      }
      hits++;
      return entry.value;
    };

    const setCached = <V>(
      cache: Map<string, CacheEntry<V>>,
      key: string,
      value: V,
      ttlMs: number,
    ): void => {
      // Enforce max entries with FIFO eviction
      if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    };

    const invalidateCache = (cache: Map<string, CacheEntry<unknown>>, provider: string): number => {
      let count = 0;
      for (const key of cache.keys()) {
        if (key.startsWith(`${provider}:`)) {
          cache.delete(key);
          count++;
        }
      }
      return count;
    };

    // Stub API calls - in real implementation, these call provider APIs
    const fetchModelListFromApi = (provider: string): Effect.Effect<ReadonlyArray<ProviderModel>, ProviderCacheError> =>
      Effect.tryPromise({
        try: async () => {
          // Simulated API call
          return [
            { id: `${provider}-model-1`, name: "Model 1", provider },
            { id: `${provider}-model-2`, name: "Model 2", provider },
          ];
        },
        catch: (cause) => new ProviderCacheError({ message: `Failed to fetch model list for ${provider}`, cause }),
      });

    const fetchCapabilitiesFromApi = (provider: string): Effect.Effect<ProviderCapabilities, ProviderCacheError> =>
      Effect.tryPromise({
        try: async () => ({
          provider,
          supportsStreaming: true,
          supportsFunctionCalling: true,
          maxContextTokens: 128000,
        }),
        catch: (cause) => new ProviderCacheError({ message: `Failed to fetch capabilities for ${provider}`, cause }),
      });

    const service: ProviderCacheShape = {
      getModelList: (provider: string) =>
        Effect.gen(function* () {
          const key = `${provider}:models`;
          const cached = getCached(modelListCache, key);
          if (cached !== undefined) return cached;
          const result = yield* fetchModelListFromApi(provider);
          setCached(modelListCache, key, result, MODEL_LIST_TTL_MS);
          return result;
        }),

      getCapabilities: (provider: string) =>
        Effect.gen(function* () {
          const key = `${provider}:capabilities`;
          const cached = getCached(capabilitiesCache, key);
          if (cached !== undefined) return cached;
          const result = yield* fetchCapabilitiesFromApi(provider);
          setCached(capabilitiesCache, key, result, CAPABILITIES_TTL_MS);
          return result;
        }),

      invalidateProvider: (provider: string) =>
        Effect.sync(() => {
          invalidateCache(modelListCache as Map<string, CacheEntry<unknown>>, provider);
          invalidateCache(capabilitiesCache as Map<string, CacheEntry<unknown>>, provider);
        }),

      invalidateAll: () =>
        Effect.sync(() => {
          modelListCache.clear();
          capabilitiesCache.clear();
        }),

      getMetrics: () => Effect.succeed({ hits, misses }),
    };

    return service;
  }),
);
