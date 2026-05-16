/**
 * ProviderCache Service
 * 
 * Caches provider API responses with configurable TTL using Effect.Cache.
 * Reduces latency and API quota consumption for repeated provider queries.
 * 
 * Features:
 * - Configurable TTL per cache type (model list: 5min, capabilities: 15min)
 * - Cache invalidation on provider config changes via Effect.Hub
 * - Cache hit/miss metrics exposed through observability layer
 * - Concurrent request deduplication (one API call per unique key)
 * - Bounded memory usage via max cache entry count
 */

import { Effect, Cache, Duration, Hub, Ref, pipe, Schedule } from "effect"

// ============================================================================
// Types
// ============================================================================

/** Provider configuration */
export interface ProviderConfig {
  readonly id: string
  readonly name: string
  readonly apiUrl: string
  readonly apiKey: string
  readonly enabled: boolean
}

/** Model listing from provider */
export interface ModelList {
  readonly providerId: string
  readonly models: Array<{
    readonly id: string
    readonly name: string
    readonly description: string
    readonly maxTokens: number
    readonly pricing: {
      readonly input: number
      readonly output: number
    }
  }>
  readonly fetchedAt: number
}

/** Provider capabilities */
export interface ProviderCapabilities {
  readonly providerId: string
  readonly supportsStreaming: boolean
  readonly supportsFunctionCalling: boolean
  readonly supportsVision: boolean
  readonly maxContextLength: number
  readonly fetchedAt: number
}

/** Cache metrics */
export interface CacheMetrics {
  readonly modelListHits: number
  readonly modelListMisses: number
  readonly capabilityHits: number
  readonly capabilityMisses: number
  readonly invalidations: number
}

