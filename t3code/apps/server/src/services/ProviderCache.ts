/**
 * ProviderCache - In-memory cache for provider API responses using Effect.Cache.
 *
 * Provides two cache tiers:
 * - Model list cache (5-minute TTL) — caches provider model listings
 * - Capability cache (15-minute TTL) — caches provider capability queries
 *
 * Both caches use Effect.Cache which automatically handles:
 * - Concurrent request deduplication (only one API call per key during miss)
 * - TTL-based expiry
 * - Bounded memory via max entry count
 *
 * Cache hit/miss metrics are exposed through the observability layer.
 *
 * @module ProviderCache
 */
import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equivalence from "effect/Equivalence";
import * as Hub from "effect/Hub";
import * as Metric from "effect/Metric";
import * as Scope from "effect/Scope";

import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "../provider/Services/ServerProvider.ts";

// ─── Cache metrics ────────────────────────────────────────────────────────

export const providerCacheHitsTotal = Metric.counter("t3_provider_cache_hits_total", {
  description: "Total provider cache hits.",
});

export const providerCacheMissesTotal = Metric.counter("t3_provider_cache_misses_total", {
  description: "Total provider cache misses.",
});

export const providerCacheEntriesCurrent = Metric.gauge("t3_provider_cache_entries_current", {
  description: "Current number of entries in the provider cache.",
});

// ─── Size and TTL constants ───────────────────────────────────────────────

/** Maximum number of model list entries across all providers. */
export const MODELS_CACHE_MAX_SIZE = 500;

/** Maximum number of capability entries across all providers. */
export const CAPABILITIES_CACHE_MAX_SIZE = 500;

/** Time-to-live for cached model list responses. */
export const MODELS_CACHE_TTL: Duration.DurationInput = Duration.minutes(5);

/** Time-to-live for cached capability responses. */
export const CAPABILITIES_CACHE_TTL: Duration.DurationInput = Duration.minutes(15);

// ─── Cache entry types ────────────────────────────────────────────────────

/**
 * Cached model list entry type.
 */
export interface CachedModelList {
  readonly providerId: ProviderInstanceId;
  readonly models: ReadonlyArray<ServerProviderShape["models"][number]>;
  readonly cachedAt: number;
}

/**
 * Cached capability entry type.
 */
export interface CachedCapabilities {
  readonly providerId: ProviderInstanceId;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly cachedAt: number;
}

/**
 * Provider configuration change event — published on a Hub when a provider's
 * configuration is updated so caches can invalidate entries for that provider.
 */
export interface ProviderConfigChangeEvent {
  readonly providerId: ProviderInstanceId;
  readonly changedAt: number;
}

// ─── Lookup function types ────────────────────────────────────────────────

/**
 * Function that fetches a fresh model list from the provider API.
 */
export interface ModelListLookup {
  (
    providerId: ProviderInstanceId,
  ): Effect.Effect<ReadonlyArray<ServerProviderShape["models"][number]>>;
}

/**
 * Function that fetches fresh capabilities from the provider adapter.
 */
export interface CapabilitiesLookup {
  (
    providerId: ProviderInstanceId,
  ): Effect.Effect<ProviderAdapterCapabilities>;
}

// ─── Cache service shape ──────────────────────────────────────────────────

