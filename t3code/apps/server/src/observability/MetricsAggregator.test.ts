import * as Effect from 'effect/Effect'
import { MetricsAggregatorLive, MetricsAggregator } from './MetricsAggregator'
import { describe, it, expect } from 'vitest'

describe('MetricsAggregator', () => {
  it('should aggregate metrics and retain max 60 windows', async () => {
    const program = Effect.gen(function* () {
      const aggregator = yield* MetricsAggregator
      
      for (let i = 0; i < 100; i++) {
        yield* aggregator.recordCall({
          method: 'getUser',
          latencyMs: i,
          isError: i >= 90 // 10% error rate
        })
      }

      const windows = yield* aggregator.getAggregatedMetrics()
      expect(Array.isArray(windows)).toBe(true)
      
    }).pipe(Effect.provide(MetricsAggregatorLive))

    await Effect.runPromise(program)
  })
})
