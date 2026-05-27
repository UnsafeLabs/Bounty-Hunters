import { Cache, Effect, Duration, Layer, Hub, Queue, pipe, Option, Metric } from "effect";
import { Chunk } from "effect/Chunk";

// Configuration interface
interface ProviderCacheConfig {
  modelListTTL: Duration.Duration;
  capabilityTTL: Duration.Duration;
  maxCacheEntries: number;
}

// Default configuration
const defaultConfig: ProviderCacheConfig = {
  modelListTTL: Duration.minutes(5),
  capabilityTTL: Duration.minutes(15),
  maxCacheEntries: 1000
};

// Cache keys
type ModelListKey = { providerId: string };
type CapabilityKey = { providerId: string; modelId: string; capability: string };
type CacheKey = ModelListKey | CapabilityKey;

// Provider configuration change event
interface ProviderConfigChangeEvent {
  providerId: string;
}

// Metrics
const cacheHitMetric = Metric.counter("provider_cache_hit", {
  description: "Number of cache hits"
});

const cacheMissMetric = Metric.counter("provider_cache_miss", {
  description: "Number of cache misses"
});

// Provider Cache Service
class ProviderCacheService extends Effect.Tag("ProviderCacheService")<
  ProviderCacheService,
  {
    readonly getModelList: (providerId: string) => Effect.Effect<unknown, unknown, unknown>;
    readonly getCapability: (providerId: string, modelId: string, capability: string) => Effect.Effect<unknown, unknown, unknown>;
    readonly invalidateProvider: (providerId: string) => Effect.Effect<void>;
    readonly getConfig: () => ProviderCacheConfig;
  }
>() {
  static live = Layer.effect(
    this,
    Effect.gen(function* (_) {
      // Configuration
      const config = defaultConfig;
      
      // Event hub for provider config changes
      const providerConfigChangeHub = yield* _(Hub.make<ProviderConfigChangeEvent>());
      
      // Cache for model lists
      const modelListCache = yield* _(
        Cache.make({
          capacity: config.maxCacheEntries,
          timeToLive: config.modelListTTL,
          lookup: (key: ModelListKey) => 
            pipe(
              Effect.sync(() => {
                // Simulate API call to fetch model list
                return fetchModelList(key.providerId);
              }),
              Effect.tap(() => Metric.increment(cacheMissMetric)),
              Effect.catchAll((error) => 
                Effect.dieMessage(`Failed to fetch model list for provider ${key.providerId}: ${error}`)
              )
            )
        })
      );
      
      // Cache for capabilities
      const capabilityCache = yield* _(
        Cache.make({
          capacity: config.maxCacheEntries,
          timeToLive: config.capabilityTTL,
          lookup: (key: CapabilityKey) => 
            pipe(
              Effect.sync(() => {
                // Simulate API call to fetch capability
                return fetchCapability(key.providerId, key.modelId, key.capability);
              }),
              Effect.tap(() => Metric.increment(cacheMissMetric)),
              Effect.catchAll((error) => 
                Effect.dieMessage(`Failed to fetch capability for provider ${key.providerId}, model ${key.modelId}: ${error}`)
              )
            )
        })
      );
      
      // Subscribe to provider config changes for cache invalidation
      yield* _(
        Hub.subscribe(providerConfigChangeHub),
        Effect.flatMap((subscription) => 
          Queue.take(subscription).pipe(
            Effect.flatMap((event) => invalidateProvider(event.providerId)),
            Effect.forever
          )
        ),
        Effect.forkScoped
      );
      
      // Invalidate all entries for a provider
      function invalidateProvider(providerId: string) {
        return Effect.gen(function* (_) {
          // In a real implementation, we would need to iterate through cache entries
          // and invalidate those matching the providerId
          // For now, we'll just log the invalidation
          console.log(`Invalidating cache for provider: ${providerId}`);
          return undefined;
        });
      }
      
      // Simulate fetching model list from provider API
      function fetchModelList(providerId: string): unknown {
        // This would be replaced with actual API call
        return {
          providerId,
          models: [`model-${providerId}-1`, `model-${providerId}-2`],
          timestamp: Date.now()
        };
      }
      
      // Simulate fetching capability from provider API
      function fetchCapability(providerId: string, modelId: string, capability: string): unknown {
        // This would be replaced with actual API call
        return {
          providerId,
          modelId,
          capability,
          supported: true,
          timestamp: Date.now()
        };
      }
      
      // Get model list with caching
      const getModelList = (providerId: string) => 
        pipe(
          modelListCache.get({ providerId }),
          Effect.tap(() => Metric.increment(cacheHitMetric))
        );
      
      // Get capability with caching
      const getCapability = (providerId: string, modelId: string, capability: string) => 
        pipe(
          capabilityCache.get({ providerId, modelId, capability }),
          Effect.tap(() => Metric.increment(cacheHitMetric))
        );
      
      return {
        getModelList,
        getCapability,
        invalidateProvider: (providerId: string) => 
          pipe(
            Hub.publish(providerConfigChangeHub, { providerId }),
            Effect.asVoid
          ),
        getConfig: () => config
      };
    })
  );
}

export { ProviderCacheService, type ProviderCacheConfig };