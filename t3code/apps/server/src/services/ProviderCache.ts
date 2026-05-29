/**
 * ProviderCache - In-memory Effect.Cache-based caching layer for provider API responses.
 *
 * Caches provider model listings and capability queries with configurable TTL,
 * automatic invalidation on provider config changes, concurrent request deduplication,
 * memory-bounded entry count, and cache hit/miss metrics.
 *
 * Complements the existing file-based `providerStatusCache.ts` by adding a fast
 * in-memory cache for hot API responses.
 *
 * @module ProviderCache
 */
import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";

// ─── Cache Types ────────────────────────────────────────────────────────────

/** Discriminated union of cache entry types. Each type maps to its own TTL and capacity budget. */
export type ProviderCacheKeyType = "modelList" | "capabilities";

/**
 * Composite cache key used to look up entries.
 * The `type` field separates model-list caches from capability caches so they
 * can have independent TTLs and eviction policies.
 */
export interface ProviderCacheKey {
  readonly type: ProviderCacheKeyType;
  readonly instanceId: ProviderInstanceId;
}

/** Cached value stored for a model list query. */
export interface CachedModelList {
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly name?: string | undefined;
    readonly description?: string | undefined;
  }>;
  readonly cachedAt: string;
}

/** Cached value stored for a capability query. */
export interface CachedCapabilities {
  readonly capabilities: ProviderAdapterCapabilities;
  readonly cachedAt: string;
}

export type ProviderCacheValue = CachedModelList | CachedCapabilities;

// ─── Configuration ──────────────────────────────────────────────────────────

/** Tunable cache configuration per entry type. */
export interface ProviderCacheConfig {
  /** Time-to-live for model list entries (default 5 minutes). */
  readonly modelListTTL: Duration.Duration;
  /** Time-to-live for capability entries (default 15 minutes). */
  readonly capabilitiesTTL: Duration.Duration;
  /** Maximum number of model list entries (default 128). */
  readonly maxModelListEntries: number;
  /** Maximum number of capability entries (default 256). */
  readonly maxCapabilityEntries: number;
}

/** Default production configuration. */
export const defaultProviderCacheConfig: ProviderCacheConfig = {
  modelListTTL: Duration.minutes(5),
  capabilitiesTTL: Duration.minutes(15),
  maxModelListEntries: 128,
  maxCapabilityEntries: 256,
} as const;

/** Schema for validating user-supplied cache config. */
export const ProviderCacheConfigSchema = Schema.Struct({
  modelListTTL: Schema.Duration,
  capabilitiesTTL: Schema.Duration,
  maxModelListEntries: Schema.Int,
  maxCapabilityEntries: Schema.Int,
});

// ─── Metrics ────────────────────────────────────────────────────────────────

export const providerCacheHitsTotal = Metric.counter("t3_provider_cache_hits_total", {
  description: "Total number of provider cache hits.",
});

export const providerCacheMissesTotal = Metric.counter("t3_provider_cache_misses_total", {
  description: "Total number of provider cache misses.",
});

export const providerCacheEvictionsTotal = Metric.counter(
  "t3_provider_cache_evictions_total",
  {
    description: "Total number of provider cache evictions.",
  },
);

const recordHit = (key: ProviderCacheKey) =>
  Metric.update(
    Metric.withAttributes(providerCacheHitsTotal, [
      ["cacheType", key.type],
      ["instanceId", key.instanceId],
    ]),
    1,
  );

const recordMiss = (key: ProviderCacheKey) =>
  Metric.update(
    Metric.withAttributes(providerCacheMissesTotal, [
      ["cacheType", key.type],
      ["instanceId", key.instanceId],
    ]),
    1,
  );

const recordEviction = (key: ProviderCacheKey) =>
  Metric.update(
    Metric.withAttributes(providerCacheEvictionsTotal, [
      ["cacheType", key.type],
      ["instanceId", key.instanceId],
    ]),
    1,
  );

// ─── Lookup Function Dependencies ───────────────────────────────────────────

/**
 * Dependencies that the cache lookup functions require on a cache miss.
 * Callers supply these at cache-creation time so the cache itself remains
 * a pure data structure that delegates I/O to injected functions.
 */
export interface ProviderCacheLookupFunctions {
  /** Fetch the fresh model list for a provider instance. Called only on cache miss. */
  readonly fetchModelList: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<CachedModelList>;

  /** Fetch the fresh capabilities for a provider instance. Called only on cache miss. */
  readonly fetchCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<CachedCapabilities>;
}

// ─── Service Shape ──────────────────────────────────────────────────────────

export interface ProviderCacheShape {
  /** Retrieve a cached model list (or fetch + cache on miss). */
  readonly getModelList: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<CachedModelList>;

  /** Retrieve cached capabilities (or fetch + cache on miss). */
  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<CachedCapabilities>;

  /**
   * Invalidate all cached entries for a specific provider instance.
   * Safe to call concurrently; uses Effect.Cache's built-in atomic invalidation.
   */
  readonly invalidate: (instanceId: ProviderInstanceId) => Effect.Effect<void>;

  /** Clear all entries from both caches. */
  readonly clear: () => Effect.Effect<void>;
}

// ─── Service Tag ────────────────────────────────────────────────────────────

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/services/ProviderCache",
) {}

// ─── Internal: Key helpers ──────────────────────────────────────────────────

