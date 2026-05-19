import { Effect } from 'effect'
import { ProviderCacheLive, ProviderCache } from './ProviderCache'
import { describe, it, expect } from 'vitest'

describe('ProviderCache', () => {
  it('should test caching logic', async () => {
    let callCount = 0

    const program = Effect.gen(function* () {
      const cache = yield* ProviderCache
      
      const fetchFn = Effect.sync(() => {
        callCount++
        return { data: "models" }
      })

      // First call -> miss
      const res1 = yield* cache.getModels('prov1', fetchFn)
      expect(res1.data).toBe("models")
      expect(callQueueCount()).toBe(1) // we check callCount later

      // Second call -> hit
      const res2 = yield* cache.getModels('prov1', fetchFn)
      expect(res2.data).toBe("models")

      const metrics = yield* cache.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(1)

      // Invalidate
      yield* cache.invalidateProvider('prov1')

      // Third call -> miss
      const res3 = yield* cache.getModels('prov1', fetchFn)
      expect(res3.data).toBe("models")

      const metrics2 = yield* cache.getMetrics()
      expect(metrics2.hits).toBe(1)
      expect(metrics2.misses).toBe(2)
      
    }).pipe(Effect.provide(ProviderCacheLive))

    await Effect.runPromise(program)
    expect(callCount).toBe(2)

    function callQueueCount() {
      return callCount
    }
  })
})
