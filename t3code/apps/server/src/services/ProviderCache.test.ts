import { describe, it, expect } from "vitest"
import { Effect, Duration } from "effect"
import { ProviderCache, type ProviderConfig } from "./ProviderCache"

describe("ProviderCache", () => {
  const runTest = <A>(effect: Effect.Effect<A>) =>
    Effect.runPromise(effect.pipe(Effect.provide(ProviderCache.Default)))

  it("should cache model list and track hits/misses", async () => {
    await runTest(
      Effect.gen(function* () {
        const cache = yield* ProviderCache

        // First call - miss
        const models1 = yield* cache.getModelList("openai")
        expect(models1.providerId).toBe("openai")
        expect(models1.models).toHaveLength(2)

        // Second call - hit
        const models2 = yield* cache.getModelList("openai")
        expect(models2.providerId).toBe("openai")

        // Check metrics
        const metrics = yield* cache.getMetrics
        expect(metrics.modelListMisses).toBe(1)
        expect(metrics.modelListHits).toBe(1)
      })
    )
  })

  it("should cache capabilities and track hits/misses", async () => {
    await runTest(
      Effect.gen(function* () {
        const cache = yield* ProviderCache

        // First call - miss
        const caps1 = yield* cache.getCapabilities("openai")
        expect(caps1.providerId).toBe("openai")
        expect(caps1.supportsStreaming).toBe(true)

        // Second call - hit
        const caps2 = yield* cache.getCapabilities("openai")
        expect(caps2.providerId).toBe("openai")

        // Check metrics
        const metrics = yield* cache.getMetrics
        expect(metrics.capabilityMisses).toBe(1)
        expect(metrics.capabilityHits).toBe(1)
      })
    )
  })

  it("should invalidate cache on config change", async () => {
    await runTest(
      Effect.gen(function* () {
        const cache = yield* ProviderCache

        // Populate cache
        yield* cache.getModelList("openai")
        yield* cache.getCapabilities("openai")

        // Notify config change
        yield* cache.notifyConfigChange({
          id: "openai",
          name: "OpenAI",
          apiUrl: "https://api.openai.com",
          apiKey: "test",
          enabled: true,
        })

        // Wait for invalidation
        yield* Effect.sleep("100 millis")

        // Next call should be a miss
        yield* cache.getModelList("openai")

        const metrics = yield* cache.getMetrics
        expect(metrics.invalidations).toBeGreaterThanOrEqual(1)
        expect(metrics.modelListMisses).toBe(2) // Initial + after invalidation
      })
    )
  })

  it("should invalidate specific provider", async () => {
    await runTest(
      Effect.gen(function* () {
        const cache = yield* ProviderCache

        // Populate cache for multiple providers
        yield* cache.getModelList("openai")
        yield* cache.getModelList("anthropic")

        // Invalidate only openai
        yield* cache.invalidateProvider("openai")

        // OpenAI should be a miss, Anthropic should be a hit
        yield* cache.getModelList("openai")
        yield* cache.getModelList("anthropic")

        const metrics = yield* cache.getMetrics
        expect(metrics.modelListMisses).toBe(3) // 2 initial + 1 after invalidation
        expect(metrics.modelListHits).toBe(1) // Anthropic hit
      })
    )
  })

  it("should track invalidation count", async () => {
    await runTest(
      Effect.gen(function* () {
        const cache = yield* ProviderCache

        // Multiple invalidations
        yield* cache.invalidateProvider("openai")
        yield* cache.invalidateProvider("anthropic")
        yield* cache.invalidateProvider("openai")

        const metrics = yield* cache.getMetrics
        expect(metrics.invalidations).toBe(3)
      })
    )
  })

  it("should return metrics as JSON", async () => {
    await runTest(
      Effect.gen(function* () {
        const cache = yield* ProviderCache

        // Generate some activity
        yield* cache.getModelList("openai")
        yield* cache.getCapabilities("openai")
        yield* cache.invalidateProvider("openai")

        const json = yield* cache.getMetricsJson
        const parsed = JSON.parse(json)

        expect(parsed).toHaveProperty("modelListHits")
        expect(parsed).toHaveProperty("modelListMisses")
        expect(parsed).toHaveProperty("capabilityHits")
        expect(parsed).toHaveProperty("capabilityMisses")
        expect(parsed).toHaveProperty("invalidations")
      })
    )
  })
})
