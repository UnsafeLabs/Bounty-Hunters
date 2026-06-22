import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Metric from "effect/Metric";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { compactMetricAttributes } from "../observability/Attributes.ts";

export const CACHE_DEFAULT_CAPACITY = 100;
export const MODEL_LIST_TTL = Duration.minutes(5);
export const CAPABILITIES_TTL = Duration.minutes(15);

export type CacheKind = "modelList" | "capabilities";

export const providerCacheHitsTotal = Metric.counter("t3_provider_cache_hits_total", {
  description: "Total provider cache hits by kind.",
});

export const providerCacheMissesTotal = Metric.counter("t3_provider_cache_misses_total", {
  description: "Total provider cache misses by kind.",
});

export const providerCacheInvalidationsTotal = Metric.counter(
  "t3_provider_cache_invalidations_total",
  {
    description: "Total provider cache invalidations by kind.",
  },
);

const cacheKindLabel = (kind: CacheKind) => compactMetricAttributes({ kind });

export interface ProviderCacheShape {
  readonly getModelList: (
    instanceId: string,
    lookup: () => Effect.Effect<string, Error>,
  ) => Effect.Effect<string, Error>;
  readonly getCapabilities: (
    instanceId: string,
    lookup: () => Effect.Effect<string, Error>,
  ) => Effect.Effect<string, Error>;
  readonly invalidateProvider: (instanceId: string) => Effect.Effect<void>;
  readonly streamInvalidations: Stream.Stream<string>;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/services/ProviderCache",
) {}

type CacheMap = HashMap.HashMap<string, Cache.Cache<string, string, Error>>;

const makeCacheEntry = (
  instanceId: string,
  fn: () => Effect.Effect<string, Error>,
  timeToLive: Duration.Duration,
) =>
  Cache.make<string, string, Error>({
    capacity: CACHE_DEFAULT_CAPACITY,
    timeToLive,
    lookup: () => fn(),
  });

export const makeProviderCache = Effect.gen(function* () {
  const invalidationPubSub = yield* PubSub.unbounded<string>();
  const modelListCaches = yield* Ref.make<CacheMap>(HashMap.empty());
  const capabilitiesCaches = yield* Ref.make<CacheMap>(HashMap.empty());

  const getModelList: ProviderCacheShape["getModelList"] = (instanceId, fn) =>
    Effect.gen(function* () {
      const caches = yield* Ref.get(modelListCaches);
      const existing = HashMap.get(caches, instanceId);
      if (existing._tag === "None") {
        const cache = yield* makeCacheEntry(instanceId, fn, MODEL_LIST_TTL);
        yield* Ref.update(modelListCaches, (m) => HashMap.set(m, instanceId, cache));
        const value = yield* Cache.get(cache, instanceId);
        yield* Metric.update(
          Metric.withAttributes(providerCacheMissesTotal, cacheKindLabel("modelList")),
          1,
        );
        return value;
      }
      const cache = existing.value;
      const cached = yield* Cache.getOption(cache, instanceId);
      if (cached._tag === "Some") {
        yield* Metric.update(
          Metric.withAttributes(providerCacheHitsTotal, cacheKindLabel("modelList")),
          1,
        );
        return cached.value;
      }
      const value = yield* Cache.get(cache, instanceId);
      yield* Metric.update(
        Metric.withAttributes(providerCacheMissesTotal, cacheKindLabel("modelList")),
        1,
      );
      return value;
    });

  const getCapabilities: ProviderCacheShape["getCapabilities"] = (instanceId, fn) =>
    Effect.gen(function* () {
      const caches = yield* Ref.get(capabilitiesCaches);
      const existing = HashMap.get(caches, instanceId);
      if (existing._tag === "None") {
        const cache = yield* makeCacheEntry(instanceId, fn, CAPABILITIES_TTL);
        yield* Ref.update(capabilitiesCaches, (m) => HashMap.set(m, instanceId, cache));
        const value = yield* Cache.get(cache, instanceId);
        yield* Metric.update(
          Metric.withAttributes(providerCacheMissesTotal, cacheKindLabel("capabilities")),
          1,
        );
        return value;
      }
      const cache = existing.value;
      const cached = yield* Cache.getOption(cache, instanceId);
      if (cached._tag === "Some") {
        yield* Metric.update(
          Metric.withAttributes(providerCacheHitsTotal, cacheKindLabel("capabilities")),
          1,
        );
        return cached.value;
      }
      const value = yield* Cache.get(cache, instanceId);
      yield* Metric.update(
        Metric.withAttributes(providerCacheMissesTotal, cacheKindLabel("capabilities")),
        1,
      );
      return value;
    });

  const invalidateProvider: ProviderCacheShape["invalidateProvider"] = (instanceId) =>
    Effect.gen(function* () {
      const mLcaches = yield* Ref.get(modelListCaches);
      const cCaches = yield* Ref.get(capabilitiesCaches);
      const mEntry = HashMap.get(mLcaches, instanceId);
      const cEntry = HashMap.get(cCaches, instanceId);

      if (mEntry._tag === "Some") {
        yield* Cache.invalidate(mEntry.value, instanceId);
        yield* Ref.update(modelListCaches, (m) => HashMap.remove(m, instanceId));
      }
      if (cEntry._tag === "Some") {
        yield* Cache.invalidate(cEntry.value, instanceId);
        yield* Ref.update(capabilitiesCaches, (m) => HashMap.remove(m, instanceId));
      }

      yield* Metric.update(
        Metric.withAttributes(providerCacheInvalidationsTotal, cacheKindLabel("modelList")),
        1,
      );
      yield* Metric.update(
        Metric.withAttributes(providerCacheInvalidationsTotal, cacheKindLabel("capabilities")),
        1,
      );
      yield* PubSub.publish(invalidationPubSub, instanceId).pipe(Effect.asVoid);
    });

  return {
    getModelList,
    getCapabilities,
    invalidateProvider,
    streamInvalidations: Stream.fromPubSub(invalidationPubSub),
  } satisfies ProviderCacheShape;
});
