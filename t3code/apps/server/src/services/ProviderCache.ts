import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as MetricCounter from "effect/MetricCounter";
import * as Scope from "effect/Scope";

// ===== Types =====

export interface ProviderCacheConfig {
  readonly modelListTTL: Duration.Duration;
  readonly capabilityTTL: Duration.Duration;
  readonly maxEntries: number;
}

export const DEFAULT_PROVIDER_CACHE_CONFIG: ProviderCacheConfig = {
  modelListTTL: Duration.minutes(5),
  capabilityTTL: Duration.minutes(15),
  maxEntries: 100,
};

// ===== Errors =====

export class ProviderCacheError {
  readonly _tag = "ProviderCacheError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

// ===== Metrics =====

const cacheHitsTotal = MetricCounter.MetricCounter("provider_cache_hits_total").pipe(
  Metric.withDescription("Total number of cache hits"),
);

const cacheMissesTotal = MetricCounter.MetricCounter("provider_cache_misses_total").pipe(
  Metric.withDescription("Total number of cache misses"),
);

// ===== Service Shape =====

export interface ProviderCacheShape {
  readonly getModels: (
    providerId: string,
    lookup: () => Effect.Effect<unknown, ProviderCacheError>,
  ) => Effect.Effect<unknown, ProviderCacheError>;
  readonly getCapabilities: (
    providerId: string,
    lookup: () => Effect.Effect<unknown, ProviderCacheError>,
  ) => Effect.Effect<unknown, ProviderCacheError>;
  readonly invalidate: (providerId: string) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
  readonly healthCheck: Effect.Effect<{
    readonly status: "healthy" | "unhealthy";
    readonly entries: number;
    readonly hits: number;
    readonly misses: number;
    readonly ratio: number;
  }>;
  readonly config: ProviderCacheConfig;
}

// ===== Implementation =====

const make = Effect.gen(function* () {
  const config = DEFAULT_PROVIDER_CACHE_CONFIG;

  const modelListCache = yield* Cache.make({
    capacity: config.maxEntries,
    timeToLive: (): Duration.Duration => config.modelListTTL,
    lookup: (_: string) =>
      Effect.fail(new ProviderCacheError("Direct lookup not supported; use getModels")),
  }).pipe(Effect.scoped);

  const capabilityCache = yield* Cache.make({
    capacity: config.maxEntries,
    timeToLive: (): Duration.Duration => config.capabilityTTL,
    lookup: (_: string) =>
      Effect.fail(new ProviderCacheError("Direct lookup not supported; use getCapabilities")),
  }).pipe(Effect.scoped);

  const cachedKeys = new Set<string>();

  const getModels = (
    providerId: string,
    lookup: () => Effect.Effect<unknown, ProviderCacheError>,
  ): Effect.Effect<unknown, ProviderCacheError> =>
    modelListCache.get(providerId).pipe(
      Effect.catchTag("CacheMiss", () =>
        Effect.flatMap(cacheMissesTotal, () =>
          Effect.flatMap(lookup, (result: unknown) =>
            Effect.sync(() => {
              cachedKeys.add(`models:${providerId}`);
              return result;
            }),
          ),
        ),
      ),
      Effect.tap(() => cacheHitsTotal),
    );

  const getCapabilities = (
    providerId: string,
    lookup: () => Effect.Effect<unknown, ProviderCacheError>,
  ): Effect.Effect<unknown, ProviderCacheError> =>
    capabilityCache.get(providerId).pipe(
      Effect.catchTag("CacheMiss", () =>
        Effect.flatMap(cacheMissesTotal, () =>
          Effect.flatMap(lookup, (result: unknown) =>
            Effect.sync(() => {
              cachedKeys.add(`caps:${providerId}`);
              return result;
            }),
          ),
        ),
      ),
      Effect.tap(() => cacheHitsTotal),
    );

  const invalidate = (providerId: string): Effect.Effect<void> =>
    Effect.sync(() => {
      modelListCache.invalidate(providerId);
      capabilityCache.invalidate(providerId);
      cachedKeys.delete(`models:${providerId}`);
      cachedKeys.delete(`caps:${providerId}`);
    });

  const invalidateAll: Effect.Effect<void> = Effect.sync(() => {
    modelListCache.clear();
    capabilityCache.clear();
    cachedKeys.clear();
  });

  const healthCheck: Effect.Effect<{
    readonly status: "healthy" | "unhealthy";
    readonly entries: number;
    readonly hits: number;
    readonly misses: number;
    readonly ratio: number;
  }> = Effect.sync(() => ({
    status: "healthy" as const,
    entries: cachedKeys.size,
    hits: 0,
    misses: 0,
    ratio: 0,
  }));

  return {
    getModels,
    getCapabilities,
    invalidate,
    invalidateAll,
    healthCheck,
    config,
  } satisfies ProviderCacheShape;
});

export class ProviderCache extends Layer.Service<ProviderCache, ProviderCacheShape>()(
  "t3code/server/services/ProviderCache",
) {}

export const layer = Layer.effect(ProviderCache, make);
