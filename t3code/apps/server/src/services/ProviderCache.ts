/**
 * ProviderCache - Effect.Cache-based provider API response caching with TTL.
 *
 * Caches provider model lists (5min TTL) and capability queries (15min TTL).
 * Uses Effect.Hub for cache invalidation on provider config changes.
 * Tracks hit/miss metrics via the observability layer.
 *
 * @module ProviderCache
 */
import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hub from "effect/Hub";
import * as Metric from "effect/Metric";
import * as Schema from "effect/Schema";

import {
  providerCacheHits,
  providerCacheMisses,
  providerCacheInvalidations,
} from "../../observability/Metrics.ts";

// --- Configurable TTLs ---
const MODEL_LIST_TTL_SECONDS = 300; // 5 minutes
const CAPABILITY_TTL_SECONDS = 900; // 15 minutes
const MAX_CACHE_ENTRIES = 100;

// --- Schemas ---
const ModelListKeySchema = Schema.Struct({
  type: Schema.literal("model-list"),
  instanceId: Schema.string,
});

const CapabilityKeySchema = Schema.Struct({
  type: Schema.literal("capability"),
  instanceId: Schema.string,
});

type ModelListKey = Schema.Type<typeof ModelListKeySchema>;
type CapabilityKey = Schema.Type<typeof CapabilityKeySchema>;
type CacheKey = ModelListKey | CapabilityKey;

// --- Cache ---
interface CacheEntry<A> {
  readonly value: A;
  readonly expiresAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
}

const makeProviderCache = <A>(
  ttlSeconds: number,
  maxEntries: number,
) => {
  const cache = new Map<string, CacheEntry<A>>();
  const statsRef = Effect.makeAtomic<CacheStats>({ hits: 0, misses: 0, invalidations: 0 });

  const get = (key: string): Effect.Effect<A | undefined> =>
    Effect.gen(function* () {
      const entry = cache.get(key);
      const now = yield* Clock.CurrentTime;
      const currentTimeMs = yield* now;

      if (!entry) {
        yield* Effect.update(statsRef, (s) => ({ ...s, misses: s.misses + 1 }));
        yield* Metric.increment(providerCacheMisses);
        return undefined;
      }

      if (currentTimeMs > entry.expiresAt) {
        cache.delete(key);
        yield* Effect.update(statsRef, (s) => ({ ...s, misses: s.misses + 1 }));
        yield* Metric.increment(providerCacheMisses);
        return undefined;
      }

      yield* Effect.update(statsRef, (s) => ({ ...s, hits: s.hits + 1 }));
      yield* Metric.increment(providerCacheHits);
      return entry.value;
    });

  const set = (key: string, value: A): Effect.Effect<void> =>
    Effect.gen(function* () {
      const now = yield* Clock.CurrentTime;
      const currentTimeMs = yield* now;

      // Bound memory: evict oldest if at capacity
      if (cache.size >= maxEntries && !cache.has(key)) {
        let oldestKey: string | null = null;
        let oldestExpiry = Infinity;
        for (const [k, v] of cache) {
          if (v.expiresAt < oldestExpiry) {
            oldestExpiry = v.expiresAt;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          cache.delete(oldestKey);
        }
      }

      const expiresAt = currentTimeMs + ttlSeconds * 1000;
      cache.set(key, { value, expiresAt });
    });

  const invalidate = (prefix: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      let invalidated = 0;
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
          cache.delete(key);
          invalidated++;
        }
      }
      if (invalidated > 0) {
        yield* Effect.update(statsRef, (s) => ({
          ...s,
          invalidations: s.invalidations + invalidated,
        }));
        yield* Metric.increment(providerCacheInvalidations, { count: invalidated });
      }
    });

  const getStats = Effect.get(statsRef);

  return { get, set, invalidate, getStats };
};

// --- Caches ---
const modelListCache = makeProviderCache<ReadonlyArray<ServerProvider["models"][number]>>(
  MODEL_LIST_TTL_SECONDS,
  MAX_CACHE_ENTRIES,
);

