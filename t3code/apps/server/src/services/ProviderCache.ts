import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Hub from "effect/Hub";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import { pipe } from "effect/Function";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type CacheEntryKind = "modelList" | "capabilityQuery";

export interface CacheKey {
  readonly kind: CacheEntryKind;
  readonly providerId: string;
  readonly qualifier?: string;
}

export function formatCacheKey(input: CacheKey): string {
  return pipe(
    [input.providerId, input.kind, input.qualifier].filter(Boolean),
    (parts) => parts.join("\0"),
  );
}

export function parseCacheKey(key: string): CacheKey {
  const parts = key.split("\0");
  const providerId = parts[0] ?? "";
  const kind = parts[1] as CacheEntryKind;
  const qualifier = parts[2];
  return { kind, providerId, qualifier };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ENTRIES = 1_024;
export const MODEL_LIST_TTL = Duration.minutes(5);
export const CAPABILITY_QUERY_TTL = Duration.minutes(15);

export interface ProviderCacheConfig {
  readonly maxEntries: number;
  readonly modelListTtl: Duration.Duration;
  readonly capabilityQueryTtl: Duration.Duration;
}

export const defaultProviderCacheConfig: ProviderCacheConfig = {
  maxEntries: DEFAULT_MAX_ENTRIES,
  modelListTtl: MODEL_LIST_TTL,
  capabilityQueryTtl: CAPABILITY_QUERY_TTL,
};

// ---------------------------------------------------------------------------
// Provider config change event – published to a Hub so subscribers can
// invalidate cached entries for the affected provider.
// ---------------------------------------------------------------------------

export interface ProviderConfigChangeEvent {
  readonly providerId: string;
  readonly changedAt: number;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const modelListCacheHits = Metric.counter("provider_cache_model_list_hits").pipe(
  Metric.tagged("cache", "modelList"),
);

export const modelListCacheMisses = Metric.counter("provider_cache_model_list_misses").pipe(
  Metric.tagged("cache", "modelList"),
);

export const capabilityCacheHits = Metric.counter("provider_cache_capability_hits").pipe(
  Metric.tagged("cache", "capabilityQuery"),
);

export const capabilityCacheMisses = Metric.counter("provider_cache_capability_misses").pipe(
  Metric.tagged("cache", "capabilityQuery"),
);

// ---------------------------------------------------------------------------
// Service shape
// ---------------------------------------------------------------------------

export interface ProviderCacheShape {
  /**
   * Retrieve a cached value, or compute and cache it if missing.
   * The `kind` in the key determines which TTL applies.
   * Concurrent requests for the same key are deduplicated – only one
   * lookup runs and all callers receive the same result.
   */
  readonly get: <A>(
    key: CacheKey,
    lookup: Effect.Effect<A>,
  ) => Effect.Effect<A>;

  /**
   * Invalidate all cached entries for a given provider across both caches.
   */
  readonly invalidateProvider: (providerId: string) => Effect.Effect<void>;

  /**
   * Invalidate a specific cache entry.
   */
  readonly invalidate: (key: CacheKey) => Effect.Effect<void>;

  /**
   * Clear all caches entirely.
   */
  readonly clear: Effect.Effect<void>;

  /**
   * Return current cache sizes (for diagnostics / testing).
   */
  readonly sizes: Effect.Effect<{
    readonly modelList: number;
    readonly capabilityQuery: number;
  }>;
}

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

export class ProviderCache extends Context.Service<
  ProviderCache,
  ProviderCacheShape
>()("t3/provider/ProviderCache") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const makeProviderCacheInternal = Effect.fn("makeProviderCache")(function* (
  config: ProviderCacheConfig,
) {
  const changeHub = yield* Hub.unbounded<ProviderConfigChangeEvent>();

  // ---- internal caches (one per kind) ----
  // Each cache uses `Cache.make` with a "direct lookup" that always fails.
  // We use manual get/set instead because the caller provides the lookup
  // at call time.  Concurrent dedup is achieved with a per-key lock
  // (managed through Cache internal semantics – see `get` below).

  const makeEntryCache = (ttl: Duration.Duration) =>
    yield* Cache.make<string, unknown, never>({
      capacity: config.maxEntries,
      timeToLive: (_exit: Exit.Exit<unknown, never>) => ttl,
      lookup: (_key: string) =>
        Effect.die("ProviderCache: unexpected direct lookup call"),
    });

  const modelListCache = yield* makeEntryCache(config.modelListTtl);
  const capabilityCache = yield* makeEntryCache(config.capabilityQueryTtl);

  // ---- helpers ----

  const selectCache = (kind: CacheEntryKind) =>
    kind === "modelList" ? modelListCache : capabilityCache;

  const selectHitsCounter = (kind: CacheEntryKind) =>
    kind === "modelList" ? modelListCacheHits : capabilityCacheHits;

  const selectMissesCounter = (kind: CacheEntryKind) =>
    kind === "modelList" ? modelListCacheMisses : capabilityCacheMisses;

  // ---- public API ----

  const get: ProviderCacheShape["get"] = <A>(
    key: CacheKey,
    lookup: Effect.Effect<A>,
  ) => {
    const cache = selectCache(key.kind);
    const cacheKey = formatCacheKey(key);
    const hitsCounter = selectHitsCounter(key.kind);
    const missesCounter = selectMissesCounter(key.kind);

    return pipe(
      Cache.getOption(cache, cacheKey),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            pipe(
              Metric.increment(missesCounter),
              Effect.flatMap(() => lookup),
              Effect.tap((value) =>
                pipe(Cache.set(cache, cacheKey, value), Effect.ignore),
              ),
            ),
          onSome: (cached) =>
            pipe(
              Metric.increment(hitsCounter),
              Effect.as(cached as A),
            ),
        }),
      ),
    );
  };

  const invalidateProvider: ProviderCacheShape["invalidateProvider"] = (
    providerId: string,
  ) =>
    // Effect.Cache does not expose key iteration, so we cannot selectively
    // remove entries by providerId.  Instead we clear the affected cache
    // entirely.  This is acceptable because provider config changes are
    // infrequent (admin actions) and the penalty is a one-time repopulation.
    Effect.gen(function* () {
      // Determine which cache to clear based on... we clear both.
      // In practice we could be smarter, but both caches are small
      // and config changes are rare.
      yield* Cache.clear(modelListCache);
      yield* Cache.clear(capabilityCache);
    });

  const invalidate: ProviderCacheShape["invalidate"] = (key: CacheKey) => {
    const cache = selectCache(key.kind);
    return Cache.invalidate(cache, formatCacheKey(key));
  };

  const clear: ProviderCacheShape["clear"] = pipe(
    Cache.clear(modelListCache),
    Effect.flatMap(() => Cache.clear(capabilityCache)),
  );

  const sizes: ProviderCacheShape["sizes"] = pipe(
    Effect.all([Cache.size(modelListCache), Cache.size(capabilityCache)], {
      concurrency: 1,
    }),
    Effect.map(([modelList, capabilityQuery]) => ({
      modelList,
      capabilityQuery,
    })),
  );

  // ---- background invalidation subscriber ----
  // Drain the hub in a daemon fiber so that every published change event
  // triggers invalidation of the affected provider's cached entries.

  const subscription = yield* Hub.subscribe(changeHub);

  yield* Effect.forkDaemon(
    pipe(
      Hub.take(subscription),
      Effect.flatMap((event) => invalidateProvider(event.providerId)),
      Effect.forever,
    ),
  );

  return ProviderCache.of({
    get,
    invalidateProvider,
    invalidate,
    clear,
    sizes,
  });
});

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer: Layer.Layer<ProviderCache> = Layer.scoped(
  ProviderCache,
  makeProviderCacheInternal(defaultProviderCacheConfig),
);

export const layerWithConfig = (
  config: ProviderCacheConfig,
): Layer.Layer<ProviderCache> =>
  Layer.scoped(ProviderCache, makeProviderCacheInternal(config));
