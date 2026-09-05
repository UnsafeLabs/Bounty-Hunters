import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Layer } from "effect"
import { ProviderCache, makeProviderCache } from "./ProviderCache"

describe("ProviderCache", () => {
  let cache: Effect.Effect.Success<typeof makeProviderCache>

  beforeEach(async () => {
    cache = await Effect.runPromise(makeProviderCache)
  })

  it("should cache model list requests", async () => {
    // First request - cache miss
    const models1 = await Effect.runPromise(cache.getModelList("openai"))
    expect(models1).toHaveLength(2)
    expect(models1[0].provider).toBe("openai")

    // Second request - should be cached
    const models2 = await Effect.runPromise(cache.getModelList("openai"))
    expect(models2).toEqual(models1)
  })

  it("should cache capability requests", async () => {
    const capability = await Effect.runPromise(cache.getCapability("openai", "chat"))
    expect(capability.supported).toBe(true)
    expect(capability.provider).toBe("openai")
  })

  it("should invalidate provider cache", async () => {
    // Populate cache
    await Effect.runPromise(cache.getModelList("openai"))

    // Invalidate
    await Effect.runPromise(cache.invalidateProvider("openai"))

    // Next request should be a cache miss (but still work)
    const models = await Effect.runPromise(cache.getModelList("openai"))
    expect(models).toHaveLength(2)
  })

  it("should track cache stats", async () => {
    // Initial stats
    const stats1 = await Effect.runPromise(cache.getCacheStats())
    expect(stats1.hits).toBe(0)
    expect(stats1.misses).toBe(0)

    // Make some requests
    await Effect.runPromise(cache.getModelList("openai"))
    await Effect.runPromise(cache.getModelList("openai")) // Should be cached

    const stats2 = await Effect.runPromise(cache.getCacheStats())
    expect(stats2.misses).toBeGreaterThanOrEqual(1)
    expect(stats2.hits).toBeGreaterThanOrEqual(1)
  })

  it("should handle different providers independently", async () => {
    const openaiModels = await Effect.runPromise(cache.getModelList("openai"))
    const anthropicModels = await Effect.runPromise(cache.getModelList("anthropic"))

    expect(openaiModels[0].provider).toBe("openai")
    expect(anthropicModels[0].provider).toBe("anthropic")
  })
})
