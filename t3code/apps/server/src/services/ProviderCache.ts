import * as Effect from 'effect'
import * as Cache from 'effect/Cache'
import * as Duration from 'effect/Duration'
import * as Layer from 'effect/Layer'
import * as Metric from 'effect/Metric'
import * as MetricState from 'effect/MetricState'
import * as Context from 'effect/Context'
import * as HashMap from 'effect/HashMap'
import * as Schema from 'effect/Schema'
import * as ProviderService from '../providers/service'
import * as ProviderModel from '../providers/model'

// Define cache configuration
interface CacheConfig {
  modelListTTL: Duration.Duration
  capabilityTTL: Duration.Duration
  maxSize: number
}

// Provider cache service
export class ProviderCache extends Effect.Service<ProviderCache>()({
  serviceName: 'ProviderCache',
  Service: ProviderCache,
  accessors: {}
}) {
  constructor() {
    super()
  }
}

// Cache configuration constants
const DEFAULT_MODEL_LIST_TTL = Duration.minutes(5)
const DEFAULT_CAPABILITY_TTL = Duration.minutes(15)
const DEFAULT_MAX_CACHE_SIZE = 1000

// Metrics for cache performance
const cacheHitMetric = Metric.counter('provider_cache_hits')
const cacheMissMetric = Metric.counter('provider_cache_misses')

// Create cache instances
const modelListCache = Cache.make(
  (providerId: string) => ProviderService.getProviderModels(providerId),
  DEFAULT_MODEL_LIST_TTL
)

const capabilityCache = Cache.make(
  (providerId: string, modelId: string) => ProviderService.getProviderCapabilities(providerId, modelId),
  DEFAULT_CAPABILITY_TTL
)

// Cache invalidation hub
const providerConfigHub = Effect.hub.empty
  .pipe(
    Effect.map(() => 
      Effect.sync(() => {
        // Invalidate all cache entries for provider
        Cache.invalidateAll(modelListCache)
        Cache.invalidateAll(capabilityCache)
      })
    )
  )

// Cache layer
export const ProviderCacheLive = Layer.effect(
  ProviderCache,
  Effect.gen(function*(_) {
    const modelCache = yield* _(Cache.make(
      (providerId: string) => ProviderService.getProviderModels(providerId),
      DEFAULT_MODEL_LIST_TTL
    ))
    
    const capabilityCache = yield* _(Cache.make(
      (providerId: string, modelId: string) => ProviderService.getProviderCapabilities(providerId, modelId),
      DEFAULT_CAPABILITY_TTL
    ))
    
    // Subscribe to provider config changes
    yield* _(providerConfigHub)
    
    return ProviderCache.of({
      modelListCache: modelCache,
      capabilityCache: capabilityCache
    })
  })
)

// Cache metrics
export const recordCacheMetrics = (hit: boolean) => 
  hit ? 
    Metric.increment(cacheHitMetric) : 
    Metric.increment(cacheMissMetric)

// Cache service functions
export const getProviderModels = (providerId: string) => 
  Cache.get(modelListCache, providerId)

export const getProviderCapabilities = (providerId: string, modelId: string) => 
  Cache.get(capabilityCache, providerId, modelId)

// Export the cache layer
export const { modelListCache, capabilityCache } = ProviderCache