import { Effect, pipe } from "effect"
import * as Cache from "effect/Cache"
import * as Layer from "effect/Layer"
import * as T from "effect/Types"
import * as Duration from "effect/Duration"
import * as Metric from "effect/Metric"
import type { ProviderId } from "../types"

interface ProviderCacheConfig {
  modelListTTL: Duration.Duration
  capabilityTTL: Duration.Duration
  maxEntries: number
}

interface ProviderCacheMetrics {
  modelListHits: Metric.Counter<number>
  modelListMisses: Metric.Counter<number>
  capabilityHits: Metric.Counter<number>
  capabilityMisses: Metric.Counter<number>
}

export interface ProviderCache {
  readonly modelList: (providerId: string) => Effect.Effect<never, never, string[]>
  readonly modelCapabilities: (providerId: string, modelId: string) => Effect.Effect<never, never, unknown>
  readonly invalidate: (providerId: string) => void
  readonly invalidateAll: () => void
}

export const makeProviderCache = (config: ProviderCacheConfig): Effect.Effect<never, never, ProviderCache> => {
  return Effect.gen(function* (_) {
    const modelListCache = yield* _(Cache.make(
      (key: string) => Effect.succeed(`fetching models for ${key}`),
      config.modelListTTL
    ))

    const capabilityCache = yield* _(Cache.make(
      (providerId: string, modelId: string) => Effect.succeed(`fetching capabilities for ${providerId}-${modelId}`),
      config.capabilityTTL
    ))

    const cache: ProviderCache = {
      modelList: (providerId: string) => 
        pipe(
          modelListCache.get(providerId),
          Effect.catchAll(() => 
            pipe(
              fetchModelList(providerId),
              Effect.tap((models) => 
                Effect.log(`Cache miss: fetching model list for ${providerId}`)
              ),
              Effect.flatMap((models) => {
                const modelList = models.map(m => m.id)
                return modelListCache.set(providerId, modelList)
              })
            )
          ),
          Effect.flatMap(() => 
            pipe(
              modelListCache.get(providerId),
              Effect.catchAll(() => Effect.succeed(modelListCache.set(providerId, [])))
            )
          )
        ),
      modelCapabilities: (providerId: string, modelId: string) => 
        pipe(
          capabilityCache.get([providerId, modelId]),
          Effect.catchAll(() => 
            pipe(
              fetchModelCapabilities(providerId, modelId),
              Effect.tap((caps) => 
                Effect.log(`Cache miss: fetching capabilities for ${providerId}/${modelId}`))
            )
          ),
          Effect.flatMap((caps) => {
            return capabilityCache.set([providerId, modelId], caps)
          })
        ),
      invalidate: (providerId: string) => {
        modelListCache.remove(providerId)
        capabilityCache.keys.forEach(key => {
          if (key[0] === providerId) {
            capabilityCache.remove(key)
          }
        })
      },
      invalidateAll: () => {
        modelListCache.clear()
        capabilityCache.clear()
      }
    }

    return cache
  })
}

export const ProviderCacheLive = Layer.succeed(
  makeProviderCache({
    modelListTTL: Duration.minutes(5),
    capabilityTTL: Duration.minutes(15),
    maxEntries: 1000
  })
)

const fetchModelList = (providerId: string) => 
  Effect.tryPromise({
    try: async () => {
      const cache = await modelListCache.get(providerId)
      return cache.keys().map(key => key[0])
    },
    catch: () => new Error("Failed to fetch model list")
  })

const fetchModelCapabilities = (providerId: string, modelId: string) => 
  Effect.tryPromise({
    try: async () => {
      const cache = await capabilityCache.get([providerId, modelId])
      return cache.entries().map(entry => entry[1])
    },
    catch: () => new Error("Failed to fetch model capabilities")
  })