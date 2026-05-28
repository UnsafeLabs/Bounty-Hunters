import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Layer from "effect/Layer";

export type ProviderCacheType = "models" | "capabilities";

export interface ProviderCacheInvalidationEvent {
  readonly cacheType?: ProviderCacheType;
  readonly instanceId?: string;
}

export interface ProviderCacheResolvers<R = never> {
  readonly resolveModels: (instanceId: string) => Effect.Effect<ReadonlyArray<unknown>, unknown, R>;
  readonly resolveCapabilities: (instanceId: string) => Effect.Effect<unknown, unknown, R>;
}

const MODELS_TTL = Duration.minutes(5);
const CAPABILITIES_TTL = Duration.minutes(15);
const CACHE_CAPACITY = 1_024;

const modelsHits = Metric.counter("t3_models_cache_hits_total", { description: "Provider models cache hits" });
const modelsMisses = Metric.counter("t3_models_cache_misses_total", { description: "Provider models cache misses" });
const capHits = Metric.counter("t3_capabilities_cache_hits_total", { description: "Provider capabilities cache hits" });
const capMisses = Metric.counter("t3_capabilities_cache_misses_total", { description: "Provider capabilities cache misses" });

export interface ProviderCacheShape {
  readonly getModels: (instanceId: string) => Effect.Effect<ReadonlyArray<unknown>>;
  readonly getCapabilities: (instanceId: string) => Effect.Effect<unknown>;
  readonly invalidate: (event: ProviderCacheInvalidationEvent) => Effect.Effect<void>;
  readonly invalidationHub: PubSub.PubSub<ProviderCacheInvalidationEvent>;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()("t3/provider/Services/ProviderCache") {}

export const makeProviderCache = Effect.fn("makeProviderCache")(function* <R>(
  resolvers: ProviderCacheResolvers<R>,
) {
  const modelsCache = yield* Cache.make<string, ReadonlyArray<unknown>, unknown>({
    capacity: CACHE_CAPACITY,
    lookup: (key) => resolvers.resolveModels(key),
    timeToLive: MODELS_TTL,
  });

  const capabilitiesCache = yield* Cache.make<string, unknown, unknown>({
    capacity: CACHE_CAPACITY,
    lookup: (key) => resolvers.resolveCapabilities(key),
    timeToLive: CAPABILITIES_TTL,
  });

  const invalidationHub = yield* PubSub.unbounded<ProviderCacheInvalidationEvent>();
  const sub = yield* PubSub.subscribe(invalidationHub);

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const event = yield* PubSub.take(sub);
        if (!event.cacheType && !event.instanceId) {
          yield* Cache.invalidateAll(modelsCache);
          yield* Cache.invalidateAll(capabilitiesCache);
        } else if (event.instanceId) {
          if (!event.cacheType || event.cacheType === "models") yield* Cache.invalidate(modelsCache, event.instanceId);
          if (!event.cacheType || event.cacheType === "capabilities") yield* Cache.invalidate(capabilitiesCache, event.instanceId);
        } else if (event.cacheType === "models") {
          yield* Cache.invalidateAll(modelsCache);
        } else {
          yield* Cache.invalidateAll(capabilitiesCache);
        }
      }
    }),
  );

  const getModels: ProviderCacheShape["getModels"] = (instanceId) =>
    Effect.gen(function* () {
      const opt = yield* Cache.getOption(modelsCache, instanceId);
      if (Option.isSome(opt)) {
        yield* Metric.update(modelsHits, 1);
        return opt.value;
      }
      yield* Metric.update(modelsMisses, 1);
      return yield* Cache.get(modelsCache, instanceId);
    });

  const getCapabilities: ProviderCacheShape["getCapabilities"] = (instanceId) =>
    Effect.gen(function* () {
      const opt = yield* Cache.getOption(capabilitiesCache, instanceId);
      if (Option.isSome(opt)) {
        yield* Metric.update(capHits, 1);
        return opt.value;
      }
      yield* Metric.update(capMisses, 1);
      return yield* Cache.get(capabilitiesCache, instanceId);
    });

  return {
    getModels,
    getCapabilities,
    invalidate: (event) => PubSub.publish(invalidationHub, event),
    invalidationHub,
  } satisfies ProviderCacheShape;
});

export const ProviderCacheLive = <R>(
  resolvers: ProviderCacheResolvers<R>,
): Layer.Layer<ProviderCache, never, R | Scope.Scope> =>
  Layer.effect(ProviderCache, makeProviderCache(resolvers));
