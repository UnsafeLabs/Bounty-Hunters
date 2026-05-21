import type { ProviderInstanceId, ServerProviderModel } from "@t3tools/contracts";
import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";

const cacheHitsTotal = Metric.counter("t3_provider_cache_hits_total", {
  description: "Total provider cache hits.",
});
const cacheMissesTotal = Metric.counter("t3_provider_cache_misses_total", {
  description: "Total provider cache misses.",
});

export interface CacheMetrics {
  readonly hits: number;
  readonly misses: number;
}

export interface ProviderCache {
  readonly getModels: (instanceId: ProviderInstanceId) => Effect.Effect<ReadonlyArray<ServerProviderModel>>;
  readonly getCapabilities: (instanceId: ProviderInstanceId) => Effect.Effect<ProviderAdapterCapabilities>;
  readonly invalidateProvider: (instanceId: ProviderInstanceId) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
  readonly getMetrics: Effect.Effect<CacheMetrics>;
}

export const makeProviderCache = (options: {
  readonly fetchModels: (instanceId: ProviderInstanceId) => Effect.Effect<ReadonlyArray<ServerProviderModel>>;
  readonly fetchCapabilities: (instanceId: ProviderInstanceId) => Effect.Effect<ProviderAdapterCapabilities>;
  readonly modelListTTL?: Duration.Duration;
  readonly capabilityTTL?: Duration.Duration;
  readonly maxEntries?: number;
}): Effect.Effect<ProviderCache> =>
  Effect.gen(function* () {
    const modelCache = yield* Cache.make<ProviderInstanceId, ReadonlyArray<ServerProviderModel>>({
      capacity: options.maxEntries ?? 100,
      timeToLive: options.modelListTTL ?? Duration.minutes(5),
      lookup: options.fetchModels,
    });
    const capabilityCache = yield* Cache.make<ProviderInstanceId, ProviderAdapterCapabilities>({
      capacity: options.maxEntries ?? 100,
      timeToLive: options.capabilityTTL ?? Duration.minutes(15),
      lookup: options.fetchCapabilities,
    });

    let hits = 0;
    let misses = 0;

    const recordHit = Effect.andThen(Metric.update(cacheHitsTotal, 1), Effect.sync(() => hits++));
    const recordMiss = Effect.andThen(Metric.update(cacheMissesTotal, 1), Effect.sync(() => misses++));

    const getWithMetrics = <A>(cache: Cache.Cache<ProviderInstanceId, A>, id: ProviderInstanceId): Effect.Effect<A> =>
      Cache.getOption(cache, id).pipe(
        Effect.flatMap((option) =>
          Option.isSome(option)
            ? Effect.succeed(option.value).pipe(Effect.tap(() => recordHit))
            : Cache.get(cache, id).pipe(Effect.tap(() => recordMiss)),
        ),
      );

    const getModels = (id: ProviderInstanceId) => getWithMetrics(modelCache, id);
    const getCapabilities = (id: ProviderInstanceId) => getWithMetrics(capabilityCache, id);
    const invalidateProvider = (id: ProviderInstanceId) =>
      Effect.andThen(Cache.invalidate(modelCache, id), Cache.invalidate(capabilityCache, id));
    const invalidateAll = Effect.andThen(Cache.invalidateAll(modelCache), Cache.invalidateAll(capabilityCache));
    const getMetrics = Effect.sync(() => ({ hits, misses }));

    return { getModels, getCapabilities, invalidateProvider, invalidateAll, getMetrics };
  });
