import { Cache, Context, Effect, Duration, Layer, Option, Hub, Queue, Metric } from "effect"
import { pipe } from "effect/Function"
import { ProviderService } from "./ProviderService"

// Metrics
const modelListCacheHits = Metric.counter("model_list_cache_hits")
const modelListCacheMisses = Metric.counter("model_list_cache_misses")
const capabilityCacheHits = Metric.counter("capability_cache_hits")
const capabilityCacheMisses = Metric.counter("capability_cache_misses")

// Cache configuration
const MODEL_LIST_TTL = Duration.minutes(5)
const CAPABILITY_TTL = Duration.minutes(15)
const MAX_CACHE_ENTRIES = 1000

// Cache key types
type ModelListCacheKey = {
  providerId: string
}

type CapabilityCacheKey = {
  providerId: string
  modelId: string
  capability: string
}

// Cache implementation
export class ProviderCache extends Effect.Tag("ProviderCache")<ProviderCache, {
  modelListCache: Cache.Cache<ModelListCacheKey, string[], never>
  capabilityCache: Cache.Cache<CapabilityCacheKey, any, never>
  invalidateProvider: (providerId: string) => Effect.Effect<void, never, never>
}>() {
  static readonly live = Layer.succeed(
    ProviderCache,
    ProviderCache.of({
      modelListCache: Cache.unsafeMake({
        capacity: MAX_CACHE_ENTRIES,
        timeToLive: MODEL_LIST_TTL
      }),
      capabilityCache: Cache.unsafeMake({
        capacity: MAX_CACHE_ENTRIES,
        timeToLive: CAPABILITY_TTL
      }),
      invalidateProvider: (providerId: string) => Effect.void
    })
  )
}

// Cache context and implementation
export interface ProviderCacheService {
  readonly modelListCache: Cache.Cache<ModelListCacheKey, string[], never>
  readonly capabilityCache: Cache.Cache<CapabilityCacheKey, any, never>
  readonly invalidateProvider: (providerId: string) => Effect.Effect<void>
}

// Create the cache service
export const makeProviderCache = Effect.gen(function* () {
  const providerService = yield* ProviderService
  
  // Model list cache with TTL
  const modelListCache = yield* Cache.make({
    capacity: MAX_CACHE_ENTRIES,
    timeToLive: MODEL_LIST_TTL,
    lookup: (key: ModelListCacheKey) => 
      Effect.gen(function* () {
        yield* modelListCacheMisses
        const result = yield* providerService.getModelList(key.providerId)
        return yield* result
      })
  })
  
  // Capability cache with TTL
  const capabilityCache = yield* Cache.make({
    capacity: MAX_CACHE_ENTRIES,
    timeToLive: CAPABILITY_TTL,
    lookup: (key: CapabilityCacheKey) => 
      Effect.gen(function* () {
        yield* capabilityCacheMisses
        const result = yield* providerService.getCapability(
          key.providerId, 
          key.modelId, 
          key.capability
        )
        return yield* result
      })
  })

  // Create invalidation hub
  const hub = yield* Hub.make<string>()
  const queue = yield* Queue.unbounded<string>()
  yield* Hub.subscribe(hub, queue)

  // Handle cache invalidation
  const invalidateProvider = (providerId: string) => 
    Effect.gen(function* () {
      // Clear cache entries for this provider
      yield* modelListCache.invalidateWhen(
        (key) => key.providerId === providerId
      )
      yield* capabilityCache.invalidateWhen(
        (key) => key.providerId === providerId
      )
    })

  return {
    modelListCache,
    capabilityCache,
    invalidateProvider
  } as ProviderCacheService
})

// Cache service layer
export const ProviderCacheServiceLive = Layer.effect(ProviderCache, makeProviderCache)

// Metrics layer
export const modelListCacheHits = Metric.counter("model_list_cache_hits")
export const modelListCacheMisses = Metric.counter("model_list_cache_misses")
export const capabilityCacheHits = Metric.counter("capability_cache_hits")
export const capabilityCacheMisses = Metric.counter("capability_cache_misses")

// Export the complete service
export const providerCacheService = pipe(
  makeProviderCache,
  Effect.map((service) => ({
    ...service,
    getModelListCached: (providerId: string) => 
      Effect.gen(function* () {
        const cache = yield* service.modelListCache
        const key = { providerId }
        const result = yield* Cache.get(cache, key)
        yield* modelListCacheHits
        return yield* result
      }).pipe(
        Effect.orElse(() => 
          Effect.gen(function* () {
            yield* modelListCacheMisses
            const result = yield* service.getModelList(providerId)
            return yield* Cache.set(service.modelListCache, { providerId }, result)
          })
        )
      )
  }))
) 