const makeModelListKey = (instanceId: ProviderInstanceId): ProviderCacheKey => ({
  type: "modelList",
  instanceId,
});

const makeCapabilitiesKey = (instanceId: ProviderInstanceId): ProviderCacheKey => ({
  type: "capabilities",
  instanceId,
});

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a live `ProviderCache` service backed by two `Effect.Cache` instances
 * (one per entry type), hit/miss metrics, and an optional config-change pubsub
 * subscription for auto-invalidation.
 *
 * ## Concurrent deduplication
 * `Effect.Cache` serialises concurrent misses for the same key so that only
 * one lookup function runs while other callers await the same result.
 *
 * ## Memory bounds
 * Each cache is constructed with a fixed `capacity`. When the cache is full
 * the least-recently-used entry is evicted (recorded via `evictionsTotal`).
 */
export const makeProviderCache = Effect.fn("makeProviderCache")(
  function* (
    lookupFunctions: ProviderCacheLookupFunctions,
    config: ProviderCacheConfig = defaultProviderCacheConfig,
    options?: {
      /** PubSub that emits provider instance IDs whose config changed. */
      readonly configChangePubSub?: PubSub.PubSub<ProviderInstanceId>;
    },
  ) {
    // ── Model list cache ──────────────────────────────────────────────────

    const modelListCache = yield* Cache.make({
      capacity: config.maxModelListEntries,
      timeToLive: config.modelListTTL,
      lookup: (key: ProviderCacheKey) =>
        Effect.gen(function* () {
          recordMiss(key);
          const result = yield* lookupFunctions.fetchModelList(key.instanceId);
          recordHit(key);
          return result;
        }).pipe(Effect.withLogSpan("ProviderCache.modelList.lookup")),
    }).pipe(
      Effect.tap(() =>
        Effect.logInfo("ProviderCache model list cache initialized"),
      ),
    );

    // ── Capabilities cache ────────────────────────────────────────────────

    const capabilitiesCache = yield* Cache.make({
      capacity: config.maxCapabilityEntries,
      timeToLive: config.capabilitiesTTL,
      lookup: (key: ProviderCacheKey) =>
        Effect.gen(function* () {
          recordMiss(key);
          const result = yield* lookupFunctions.fetchCapabilities(key.instanceId);
          recordHit(key);
          return result;
        }).pipe(Effect.withLogSpan("ProviderCache.capabilities.lookup")),
    }).pipe(
      Effect.tap(() =>
        Effect.logInfo("ProviderCache capabilities cache initialized"),
      ),
    );

    // ── Config-change subscription (auto-invalidation) ────────────────────

    if (options?.configChangePubSub) {
      yield* Stream.runForEach(
        Stream.fromSubscription(PubSub.subscribe(options.configChangePubSub)),
        (instanceId: ProviderInstanceId) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "ProviderCache invalidating due to config change",
              { instanceId },
            );
            const modelKey = makeModelListKey(instanceId);
            const capKey = makeCapabilitiesKey(instanceId);

            const modelExists = yield* Cache.has(modelListCache, modelKey);
            if (modelExists) {
              recordEviction(modelKey);
            }
            yield* Cache.invalidate(modelListCache, modelKey);

            const capExists = yield* Cache.has(capabilitiesCache, capKey);
            if (capExists) {
              recordEviction(capKey);
            }
            yield* Cache.invalidate(capabilitiesCache, capKey);
          }),
      ).pipe(
        Effect.forkScoped,
        Effect.tap(() =>
          Effect.logInfo(
            "ProviderCache config-change invalidation subscriber started",
          ),
        ),
      );
    }

    // ── Public API ───────────────────────────────────────────────────────

    const getModelList: ProviderCacheShape["getModelList"] = (instanceId) =>
      Cache.get(modelListCache, makeModelListKey(instanceId)).pipe(
        Effect.tap(() => recordHit(makeModelListKey(instanceId))),
        Effect.withLogSpan("ProviderCache.getModelList"),
      );

    const getCapabilities: ProviderCacheShape["getCapabilities"] = (
      instanceId,
    ) =>
      Cache.get(capabilitiesCache, makeCapabilitiesKey(instanceId)).pipe(
        Effect.tap(() => recordHit(makeCapabilitiesKey(instanceId))),
        Effect.withLogSpan("ProviderCache.getCapabilities"),
      );

    const invalidate: ProviderCacheShape["invalidate"] = (instanceId) =>
      Effect.gen(function* () {
        const modelKey = makeModelListKey(instanceId);
        const capKey = makeCapabilitiesKey(instanceId);

        const modelExists = yield* Cache.has(modelListCache, modelKey);
        if (modelExists) {
          recordEviction(modelKey);
        }
        yield* Cache.invalidate(modelListCache, modelKey);

        const capExists = yield* Cache.has(capabilitiesCache, capKey);
        if (capExists) {
          recordEviction(capKey);
        }
        yield* Cache.invalidate(capabilitiesCache, capKey);
      });

    const clear: ProviderCacheShape["clear"] = () =>
      Effect.all([
        Cache.invalidateAll(modelListCache),
        Cache.invalidateAll(capabilitiesCache),
      ]).pipe(Effect.asVoid);

    return {
      getModelList,
      getCapabilities,
      invalidate,
      clear,
    } satisfies ProviderCacheShape;
  },
);
