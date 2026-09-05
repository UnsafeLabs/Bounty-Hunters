import { Effect, Cache, Hub, Metric, Context } from "effect"

// Types
interface ModelInfo {
  id: string
  name: string
  provider: string
}

interface ProviderCapability {
  provider: string
  capability: string
  supported: boolean
}

// Cache configuration
const MODEL_LIST_TTL = 5 * 60 * 1000 // 5 minutes
const CAPABILITY_TTL = 15 * 60 * 1000 // 15 minutes
const MAX_CACHE_ENTRIES = 1000

// Metrics
const cacheHits = Metric.counter("provider_cache_hits_total", "Total cache hits")
const cacheMisses = Metric.counter("provider_cache_misses_total", "Total cache misses")

// Cache service layer
export class ProviderCache extends Context.Tag("ProviderCache")<
  ProviderCache,
  {
    readonly getModelList: (provider: string) => Effect.Effect<ModelInfo[], never, never>
    readonly getCapability: (provider: string, capability: string) => Effect.Effect<ProviderCapability, never, never>
    readonly invalidateProvider: (provider: string) => Effect.Effect<void>
    readonly getCacheStats: () => Effect.Effect<{ hits: number; misses: number }>
  }
>() {}

// Provider API client (simulated)
const fetchModelListFromAPI = (provider: string): Effect.Effect<ModelInfo[], never, never> =>
  Effect.gen(function* () {
    // Simulate API call
    yield* Effect.sleep("100 milliseconds")
    return [
      { id: `${provider}-model-1`, name: `${provider} Model 1`, provider },
      { id: `${provider}-model-2`, name: `${provider} Model 2`, provider },
    ]
  })

const fetchCapabilityFromAPI = (provider: string, capability: string): Effect.Effect<ProviderCapability, never, never> =>
  Effect.gen(function* () {
    // Simulate API call
    yield* Effect.sleep("50 milliseconds")
    return { provider, capability, supported: true }
  })

// Cache implementation
export const makeProviderCache = Effect.gen(function* () {
  // Create caches with TTL
  const modelListCache = yield* Cache.make({
    capacity: MAX_CACHE_ENTRIES,
    timeToLive: MODEL_LIST_TTL,
    lookup: (provider: string) =>
      Effect.gen(function* () {
        yield* Effect.log(`Cache miss for model list: ${provider}`)
        yield* Metric.increment(cacheMisses)
        return yield* fetchModelListFromAPI(provider)
      }),
  })

  const capabilityCache = yield* Cache.make({
    capacity: MAX_CACHE_ENTRIES,
    timeToLive: CAPABILITY_TTL,
    lookup: ([provider, capability]: [string, string]) =>
      Effect.gen(function* () {
        yield* Effect.log(`Cache miss for capability: ${provider}/${capability}`)
        yield* Metric.increment(cacheMisses)
        return yield* fetchCapabilityFromAPI(provider, capability)
      }),
  })

  // Hub for invalidation events
  const invalidationHub = yield* Hub.make<string>()

  // Subscribe to invalidation events
  yield* Hub.subscribe(invalidationHub).pipe(
    Effect.tap((provider) =>
      Effect.gen(function* () {
        yield* Effect.log(`Invalidating cache for provider: ${provider}`)
        yield* Cache.invalidate(modelListCache, provider)
        // Invalidate all capabilities for this provider
        yield* Cache.invalidateAll(capabilityCache)
      })
    ),
    Effect.run
  )

  return {
    getModelList: (provider: string) =>
      Effect.gen(function* () {
        const cached = yield* Cache.get(modelListCache, provider)
        yield* Metric.increment(cacheHits)
        return cached
      }),

    getCapability: (provider: string, capability: string) =>
      Effect.gen(function* () {
        const cached = yield* Cache.get(capabilityCache, [provider, capability])
        yield* Metric.increment(cacheHits)
        return cached
      }),

    invalidateProvider: (provider: string) =>
      Effect.gen(function* () {
        yield* Hub.publish(invalidationHub, provider)
      }),

    getCacheStats: () =>
      Effect.gen(function* () {
        const hits = yield* Metric.value(cacheHits)
        const misses = yield* Metric.value(cacheMisses)
        return { hits, misses }
      }),
  }
})

// Layer for dependency injection
export const ProviderCacheLive = Layer.succeed(ProviderCache, yield* makeProviderCache)
