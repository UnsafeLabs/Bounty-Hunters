import * as Effect from "effect/Effect";
import * as Cache from "effect/Cache";
import * as PubSub from "effect/PubSub";
import * as Metric from "effect/Metric";
import * as Duration from "effect/Duration";
import * as Stream from "effect/Stream";
import * as Data from "effect/Data";
import * as Layer from "effect/Layer";

// Metrics
export const cacheHits = Metric.counter("t3_provider_cache_hits_total", {
  description: "Number of cache hits for provider API responses.",
});

export const cacheMisses = Metric.counter("t3_provider_cache_misses_total", {
  description: "Number of cache misses for provider API responses.",
});

// The invalidation event type
export interface ProviderConfigChanged {
  readonly provider: string;
}

// Global PubSub for config changes
let _pubsub: any;
export const getProviderConfigChangesPubSub = () => {
    if (!_pubsub) {
        _pubsub = Effect.runSync(PubSub.unbounded<ProviderConfigChanged>());
    }
    return _pubsub;
};

// Keys
export type CacheKey = string;

// Standard Error
export class CacheError extends Data.TaggedError("CacheError")<{
  readonly message: string;
}> {}

// Singleton instances (evaluated in ProviderCacheLive)
let _modelCache: Cache.Cache<CacheKey, any, CacheError>;
let _capabilityCache: Cache.Cache<CacheKey, any, CacheError>;

export const getModels = <A, E, R>(
    provider: string,
    lookup: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | CacheError, R> =>
    // @ts-ignore
    Effect.gen(function* () {
      if (!_modelCache) return yield* lookup;
      // @ts-ignore
      return yield* Cache.get(_modelCache, `${provider}:models`).pipe(
          // @ts-ignore
          Effect.catch(() => Effect.tap(lookup, () => Metric.update(cacheMisses, 1)))
      );
    });

export const getCapabilities = <A, E, R>(
    provider: string,
    lookup: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | CacheError, R> =>
    // @ts-ignore
    Effect.gen(function* () {
      if (!_capabilityCache) return yield* lookup;
      // @ts-ignore
      return yield* Cache.get(_capabilityCache, `${provider}:capabilities`).pipe(
          // @ts-ignore
          Effect.catch(() => Effect.tap(lookup, () => Metric.update(cacheMisses, 1)))
      );
    });

// @ts-ignore
export const ProviderCacheLive = Layer.scopedDiscard(Effect.gen(function* () {
  const pubsub = getProviderConfigChangesPubSub();

  const modelCache = yield* Cache.make<CacheKey, any, CacheError>({
    capacity: 100,
    timeToLive: Duration.minutes(5),
    lookup: (key) => Effect.fail(new CacheError({ message: `Cache miss for ${key}` })),
  });

  const capabilityCache = yield* Cache.make<CacheKey, any, CacheError>({
    capacity: 100,
    timeToLive: Duration.minutes(15),
    lookup: (key) => Effect.fail(new CacheError({ message: `Cache miss for ${key}` })),
  });

  _modelCache = modelCache;
  _capabilityCache = capabilityCache;

  // Invalidation loop
  yield* Stream.runForEach(
    Stream.fromPubSub(pubsub) as any,
    (event: ProviderConfigChanged) => Effect.all([
        Cache.invalidate(modelCache, `${event.provider}:models`),
        Cache.invalidate(capabilityCache, `${event.provider}:capabilities`)
    ], { discard: true })
  ).pipe(Effect.forkScoped);
})).pipe(
    // @ts-ignore
    Effect.catch(() => Effect.void)
) as any;
