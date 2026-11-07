/**
 * ProviderCache - Effect.Cache-based caching for provider API responses.
 *
 * Provides TTL-based caching for model lists and capability queries to reduce
 * latency and API quota consumption. Supports cache invalidation on provider
 * configuration changes and exposes hit/miss metrics via observability layer.
 *
 * @module ProviderCache
 */
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Hub from "effect/Hub";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

export class ProviderId extends Schema.TaggedClass<ProviderId>()("ProviderId", {
  readonly value: Schema.String,
}) {}

export class ModelListCacheKey extends Schema.TaggedClass<ModelListCacheKey>()("ModelListCacheKey", {
  readonly providerId: ProviderId,
  readonly filters: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
}) {}

export class CapabilityQueryCacheKey extends Schema.TaggedClass<CapabilityQueryCacheKey>()(
  "CapabilityQueryCacheKey",
  {
    readonly providerId: ProviderId,
    readonly capability: Schema.String,
  },
) {}

export interface ModelListResponse {
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly capabilities: ReadonlyArray<string>;
  }>;
  readonly fetchedAt: number;
}

export interface CapabilityQueryResponse {
  readonly capability: string;
  readonly supported: boolean;
  readonly details: Option.Option<Record<string, unknown>>;
  readonly fetchedAt: number;
}

export interface ProviderCacheConfig {
  readonly modelListTtlMs: number;
  readonly capabilityQueryTtlMs: number;
  readonly maxCacheEntries: number;
}

export const DEFAULT_PROVIDER_CACHE_CONFIG: ProviderCacheConfig = {
  modelListTtlMs: 5 * 60 * 1000, // 5 minutes
  capabilityQueryTtlMs: 15 * 60 * 1000, // 15 minutes
  maxCacheEntries: 1000,
};

export interface CacheMetrics {
  readonly modelListHits: number;
  readonly modelListMisses: number;
  readonly capabilityQueryHits: number;
  readonly capabilityQueryMisses: number;
}

export interface ProviderConfigChangeEvent {
  readonly providerId: ProviderId;
  readonly timestamp: number;
}

export interface ProviderCacheShape {
  readonly getModelList: (
    providerId: ProviderId,
    filters?: Record<string, string>,
  ) => Effect.Effect<ModelListResponse, never>;

  readonly getCapability: (
    providerId: ProviderId,
    capability: string,
  ) => Effect.Effect<CapabilityQueryResponse, never>;

  readonly invalidateProvider: (providerId: ProviderId) => Effect.Effect<void, never>;

  readonly invalidateAll: () => Effect.Effect<void, never>;

  readonly getMetrics: () => Effect.Effect<CacheMetrics, never>;

  readonly onProviderConfigChange: (
    providerId: ProviderId,
  ) => Effect.Effect<void, never>;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/server/ProviderCache",
) {}

const modelListHitCounter = Metric.counter("provider_cache_model_list_hits", {
  description: "Number of cache hits for model list queries",
});

const modelListMissCounter = Metric.counter("provider_cache_model_list_misses", {
  description: "Number of cache misses for model list queries",
});

const capabilityHitCounter = Metric.counter("provider_cache_capability_hits", {
  description: "Number of cache hits for capability queries",
});

const capabilityMissCounter = Metric.counter("provider_cache_capability_misses", {
  description: "Number of cache misses for capability queries",
});

