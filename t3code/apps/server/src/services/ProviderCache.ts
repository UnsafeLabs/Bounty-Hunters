/**
 * ProviderCache - Effect.Cache-based caching layer for provider API responses.
 *
 * Caches model lists and capability queries with configurable TTLs to reduce
 * unnecessary API calls and latency.
 *
 * @module ProviderCache
 */
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Metrics from "../observability/Metrics.ts";

export interface ProviderCacheShape {
  /**
   * Get cached model list for a provider, fetching on cache miss.
   */
  readonly getModelList: (
    providerKey: string,
    fetcher: () => Effect.Effect<ReadonlyArray<unknown>, Error>,
  ) => Effect.Effect<ReadonlyArray<unknown>, Error>;

  /**
   * Get cached capabilities for a provider model, fetching on cache miss.
   */
  readonly getCapabilities: (
    cacheKey: string,
    fetcher: () => Effect.Effect<unknown, Error>,
  ) => Effect.Effect<unknown, Error>;

  /**
   * Invalidate all cached entries for a provider.
   */
  readonly invalidateProvider: (providerKey: string) => Effect.Effect<void>;

  /**
   * Get cache hit/miss metrics.
   */
  readonly getMetrics: () => Effect.Effect<{
    hits: number;
    misses: number;
    hitRate: number;
  }>;
}

export const ProviderCache = Effect.GenericTag<ProviderCacheShape>("@services/ProviderCache");

export interface ProviderCacheConfig {
  readonly modelListTTL: number; // milliseconds
  readonly capabilitiesTTL: number; // milliseconds
  readonly maxCacheSize: number;
}

export const defaultConfig: ProviderCacheConfig = {
  modelListTTL: 5 * 60 * 1000, // 5 minutes
  capabilitiesTTL: 15 * 60 * 1000, // 15 minutes
  maxCacheSize: 1000,
};

export function getConfig(): ProviderCacheConfig {
  return {
    modelListTTL: parseInt(process.env.CACHE_MODEL_LIST_TTL || String(defaultConfig.modelListTTL)),
    capabilitiesTTL: parseInt(process.env.CACHE_CAPABILITIES_TTL || String(defaultConfig.capabilitiesTTL)),
    maxCacheSize: parseInt(process.env.CACHE_MAX_SIZE || String(defaultConfig.maxCacheSize)),
  };
}

interface CacheMetrics {
  hits: number;
  misses: number;
}

export const ProviderCacheLive = Layer.effect(
  ProviderCache,
  Effect.gen(function* () {
    const config = getConfig();
    const metricsRef = yield* Ref.make<CacheMetrics>({ hits: 0, misses: 0 });

    const modelListCache = yield* Cache.make({
      capacity: config.maxCacheSize,
      timeToLive: config.modelListTTL,
      lookup: (key: string) =>
        Effect.flatMap(Ref.update(metricsRef, (m) => ({ ...m, misses: m.misses + 1 })), () =>
          Effect.fail(new Error(`Cache miss for model list: ${key}`)),
        ),
    });

    const capabilitiesCache = yield* Cache.make({
      capacity: config.maxCacheSize,
      timeToLive: config.capabilitiesTTL,
      lookup: (key: string) =>
        Effect.flatMap(Ref.update(metricsRef, (m) => ({ ...m, misses: m.misses + 1 })), () =>
          Effect.fail(new Error(`Cache miss for capabilities: ${key}`)),
        ),
    });

    const invalidateModelList = (providerKey: string) =>
      Cache.invalidate(modelListCache, providerKey);

    const invalidateCapabilities = (providerKey: string) =>
      Cache.invalidate(capabilitiesCache, providerKey);

    const recordHit = Ref.update(metricsRef, (m) => ({ ...m, hits: m.hits + 1 }));

    const service: ProviderCacheShape = {
      getModelList: (providerKey, fetcher) =>
        Effect.gen(function* () {
          const cached = yield* Cache.get(modelListCache, providerKey).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          );
          if (cached !== null) {
            yield* recordHit;
            return cached;
          }
          const fresh = yield* fetcher();
          yield* Cache.put(modelListCache, providerKey, fresh);
          return fresh;
        }),

      getCapabilities: (cacheKey, fetcher) =>
        Effect.gen(function* () {
          const cached = yield* Cache.get(capabilitiesCache, cacheKey).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          );
          if (cached !== null) {
            yield* recordHit;
            return cached;
          }
          const fresh = yield* fetcher();
          yield* Cache.put(capabilitiesCache, cacheKey, fresh);
          return fresh;
        }),

      invalidateProvider: (providerKey) =>
        Effect.all([
          invalidateModelList(providerKey),
          invalidateCapabilities(providerKey),
        ]),

      getMetrics: () =>
        Effect.gen(function* () {
          const metrics = yield* Ref.get(metricsRef);
          const total = metrics.hits + metrics.misses;
          return {
            hits: metrics.hits,
            misses: metrics.misses,
            hitRate: total > 0 ? metrics.hits / total : 0,
          };
        }),
    };

    return service;
  }),
);
