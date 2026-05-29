import { Cache } from "@effect/cache";
import { Duration, pipe } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Hub from "effect/Hub";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ProviderConfig } from "../types";

// Metrics
const cacheHitCounter = Metric.counter("provider_cache_hit", {
  description: "Number of cache hits"
});

const cacheMissCounter = Metric.counter("provider_cache_miss", {
  description: "Number of cache misses"
});

// Configuration
interface CacheConfig {
  modelListTTL: Duration.Duration;
  capabilityTTL: Duration.Duration;
  maxEntries: number;
}

const defaultCacheConfig: CacheConfig = {
  modelListTTL: Duration.minutes(5),
  capabilityTTL: Duration.minutes(15),
  maxEntries: 1000
};

// Cache keys
type ModelListKey = {
  providerId: string;
  type: "modelList";
};

type CapabilityKey = {
  providerId: string;
  modelId: string;
  type: "capability";
};

type CacheKey = ModelListKey | CapabilityKey;

// Provider API interfaces
interface ProviderAPI {
  getModelList: (providerId: string) => Effect.Effect<unknown, unknown, unknown[]>;
  getCapability: (providerId: string, modelId: string) => Effect.Effect<unknown, unknown, unknown>;
}

// Cache service
export interface ProviderCache {
  getModelList: (providerId: string) => Effect.Effect<unknown, unknown, unknown[]>;
  getCapability: (providerId: string, modelId: string) => Effect.Effect<unknown, unknown, unknown>;
  invalidateProvider: (providerId: string) => Effect.Effect<unknown, never, void>;
  invalidateAll: () => Effect.Effect<unknown, never, void>;
}

// Create the cache service
export const makeProviderCache = (api: ProviderAPI, config: CacheConfig = defaultCacheConfig) => 
  Effect.gen(function* (_) {
    // Create cache for model lists
    const modelListCache = yield* _(
      Cache.makeWithTTL({
        capacity: config.maxEntries,
        timeToLive: config.modelListTTL,
        lookup: (key: ModelListKey) => 
          pipe(
            api.getModelList(key.providerId),
            Effect.tapError(() => cacheMissCounter.incrementBy(1)),
            Effect.tap(() => cacheHitCounter.incrementBy(1))
          )
      })
    );

    // Create cache for capabilities
    const capabilityCache = yield* _(
      Cache.makeWithTTL({
        capacity: config.maxEntries,
        timeToLive: config.capabilityTTL,
        lookup: (key: CapabilityKey) => 
          pipe(
            api.getCapability(key.providerId, key.modelId),
            Effect.tapError(() => cacheMissCounter.incrementBy(1)),
            Effect.tap(() => cacheHitCounter.incrementBy(1))
          )
      })
    );

    // Create hub for provider config changes
    const providerConfigHub = yield* _(Hub.unbounded<ProviderConfig>());
    
    // Subscribe to provider config changes for cache invalidation
    const providerConfigSubscription = yield* _(Hub.subscribe(providerConfigHub));
    
    // Effect to handle config changes and invalidate cache
    yield* _(
      providerConfigSubscription.pipe(
        Effect.flatMap(SubscriptionRef.make),
        Effect.flatMap(subscriptionRef => 
          SubscriptionRef.get(subscriptionRef).pipe(
            Effect.flatMap(config => {
              if (config.action === "update") {
                return invalidateProvider(config.providerId);
              }
              return Effect.unit;
            }),
            Effect.forever
          )
        ),
        Effect.forkScoped
      )
    );

    // Invalidate all entries for a provider
    const invalidateProvider = (providerId: string) => 
      Effect.gen(function* (_) {
        // In a real implementation, we would need to track keys per provider
        // For simplicity, we're just clearing the caches
        yield* _(modelListCache.invalidateWhen(key => 
          key.type === "modelList" && key.providerId === providerId
        ));
        yield* _(capabilityCache.invalidateWhen(key => 
          key.type === "capability" && key.providerId === providerId
        ));
      });

    // Invalidate all entries
    const invalidateAll = () => 
      Effect.gen(function* (_) {
        yield* _(modelListCache.invalidateAll);
        yield* _(capabilityCache.invalidateAll);
      });

    // Public API
    return {
      getModelList: (providerId: string) => 
        modelListCache.get({ providerId, type: "modelList" }),
      getCapability: (providerId: string, modelId: string) => 
        capabilityCache.get({ providerId, modelId, type: "capability" }),
      invalidateProvider,
      invalidateAll
    } as ProviderCache;
  });

// Layer for the cache service
export const ProviderCacheLive = (api: ProviderAPI) => 
  Layer.effect(
    Layer.succeed(makeProviderCache(api))
  );