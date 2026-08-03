import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import { providerCacheHitsTotal, providerCacheMissesTotal, increment } from "../../observability/Metrics.ts";

export interface ModelListCacheEntry<T = unknown> {
  readonly providerId: string;
  readonly models: ReadonlyArray<T>;
}

export interface CapabilityCacheEntry<T = unknown> {
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilities: T;
}

export const MODEL_LIST_CACHE_TTL = Duration.minutes(5);
export const CAPABILITY_CACHE_TTL = Duration.minutes(15);

export interface ProviderCacheService<M = unknown, C = unknown> {
  readonly getModels: (
    providerId: string,
    fetcher: (providerId: string) => Effect.Effect<ReadonlyArray<M>, Error>,
  ) => Effect.Effect<ReadonlyArray<M>, Error>;
  readonly getCapabilities: (
    providerId: string,
    modelId: string,
    fetcher: (providerId: string, modelId: string) => Effect.Effect<C, Error>,
  ) => Effect.Effect<C, Error>;
  readonly invalidateProvider: (providerId: string) => Effect.Effect<void>;
  readonly invalidateAll: () => Effect.Effect<void>;
}

export const makeProviderCache = Effect.gen(function* () {
  const modelListCache = yield* Cache.make({
    capacity: 100,
    timeToLive: MODEL_LIST_CACHE_TTL,
    lookup: (key: string) =>
      Effect.fail(new Error(`ModelListCache lookup failed for key ${key}`)),
  });

  const capabilityCache = yield* Cache.make({
    capacity: 500,
    timeToLive: CAPABILITY_CACHE_TTL,
    lookup: (key: string) =>
      Effect.fail(new Error(`CapabilityCache lookup failed for key ${key}`)),
  });

  const getModels = <M>(
    providerId: string,
    fetcher: (providerId: string) => Effect.Effect<ReadonlyArray<M>, Error>,
  ): Effect.Effect<ReadonlyArray<M>, Error> =>
    Effect.gen(function* () {
      const cached = yield* Cache.getOption(modelListCache, providerId);
      if (Option.isSome(cached)) {
        yield* increment(providerCacheHitsTotal, { cache: "model_list", providerId });
        return cached.value as ReadonlyArray<M>;
      }

      yield* increment(providerCacheMissesTotal, { cache: "model_list", providerId });
      const freshModels = yield* fetcher(providerId);
      yield* Cache.set(modelListCache, providerId, freshModels as unknown);
      return freshModels;
    });

  const getCapabilities = <C>(
    providerId: string,
    modelId: string,
    fetcher: (providerId: string, modelId: string) => Effect.Effect<C, Error>,
  ): Effect.Effect<C, Error> =>
    Effect.gen(function* () {
      const cacheKey = `${providerId}:${modelId}`;
      const cached = yield* Cache.getOption(capabilityCache, cacheKey);
      if (Option.isSome(cached)) {
        yield* increment(providerCacheHitsTotal, { cache: "capability", providerId, modelId });
        return cached.value as C;
      }

      yield* increment(providerCacheMissesTotal, { cache: "capability", providerId, modelId });
      const freshCapabilities = yield* fetcher(providerId, modelId);
      yield* Cache.set(capabilityCache, cacheKey, freshCapabilities as unknown);
      return freshCapabilities;
    });

  const invalidateProvider = (providerId: string) =>
    Effect.gen(function* () {
      yield* Cache.invalidate(modelListCache, providerId);
      yield* Cache.invalidateAll(capabilityCache);
    });

  const invalidateAll = () =>
    Effect.gen(function* () {
      yield* Cache.invalidateAll(modelListCache);
      yield* Cache.invalidateAll(capabilityCache);
    });

  return {
    getModels,
    getCapabilities,
    invalidateProvider,
    invalidateAll,
  };
});
