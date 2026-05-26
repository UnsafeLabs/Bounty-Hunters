import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import {
  ProviderCache,
  ProviderCacheLive,
  MODEL_LIST_TTL_MS,
  CAPABILITIES_TTL_MS,
  MAX_CACHE_ENTRIES,
  type ProviderModel,
  type ProviderCapabilities,
} from "./ProviderCache.ts";

describe("ProviderCache", () => {
  const TestLayer = ProviderCacheLive;

  it.effect("returns cached model list and hits increase", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      const result1 = yield* cache.getModelList("test-provider");
      assert.ok(result1.length > 0);
      assert.equal(result1[0]!.provider, "test-provider");

      const metrics1 = yield* cache.getMetrics();
      assert.ok(metrics1.misses >= 1); // first call is a miss

      // Second call should be a cache hit
      const result2 = yield* cache.getModelList("test-provider");
      assert.deepStrictEqual(result1, result2);

      const metrics2 = yield* cache.getMetrics();
      assert.ok(metrics2.hits > metrics1.hits);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns cached capabilities", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      const caps = yield* cache.getCapabilities("openai");
      assert.equal(caps.provider, "openai");
      assert.equal(caps.supportsStreaming, true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("invalidateProvider removes entries for that provider", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      yield* cache.getModelList("test-provider");
      yield* cache.getCapabilities("test-provider");

      const before = yield* cache.getMetrics();
      assert.ok(before.misses >= 2);

      yield* cache.invalidateProvider("test-provider");

      // After invalidation, next call should be a miss
      yield* cache.getModelList("test-provider");
      const after = yield* cache.getMetrics();
      assert.ok(after.misses > before.misses);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("invalidateAll clears all caches", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      yield* cache.getModelList("provider-a");
      yield* cache.getModelList("provider-b");
      yield* cache.invalidateAll();

      const metrics = yield* cache.getMetrics();
      // After invalidateAll, next calls should be misses
      yield* cache.getModelList("provider-a");
      const after = yield* cache.getMetrics();
      assert.ok(after.misses > metrics.misses);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("getMetrics returns current hit/miss counts", () =>
    Effect.gen(function* () {
      const cache = yield* ProviderCache;
      const metrics = yield* cache.getMetrics();
      assert.ok(typeof metrics.hits === "number");
      assert.ok(typeof metrics.misses === "number");
    }).pipe(Effect.provide(TestLayer)),
  );
});