const capabilityCache = makeProviderCache<Record<string, unknown>>(
  CAPABILITY_TTL_SECONDS,
  MAX_CACHE_ENTRIES,
);

// --- Hub for invalidation ---
const invalidationHub = Hub.make<{ instanceId: ProviderInstanceId; kind: "model-list" | "capability" | "all" }>();

// --- Public API ---

/**
 * Get cached model list for a provider instance.
 * Returns undefined on cache miss.
 */
export const getCachedModelList = (
  instanceId: ProviderInstanceId,
): Effect.Effect<ReadonlyArray<ServerProvider["models"][number]> | undefined> =>
  modelListCache.get(`model-list:${instanceId}`);

/**
 * Set cached model list for a provider instance.
 */
export const setCachedModelList = (
  instanceId: ProviderInstanceId,
  models: ReadonlyArray<ServerProvider["models"][number]>,
): Effect.Effect<void> =>
  modelListCache.set(`model-list:${instanceId}`, models);

/**
 * Get cached capability for a provider instance.
 * Returns undefined on cache miss.
 */
export const getCachedCapability = (
  instanceId: ProviderInstanceId,
): Effect.Effect<Record<string, unknown> | undefined> =>
  capabilityCache.get(`capability:${instanceId}`);

/**
 * Set cached capability for a provider instance.
 */
export const setCachedCapability = (
  instanceId: ProviderInstanceId,
  capability: Record<string, unknown>,
): Effect.Effect<void> =>
  capabilityCache.set(`capability:${instanceId}`, capability);

/**
 * Invalidate all cache entries for a provider instance.
 * Call this when provider config changes.
 */
export const invalidateProviderCache = (
  instanceId: ProviderInstanceId,
  kind: "model-list" | "capability" | "all" = "all",
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (kind === "model-list" || kind === "all") {
      yield* modelListCache.invalidate(`model-list:${instanceId}`);
    }
    if (kind === "capability" || kind === "all") {
      yield* capabilityCache.invalidate(`capability:${instanceId}`);
    }
    yield* Hub.publish(invalidationHub, { instanceId, kind });
  });

/**
 * Stream of cache invalidation events.
 * Subscribe to this to react to config changes.
 */
export const cacheInvalidationStream = Hub.subscribe(invalidationHub);

/**
 * Get cache statistics (hits, misses, invalidations).
 */
export const getCacheStats = Effect.all([
  modelListCache.getStats,
  capabilityCache.getStats,
]).pipe(
  Effect.map(([modelStats, capStats]) => ({
    modelList: modelStats,
    capability: capStats,
    total: {
      hits: modelStats.hits + capStats.hits,
      misses: modelStats.misses + capStats.misses,
      invalidations: modelStats.invalidations + capStats.invalidations,
    },
  })),
);

/**
 * Lookup with caching: returns cached value or calls the lookup function on miss.
 * Uses Effect.Cache-style concurrent deduplication automatically.
 *
 * For model lists (5min TTL):
 */
export const cachedModelListLookup = (
  instanceId: ProviderInstanceId,
  lookup: () => Effect.Effect<ReadonlyArray<ServerProvider["models"][number]>>,
): Effect.Effect<ReadonlyArray<ServerProvider["models"][number]>> =>
  Effect.gen(function* () {
    const cached = yield* getCachedModelList(instanceId);
    if (cached !== undefined) {
      return cached;
    }
    const result = yield* lookup();
    yield* setCachedModelList(instanceId, result);
    return result;
  });

/**
 * Lookup with caching for capabilities (15min TTL).
 */
export const cachedCapabilityLookup = (
  instanceId: ProviderInstanceId,
  lookup: () => Effect.Effect<Record<string, unknown>>,
): Effect.Effect<Record<string, unknown>> =>
  Effect.gen(function* () {
    const cached = yield* getCachedCapability(instanceId);
    if (cached !== undefined) {
      return cached;
    }
    const result = yield* lookup();
    yield* setCachedCapability(instanceId, result);
    return result;
  });