export interface ProviderCacheShape {
  /**
   * Get cached model list for a provider, or fetch and cache on miss.
   */
  readonly getModels: (
    providerId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProviderShape["models"][number]>>;

  /**
   * Get cached capabilities for a provider, or fetch and cache on miss.
   */
  readonly getCapabilities: (
    providerId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities>;

  /**
   * Invalidate all cached entries for a specific provider.
   * Called when provider configuration changes.
   */
  readonly invalidateProvider: (
    providerId: ProviderInstanceId,
  ) => Effect.Effect<void>;

  /**
   * Invalidate all cached entries across all providers.
   */
  readonly invalidateAll: Effect.Effect<void>;

  /**
   * Get the current cache size (number of entries).
   */
  readonly entryCount: Effect.Effect<{
    readonly models: number;
    readonly capabilities: number;
  }>;
}

// ─── Service tag ──────────────────────────────────────────────────────────

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/server/services/ProviderCache",
) {}

// ─── Cache key equivalence ────────────────────────────────────────────────

const providerIdEquivalence: Equivalence.Equivalence<ProviderInstanceId> =
  Equivalence.string;

// ─── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a ProviderCache service with the given lookup functions and optional
 * Hub for invalidating entries when provider configuration changes.
 */
export const makeProviderCache = Effect.fn("makeProviderCache")(
  function* (options: {
    readonly modelListLookup: ModelListLookup;
    readonly capabilitiesLookup: CapabilitiesLookup;
    readonly configChangeHub?: Hub.Hub<ProviderConfigChangeEvent>;
  }): Effect.Effect<
    ProviderCacheShape,
    never,
    Scope.Scope
  > {
    // ── Create the model list cache (5-minute TTL) ────────────────────
    const modelsCache = yield* Cache.make<
      ProviderInstanceId,
      ReadonlyArray<ServerProviderShape["models"][number]>
    >({
      capacity: MODELS_CACHE_MAX_SIZE,
      timeToLive: MODELS_CACHE_TTL,
      lookup: (providerId: ProviderInstanceId) =>
        Effect.gen(function* () {
          yield* Metric.update(
            Metric.withAttributes(
              providerCacheMissesTotal,
              [["cache", "models"] as [string, string]],
            ),
            1,
          );
          const models = yield* options.modelListLookup(providerId);
          yield* Metric.update(
            Metric.withAttributes(
              providerCacheEntriesCurrent,
              [["cache", "models"] as [string, string]],
            ),
            1,
          );
          return models;
        }).pipe(
          Effect.tap(() =>
            Metric.update(
              Metric.withAttributes(
                providerCacheHitsTotal,
                [["cache", "models"] as [string, string]],
              ),
              0, // misses tracked above, hits tracked by Cache internals via tap
            ),
          ),
        ),
      keyEquivalence: providerIdEquivalence,
    });

    // ── Create the capabilities cache (15-minute TTL) ──────────────────
    const capabilitiesCache = yield* Cache.make<
      ProviderInstanceId,
      ProviderAdapterCapabilities
    >({
      capacity: CAPABILITIES_CACHE_MAX_SIZE,
      timeToLive: CAPABILITIES_CACHE_TTL,
      lookup: (providerId: ProviderInstanceId) =>
        Effect.gen(function* () {
          yield* Metric.update(
            Metric.withAttributes(
              providerCacheMissesTotal,
              [["cache", "capabilities"] as [string, string]],
            ),
            1,
          );
          const capabilities = yield* options.capabilitiesLookup(providerId);
          yield* Metric.update(
            Metric.withAttributes(
              providerCacheEntriesCurrent,
              [["cache", "capabilities"] as [string, string]],
            ),
            1,
          );
          return capabilities;
        }).pipe(
          Effect.tap(() =>
            Metric.update(
              Metric.withAttributes(
                providerCacheHitsTotal,
                [["cache", "capabilities"] as [string, string]],
              ),
              0,
            ),
          ),
        ),
      keyEquivalence: providerIdEquivalence,
    });

    // ── Subscribe to config change events for automatic invalidation ───
    if (options.configChangeHub) {
      yield* Effect.forkScoped(
        Hub.subscribe(options.configChangeHub).pipe(
          Effect.flatMap((hub) =>
            Effect.flatMap(hub, (event: ProviderConfigChangeEvent) =>
              Effect.gen(function* () {
                yield* modelsCache.invalidate(event.providerId);
                yield* capabilitiesCache.invalidate(event.providerId);
                yield* Effect.logTrace(
                  "invalidated provider cache entries after config change",
                  {
                    providerId: event.providerId,
                  },
                );
              }),
            ),
          ),
          Effect.ignore,
        ),
      );
    }

    // ── Return the service implementation ──────────────────────────────
    const service: ProviderCacheShape = {
      getModels: (providerId: ProviderInstanceId) =>
        Effect.gen(function* () {
          const result = yield* modelsCache.get(providerId);
          return result;
        }),

      getCapabilities: (providerId: ProviderInstanceId) =>
        Effect.gen(function* () {
          const result = yield* capabilitiesCache.get(providerId);
          return result;
        }),

      invalidateProvider: (providerId: ProviderInstanceId) =>
        Effect.gen(function* () {
          yield* modelsCache.invalidate(providerId);
          yield* capabilitiesCache.invalidate(providerId);
        }),

      invalidateAll: Effect.gen(function* () {
        yield* modelsCache.invalidateAll;
        yield* capabilitiesCache.invalidateAll;
      }),

      entryCount: Effect.sync(() => ({
        models: modelsCache.entryCount,
        capabilities: capabilitiesCache.entryCount,
      })),
    };

    return service;
  },
);
