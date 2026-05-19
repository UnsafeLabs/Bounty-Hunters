import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Cache from 'effect/Cache'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Ref from 'effect/Ref'

export interface ProviderCacheShape {
  readonly getModels: (providerId: string, fetchFn: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>
  readonly getCapabilities: (providerId: string, fetchFn: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>
  readonly invalidateProvider: (providerId: string) => Effect.Effect<void>
  readonly getMetrics: () => Effect.Effect<{ hits: number, misses: number }>
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "@services/ProviderCache"
) {}

export const ProviderCacheLive = Layer.effect(
  ProviderCache,
  Effect.gen(function* () {
    const hits = yield* Ref.make(0)
    const misses = yield* Ref.make(0)

    const modelsFetchFns = yield* Ref.make(new Map<string, Effect.Effect<any, any, any>>())
    const capabilitiesFetchFns = yield* Ref.make(new Map<string, Effect.Effect<any, any, any>>())

    const modelsPresent = yield* Ref.make(new Set<string>())
    const capabilitiesPresent = yield* Ref.make(new Set<string>())

    const modelsCache = yield* Cache.make({
      capacity: 1000,
      timeToLive: Duration.minutes(5),
      lookup: (providerId: string) => Effect.gen(function* () {
        yield* Ref.update(misses, n => n + 1)
        yield* Ref.update(modelsPresent, s => new Set(s).add(providerId))
        const map = yield* Ref.get(modelsFetchFns)
        const fn = map.get(providerId)
        if (!fn) return yield* Effect.fail(new Error("No fetch fn"))
        return yield* fn
      })
    })

    const capabilitiesCache = yield* Cache.make({
      capacity: 1000,
      timeToLive: Duration.minutes(15),
      lookup: (providerId: string) => Effect.gen(function* () {
        yield* Ref.update(misses, n => n + 1)
        yield* Ref.update(capabilitiesPresent, s => new Set(s).add(providerId))
        const map = yield* Ref.get(capabilitiesFetchFns)
        const fn = map.get(providerId)
        if (!fn) return yield* Effect.fail(new Error("No fetch fn"))
        return yield* fn
      })
    })

    return ProviderCache.of({
      getModels: (providerId, fetchFn) => Effect.gen(function*() {
        const set = yield* Ref.get(modelsPresent)
        if (set.has(providerId)) {
          yield* Ref.update(hits, n => n + 1)
        }
        yield* Ref.update(modelsFetchFns, map => {
          const newMap = new Map(map)
          newMap.set(providerId, fetchFn)
          return newMap
        })
        return yield* Cache.get(modelsCache, providerId)
      }),
      getCapabilities: (providerId, fetchFn) => Effect.gen(function*() {
        const set = yield* Ref.get(capabilitiesPresent)
        if (set.has(providerId)) {
          yield* Ref.update(hits, n => n + 1)
        }
        yield* Ref.update(capabilitiesFetchFns, map => {
          const newMap = new Map(map)
          newMap.set(providerId, fetchFn)
          return newMap
        })
        return yield* Cache.get(capabilitiesCache, providerId)
      }),
      invalidateProvider: (providerId) => Effect.gen(function*() {
        yield* Ref.update(modelsPresent, s => { const ns = new Set(s); ns.delete(providerId); return ns; })
        yield* Ref.update(capabilitiesPresent, s => { const ns = new Set(s); ns.delete(providerId); return ns; })
        
        yield* Effect.ignore(Cache.invalidate(modelsCache, providerId))
        yield* Effect.ignore(Cache.invalidate(capabilitiesCache, providerId))
      }),
      getMetrics: () => Effect.gen(function*() {
        return {
          hits: yield* Ref.get(hits),
          misses: yield* Ref.get(misses)
        }
      })
    })
  })
)
