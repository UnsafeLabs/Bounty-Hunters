/**
 * Effect.Cache-based provider API response caching with configurable TTL.
 *
 * Caches provider model lists (5-minute TTL) and capability queries
 * (15-minute TTL). Supports cache invalidation via Effect.Hub subscription
 * when provider configuration changes.
 */

import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hub from "effect/Hub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

const MODELS_CACHE_TTL = Duration.minutes(5);
const CAPABILITIES_CACHE_TTL = Duration.minutes(15);

export interface ProviderCacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly cachedAt: number;
}

export interface ProviderCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
}

/**
 * Provider API response cache with TTL-based expiration and
 * invalidation on configuration changes.
 */
export class ProviderCache extends Effect.Service<ProviderCache>()(
  "app/server/ProviderCache",
  {
    effect: Effect.gen(function* () {
      const invalidationHub = yield* Hub.unbounded<void>();
      const invalidationStream = Hub.subscribe(invalidationHub);

      // Model list cache (5-minute TTL)
      const modelCache = yield* Cache.make({
        capacity: 100,
        timeToLive: (_: string) => Effect.succeed(MODELS_CACHE_TTL),
        lookup: (key: string) =>
          Effect.fail(new Error(`Cache miss for key: ${key}`)),
      }).pipe(Scope.extend(Scope.globalScope));

      // Capability query cache (15-minute TTL)
      const capabilityCache = yield* Cache.make({
        capacity: 100,
        timeToLive: (_: string) => Effect.succeed(CAPABILITIES_CACHE_TTL),
        lookup: (key: string) =>
          Effect.fail(new Error(`Cache miss for key: ${key}`)),
      }).pipe(Scope.extend(Scope.globalScope));

      const metricsRef = yield* Ref.make<ProviderCacheMetrics>({
        hits: 0,
        misses: 0,
        size: 0,
      });

      const getOrCompute = <T>(
        cache: Cache.Cache<string, T, Error>,
        key: string,
        compute: () => Effect.Effect<T, Error>,
      ): Effect.Effect<T, Error> =>
        Effect.gen(function* () {
          const cached = yield* cache.get(key).pipe(Effect.option);
          if (cached._tag === "Some") {
            yield* Ref.update(metricsRef, (m) => ({ ...m, hits: m.hits + 1 }));
            return cached.value;
          }
          yield* Ref.update(metricsRef, (m) => ({ ...m, misses: m.misses + 1 }));
          const value = yield* compute();
          yield* cache.set(key, value);
          yield* Ref.update(metricsRef, (m) => ({
            ...m,
            size: m.size + 1,
          }));
          return value;
        });

      const invalidate = Effect.gen(function* () {
        yield* modelCache.clear;
        yield* capabilityCache.clear;
        yield* Ref.set(metricsRef, { hits: 0, misses: 0, size: 0 });
        yield* Hub.publish(invalidationHub, void 0);
      });

      return {
        getModels: <T>(key: string, compute: () => Effect.Effect<T, Error>) =>
          getOrCompute(modelCache, key, compute),
        getCapabilities: <T>(key: string, compute: () => Effect.Effect<T, Error>) =>
          getOrCompute(capabilityCache, key, compute),
        invalidate,
        getMetrics: Ref.get(metricsRef),
        invalidationStream,
      } as const;
    }),
  },
) {}

export type ProviderCache = typeof ProviderCache.Type;
