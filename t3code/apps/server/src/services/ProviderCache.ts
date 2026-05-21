/**
 * ProviderCache — configurable in-memory cache for provider API responses.
 *
 * Uses `Effect.Cache` for bounded, TTL-expiring storage with built-in
 * concurrent-request deduplication.  Cache hit/miss counters are exposed
 * through Effect Metrics.
 *
 * @module services/ProviderCache
 */
import type {
  ProviderInstanceId,
  ServerProviderModel,
} from "@t3tools/contracts";
import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

/* ------------------------------------------------------------------ */
/*  Metrics                                                           */
/* ------------------------------------------------------------------ */

const cacheHitsTotal = Metric.counter("t3_provider_cache_hits_total", {
  description: "Total provider cache hits.",
});

const cacheMissesTotal = Metric.counter("t3_provider_cache_misses_total", {
  description: "Total provider cache misses.",
});

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

export interface CacheMetrics {
  readonly hits: number;
  readonly misses: number;
}

export interface ProviderCache {
  readonly getModels: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProviderModel>>;
  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities>;
  readonly invalidateProvider: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
  readonly getMetrics: Effect.Effect<CacheMetrics>;
}

export interface ProviderCacheOptions {
  readonly modelListTTL: Duration.Duration;
  readonly capabilityTTL: Duration.Duration;
  readonly maxEntries: number;
}

const DEFAULT_OPTIONS: ProviderCacheOptions = {
  modelListTTL: Duration.minutes(5),
  capabilityTTL: Duration.minutes(15),
  maxEntries: 100,
};

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export const makeProviderCache = (options: {
  readonly fetchModels: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProviderModel>>;
  readonly fetchCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities>;
  readonly modelListTTL?: Duration.Duration;
  readonly capabilityTTL?: Duration.Duration;
  readonly maxEntries?: number;
}): Effect.Effect<ProviderCache> =>
  Effect.gen(function* () {
    const opts: ProviderCacheOptions = {
      ...DEFAULT_OPTIONS,
      modelListTTL: options.modelListTTL ?? DEFAULT_OPTIONS.modelListTTL,
      capabilityTTL:
        options.capabilityTTL ?? DEFAULT_OPTIONS.capabilityTTL,
      maxEntries: options.maxEntries ?? DEFAULT_OPTIONS.maxEntries,
    };

    const modelCache = yield* Cache.make<
      ProviderInstanceId,
      ReadonlyArray<ServerProviderModel>
    >({
      capacity: opts.maxEntries,
      timeToLive: opts.modelListTTL,
      lookup: options.fetchModels,
    });

    const capabilityCache = yield* Cache.make<
      ProviderInstanceId,
      ProviderAdapterCapabilities
    >({
      capacity: opts.maxEntries,
      timeToLive: opts.capabilityTTL,
      lookup: options.fetchCapabilities,
    });

    let hits = 0;
    let misses = 0;

    const getWithMetrics = <A>(
      cache: Cache.Cache<ProviderInstanceId, A>,
      instanceId: ProviderInstanceId,
    ): Effect.Effect<A> =>
      Cache.has(cache, instanceId).pipe(
        Effect.flatMap((cached) =>
          cached
            ? Cache.get(cache, instanceId).pipe(
                Effect.tap(() => Effect.sync(() => hits++)),
                Effect.tap(() => Metric.update(cacheHitsTotal, 1)),
              )
            : Cache.get(cache, instanceId).pipe(
                Effect.tap(() => Effect.sync(() => misses++)),
                Effect.tap(() => Metric.update(cacheMissesTotal, 1)),
              ),
        ),
      );

    const getModels = (
      instanceId: ProviderInstanceId,
    ): Effect.Effect<ReadonlyArray<ServerProviderModel>> =>
      getWithMetrics(modelCache, instanceId);

    const getCapabilities = (
      instanceId: ProviderInstanceId,
    ): Effect.Effect<ProviderAdapterCapabilities> =>
      getWithMetrics(capabilityCache, instanceId);

    const invalidateProvider = (
      instanceId: ProviderInstanceId,
    ): Effect.Effect<void> =>
      Effect.andThen(
        Cache.invalidate(modelCache, instanceId),
        Cache.invalidate(capabilityCache, instanceId),
      );

    const invalidateAll: Effect.Effect<void> = Effect.andThen(
      Cache.invalidateAll(modelCache),
      Cache.invalidateAll(capabilityCache),
    );

    const getMetrics: Effect.Effect<CacheMetrics> = Effect.sync(() => ({
      hits,
      misses,
    }));

    return {
      getModels,
      getCapabilities,
      invalidateProvider,
      invalidateAll,
      getMetrics,
    };
  });
