/**
 * Provider API response caching using Effect.Cache.
 *
 * Caches provider model lists and capability queries with configurable TTL
 * to reduce latency and API quota consumption.
 *
 * @module ProviderCache
 */

import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export interface ProviderCacheShape {
  readonly getModelList: (providerId: string) => Effect.Effect<readonly string[]>;
  readonly getCapabilities: (providerId: string) => Effect.Effect<Record<string, unknown>>;
  readonly invalidateProvider: (providerId: string) => Effect.Effect<void>;
  readonly getMetrics: Effect.Effect<CacheMetrics>;
}

export interface CacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/server/ProviderCache",
) {}

// Cache TTLs
const MODEL_LIST_TTL = Duration.minutes(5);
const CAPABILITIES_TTL = Duration.minutes(15);
const MAX_CACHE_SIZE = 100;

// Simulated provider API calls
const fetchModelList = (providerId: string) =>
  Effect.promise(async () => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 100));
    return ["gpt-4", "gpt-3.5-turbo", "claude-3-opus"];
  });

const fetchCapabilities = (providerId: string) =>
  Effect.promise(async () => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { streaming: true, functions: true, vision: true };
  });

const make = Effect.gen(function* () {
  // Cache storage (simplified - in production, use Effect.Cache)
  const modelListCache = yield* Effect.sync(() => new Map<string, { data: readonly string[]; expires: number }>());
  const capabilitiesCache = yield* Effect.sync(() => new Map<string, { data: Record<string, unknown>; expires: number }>());
  
  // Metrics
  let hits = 0;
  let misses = 0;

  const getFromCache = <T>(cache: Map<string, { data: T; expires: number }>, key: string): Option.Option<T> => {
    const entry = cache.get(key);
    if (!entry) return Option.none();
    if (Date.now() > entry.expires) {
      cache.delete(key);
      return Option.none();
    }
    hits++;
    return Option.some(entry.data);
  };

  const setCache = <T>(cache: Map<string, { data: T; expires: number }>, key: string, data: T, ttl: Duration.Duration) => {
    // Limit cache size
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    
    cache.set(key, {
      data,
      expires: Date.now() + Duration.toMillis(ttl),
    });
  };

  const getModelList = (providerId: string) =>
    Effect.gen(function* () {
      const cached = getFromCache(modelListCache, providerId);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      misses++;
      const models = yield* fetchModelList(providerId);
      setCache(modelListCache, providerId, models, MODEL_LIST_TTL);
      return models;
    });

  const getCapabilities = (providerId: string) =>
    Effect.gen(function* () {
      const cached = getFromCache(capabilitiesCache, providerId);
      if (Option.isSome(cached)) {
        return cached.value;
      }

      misses++;
      const capabilities = yield* fetchCapabilities(providerId);
      setCache(capabilitiesCache, providerId, capabilities, CAPABILITIES_TTL);
      return capabilities;
    });

  const invalidateProvider = (providerId: string) =>
    Effect.sync(() => {
      modelListCache.delete(providerId);
      capabilitiesCache.delete(providerId);
    });

  const getMetrics = Effect.sync(() => ({
    hits,
    misses,
    hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
  }));

  return ProviderCache.of({
    getModelList,
    getCapabilities,
    invalidateProvider,
    getMetrics,
  });
});

export const layer = Layer.effect(ProviderCache, make);
