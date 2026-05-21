import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

export class ProviderCacheService extends Effect.Service<ProviderCacheService>()(
  "t3/server/services/ProviderCache",
  {
    effect: Effect.gen(function* () {
      const modelListCache = yield* Cache.make({
        capacity: 100,
        timeToLive: Duration.minutes(5),
        lookup: (provider: string) =>
          Effect.succeed({ provider, models: [], cachedAt: Date.now() }),
      }).pipe(Scope.extend(Effect.runSync));

      const capabilitiesCache = yield* Cache.make({
        capacity: 100,
        timeToLive: Duration.minutes(15),
        lookup: (provider: string) =>
          Effect.succeed({ provider, capabilities: [], cachedAt: Date.now() }),
      }).pipe(Scope.extend(Effect.runSync));

      function getCachedModels(provider: string) {
        return modelListCache.get(provider);
      }

      function getCachedCapabilities(provider: string) {
        return capabilitiesCache.get(provider);
      }

      function invalidateProvider(provider: string) {
        return Effect.zipRight(
          modelListCache.invalidate(provider),
          capabilitiesCache.invalidate(provider),
        );
      }

      return {
        getCachedModels,
        getCachedCapabilities,
        invalidateProvider,
      } as const;
    }),
  },
) {}
