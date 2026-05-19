import { describe, it, expect } from "vitest";
import { Effect, Duration, TestClock } from "effect";
import { ProviderCacheService } from "../src/ProviderCache";

describe("ProviderCacheService", () => {
  it("should cache models and capabilities correctly", async () => {
    const service = new ProviderCacheService();
    
    let modelFetches = 0;
    const fetcher = (p: string) => Effect.sync(() => {
      modelFetches++;
      return { models: ["m1", "m2"], capabilities: [] };
    });

    const program = Effect.gen(function* (_) {
      // First fetch should hit the fetcher
      const res1 = yield* _(service.getModels("anthropic", fetcher));
      
      // Second fetch should hit the cache
      const res2 = yield* _(service.getModels("anthropic", fetcher));
      
      const metrics = yield* _(service.getMetrics());
      
      return { modelFetches, metrics };
    });

    const result = await Effect.runPromise(program);
    
    expect(result.modelFetches).toBe(1);
    expect(result.metrics.hits).toBe(1);
    expect(result.metrics.misses).toBe(1);
  });
});
