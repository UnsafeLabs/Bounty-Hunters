import { Cache, Effect, Exit, Layer, Option, pipe } from "effect"
import { MetricsService } from "./MetricsService"
import { ProviderService } from "./ProviderService"
import { ConfigService } from "./ConfigService"

// Cache key types
type CacheKey = {
  readonly providerId: string
  readonly endpoint: string
  readonly query: string
}

// Cache entry types
interface CacheEntry {
  readonly data: unknown
  readonly timestamp: number
}

// Configuration
const MODEL_LIST_TTL = 5 * 60 * 1000 // 5 minutes
const CAPABILITY_TTL = 15 * 60 * 1000 // 15 minutes
const MAX_CACHE_SIZE = 1000

// Cache key constructors
const makeModelListKey = (providerId: string): CacheKey => ({
  providerId,
  endpoint: "models",
  query: ""
})

const makeCapabilityKey = (providerId: string, query: string): CacheKey => ({
  providerId,
  endpoint: "capabilities",
  query
})

// Cache key serializer
const serializeKey = (key: CacheKey): string => 
  `${key.providerId}:${key.endpoint}:${key.query}`

// Provider cache service
export class ProviderCache extends Effect.Tag("ProviderCache")<
  ProviderCache,
  {
    readonly getModelList: (providerId: string) => Effect.Effect<unknown, unknown>
    readonly getCapabilities: (providerId: string, query: string) => Effect.Effect<unknown, unknown>
    readonly invalidateProvider: (providerId: string) => Effect.Effect<void>
    readonly invalidateAll: () => Effect.Effect<void>
  }
>() {
  static readonly live = Layer.succeed(
    this,
    pipe(
      Effect.all([MetricsService, ProviderService, ConfigService]),
      Effect.map(([metrics, provider, config]) => {
        // Create caches with different TTLs
        const modelListCache = Cache.make(serializeKey, {
          timeToLive: MODEL_LIST_TTL,
          capacity: MAX_CACHE_SIZE
        }, (key: CacheKey) => 
          pipe(
            Effect.logDebug(`Model list cache miss for provider: ${key.providerId}`),
            Effect.zipRight(metrics.increment("provider_cache_miss", { 
              cache_type: "model_list",
              provider_id: key.providerId 
            })),
            Effect.zipRight(provider.listModels(key.providerId)),
            Effect.tap(() => 
              metrics.increment("provider_cache_hit", { 
                cache_type: "model_list",
                provider_id: key.providerId 
              })
            ),
            Effect.catchAll(error => 
              pipe(
                metrics.increment("provider_cache_error", { 
                  cache_type: "model_list",
                  provider_id: key.providerId 
                }),
                Effect.zipRight(Effect.fail(error))
              )
            )
          )
        )

        const capabilityCache = Cache.make(serializeKey, {
          timeToLive: CAPABILITY_TTL,
          capacity: MAX_CACHE_SIZE
        }, (key: CacheKey) => 
          pipe(
            Effect.logDebug(`Capability cache miss for provider: ${key.providerId}, query: ${key.query}`),
            Effect.zipRight(metrics.increment("provider_cache_miss", { 
              cache_type: "capability",
              provider_id: key.providerId 
            })),
            Effect.zipRight(provider.getCapabilities(key.providerId, key.query)),
            Effect.tap(() => 
              metrics.increment("provider_cache_hit", { 
                cache_type: "capability",
                provider_id: key.providerId 
              })
            ),
            Effect.catchAll(error => 
              pipe(
                metrics.increment("provider_cache_error", { 
                  cache_type: "capability",
                  provider_id: key.providerId 
                }),
                Effect.zipRight(Effect.fail(error))
              )
            )
          )
        )

        // Subscribe to config changes for cache invalidation
        const configSubscription = config.changes.pipe(
          Effect.tap(({ providerId }) => 
            pipe(
              Effect.logInfo(`Invalidating cache for provider: ${providerId}`),
              Effect.zipRight(Effect.all([
                modelListCache.remove(makeModelListKey(providerId)),
                capabilityCache.remove(makeModelListKey(providerId)) // This will remove all capabilities for this provider
              ]))
            )
          ),
          Effect.runInDaemon
        )

        // Start the subscription
        configSubscription

        return {
          getModelList: (providerId: string) => 
            modelListCache.get(makeModelListKey(providerId)),

          getCapabilities: (providerId: string, query: string) => 
            capabilityCache.get(makeCapabilityKey(providerId, query)),

          invalidateProvider: (providerId: string) => 
            pipe(
              Effect.logInfo(`Manually invalidating cache for provider: ${providerId}`),
              Effect.zipRight(Effect.all([
                modelListCache.remove(makeModelListKey(providerId)),
                capabilityCache.remove(makeModelListKey(providerId))
              ]))
            ),

          invalidateAll: () => 
            pipe(
              Effect.logInfo("Invalidating all provider caches"),
              Effect.zipRight(Effect.all([
                modelListCache.removeAll(),
                capabilityCache.removeAll()
              ]))
            )
        }
      })
    )
  )
}