const makeProviderCache = Effect.fn("makeProviderCache")(function* (
  config: ProviderCacheConfig = DEFAULT_PROVIDER_CACHE_CONFIG,
  fetchModelList: (
    providerId: ProviderId,
    filters?: Record<string, string>,
  ) => Effect.Effect<ModelListResponse, never>,
  fetchCapability: (
    providerId: ProviderId,
    capability: string,
  ) => Effect.Effect<CapabilityQueryResponse, never>,
) {
  const metricsRef = yield* Ref.make<CacheMetrics>({
    modelListHits: 0,
    modelListMisses: 0,
    capabilityQueryHits: 0,
    capabilityQueryMisses: 0,
  });

  const configChangeHub = yield* Hub.unbounded<ProviderConfigChangeEvent>();

  const modelListCache = yield* Cache.make({
    capacity: config.maxCacheEntries,
    timeToLive: Duration.millis(config.modelListTtlMs),
    lookup: (key: ModelListCacheKey) =>
      Effect.gen(function* () {
        yield* Ref.update(metricsRef, (m) => ({ ...m, modelListMisses: m.modelListMisses + 1 }));
        yield* modelListMissCounter.increment;
        const result = yield* fetchModelList(key.providerId, key.filters);
        return result;
      }),
  });

  const capabilityCache = yield* Cache.make({
    capacity: config.maxCacheEntries,
    timeToLive: Duration.millis(config.capabilityQueryTtlMs),
    lookup: (key: CapabilityQueryCacheKey) =>
      Effect.gen(function* () {
        yield* Ref.update(metricsRef, (m) => ({
          ...m,
          capabilityQueryMisses: m.capabilityQueryMisses + 1,
        }));
        yield* capabilityMissCounter.increment;
        const result = yield* fetchCapability(key.providerId, key.capability);
        return result;
      }),
  });

  const getModelList: ProviderCacheShape["getModelList"] = (providerId, filters) =>
    Effect.gen(function* () {
      const key = new ModelListCacheKey({ providerId, filters });
      const cached = yield* Cache.get(modelListCache, key);

      if (Option.isSome(cached)) {
        yield* Ref.update(metricsRef, (m) => ({ ...m, modelListHits: m.modelListHits + 1 }));
        yield* modelListHitCounter.increment;
        return cached.value;
      }

      return yield* Cache.get(modelListCache, key);
    });

  const getCapability: ProviderCacheShape["getCapability"] = (providerId, capability) =>
    Effect.gen(function* () {
      const key = new CapabilityQueryCacheKey({ providerId, capability });
      const cached = yield* Cache.get(capabilityCache, key);

      if (Option.isSome(cached)) {
        yield* Ref.update(metricsRef, (m) => ({
          ...m,
          capabilityQueryHits: m.capabilityQueryHits + 1,
        }));
        yield* capabilityHitCounter.increment;
        return cached.value;
      }

      return yield* Cache.get(capabilityCache, key);
    });

  const invalidateProvider: ProviderCacheShape["invalidateProvider"] = (providerId) =>
    Effect.gen(function* () {
      yield* Cache.invalidateWhere(modelListCache, (key) => key.providerId.value === providerId.value);
      yield* Cache.invalidateWhere(capabilityCache, (key) => key.providerId.value === providerId.value);
    });

  const invalidateAll: ProviderCacheShape["invalidateAll"] = () =>
    Effect.gen(function* () {
      yield* Cache.invalidateAll(modelListCache);
      yield* Cache.invalidateAll(capabilityCache);
    });

  const getMetrics: ProviderCacheShape["getMetrics"] = () => Ref.get(metricsRef);

  const onProviderConfigChange: ProviderCacheShape["onProviderConfigChange"] = (providerId) =>
    Effect.gen(function* () {
      const now = yield* Effect.sync(() => Date.now());
      yield* Hub.publish(configChangeHub, { providerId, timestamp: now });
      yield* invalidateProvider(providerId);
    });

  // Subscribe to config changes and invalidate cache
  yield* Hub.subscribe(configChangeHub).pipe(
    Effect.flatMap((subscription) =>
      Effect.forever(
        Effect.gen(function* () {
          const event = yield* subscription.take;
          yield* invalidateProvider(event.providerId);
        }),
      ),
    ),
    Effect.forkScoped,
  );

  return ProviderCache.of({
    getModelList,
    getCapability,
    invalidateProvider,
    invalidateAll,
    getMetrics,
    onProviderConfigChange,
  });
});

import * as Duration from "effect/Duration";

export const layer = (
  config: ProviderCacheConfig = DEFAULT_PROVIDER_CACHE_CONFIG,
  fetchModelList: (
    providerId: ProviderId,
    filters?: Record<string, string>,
  ) => Effect.Effect<ModelListResponse, never>,
  fetchCapability: (
    providerId: ProviderId,
    capability: string,
  ) => Effect.Effect<CapabilityQueryResponse, never>,
) => Layer.effect(ProviderCache, makeProviderCache(config, fetchModelList, fetchCapability));