/** Cache configuration */
export interface CacheConfig {
  readonly modelListTTL: Duration.Duration
  readonly capabilityTTL: Duration.Duration
  readonly maxEntries: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const defaultCacheConfig: CacheConfig = {
  modelListTTL: Duration.minutes(5),
  capabilityTTL: Duration.minutes(15),
  maxEntries: 1000,
}

// ============================================================================
// ProviderCache Service
// ============================================================================

export class ProviderCache extends Effect.Service<ProviderCache>()("ProviderCache", {
  accessors: true,
  effect: Effect.gen(function* () {
    // Configuration
    const configRef = yield* Ref.make<CacheConfig>(defaultCacheConfig)

    // Metrics
    const metricsRef = yield* Ref.make<CacheMetrics>({
      modelListHits: 0,
      modelListMisses: 0,
      capabilityHits: 0,
      capabilityMisses: 0,
      invalidations: 0,
    })

    // Provider config hub for invalidation events
    const configHub = yield* Hub.sliding<ProviderConfig>(16)

    // Model list cache
    const modelListCache = yield* Cache.make({
      capacity: defaultCacheConfig.maxEntries,
      timeToLive: defaultCacheConfig.modelListTTL,
      lookup: (providerId: string) =>
        Effect.gen(function* () {
          // Increment miss counter
          yield* Ref.update(metricsRef, (m) => ({
            ...m,
            modelListMisses: m.modelListMisses + 1,
          }))

          // Fetch from provider API
          const models = yield* fetchModelListFromProvider(providerId)

          return {
            providerId,
            models,
            fetchedAt: Date.now(),
          }
        }),
    })

    // Capability cache
    const capabilityCache = yield* Cache.make({
      capacity: defaultCacheConfig.maxEntries,
      timeToLive: defaultCacheConfig.capabilityTTL,
      lookup: (providerId: string) =>
        Effect.gen(function* () {
          // Increment miss counter
          yield* Ref.update(metricsRef, (m) => ({
            ...m,
            capabilityMisses: m.capabilityMisses + 1,
          }))

          // Fetch from provider API
          const capabilities = yield* fetchCapabilitiesFromProvider(providerId)

          return {
            providerId,
            ...capabilities,
            fetchedAt: Date.now(),
          }
        }),
    })

    // Subscribe to config changes for cache invalidation
    yield* configHub.pipe(
      Hub.subscribe,
      Effect.flatMap((subscription) =>
        Effect.forever(
          Effect.gen(function* () {
            const config = yield* Queue.take(subscription)
            
            // Invalidate caches for this provider
            yield* Cache.invalidate(modelListCache, config.id)
            yield* Cache.invalidate(capabilityCache, config.id)
            
            // Increment invalidation counter
            yield* Ref.update(metricsRef, (m) => ({
              ...m,
              invalidations: m.invalidations + 1,
            }))
          })
        )
      ),
      Effect.forkDaemon,
    )

    // ============================================================================
    // Public API
    // ============================================================================

    /**
     * Get model list for a provider (cached)
     */
    const getModelList = (providerId: string) =>
      Effect.gen(function* () {
        const result = yield* Cache.get(modelListCache, providerId)
        
        // Increment hit counter
        yield* Ref.update(metricsRef, (m) => ({
          ...m,
          modelListHits: m.modelListHits + 1,
        }))

        return result
      })

    /**
     * Get provider capabilities (cached)
     */
    const getCapabilities = (providerId: string) =>
      Effect.gen(function* () {
        const result = yield* Cache.get(capabilityCache, providerId)
        
        // Increment hit counter
        yield* Ref.update(metricsRef, (m) => ({
          ...m,
          capabilityHits: m.capabilityHits + 1,
        }))

        return result
      })

    /**
     * Invalidate cache for a specific provider
     */
    const invalidateProvider = (providerId: string) =>
      Effect.gen(function* () {
        yield* Cache.invalidate(modelListCache, providerId)
        yield* Cache.invalidate(capabilityCache, providerId)
        
        yield* Ref.update(metricsRef, (m) => ({
          ...m,
          invalidations: m.invalidations + 1,
        }))
      })

    /**
     * Notify config change (triggers cache invalidation)
     */
    const notifyConfigChange = (config: ProviderConfig) =>
      Hub.publish(configHub, config)

    /**
     * Get cache metrics
     */
    const getMetrics = Ref.get(metricsRef)

    /**
     * Get metrics as JSON string
     */
    const getMetricsJson = getMetrics.pipe(
      Effect.map((metrics) => JSON.stringify(metrics, null, 2))
    )

    /**
     * Update cache configuration
     */
    const updateConfig = (newConfig: Partial<CacheConfig>) =>
      Ref.update(configRef, (current) => ({ ...current, ...newConfig }))

    return {
      getModelList,
      getCapabilities,
      invalidateProvider,
      notifyConfigChange,
      getMetrics,
      getMetricsJson,
      updateConfig,
    } as const
  }),
}) {}

// ============================================================================
// Provider API Fetchers (Placeholder implementations)
// ============================================================================

/**
 * Fetch model list from provider API
 * In production, this would make actual HTTP requests
 */
const fetchModelListFromProvider = (providerId: string) =>
  Effect.gen(function* () {
    // Simulate API call
    yield* Effect.sleep("100 millis")

    // Return mock data
    return [
      {
        id: `${providerId}-model-1`,
        name: "Model 1",
        description: "First model",
        maxTokens: 4096,
        pricing: { input: 0.01, output: 0.02 },
      },
      {
        id: `${providerId}-model-2`,
        name: "Model 2",
        description: "Second model",
        maxTokens: 8192,
        pricing: { input: 0.02, output: 0.04 },
      },
    ]
  })

/**
 * Fetch capabilities from provider API
 * In production, this would make actual HTTP requests
 */
const fetchCapabilitiesFromProvider = (providerId: string) =>
  Effect.gen(function* () {
    // Simulate API call
    yield* Effect.sleep("50 millis")

    // Return mock data
    return {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsVision: false,
      maxContextLength: 4096,
    }
  })

// ============================================================================
// Example Usage
// ============================================================================

export const example = Effect.gen(function* () {
  const cache = yield* ProviderCache

  // First call - cache miss
  const models1 = yield* cache.getModelList("openai")
  yield* Effect.log("First call (miss):", models1)

  // Second call - cache hit
  const models2 = yield* cache.getModelList("openai")
  yield* Effect.log("Second call (hit):", models2)

  // Get metrics
  const metrics = yield* cache.getMetrics
  yield* Effect.log("Metrics:", metrics)

  // Invalidate and re-fetch
  yield* cache.invalidateProvider("openai")
  const models3 = yield* cache.getModelList("openai")
  yield* Effect.log("After invalidation (miss):", models3)

  // Final metrics
  const finalMetrics = yield* cache.getMetrics
  yield* Effect.log("Final metrics:", finalMetrics)
})

// Run if executed directly
if (require.main === module) {
  Effect.runPromise(example).catch(console.error)
}
